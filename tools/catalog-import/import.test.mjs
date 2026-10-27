import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, parseListing, pairFiles, validateImage, downloadUrl, parseConfirmation, crawl } from './import.mjs';
const encode = data => JSON.stringify(data).replace(/[\x00-\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}`);
const row = (id, name, mime, size = 123) => [id, ['folderid123'], name, mime, 0, null, 0, 0, 0, 0, 10, null, null, size];
const html = rows => `<script>window['_DRIVE_ivd'] = '${encode([rows])}';</script>`;
test('decodes public Drive listing without executing embedded script', () => {
 const entries = parseListing(html([row('imageid12345','Chair.jpg','image/jpeg'),row('archiveid12345','Chair.rar','application/x-compressed')]));
 assert.deepEqual(entries.map(e => e.name), ['Chair.jpg','Chair.rar']);
 assert.throws(() => parseListing("<script>window['_DRIVE_ivd'] = 'garbage';</script>"));
 assert.throws(() => parseListing('<script>window.x=1</script>'));
});
test('pairs exact names, rejects ambiguity, and marks missing previews', () => {
 const entries = parseListing(html([row('imageid12345','Chair.jpg','image/jpeg'),row('archiveid12345','Chair.rar','application/x-compressed')]));
 assert.equal(pairFiles(entries)[0].archive.id, 'archiveid12345');
 assert.throws(() => pairFiles([...entries, {...entries[0], id:'anotherid12345',name:'Chair.png'}]), /ambiguous/i);
 assert.equal(pairFiles(entries.slice(1))[0].preview, null);
});
test('crawl discovers models in newly added nested Drive folders', async () => {
 const folder = 'application/vnd.google-apps.folder';
 const rows = new Map([
  ['rootfolder123', [row('furniture123','Furniture',folder,0)]],
  ['furniture123', [row('futurefolder123','Future category',folder,0),row('chairarchive12','Chair.rar','application/x-compressed'),row('chairimage123','Chair.jpg','image/jpeg')]],
  ['futurefolder123', [row('additionsub12','Add-on',folder,0)]],
  ['additionsub12', [row('newarchive123','New model.zip','application/zip'),row('newimage12345','New model.jpg','image/jpeg')]]
 ]);
 const discovered = await crawl('rootfolder123', async id => {
  assert.ok(rows.has(id), `unexpected folder ${id}`);
  return parseListing(html(rows.get(id)));
 });
 assert.deepEqual(discovered.map(item => [item.category, item.name]), [
  ['Furniture', 'Chair'],
  ['Furniture / Future category / Add-on', 'New model']
 ]);
});
test('validates raster bytes and Drive redirect/confirmation constraints', () => {
 assert.doesNotThrow(() => validateImage(Buffer.from([255,216,255]), '.jpg'));
 assert.throws(() => validateImage(Buffer.from('<html>'), '.jpg'));
 assert.throws(() => downloadUrl('https://drive.google.com.evil.example/file'));
 assert.throws(() => downloadUrl('http://drive.google.com/file'));
 const url = parseConfirmation('<form action="https://drive.usercontent.google.com/download" method="get"><input name="confirm" value="t"></form>','archiveid12345');
 assert.equal(new URL(url).searchParams.get('id'),'archiveid12345');
 assert.throws(() => parseConfirmation('<form action="https://evil.example/download"><input name="confirm" value="t"></form>','archiveid12345'));
});

test('streaming downloader accepts bounded Google redirects and rejects truncated or foreign content', async () => {
 const {download}=await import('./import.mjs'); const old=globalThis.fetch;
 try {
  let calls=0; globalThis.fetch=async url=>{calls++; if(calls===1) return new Response(null,{status:303,headers:{location:'https://drive.usercontent.google.com/download?id=archiveid12345'}}); return new Response(new Uint8Array([1,2,3]),{status:200,headers:{'content-length':'3','content-type':'application/octet-stream'}});};
  const chunks=[]; assert.equal(await download('archiveid12345',100,c=>chunks.push(...c)),3); assert.deepEqual(chunks,[1,2,3]);
  globalThis.fetch=async()=>new Response(null,{status:303,headers:{location:'https://evil.example/steal'}});
  await assert.rejects(download('archiveid12345',100,()=>{}),/unsafe/);
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{status:200,headers:{'content-length':'4'}});
  await assert.rejects(download('archiveid12345',100,()=>{}),/truncated/);
  globalThis.fetch=async()=>new Response('<html>quota</html>',{status:403});
  await assert.rejects(download('archiveid12345',100,()=>{}),/403/);
 } finally {globalThis.fetch=old;}
});
test('transient retries are bounded and permission errors are not retried', async () => {
 const {retryTransient}=await import('./import.mjs'); let calls=0;
 assert.equal(await retryTransient(async()=>{calls++;if(calls<3)throw new TypeError('network');return 42;},async()=>{}),42); assert.equal(calls,3);
 calls=0; await assert.rejects(retryTransient(async()=>{calls++;throw new Error('HTTP 403');},async()=>{})); assert.equal(calls,1);
});

test('CLI preserves prior catalog on inventory mismatch and reuses archive hashes when previews change', async () => {
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'); const {join,resolve}=await import('node:path'); const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'catalog-import-test-'));
 try {
  const pub=join(dir,'public'),cache=join(dir,'cache');mkdirSync(pub);const out=join(pub,'catalog.json'); const original='{"version":1,"items":[]}';writeFileSync(out,original);
  const listing=html([row('imageid12345','Chair.jpg','image/jpeg',3),row('archiveid12345','Chair.rar','application/x-compressed',5)]);
  const updatedListing=html([row('imageid12345','Chair.jpg','image/jpeg',4),row('archiveid12345','Chair.rar','application/x-compressed',5)]);
  const mock=join(dir,'mock.mjs'),log=join(dir,'network.log');
  writeFileSync(mock,`import {appendFileSync} from 'node:fs'; globalThis.fetch=async value=>{const u=new URL(value); if(u.pathname.startsWith('/drive/folders/')) return new Response(process.env.TEST_PREVIEW_UPDATED==='1'?${JSON.stringify(updatedListing)}:${JSON.stringify(listing)}); const id=u.searchParams.get('id'); appendFileSync(process.env.TEST_LOG,id+'\\n'); const bytes=id==='archiveid12345'?Buffer.from('model'):process.env.TEST_PREVIEW_UPDATED==='1'?Buffer.from([255,216,255,1]):Buffer.from([255,216,255]); return new Response(bytes,{headers:{'content-length':String(bytes.length),'content-type':'application/octet-stream'}});};`);
  const {pathToFileURL}=await import('node:url'); const script=resolve('tools/catalog-import/import.mjs'); const args=['--import',pathToFileURL(mock).href,script,'--folder','folderid12345','--cache',cache,'--out',out,'--expected-models'];
  const run=(count,updated=false)=>spawnSync(process.execPath,[...args,String(count)],{encoding:'utf8',env:{...process.env,TEST_LOG:log,TEST_PREVIEW_UPDATED:updated?'1':'0'},timeout:10000});
  assert.notEqual(run(2).status,0); assert.equal(readFileSync(out,'utf8'),original);
  const result=run(1); assert.equal(result.status,0,result.stderr); const catalog=JSON.parse(readFileSync(out,'utf8'));assert.equal(catalog.items.length,1);assert.equal(catalog.items[0].driveFileId,'archiveid12345');assert.ok(existsSync(join(pub,catalog.items[0].preview)));
  const calls=readFileSync(log,'utf8').trim().split('\n');assert.deepEqual(calls.sort(),['archiveid12345','imageid12345']);
  const again=run(1);assert.equal(again.status,0,again.stderr);assert.equal(readFileSync(log,'utf8').trim().split('\n').length,calls.length);
  const oldPreview=catalog.items[0].preview;
  const previewUpdate=run(1,true);assert.equal(previewUpdate.status,0,previewUpdate.stderr);
  const updateCalls=readFileSync(log,'utf8').trim().split('\n');assert.equal(updateCalls.filter(id=>id==='archiveid12345').length,1);assert.equal(updateCalls.filter(id=>id==='imageid12345').length,2);
  const updatedCatalog=JSON.parse(readFileSync(out,'utf8'));assert.notEqual(updatedCatalog.items[0].preview,oldPreview);assert.ok(existsSync(join(pub,updatedCatalog.items[0].preview)));
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('CLI warns and publishes labeled placeholder for a model without a matching image', async () => {
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'); const {join,resolve}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const {pathToFileURL}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'catalog-missing-preview-'));
 try {
  const pub=join(dir,'public'),cache=join(dir,'cache');mkdirSync(pub);const out=join(pub,'catalog.json');
  const listing=html([row('archiveid12345','Chair.rar','application/x-compressed',5)]);
  const mock=join(dir,'mock.mjs');
  writeFileSync(mock,`globalThis.fetch=async value=>{const u=new URL(value); if(u.pathname.startsWith('/drive/folders/')) return new Response(${JSON.stringify(listing)}); return new Response(Buffer.from('model'),{headers:{'content-length':'5','content-type':'application/octet-stream'}});};`);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(mock).href,resolve('tools/catalog-import/import.mjs'),'--folder','folderid12345','--cache',cache,'--out',out,'--expected-models','1'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/WARNING: no matching preview/);
  const item=JSON.parse(readFileSync(out,'utf8')).items[0]; assert.equal(item.name,'Chair');assert.match(item.preview,/\.png$/);
  const image=readFileSync(join(pub,item.preview));validateImage(image,'.png');assert.deepEqual(image,readFileSync(resolve('tools/catalog-import/placeholder.png')));
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('CLI preserves verified existing preview by Drive ID and fails if it is missing or corrupt', async () => {
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'); const {join,resolve}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const {pathToFileURL}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'catalog-retain-preview-'));
 try {
  const pub=join(dir,'public'),cache=join(dir,'cache'),preview=join(pub,'previews','existing.jpg');mkdirSync(join(pub,'previews'),{recursive:true});
  const out=join(pub,'catalog.json');const existing={version:1,items:[{id:'chair',name:'Chair',category:'Furniture',preview:'previews/existing.jpg',driveFileId:'archiveid12345',fileName:'Chair.rar',sha256:'a'.repeat(64)}]};
  writeFileSync(out,JSON.stringify(existing));writeFileSync(preview,Buffer.from([255,216,255,1]));
  const listing=html([row('archiveid12345','Chair.rar','application/x-compressed',5)]),mock=join(dir,'mock.mjs');
  writeFileSync(mock,`globalThis.fetch=async value=>{const u=new URL(value); if(u.pathname.startsWith('/drive/folders/')) return new Response(${JSON.stringify(listing)}); return new Response(Buffer.from('model'),{headers:{'content-length':'5','content-type':'application/octet-stream'}});};`);
  const run=()=>spawnSync(process.execPath,['--import',pathToFileURL(mock).href,resolve('tools/catalog-import/import.mjs'),'--folder','folderid12345','--cache',cache,'--out',out,'--expected-models','1'],{encoding:'utf8',timeout:10000});
  const first=run();assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(readFileSync(out,'utf8')).items[0].preview,'previews/existing.jpg');
  const before=readFileSync(out,'utf8');writeFileSync(preview,Buffer.from('bad'));const bad=run();assert.notEqual(bad.status,0);assert.equal(readFileSync(out,'utf8'),before);
  rmSync(preview);const missing=run();assert.notEqual(missing.status,0);assert.equal(readFileSync(out,'utf8'),before);
  writeFileSync(preview,Buffer.from([255,216,255,1]));const duplicate={...existing,items:[existing.items[0],{...existing.items[0],id:'duplicate'}]};writeFileSync(out,JSON.stringify(duplicate));
  const duplicateBefore=readFileSync(out,'utf8'),ambiguous=run();assert.notEqual(ambiguous.status,0);assert.equal(readFileSync(out,'utf8'),duplicateBefore);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('CLI identifies the folder and ID when Drive listing is malformed', async () => {
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'); const {join,resolve}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const {pathToFileURL}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'catalog-bad-folder-'));
 try { const pub=join(dir,'public'),cache=join(dir,'cache');mkdirSync(pub);const out=join(pub,'catalog.json');
  const listing=html([row('subfolder12345','Problem','application/vnd.google-apps.folder',0)]); const mock=join(dir,'mock.mjs');
  writeFileSync(mock,`globalThis.fetch=async value=>{const u=new URL(value); return new Response(u.pathname.endsWith('folderid12345')?${JSON.stringify(listing)}:'<html>unavailable</html>');};`);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(mock).href,resolve('tools/catalog-import/import.mjs'),'--folder','folderid12345','--cache',cache,'--out',out,'--expected-models','1'],{encoding:'utf8',timeout:10000});
  assert.notEqual(result.status,0); assert.match(result.stderr,/Problem/);assert.match(result.stderr,/subfolder12345/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a Drive null listing requires matching folder metadata and separate embedded empty view', async () => {
 const { parseEmbeddedEmpty }=await import('./import.mjs');
 const empty=html(null).replace(encode([null]),encode([null,null,null,null,[[['folderid12345']]],1]));
 assert.equal(parseListing(empty,{folderId:'folderid12345'}),null);
 assert.throws(()=>parseListing(empty,{folderId:'wrongfolder12345'}));
 assert.equal(parseEmbeddedEmpty('<html><title>Brick</title><body><div id="flip-contents"><div class="flip-entries"></div></div></body></html>'),true);
 assert.throws(()=>parseEmbeddedEmpty('<html><title>Login</title><div id="flip-contents">Sign in</div></html>'));
 assert.throws(()=>parseEmbeddedEmpty('<html><title>Brick</title><div id="flip-contents"><div class="flip-entries"><div class="flip-entry"></div></div></div></html>'));
});

test('catalog CLI accepts a fail-closed minimum and rejects ambiguous count settings', () => {
 const options=parseArguments(['--folder','rootfolder123','--cache','C:\\catalog-cache','--out','library/public/catalog.json','--minimum-models','360','--list-source','drive-api']);
 assert.equal(options.minimumModels,360);assert.equal(options.expectedModels,null);assert.equal(options.listSource,'drive-api');
 assert.throws(()=>parseArguments(['--folder','rootfolder123','--cache','cache','--out','catalog.json','--minimum-models','0']),/count/i);
 assert.throws(()=>parseArguments(['--folder','rootfolder123','--cache','cache','--out','catalog.json','--minimum-models','360','--expected-models','360']),/exactly one/i);
});

test('minimum-count scan preserves curated fields and leaves catalog unchanged below the safety floor', async () => {
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'); const {join,resolve}=await import('node:path'); const {spawnSync}=await import('node:child_process'); const {pathToFileURL}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'catalog-minimum-count-'));
 try {
  const pub=join(dir,'public'),cache=join(dir,'cache');mkdirSync(pub);const out=join(pub,'catalog.json');
  const previous={version:1,items:[{id:'curated-chair',name:'Curated chair title',category:'Furniture / Seating',preview:'previews/old.jpg',driveFileId:'archiveid12345',fileName:'Chair.rar',sha256:'a'.repeat(64),entryFile:'chair/scene.max'}]};
  writeFileSync(out,JSON.stringify(previous));
  const listing=html([row('imageid12345','Chair.jpg','image/jpeg',3),row('archiveid12345','Chair.rar','application/x-compressed',5)]);
  const mock=join(dir,'mock.mjs');
  writeFileSync(mock,`globalThis.fetch=async value=>{const u=new URL(value); if(u.pathname.startsWith('/drive/folders/')) return new Response(${JSON.stringify(listing)}); const bytes=u.searchParams.get('id')==='archiveid12345'?Buffer.from('model'):Buffer.from([255,216,255]); return new Response(bytes,{headers:{'content-length':String(bytes.length),'content-type':'application/octet-stream'}});};`);
  const script=resolve('tools/catalog-import/import.mjs');
  const run=minimum=>spawnSync(process.execPath,['--import',pathToFileURL(mock).href,script,'--folder','folderid12345','--cache',cache,'--out',out,'--minimum-models',String(minimum),'--list-source','html'],{encoding:'utf8',timeout:10000});
  const first=run(1);assert.equal(first.status,0,first.stderr);
  const result=JSON.parse(readFileSync(out,'utf8')).items[0];
  assert.equal(result.id,'curated-chair');assert.equal(result.name,'Curated chair title');assert.equal(result.category,'Furniture / Seating');assert.equal(result.entryFile,'chair/scene.max');
  const before=readFileSync(out,'utf8');const second=run(2);assert.notEqual(second.status,0);assert.match(second.stderr,/safety minimum/i);assert.equal(readFileSync(out,'utf8'),before);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('list confirms null only with empty embedded view for same folder', async () => {
 const {list}=await import('./import.mjs'); const old=globalThis.fetch;
 const payload=[null,null,null,null,[[['folderid12345']]],1]; const listing=`<title>Brick - Google Drive</title>${html(null).replace(encode([null]),encode(payload))}`;
 try {
  globalThis.fetch=async url=>new Response(String(url).includes('embeddedfolderview')?'<html><title>Brick</title><body><div id="flip-contents"><div class="flip-entries"></div></div></body></html>':listing);
  assert.deepEqual(await list('folderid12345'),[]);
  globalThis.fetch=async url=>new Response(String(url).includes('embeddedfolderview')?'<html><title>Other</title><body><div id="flip-contents"><div class="flip-entries"></div></div></body></html>':listing);
  await assert.rejects(list('folderid12345'),/does not match/);
  globalThis.fetch=async url=>new Response(String(url).includes('embeddedfolderview')?'<html><title>Brick</title><body><div id="flip-contents"><div class="flip-entries"><div class="flip-entry"></div></div></div></body></html>':listing);
  await assert.rejects(list('folderid12345'),/does not confirm/);
 } finally {globalThis.fetch=old;}
});
