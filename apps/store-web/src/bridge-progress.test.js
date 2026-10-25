import test from 'node:test';
import assert from 'node:assert/strict';

test('native progress updates do not settle or consume the import request', async () => {
  let receive, message, done=false;
  globalThis.window={chrome:{webview:{addEventListener:(_name,fn)=>{receive=fn;},postMessage:value=>{message=value;}}}};
  const {importAsset}=await import('./integrations/3dsmax/bridge.js');
  const progress=[];
  const request=importAsset('abc123abc123','ticket',value=>progress.push(value)).then(()=>{done=true;});
  receive({data:{id:message.id,type:'asset.progress',receivedBytes:50,totalBytes:100}});
  await new Promise(r=>setImmediate(r));
  assert.equal(done,false);assert.equal(progress[0].receivedBytes,50);
  receive({data:{id:message.id,ok:true,result:{imported:1}}});await request;assert.equal(done,true);
});
