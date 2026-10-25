import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import express from 'express';
import sharp from 'sharp';
import {isolatedTestDatabase} from './test-database.js';

const enabled=Boolean(process.env.TEST_DATABASE_URL);
let dispose,pool,runtime,server,base,directory,source,fail=false;
const env={CATALOG_PROVIDER:'google_drive',GOOGLE_DRIVE_FOLDER_ID:'private-root',GOOGLE_DRIVE_API_KEY:'fixture'};
before(async()=>{
  if(!enabled)return;
  dispose=await isolatedTestDatabase('catalog_http');
  const db=await import('./db.js');pool=db.pool;await db.migrate();
  directory=await mkdtemp(path.join(os.tmpdir(),'catalog-http-'));env.GOOGLE_DRIVE_PREVIEW_CACHE_DIR=directory;
  const {createCatalogRuntime,catalogRouter}=await import('./catalog-runtime.js');
  const {authRouter}=await import('./auth.js');const {errorHandler}=await import('./security.js');
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).jpeg().toBuffer();
  source={folders:[{id:'private-root',parentId:null,name:'Wall light',path:'Wall light'}],models:[{archiveId:'private-archive',folderId:'private-root',name:'Lamp',archiveExtension:'.rar',size:20,canDownload:true,preview:{id:'private-preview',mimeType:'image/jpeg',modifiedTime:'2026-10-25T00:00:00Z',size:bytes.length}}],filesScanned:2};
  const driveProvider={scan:async()=>{if(fail)throw Object.assign(new Error('private'),{code:'DRIVE_QUOTA_EXCEEDED'});return structuredClone(source);},openDownload:async()=>({data:Readable.from([bytes]),headers:{'content-type':'image/jpeg'},status:200})};
  runtime=await createCatalogRuntime({pool,env,driveProvider,logger:{warn(){},error(){}}});
  const app=express();app.use(express.json());app.use('/api/auth',authRouter);app.use('/api',catalogRouter(runtime));app.use(errorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(dispose)await dispose(pool);if(directory)await rm(directory,{recursive:true,force:true});});

test('Drive HTTP catalog publishes cached previews and distinguishes pending, ready, failed, empty snapshots', {skip:!enabled},async()=>{
  assert.equal((await runtime.status()).state,'not_synced');
  assert.equal((await (await fetch(base+'/api/products')).json()).total,0);
  await runtime.worker.sync();
  const first=await (await fetch(base+'/api/products')).json();const product=first.items[0];
  assert.equal(first.total,1);assert.equal(product.name,'Lamp');assert.equal(JSON.stringify(first).includes('private-'),false);
  const categories=await (await fetch(base+'/api/categories')).json();assert.equal(categories[0].name,'Wall light');
  const preview=await fetch(base+product.thumb);assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/image\/webp/);
  assert.equal((await fetch(base+product.thumb,{headers:{'if-none-match':preview.headers.get('etag')}})).status,304);
  assert.ok((await preview.arrayBuffer()).byteLength>0);
  const version=first.version;await runtime.worker.sync();assert.equal((await runtime.status()).version,version);
  source.models[0].preview=null;await runtime.worker.sync();
  assert.equal((await (await fetch(base+'/api/products')).json()).items[0].thumb,null);
  assert.equal((await fetch(base+product.thumb)).status,404);
  fail=true;await assert.rejects(runtime.worker.sync());
  assert.equal((await (await fetch(base+'/api/products')).json()).total,1);
  const status=await (await fetch(base+'/api/catalog/version')).json();assert.equal(status.state,'error');assert.equal(status.error,'DRIVE_QUOTA_EXCEEDED');assert.equal(JSON.stringify(status).includes('private-'),false);
  fail=false;source.models=[];await runtime.worker.sync();
  assert.equal((await (await fetch(base+'/api/catalog/version')).json()).state,'empty');
  assert.equal((await fetch(base+'/api/products/'+product.slug)).status,404);
});

test('manual sync is restricted to server-allowlisted administrators', {skip:!enabled},async()=>{
  const call=(cookie)=>fetch(base+'/api/admin/catalog/sync',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:'{}'});
  assert.equal((await call()).status,401);
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'catalog-admin@test.invalid',password:'fixture-password'})});
  const {user}=await response.json();const cookie=response.headers.getSetCookie()[0].split(';')[0];
  assert.equal((await call(cookie)).status,403);
  process.env.LICENSE_ADMIN_USER_IDS=user.id;
  try{assert.equal((await call(cookie)).status,202);await runtime.worker.sync();}finally{delete process.env.LICENSE_ADMIN_USER_IDS;}
});
