const CHANNEL='r2_catalog_changed';
const RETRY_START_MS=1000;
const RETRY_MAX_MS=30000;

export function createCatalogEventBus({pool,logger=console,scheduler=globalThis}) {
  const subscribers=new Set();
  const clientListeners=new WeakMap();
  let client=null,connecting=null,retryTimer=null,retryMs=RETRY_START_MS,stopped=true,connectionAttempted=false;

  const broadcast=value=>{
    for(const subscriber of subscribers) {
      try { subscriber(value); } catch { /* One SSE client cannot break the shared listener. */ }
    }
  };

  const publish=notification=>{
    if(notification.channel!==CHANNEL)return;
    let value;
    try { value=JSON.parse(notification.payload); } catch { return; }
    if(!Number.isSafeInteger(value?.version) || value.version<0)return;
    broadcast(value);
  };

  const removeClient=target=>{
    if(client!==target)return;
    client=null;
    const listeners=clientListeners.get(target);
    target.removeListener('notification',publish);
    if(listeners) {
      target.removeListener('error',listeners.error);
      target.removeListener('end',listeners.end);
      clientListeners.delete(target);
    }
    target.release(new Error('Catalog event listener disconnected'));
    if(!stopped) {
      logger.warn?.('[catalog] database event listener reconnecting');
      scheduleReconnect();
    }
  };
  function scheduleReconnect() {
    if(stopped || retryTimer!==null)return;
    const delay=retryMs;
    retryMs=Math.min(RETRY_MAX_MS,retryMs*2);
    retryTimer=scheduler.setTimeout(()=>{retryTimer=null;void connect();},delay);
    retryTimer?.unref?.();
  }

  function connect() {
    if(stopped || client)return Promise.resolve();
    if(connecting)return connecting;
    const reconnecting=connectionAttempted;
    connectionAttempted=true;
    connecting=(async()=>{
      let target;
      try {
        target=await pool.connect();
        if(stopped) { target.release(); return; }
        client=target;
        target.on('notification',publish);
        const listeners={error:()=>removeClient(target),end:()=>removeClient(target)};
        clientListeners.set(target,listeners);
        target.on('error',listeners.error);
        target.on('end',listeners.end);
        await target.query(`LISTEN ${CHANNEL}`);
        retryMs=RETRY_START_MS;
        if(reconnecting)broadcast({resync:true});
      } catch {
        if(target && client===target)removeClient(target);
        else if(target) {
          target.release(new Error('Catalog event listener connection failed'));
          if(!stopped) {
            logger.warn?.('[catalog] database event listener reconnecting');
            scheduleReconnect();
          }
        } else if(!stopped) {
          logger.warn?.('[catalog] database event listener reconnecting');
          scheduleReconnect();
        }
      }
    })().finally(()=>{connecting=null;});
    return connecting;
  }

  const subscribe=listener=>{
    subscribers.add(listener);
    return ()=>subscribers.delete(listener);
  };

  const start=async()=>{
    stopped=false;
    await connect();
    return stop;
  };

  const stop=async()=>{
    stopped=true;
    if(retryTimer!==null)scheduler.clearTimeout(retryTimer);
    retryTimer=null;
    await connecting;
    const active=client;
    if(!active)return;
    client=null;
    const listeners=clientListeners.get(active);
    active.removeListener('notification',publish);
    try { await active.query(`UNLISTEN ${CHANNEL}`); } catch { /* The connection is being closed. */ }
    if(listeners) {
      active.removeListener('error',listeners.error);
      active.removeListener('end',listeners.end);
      clientListeners.delete(active);
    }
    active.release();
  };

  return {start,stop,subscribe,get connected(){return Boolean(client);}};
}
