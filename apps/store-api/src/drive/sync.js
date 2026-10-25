// Scan and preview preparation happen outside the publication transaction. A dedicated
// PostgreSQL session owns the lock throughout, including cache cleanup.
export function createSyncWorker({ repository, provider, previewCache, intervalMinutes = 30, logger = console, scheduler=globalThis,now=Date.now }) {
  let pending = null;
  let timer = null;
  let controller = null;
  let started=false,startupTimer=null;
  const intervalMs=Math.max(1,Number(intervalMinutes) || 30)*60_000;

  async function run() {
    const lock = await repository.acquireLock();
    if (!lock) return { skipped: true, reason: 'SYNC_IN_PROGRESS' };
    let syncId;
    controller = new AbortController();
    try {
      syncId = await repository.beginSync(lock.client);
      const scan = await provider.scan({signal:controller.signal});
      const models = [];
      for (const model of scan.models) {
        const preview = await previewCache.prepare(model,{signal:controller.signal});
        models.push({ ...model, ...preview, cachedPreviewPath: preview.cachedPreviewPath ?? preview.previewCachePath ?? null });
      }
      const report = await repository.publish(lock.client, { ...scan, models, syncId });
      try { await previewCache.cleanup(await repository.referencedPreviews(lock.client)); }
      catch { logger.warn?.('[catalog] preview cleanup deferred'); }
      return report;
    } catch (error) {
      if (syncId) await repository.markFailed(lock.client, syncId, error).catch(() => logger.error?.('[catalog] failed to persist sync status'));
      throw error;
    } finally { controller = null; await lock.release(); }
  }

  function sync() {
    if (pending) return pending;
    pending = run().finally(() => { pending = null; });
    return pending;
  }

  function start() {
    if (started) return stop;
    started=true;
    const trigger=()=>{if(started)sync().catch(()=>logger.warn?.('[catalog] Drive sync failed; keeping previous snapshot'));};
    const schedule=()=>{if(!started)return;timer=scheduler.setInterval(trigger,intervalMs);timer?.unref?.();trigger();};
    queueMicrotask(async()=>{
      let status;
      try{status=await repository.status?.();}catch{ /* The normal sync path records connectivity failures. */ }
      if(!started)return;
      const failedAt=status?.lastAttempt?.status==='failed'?Date.parse(status.lastAttempt.finishedAt):NaN;
      const delay=Number.isFinite(failedAt)?Math.max(0,failedAt+intervalMs-now()):0;
      if(delay){startupTimer=scheduler.setTimeout(()=>{startupTimer=null;schedule();},delay);startupTimer?.unref?.();}
      else schedule();
    });
    return stop;
  }

  function stop() {
    started=false;
    if(timer)scheduler.clearInterval(timer);
    if(startupTimer)scheduler.clearTimeout(startupTimer);
    timer=null;startupTimer=null;controller?.abort();return pending?.catch(()=>{});
  }
  return { sync, start, stop, get syncing() { return pending !== null; } };
}
