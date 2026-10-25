import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import express from 'express';
import sharp from 'sharp';
import {isolatedTestDatabase} from './test-database.js';

const enabled=Boolean(process.env.TEST_DATABASE_URL);
let dispose,pool,runtime,server,base,source,bytes,fail=false;
const env={CATALOG_PROVIDER:'r2',R2_ACCOUNT_ID:'fixture-account',R2_BUCKET:'fixture-private-bucket',
  R2_ENDPOINT:'https://fixture.r2.cloudflarestorage.com',R2_REGION:'auto',R2_ROOT_PREFIX:'3DSMOOD/',
  R2_READ_ACCESS_KEY_ID:'fixture-read-key',R2_READ_SECRET_ACCESS_KEY:'fixture-read-secret'};
const object=(key,etag='original')=>({key,size:42,etag,lastModified:'2026-10-25T00:00:00Z'});

before(async()=>{
  if(!enabled)return;
  dispose=await isolatedTestDatabase('catalog_http');
  const db=await import('./db.js');pool=db.pool;await db.migrate();
  const {createCatalogRuntime,catalogRouter}=await import('./catalog-runtime.js');
  const {authRouter}=await import('./auth.js');const {errorHandler}=await import('./security.js');
  bytes=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).jpeg().toBuffer();
  source=[object('3DSMOOD/Lighting/Table lamp/Modern/Lamp.JPG'),object('3DSMOOD/Lighting/Table lamp/Modern/Lamp.RAR'),
    object('3DSMOOD/Furniture/Empty/'),object('3DSMOOD/Lighting/Incomplete/Preview only.jpeg')];
  const listObjects=async(prefix='3DSMOOD/')=>{
    if(fail)throw Object.assign(new Error('private provider details'),{code:'R2_UNAVAILABLE'});
    return structuredClone(source.filter(item=>item.key.startsWith(prefix)));
  };
  const openPreview=async()=>({data:Readable.from([bytes]),headers:{'content-type':'image/jpeg','content-length':String(bytes.length)},status:200});
  const r2Provider={listObjects,hasObjects:async prefix=>(await listObjects(prefix)).length>0,
    scan:async()=>{const {buildCatalog}=await import('./r2/pairing.js');return buildCatalog(await listObjects(),'3DSMOOD/');},
    openPreview,openDownload:openPreview};
  runtime=await createCatalogRuntime({pool,env,r2Provider,logger:{warn(){},error(){}}});
  const app=express();app.use(express.json());app.use('/api/auth',authRouter);app.use('/api',catalogRouter(runtime));app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(dispose)await dispose(pool);});

test('R2 HTTP catalog exposes nested dynamic categories, marker folders and incomplete model status', {skip:!enabled},async()=>{
  assert.equal((await runtime.status()).state,'not_synced');
  assert.equal((await (await fetch(base+'/api/models')).json()).total,0);
  await runtime.worker.sync();
  const first=await (await fetch(base+'/api/models')).json();
  assert.equal(first.total,2);
  const product=first.items.find(item=>item.name==='Lamp');
  assert.equal(product.status,'ready');assert.equal(product.downloadable,true);
  const incomplete=first.items.find(item=>item.name==='Preview only');
  assert.equal(incomplete.status,'missing_archive');assert.equal(incomplete.downloadable,false);
  assert.equal(JSON.stringify(first).includes('fixture-read'),false);
  assert.equal(JSON.stringify(first).includes('3DSMOOD/'),false);
  const categories=await (await fetch(base+'/api/categories/tree')).json();
  const lighting=categories.find(category=>category.name==='Lighting');
  assert.equal(lighting.path,'Lighting');
  assert.equal(lighting.children.find(category=>category.name==='Table lamp').children[0].path,'Lighting/Table lamp/Modern');
  assert.equal(categories.find(category=>category.name==='Furniture').children[0].name,'Empty');
  assert.equal(categories.some(category=>category.name==='3DSMOOD'),false);
  const filtered=await (await fetch(base+'/api/models?category='+encodeURIComponent('Lighting/Table lamp'))).json();
  assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,product.id);
  assert.deepEqual(await (await fetch(base+'/api/products')).json(),first);
});

