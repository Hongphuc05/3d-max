import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Readable } from 'node:stream';
import { createArchiveSender } from './download-stream.js';

async function fixture(provider, options, run) {
  const send = createArchiveSender(provider, options);
  const app = express();
  app.get('/', (req,res,next) => send(req,res,{id:'abc123abc123',slug:'lamp',archiveId:'server-only',archiveExtension:'.rar',canDownload:true}).catch(next));
  app.use((e,req,res,next) => res.status(e.status || 500).json({error:e.code}));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.on('listening',resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('streams archive through backend and does not claim Range support', async () => {
  let source;
  await fixture({openDownload:async file => {source=file.archiveId;return {data:Readable.from(['archive']),headers:{'content-length':'7'},status:200};}}, {}, async url => {
    const res=await fetch(url,{headers:{range:'bytes=0-3'}});
    assert.equal(res.status,200);
    assert.equal(res.headers.get('accept-ranges'),'none');
    assert.match(res.headers.get('content-disposition'),/lamp.rar/);
    assert.equal(await res.text(),'archive');
    assert.equal(source,'server-only');
  });
});

test('rejects restricted archive before any provider call', async () => {
  const send=createArchiveSender({openDownload:()=>assert.fail('must not fetch')});
  await assert.rejects(()=>send({}, {}, {canDownload:false}), {code:'MODEL_DOWNLOAD_RESTRICTED',status:403});
});

test('client cancellation aborts upstream and releases concurrency slot', async () => {
  let signal, streams=0;
  const provider={openDownload:async (_file,opts)=>{
    signal=opts.signal;streams++;
    if(streams>1)return {data:Readable.from(['ok']),headers:{},status:200};
    const data=new Readable({read(){this.push(Buffer.alloc(65536));}});
    signal.addEventListener('abort',()=>data.destroy());
    return {data,headers:{},status:200};
  }};
  await fixture(provider,{maxConcurrent:1},async url=>{
    const res=await fetch(url); const reader=res.body.getReader();await reader.read();await reader.cancel();
    for(let i=0;i<40&&!signal.aborted;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(signal.aborted,true);
    assert.equal(await (await fetch(url)).text(),'ok');
  });
});

test('provider failures expose safe error codes only', async () => {
  await fixture({openDownload:async()=>{throw Object.assign(new Error('secret URL'),{code:'DRIVE_PERMISSION_DENIED',status:403});}}, {},async url=>{
    const res=await fetch(url);assert.equal(res.status,403);assert.deepEqual(await res.json(),{error:'DRIVE_PERMISSION_DENIED'});
  });
});

test('large archive is consumed incrementally with bounded chunks',async()=>{
  let produced=0;
  const size=32*1024*1024;
  await fixture({openDownload:async()=>({data:Readable.from((async function*(){while(produced<size){produced+=65536;yield Buffer.alloc(65536,17);}})()),headers:{'content-length':String(size)},status:200})},{},async url=>{
    const response=await fetch(url);let received=0;
    for await(const chunk of response.body){received+=chunk.length;assert.ok(chunk.length<=1048576);}
    assert.equal(received,size);assert.equal(produced,size);
  });
});

test('concurrency admission rejects excess downloads and timeout frees the slot',async()=>{
  let release,call=0;
  await fixture({openDownload:async(_model,{signal})=>{
    if(++call>1)return {data:Readable.from(['ok']),headers:{},status:200};
    await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(new Error('aborted')));});
    return {data:Readable.from(['ok']),headers:{},status:200};
  }},{maxConcurrent:1,timeoutMs:100},async url=>{
    const first=fetch(url);while(!release)await new Promise(r=>setTimeout(r,1));
    assert.equal((await fetch(url)).status,503);assert.equal((await first).status,504);
    assert.equal(await(await fetch(url)).text(),'ok');
  });
});
