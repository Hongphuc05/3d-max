// Handler cua mot job dong bo: SCANNING -> COMPARING -> DOWNLOADING_PREVIEWS -> PUBLISHING.
// Moi giai doan doc lai checkpoint tu DB nen job bi gian doan (SIGTERM, worker chet) tiep tuc dung cho.
// Chi PUBLISHING ghi vao catalog, trong 1 transaction; tat ca giai doan truoc chi tao du lieu trung gian.
import { createDriveClient } from '../drive/client.js';
import { messageFor } from '../drive/errors.js';
import { computeDiff } from './diff.js';
import { runPreviewStage } from './previews.js';
import { publishPlan } from './publish.js';
import { scanSource } from './scan.js';

const CODE = /^[A-Z][A-Z0-9_]{1,60}$/;
const failed = (code) => ({ status: 'FAILED', errorCode: code, errorMessage: messageFor(code) ?? messageFor('JOB_HANDLER_ERROR') });

// Ket qua cua mot giai doan -> cach ket thuc job (null = chay tiep).
function stopped(r) {
  if (r.leaseLost) return { interrupted: true }; // runner bo qua ket qua khi da mat lease
  if (r.status === 'CANCELLED') return { status: 'CANCELLED' };
  if (r.interrupted) return { interrupted: true };
  return null;
}
const planCounters = (plan, scanSkipped) => ({
  newCount: plan.counters.newCount, updatedCount: plan.counters.updatedCount, unchangedCount: plan.counters.unchangedCount,
  missingCount: plan.counters.missingCount, reviewCount: plan.counters.reviewCount, skippedCount: scanSkipped + plan.counters.skippedCount,
});

export function createSyncHandler({ pool, previewDir, minFreeDiskBytes, defaultPriceVnd, previewDelayMs, previewConcurrency, apiKey, createClient, freeDiskBytes }) {
  const makeClient = createClient ?? (() => createDriveClient({ apiKey }));
  const reload = async (id) => (await pool.query('select * from drive_sync_jobs where id = $1', [id])).rows[0];

  async function run(job, ctx) {
    const source = (await pool.query('select * from drive_sources where id = $1', [job.source_id])).rows[0];
    if (!source?.enabled || source.access_mode !== 'API_KEY') return failed('DRIVE_NOT_CONNECTED');
    const client = makeClient(source);
    let cur = job;

    if (!cur.checkpoint?.scan?.done) {
      const s = stopped(await scanSource({ pool, client, job: cur, source, ctx }));
      if (s) return s;
      cur = await reload(job.id);
    }

    const plan = await computeDiff(pool, { sourceId: source.id, jobId: job.id });
    const scanSkipped = cur.checkpoint?.scan?.counters?.skippedCount ?? 0;
    if (!(await ctx.saveProgress({ stage: 'COMPARING', counters: planCounters(plan, scanSkipped) }))) return { interrupted: true };

    const p = await runPreviewStage({ pool, client, job: cur, images: plan.previews, checkpoint: cur.checkpoint ?? {}, ctx, previewDir, minFreeDiskBytes, freeDiskBytes, delayMs: previewDelayMs, concurrency: previewConcurrency });
    const s2 = stopped(p);
    if (s2) return s2;

    // Diem dung an toan cuoi cung: publish la mot transaction, khong the bi cat ngang.
    if (ctx.cancelled) return { status: 'CANCELLED' };
    if (ctx.shuttingDown) return { interrupted: true };
    if (!(await ctx.saveProgress({ stage: 'PUBLISHING' }))) return { interrupted: true };
    const fresh = await computeDiff(pool, { sourceId: source.id, jobId: job.id }); // khong dung ke hoach cu: admin co the da sua trong luc tai anh
    await publishPlan(pool, { sourceId: source.id, jobId: job.id, plan: fresh, results: p.results, defaultPriceVnd });
    await ctx.saveProgress({ counters: planCounters(fresh, scanSkipped) });
    await pool.query('update drive_sources set last_successful_sync_at = now() where id = $1', [source.id]);
    return { status: (await reload(job.id)).error_count > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED' };
  }

  return async function handleSyncJob(job, ctx) {
    try { return await run(job, ctx); } catch (e) {
      // Loi da biet (DRIVE_*, DISK_SPACE_LOW...) -> ma + thong diep tieng Viet. Loi la: chi ghi TEN loi vao log, khong co noi dung.
      const code = CODE.test(e?.code ?? '') && messageFor(e.code) ? e.code : 'JOB_HANDLER_ERROR';
      if (code === 'JOB_HANDLER_ERROR') console.error('[worker] unexpected error:', e?.name ?? 'Error', typeof e?.code === 'string' ? e.code : '');
      return failed(code);
    }
  };
}
