import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { R2Provider, classifyR2Error } from './provider.js';
import { loadR2Config } from './config.js';
const config={bucket:'test',rootPrefix:'3DSMOOD/',endpoint:'https://example.com',region:'auto',credentials:{accessKeyId:'read-id',secretAccessKey:'read-secret'}};

test('configuration needs only READ credentials and defaults to free polling',()=>{
  const c=loadR2Config({R2_BUCKET:'test',R2_ENDPOINT:'https://example.com',R2_REGION:'auto',R2_READ_ACCESS_KEY_ID:'read',R2_READ_SECRET_ACCESS_KEY:'secret',R2_WRITE_ACCESS_KEY_ID:'write',R2_WRITE_SECRET_ACCESS_KEY:'write-secret'});
  assert.equal(c.configured,true); assert.equal(c.rootPrefix,'3DSMOOD/');
  assert.deepEqual([c.syncEnabled,c.syncOnStartup,c.syncIntervalSeconds,c.batchSize,c.webhookEnabled],[true,true,600,1000,false]);
  assert.equal(c.credentials.accessKeyId,'read');
  assert.equal(loadR2Config({R2_BUCKET:'test',R2_ENDPOINT:'https://example.com',R2_REGION:'auto',R2_READ_ACCESS_KEY_ID:'read',R2_READ_SECRET_ACCESS_KEY:'secret'}).configured,true);
  assert.equal(loadR2Config({R2_ENDPOINT:'http://example.com',R2_ROOT_PREFIX:'/bad/'}).configured,false);
});

test('polling settings are configurable and invalid values fail closed',()=>{
  const config=loadR2Config({R2_BUCKET:'test',R2_ENDPOINT:'https://example.com',R2_REGION:'auto',R2_READ_ACCESS_KEY_ID:'read',R2_READ_SECRET_ACCESS_KEY:'secret',
    R2_SYNC_ENABLED:'false',R2_SYNC_INTERVAL_SECONDS:'120',R2_SYNC_ON_STARTUP:'false',R2_SYNC_BATCH_SIZE:'250',R2_WEBHOOK_ENABLED:'true'});
  assert.deepEqual([config.syncEnabled,config.syncOnStartup,config.syncIntervalSeconds,config.batchSize,config.webhookEnabled],[false,false,120,250,true]);
  const invalid=loadR2Config({R2_BUCKET:'test',R2_ENDPOINT:'https://example.com',R2_REGION:'auto',R2_READ_ACCESS_KEY_ID:'read',R2_READ_SECRET_ACCESS_KEY:'secret',R2_SYNC_INTERVAL_SECONDS:'0'});
  assert.equal(invalid.configured,false);
  assert.ok(invalid.errors.includes('R2_SYNC_INTERVAL_INVALID'));
});

test('metadata listing paginates without downloading and preserves key spelling',async()=>{
  const calls=[];
  const provider=new R2Provider({config,client:{send:async command=>{calls.push(command);return calls.length===1?{Contents:[{Key:'3DSMOOD/A/a %.JPG',Size:10,ETag:'"abc"',LastModified:new Date('2026-01-01')}],IsTruncated:true,NextContinuationToken:'next'}:{Contents:[{Key:'3DSMOOD/A/a %.rar',Size:30}],IsTruncated:false};}}});
  const objects=await provider.listObjects();
  assert.equal(objects.length,2);assert.equal(objects[0].key,'3DSMOOD/A/a %.JPG');
  assert.equal(calls[1].input.ContinuationToken,'next');assert.ok(calls.every(x=>x.constructor.name==='ListObjectsV2Command'));
});

test('incomplete listing and pagination cycles fail closed',async()=>{
  const p=new R2Provider({config,client:{send:async()=>({Contents:[],IsTruncated:true,NextContinuationToken:'same'})}});
  await assert.rejects(p.listObjects(),/PAGINATION/);
});

test('download validates source key and streams archive with expected content identity',async()=>{
  let input;
  const p=new R2Provider({config,client:{send:async command=>{input=command.input;return {Body:Readable.from(['data']),ContentLength:4,ETag:'"v1"'};}}});
  const out=await p.openDownload({archiveId:'3DSMOOD/A/a.zip',canDownload:true,checksum:'v1'});
  assert.equal(out.status,200);assert.equal(out.headers['content-length'],'4');assert.equal(input.IfMatch,'"v1"');
  await assert.rejects(p.openDownload({archiveId:'else/a.zip'}),/OUTSIDE/);
  await assert.rejects(p.openDownload({archiveId:'3DSMOOD/A/a.zip',canDownload:false}),/RESTRICTED/);
});

test('provider errors expose only safe R2 codes and classify numeric or unstructured failures',()=>{
  const known=Object.assign(new Error('private endpoint'),{code:'R2_CUSTOM_SAFE'});
  assert.equal(classifyR2Error(known),known);
  for(const [status,code,publicStatus] of [[404,'R2_OBJECT_NOT_FOUND',404],[412,'R2_OBJECT_CHANGED',409],
    [403,'R2_ACCESS_DENIED',503],[503,'R2_UNAVAILABLE',503]]) {
    const error=classifyR2Error({message:'private credential URL',code:'Unknown', $metadata:{httpStatusCode:status}});
    assert.equal(error.code,code);assert.equal(error.status,publicStatus);assert.equal(error.message,code);
  }
  assert.equal(classifyR2Error({code:503,message:'private'}).code,'R2_UNAVAILABLE');
});

test('R2 object reads enforce range syntax and return a safe stream metadata shape',async()=>{
  let input;
  const provider=new R2Provider({config,client:{send:async command=>{
    input=command.input;return {Body:Readable.from(['bytes']),ContentLength:5,ContentType:'application/octet-stream',ETag:'"v1"'};
  }}});
  const result=await provider.openObject('3DSMOOD/A/a.zip',{range:'bytes=1-5',etag:'"v1"'});
  assert.equal(result.status,206);assert.equal(result.headers['content-length'],'5');assert.equal(input.IfMatch,'"v1"');
  const preview=await provider.openPreview({previewId:'3DSMOOD/A/a.jpg',previewMetadata:{etag:'v1'}});
  assert.equal(preview.status,200);assert.equal(input.Key,'3DSMOOD/A/a.jpg');
  await assert.rejects(provider.openObject('3DSMOOD/A/a.zip',{range:'bytes=-3'}),{code:'R2_INVALID_RANGE'});
  const missing=new R2Provider({config,client:{send:async()=>({})}});
  await assert.rejects(missing.openObject('3DSMOOD/A/a.zip'),{code:'R2_EMPTY_RESPONSE'});
});
