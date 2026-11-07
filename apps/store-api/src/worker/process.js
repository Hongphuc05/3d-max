// Handler cua mot job dong bo: SCANNING -> COMPARING -> PUBLISHING. D29: khong tai anh tu Drive (anh do admin tai len).
// Moi giai doan doc lai checkpoint tu DB nen job bi gian doan (SIGTERM, worker chet) tiep tuc dung cho.
// Chi PUBLISHING ghi vao catalog, trong 1 transaction; tat ca giai doan truoc chi tao du lieu trung gian.
import { createDriveClient } from '../drive/client.js';
import { messageFor } from '../drive/errors.js';
import { captureArchiveSnapshot, latestArchiveSnapshot } from './archive-snapshot.js';
import { computeDiff } from './diff.js';
import { publishPlan } from './publish.js';
import { scanSource } from './scan.js';
import { isModelLibrarySource } from './model-scope.js';

const CODE = /^[A-Z][A-Z0-9_]{1,60}$/;

const failed = (code) => ({ status: 'FAILED', errorCode: code, errorMessage: messageFor(code) ?? messageFor('JOB_HANDLER_ERROR') });

// Ket qua cua mot giai doan -> cach ket thuc job (null = chay tiep).
function stopped(r) {
  if (r.leaseLost) return { interrupted: true }; // runner bo qua ket qua khi da mat lease
  if (r.status === 'CANCELLED') return { status: 'CANCELLED' };
  if (r.interrupted) return { interrupted: true };
  return null;
}
// So "Can duyet" cua luot = so muc DANG CHO duyet (OPEN) sau luot nay: muc dang mo + muc moi trong ke hoach. Muc da xu ly van bi quet thay nhung
// khong bi mo lai (trung van tay) nen khong tinh; nhu vay so nay giam khi admin duyet, thay vi luon bang so muc 'phat hien'.
async function openReviewCount(pool, sourceId, plan) {
  const open = Number((await pool.query("select count(*) from review_items where source_id = $1 and status = 'OPEN' and content_domain = $2", [sourceId, plan.contentDomain ?? '3dmodels'])).rows[0].count);
  const fingerprints = [...new Set(plan.reviews.map((r) => r.payload.fingerprint))];
  const known = new Set((await pool.query("select payload->>'fingerprint' as fp from review_items where source_id = $1 and payload->>'fingerprint' = any($2::text[]) and content_domain = $3", [sourceId, fingerprints, plan.contentDomain ?? '3dmodels'])).rows.map((r) => r.fp));
  return open + fingerprints.filter((fp) => !known.has(fp)).length;
}
const planCounters = (plan, scanSkipped) => ({
  newCount: plan.counters.newCount, updatedCount: plan.counters.updatedCount, unchangedCount: plan.counters.unchangedCount,
  missingCount: plan.counters.missingCount, reviewCount: plan.counters.reviewCount, skippedCount: scanSkipped + plan.counters.skippedCount,
});

export function createSyncHandler({ pool, apiKey, credentialStore, createClient }) {
  const makeClient = createClient ?? (() => credentialStore
    ? createDriveClient({ getApiKey: options => credentialStore.getActiveCredential(options), onRateLimit: credentialStore.markRateLimited })
    : createDriveClient({ apiKey }));
  const reload = async (id) => (await pool.query('select * from drive_sync_jobs where id = $1', [id])).rows[0];

  async function run(job, ctx) {
    const source = (await pool.query('select * from drive_sources where id = $1', [job.source_id])).rows[0];
    if (!source?.enabled) return failed('DRIVE_NOT_CONNECTED');
    const contentDomain = job.content_domain ?? '3dmodels';
    let cur = job;
    let snapshotJobId = job.id;
    const full = cur.mode === 'FULL';

    if (full) {
      if (source.access_mode !== 'API_KEY') return failed('DRIVE_NOT_CONNECTED');
      const client = makeClient(source);
      if (!cur.checkpoint?.scan?.done || isModelLibrarySource(source)) {
        const s = stopped(await scanSource({ pool, client, job: cur, source, ctx }));
        if (s) return s;
        cur = await reload(job.id);
      }
      await captureArchiveSnapshot(pool, { sourceId: source.id, jobId: job.id, contentDomain });
    } else {
      const snapshot = await latestArchiveSnapshot(pool, source.id, contentDomain);
      if (!snapshot) return failed('FULL_SCAN_REQUIRED');
      snapshotJobId = snapshot.id;
      if (!(await ctx.saveProgress({ stage: 'COMPARING', checkpoint: { ...cur.checkpoint, archiveSnapshotJobId: snapshot.id } }))) return { interrupted: true };
      cur = await reload(job.id);
    }

    const plan = await computeDiff(pool, { sourceId: source.id, jobId: snapshotJobId, includeDriveTree: full, detectMissing: full, contentDomain });
    const scanSkipped = cur.checkpoint?.scan?.counters?.skippedCount ?? 0;
    if (!(await ctx.saveProgress({ stage: 'COMPARING', counters: { ...planCounters(plan, scanSkipped), reviewCount: await openReviewCount(pool, source.id, plan) } }))) return { interrupted: true };

    // Diem dung an toan cuoi cung: publish la mot transaction, khong the bi cat ngang.
    if (ctx.cancelled) return { status: 'CANCELLED' };
    if (ctx.shuttingDown) return { interrupted: true };
    if (!(await ctx.saveProgress({ stage: 'PUBLISHING' }))) return { interrupted: true };
    const fresh = await computeDiff(pool, { sourceId: source.id, jobId: snapshotJobId, includeDriveTree: full, detectMissing: full, contentDomain }); // tinh lai truoc publish; preview co the vua duoc admin tai len
    await publishPlan(pool, { sourceId: source.id, jobId: job.id, plan: fresh });
    await ctx.saveProgress({ counters: { ...planCounters(fresh, scanSkipped), reviewCount: await openReviewCount(pool, source.id, fresh) } });
    if (full) await pool.query('update drive_sources set last_successful_sync_at = now() where id = $1', [source.id]);
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
