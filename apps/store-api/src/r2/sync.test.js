import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncWorker } from './sync.js';

test('worker runs an asynchronous initial scan and configured polling without processing webhook events',async()=>{
  let scans=0,processed=0,resolveScan,signal,interval,cleared=false,notified=0;
  const repository={sync:async(_provider,options)=>{scans++;signal=options.signal;return new Promise(resolve=>{resolveScan=resolve;});},processPending:async()=>{processed++;return {processed:1};}};
  let intervalMs;
  const scheduler={setInterval:(fn,ms)=>{interval=fn;intervalMs=ms;return {unref(){}};},clearInterval:()=>{cleared=true;}};
  const worker=createSyncWorker({repository,provider:{},config:{syncEnabled:true,syncOnStartup:true,syncIntervalSeconds:600,webhookEnabled:false},scheduler,onChanged:()=>{notified++;}});
  const stop=worker.start();worker.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,1);assert.equal(processed,0);assert.equal(intervalMs,600000);
  const one=worker.sync(),two=worker.sync();assert.equal(one,two);assert.equal(worker.syncing,true);
  interval();await new Promise(resolve=>setImmediate(resolve));assert.equal(scans,1);
  resolveScan({changed:true});await one;assert.equal(scans,1);assert.equal(notified,1);assert.equal(worker.syncing,false);
  const pending=worker.sync();const stopping=stop();assert.equal(signal.aborted,true);resolveScan({changed:false});await pending;await stopping;
  assert.equal(cleared,true);
});
test('disabled polling does not schedule or start a bucket scan',async()=>{
  let schedules=0,scans=0;
  const worker=createSyncWorker({repository:{sync:async()=>{scans++;}},provider:{},config:{syncEnabled:false,syncOnStartup:true,syncIntervalSeconds:60,webhookEnabled:false},
    scheduler:{setInterval:()=>{schedules++;return 1;},clearInterval(){}}});
  const stop=worker.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scans,0);assert.equal(schedules,0);await stop();
});
test('worker logs sanitized polling errors and keeps the interval active',async()=>{
  let interval,warnings=0,calls=0;
  const worker=createSyncWorker({repository:{sync:async()=>{calls++;throw Object.assign(new Error('private endpoint'),{code:'R2_ACCESS_DENIED'});}},provider:{},
    config:{syncEnabled:true,syncOnStartup:true,syncIntervalSeconds:60,webhookEnabled:false},
    scheduler:{setInterval:fn=>{interval=fn;return 1;},clearInterval(){}},logger:{warn:(...args)=>{warnings++;assert.equal(JSON.stringify(args).includes('private endpoint'),false);}}});
  const stop=worker.start();await new Promise(resolve=>setImmediate(resolve));interval();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(warnings,2);assert.equal(calls,2);await stop();
});
