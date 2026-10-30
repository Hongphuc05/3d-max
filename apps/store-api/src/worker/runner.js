// Vong lap worker: nhan job -> chay handler kem heartbeat -> ghi ket qua. Khong biet gi ve Drive.
// handler(job, ctx) tra ve { status?, errorCode? } hoac { interrupted: true } (dung vi shutdown, da luu checkpoint).
import os from 'node:os';
import { claimJob, finishJob, heartbeat, releaseJob, saveProgress } from './queue.js';

const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']);
// Chi ghi ten loi: thong diep co the chua token/ID.
const defaultOnError = (e) => console.error('[worker] error:', e?.name ?? 'Error');

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function runWorker({
  pool, handler, signal, workerId = `${os.hostname()}-${process.pid}`,
  pollMs = 5000, leaseMs = 60_000, heartbeatMs = 15_000, onError = defaultOnError,
}) {
  async function runOne(job) {
    const ac = new AbortController();
    const state = { cancelled: false, leaseLost: false };
    const lose = () => { state.leaseLost = true; ac.abort(); };
    const onShutdown = () => ac.abort();
    signal?.addEventListener('abort', onShutdown, { once: true });

    const ctx = {
      signal: ac.signal,
      get cancelled() { return state.cancelled; },
      get shuttingDown() { return !!signal?.aborted; },
      async saveProgress(p) {
        const ok = await saveProgress(pool, job.id, workerId, p);
        if (!ok) lose();
        return ok;
      },
    };

    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const hb = await heartbeat(pool, job.id, workerId, { leaseMs });
        if (!hb) lose();
        else if (hb.cancelRequested && !state.cancelled) { state.cancelled = true; ac.abort(); }
      } catch (e) { onError(e); } finally { busy = false; }
    }, heartbeatMs);

    let result, threw = false;
    try { result = await handler(job, ctx); } catch (e) { threw = true; onError(e); }
    clearInterval(timer);
    signal?.removeEventListener('abort', onShutdown);

    if (state.leaseLost) return; // job da thuoc worker khac: khong ghi gi
    const finish = (status, errorCode = null, errorMessage = null) => finishJob(pool, job.id, workerId, { status, errorCode, errorMessage });
    if (state.cancelled) return void await finish('CANCELLED');
    if (threw) return void await finish('FAILED', 'JOB_HANDLER_ERROR', 'The sync job failed unexpectedly.');
    if (result?.interrupted) {
      return void (ctx.shuttingDown ? await releaseJob(pool, job.id, workerId) : await finish('FAILED', 'JOB_INTERRUPTED', 'The sync job was interrupted.'));
    }
    const status = result?.status ?? 'COMPLETED';
    if (!TERMINAL.has(status)) return void await finish('FAILED', 'JOB_HANDLER_ERROR', 'The sync job returned an invalid status.');
    await finish(status, result?.errorCode ?? null, result?.errorMessage ?? null);
  }

  while (!signal?.aborted) {
    let job = null;
    try { job = await claimJob(pool, workerId, { leaseMs }); } catch (e) { onError(e); }
    if (!job) { await sleep(pollMs, signal); continue; }
    try { await runOne(job); } catch (e) { onError(e); }
  }
}
