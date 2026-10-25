import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { r2WebhookRouter, catalogEventStream } from './r2-http.js';
import { errorHandler } from './security.js';

const event = {account:'account',bucket:'bucket',action:'PutObject',object:{key:'3DSMOOD/Furniture/New chair/a.JPG',size:42,eTag:'etag'},eventTime:'2026-10-25T00:00:00Z'};
const config = {accountId:'account',bucket:'bucket',rootPrefix:'3DSMOOD/',webhookSecret:'test-webhook-secret'};
async function serve(runtime, run) {
  const app=express();app.use('/internal/r2/events',r2WebhookRouter(runtime));
  app.get('/api/catalog/events',catalogEventStream(runtime,{pollMs:10,heartbeatMs:30}));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {await run(`http://127.0.0.1:${server.address().port}`);} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
const runtime=(ingestEvents=async events=>({accepted:events.length}))=>({config,repository:{ingestEvents},status:async()=>({provider:'r2',version:1})});
const post=(base,body=event,secret=config.webhookSecret)=>fetch(base+'/internal/r2/events',{method:'POST',headers:{'content-type':'application/json',...(secret?{authorization:`Bearer ${secret}`}:{})},body:JSON.stringify(body)});

test('webhook requires bearer secret and stores event before acknowledging',async()=>{
  let saved;
  await serve(runtime(async events=>{saved=events;return {accepted:1};}),async base=>{
    assert.equal((await post(base,event,'')).status,401);
    assert.equal((await post(base,event,'wrong')).status,401);
    const response=await post(base);assert.equal(response.status,202);assert.equal(saved[0].object.key,event.object.key);
    assert.equal((await post(base,{...event,bucket:'other'})).status,200);
    assert.equal((await post(base,{...event,object:{key:'outside/a.jpg'}})).status,200);
    assert.equal((await post(base,{...event,account:'other'})).status,403);
  });
});
test('invalid payloads and failed durable inserts never receive successful acknowledgements',async()=>{
  await serve(runtime(async()=>{throw Object.assign(new Error('private details'),{code:'08006'});}),async base=>{
    assert.equal((await post(base,{...event,action:'RenameObject'})).status,400);
    assert.equal((await post(base,{...event,eventTime:'bad'})).status,400);
    assert.equal((await post(base,{...event,object:{key:'3DSMOOD/a.jpg',size:-1}})).status,400);
    assert.equal((await post(base,{padding:'x'.repeat(70000)})).status,413);
    const response=await post(base);assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);
  });
});
test('missing webhook configuration fails closed',async()=>{
  await serve({...runtime(),config:{...config,webhookSecret:''}},async base=>assert.equal((await post(base)).status,503));
});
test('SSE sends initial state, changes and heartbeat without requiring a license',async()=>{
  let version=1;
  await serve({...runtime(),status:async()=>({provider:'r2',version})},async base=>{
    const abort=new AbortController();const response=await fetch(base+'/api/catalog/events',{signal:abort.signal});
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'),'no');
    const reader=response.body.getReader();let received='';
    while(!received.includes('"version":1')) received+=new TextDecoder().decode((await reader.read()).value);
    version=2;
    while(!received.includes('"version":2')) received+=new TextDecoder().decode((await reader.read()).value);
    assert.match(received,/event: catalog.changed/);abort.abort();
  });
});