test('R2 preview URLs change on overwrite, expire on deletion and keep model IDs stable across sync', {skip:!enabled},async()=>{
  const first=await (await fetch(base+'/api/models')).json();const product=first.items.find(item=>item.name==='Lamp');
  const preview=await fetch(base+product.thumb);assert.equal(preview.status,200);
  assert.match(preview.headers.get('content-type'),/image\/(?:jpeg|webp)/);
  assert.equal((await fetch(base+product.thumb,{headers:{'if-none-match':preview.headers.get('etag')}})).status,304);
  assert.ok((await preview.arrayBuffer()).byteLength>0);
  const version=first.version;await runtime.worker.sync();assert.equal((await runtime.status()).version,version);
  source=source.map(item=>item.key.endsWith('Lamp.JPG')?{...item,etag:'replacement',lastModified:'2026-10-25T01:00:00Z'}:item);
  await runtime.worker.sync();
  const updated=(await (await fetch(base+'/api/models')).json()).items.find(item=>item.name==='Lamp');
  assert.equal(updated.id,product.id);assert.notEqual(updated.thumb,product.thumb);
  assert.equal((await fetch(base+product.thumb)).status,404);
  assert.equal((await fetch(base+updated.thumb)).status,200);
  source=source.filter(item=>!item.key.endsWith('Lamp.JPG'));await runtime.worker.sync();
  const missing=(await (await fetch(base+'/api/models')).json()).items.find(item=>item.name==='Lamp');
  assert.equal(missing.id,product.id);assert.equal(missing.status,'missing_preview');assert.equal(missing.downloadable,false);assert.equal(missing.thumb,null);
  assert.equal((await fetch(base+updated.thumb)).status,404);
  fail=true;await assert.rejects(runtime.worker.sync());
  assert.equal((await (await fetch(base+'/api/models')).json()).total,2);
  const status=await (await fetch(base+'/api/catalog/version')).json();assert.equal(status.state,'error');assert.equal(status.error,'R2_UNAVAILABLE');
  assert.equal(JSON.stringify(status).includes('private provider'),false);
  fail=false;source=[];await runtime.worker.sync();
  assert.equal((await (await fetch(base+'/api/catalog/version')).json()).state,'empty');
  assert.equal((await fetch(base+'/api/products/'+product.slug)).status,404);
});

test('manual R2 reconciliation is restricted to server-allowlisted administrators', {skip:!enabled},async()=>{
  const call=(cookie)=>fetch(base+'/api/admin/catalog/sync',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:'{}'});
  assert.equal((await call()).status,401);
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'catalog-admin@test.invalid',password:'fixture-password'})});
  const {user}=await response.json();const cookie=response.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await call(cookie)).status,403);
  const previous=process.env.LICENSE_ADMIN_USER_IDS;process.env.LICENSE_ADMIN_USER_IDS=user.id;
  try{assert.equal((await call(cookie)).status,202);await runtime.worker.sync();}finally{
    if(previous===undefined)delete process.env.LICENSE_ADMIN_USER_IDS;else process.env.LICENSE_ADMIN_USER_IDS=previous;
  }
});

test('dead R2 inbox events can be requeued by an allowlisted administrator', {skip:!enabled},async()=>{
  const call=(cookie)=>fetch(base+'/api/admin/catalog/retry-dead-events',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:'{}'});
  assert.equal((await call()).status,401);
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'catalog-recovery@test.invalid',password:'fixture-password'})});
  const {user}=await response.json();const cookie=response.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await call(cookie)).status,403);
  const event={account:env.R2_ACCOUNT_ID,bucket:env.R2_BUCKET,action:'PutObject',
    object:{key:'3DSMOOD/Recovery/new-model/model.RAR',size:42,eTag:'fixture-rar'},eventTime:new Date().toISOString()};
  const {eventIdentity}=await import('./r2/repository.js');
  await runtime.repository.ingestEvents([event]);
  const id=eventIdentity(event);
  await pool.query("update r2_event_inbox set status='dead',attempts=10 where id=$1",[id]);
  const previous=process.env.LICENSE_ADMIN_USER_IDS;process.env.LICENSE_ADMIN_USER_IDS=user.id;
  try{
    const retried=await call(cookie);
    assert.equal(retried.status,202);
    assert.deepEqual(await retried.json(),{accepted:true,retried:1});
    assert.equal((await pool.query('select status from r2_event_inbox where id=$1',[id])).rows[0].status,'pending');
    source=[object('3DSMOOD/Recovery/new-model/model.JPG'),object('3DSMOOD/Recovery/new-model/model.RAR')];
    const processed=await runtime.worker.processPending();
    assert.equal(processed.processed,1);
    assert.equal((await pool.query('select status from r2_event_inbox where id=$1',[id])).rows[0].status,'processed');
    const models=await (await fetch(base+'/api/models?category='+encodeURIComponent('Recovery/new-model'))).json();
    assert.equal(models.total,1);assert.equal(models.items[0].status,'ready');
  }finally{
    if(previous===undefined)delete process.env.LICENSE_ADMIN_USER_IDS;else process.env.LICENSE_ADMIN_USER_IDS=previous;
  }
});
