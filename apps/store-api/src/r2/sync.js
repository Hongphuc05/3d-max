const errorCode=error=>/^R2_[A-Z0-9_]+$/.test(error?.code || '')?error.code:'R2_CATALOG_SYNC_FAILED';

export function createSyncWorker({repository,provider,config={},logger=console,onChanged=()=>{},scheduler=globalThis}) {
  let syncing=null,processing=null,controller=null,pollTimer=null,eventTimer=null,started=false;
  const notify=report=>{if(report?.changed)onChanged(report);return report;};
  const sync=({onStarted}={})=>{
    if(syncing)return syncing;
    controller=new AbortController();
    syncing=repository.sync(provider,{signal:controller.signal,onStarted}).then(notify).finally(()=>{syncing=null;controller=null;});
    return syncing;
  };
  const processPending=()=>{
    if(processing)return processing;
    if(!repository.processPending)return Promise.resolve({processed:0});
    processing=repository.processPending(provider).finally(()=>{processing=null;});return processing;
  };
  const safeWarn=(message,error)=>logger.warn?.(message,errorCode(error));
  const runSync=()=>{void sync().catch(error=>safeWarn('[catalog] R2 catalog scan deferred',error));};
  const runPending=()=>{void processPending().catch(error=>safeWarn('[catalog] R2 webhook inbox processing deferred',error));};
  const start=()=>{
    if(started)return stop;
    started=true;
    if(config.syncEnabled!==false) {
      pollTimer=scheduler.setInterval(runSync,Math.max(1,Number(config.syncIntervalSeconds)||600)*1000);
      pollTimer?.unref?.();
      if(config.syncOnStartup!==false)runSync();
    }
    if(config.webhookEnabled===true && repository.processPending) {
      eventTimer=scheduler.setInterval(runPending,1000);
      eventTimer?.unref?.();
      runPending();
    }
    return stop;
  };
  const stop=async()=>{
    started=false;
    if(pollTimer)scheduler.clearInterval(pollTimer);
    if(eventTimer)scheduler.clearInterval(eventTimer);
    pollTimer=null;eventTimer=null;
    controller?.abort();
    await Promise.allSettled([syncing,processing].filter(Boolean));
  };
  return {sync,start,stop,processPending,get syncing(){return Boolean(syncing);}};
}
