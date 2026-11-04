import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { isolatedTestDatabase } from '../test-database.js';
import { createDriveClient, FOLDER } from '../drive/client.js';
import { startFakeDrive } from '../drive/testing/fake-drive.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const KEY = 'AIzaSyProcessKey_0123456789-abcdefghi';
const ROOT = 'procRootFolder001';
let dispose, pool, q, mod, runWorker, ensureApiKeySource, manifest, fake, sourceId;
let n = 0;
const nid = () => `T${String(++n).padStart(11, '0')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jpeg = (seed) => sharp({ create: { width: 900 + seed, height: 600, channels: 3, background: { r: seed * 7 % 255, g: 80, b: 120 } } }).jpeg().toBuffer();

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_process');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
  mod = await import('./process.js');
  ({ runWorker } = await import('./runner.js'));
  ({ ensureApiKeySource } = await import('./source.js'));
  manifest = await import('../catalog-v1/manifest.js');
  fake = await startFakeDrive({ pageSize: 100, apiKeys: [KEY] });
});
after(async () => { if (fake) await fake.close(); if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  fake.state.files.length = 0; fake.state.failures.length = 0; fake.state.missingFolders.clear(); fake.state.requests.length = 0;
  await pool.query('update models set primary_file_id = null');
  for (const t of ['review_items', 'model_previews', 'model_files', 'models', 'categories', 'drive_inventory', 'drive_sync_job_items', 'drive_sync_jobs', 'drive_sources']) await pool.query(`delete from ${t}`);
  await pool.query('update catalog_state set active_version = 0, manifest_checksum = null, published_at = null, published_by_job = null');
  fake.state.files.push({ id: ROOT, name: 'root', mimeType: FOLDER, parents: [] });
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY',$1,'root','MY_DRIVE') returning id", [ROOT])).rows[0].id;
});

const folder = (name, parent) => { const f = { id: nid(), name, mimeType: FOLDER, parents: [parent] }; fake.state.files.push(f); return f; };
async function addPair(parent, stem, seed = ++n) {
  const content = await jpeg(seed);
  const img = { id: nid(), name: `${stem}.jpg`, mimeType: 'image/jpeg', parents: [parent], content, size: content.length, md5Checksum: `${String(seed).padStart(32, 'a').slice(-32)}`.replace(/[^0-9a-f]/g, 'b') };
  const arc = { id: nid(), name: `${stem}.rar`, mimeType: 'application/x-rar', parents: [parent], content: Buffer.from('rar-bytes-' + stem), size: 100 + seed, md5Checksum: `${String(seed + 1000).padStart(32, 'c').slice(-32)}`.replace(/[^0-9a-f]/g, 'd') };
  fake.state.files.push(img, arc);
  return { img, arc };
}
const makeHandler = (over = {}) => mod.createSyncHandler({
  pool,
  createClient: () => createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 1 } }), ...over,
});
const job = id => pool.query('select * from drive_sync_jobs where id=$1', [id]).then(r => r.rows[0]);
const media = () => fake.state.requests.filter(r => r.query.alt === 'media').length;
const TERMINAL = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'];

// Runs a worker until `until(job)` holds (or the job is terminal), then stops it and waits.
async function work(jobId, { handler = makeHandler(), until = j => TERMINAL.includes(j.status), ms = 20_000, signal: external } = {}) {
  const ac = new AbortController();
  external?.addEventListener('abort', () => ac.abort());
  const done = runWorker({ pool, handler, signal: ac.signal, workerId: 'proc-worker', pollMs: 10, heartbeatMs: 40, leaseMs: 5000, onError: () => {} });
  const end = Date.now() + ms;
  while (Date.now() < end && !until(await job(jobId))) await sleep(15);
  ac.abort(); await done;
  return job(jobId);
}
const enqueue = () => q.enqueueJob(pool, { sourceId, mode: 'FULL' });
const state = () => manifest.readCatalogState(pool);


test('an unexpected error (even one carrying a secret) ends the job FAILED with a generic code; its text is never stored', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'one');
  const handler = makeHandler({ createClient: () => { throw new Error('Bearer ya29.SUPER-SECRET-TOKEN leaked from the client'); } });
  const j = await work((await enqueue()).id, { handler });
  assert.deepEqual([j.status, j.error_code], ['FAILED', 'JOB_HANDLER_ERROR']);
  assert.ok(!JSON.stringify(j).includes('SUPER-SECRET'));
  assert.ok(!j.error_message.includes('Bearer'));
});

test('a disabled or non-API-key source ends the job FAILED (DRIVE_NOT_CONNECTED) before any Drive call', { skip }, async () => {
  await pool.query('update drive_sources set enabled = false');
  fake.state.requests.length = 0;
  const j = await work((await enqueue()).id);
  assert.deepEqual([j.status, j.error_code], ['FAILED', 'DRIVE_NOT_CONNECTED']);
  assert.equal(fake.state.requests.length, 0);
});

test('the API key never reaches the database: jobs, items, checkpoints, reviews', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'one'); await addPair(d.id, 'bad', 7, { badImage: true });
  fake.state.missingFolders.add(folder('Gone', ROOT).id);
  await work((await enqueue()).id);
  for (const t of ['drive_sync_jobs', 'drive_sync_job_items', 'review_items', 'drive_inventory', 'models', 'model_files', 'model_previews', 'audit_events']) {
    assert.ok(!JSON.stringify((await pool.query(`select * from ${t}`)).rows).includes(KEY), `${t} contains the API key`);
  }
});

test('ensureApiKeySource: verifies the folder through Drive, creates the source once, re-enables it; a file or unknown id is refused', { skip }, async () => {
  await pool.query('delete from drive_sources');
  const client = createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 0 } });
  const a = await ensureApiKeySource({ pool, client, rootFolderId: ROOT });
  const b = await ensureApiKeySource({ pool, client, rootFolderId: ROOT });
  assert.equal(a.id, b.id);
  assert.deepEqual((await pool.query('select access_mode, root_folder_name, enabled from drive_sources')).rows, [{ access_mode: 'API_KEY', root_folder_name: 'root', enabled: true }]);
  await pool.query('update drive_sources set enabled = false');
  await ensureApiKeySource({ pool, client, rootFolderId: ROOT });
  assert.equal((await pool.query('select enabled from drive_sources')).rows[0].enabled, true);
  const file = { id: nid(), name: 'x.jpg', mimeType: 'image/jpeg', parents: [ROOT] }; fake.state.files.push(file);
  await assert.rejects(ensureApiKeySource({ pool, client, rootFolderId: file.id }), e => e.code === 'DRIVE_NOT_A_FOLDER');
  await assert.rejects(ensureApiKeySource({ pool, client, rootFolderId: 'does-not-exist-123' }), e => e.code === 'DRIVE_NOT_FOUND');
  await assert.rejects(ensureApiKeySource({ pool, client, rootFolderId: "x' or '1'='1" }), e => e.code === 'INVALID_PARAMS');
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 1);
});

// ---- P3.4: "Can duyet" cua mot luot = so muc DANG CHO duyet (OPEN), khong phai so muc phat hien trong luot quet ----
const orphan = (parent, name) => fake.state.files.push({ id: nid(), name, mimeType: 'application/x-rar', parents: [parent], content: Buffer.from('x'), size: 1, md5Checksum: 'e'.repeat(32) });
const reviewCountOf = async (jobId) => Number((await job(jobId)).review_count);


test('D29: a FULL job lists archives only — NO image is ever downloaded, models are archive-only (admin-visible), nothing is public yet', { skip }, async () => {
  const a = folder('Furniture', ROOT), b = folder('Desk', a.id), empty = folder('Empty', ROOT);
  await addPair(b.id, 'one'); await addPair(b.id, 'two'); await addPair(a.id, 'three');
  const j = await work((await enqueue()).id);
  assert.equal(j.status, 'COMPLETED');
  assert.equal(media(), 0, 'no alt=media request at all (Drive throttles previews)');
  assert.deepEqual((await pool.query('select m.name, m.stem, c.full_path, (select count(*) from model_previews p where p.model_id=m.id)::int as previews from models m join categories c on c.id=m.category_id order by m.name')).rows,
    [{ name: 'one', stem: 'one', full_path: 'Furniture / Desk', previews: 0 }, { name: 'three', stem: 'three', full_path: 'Furniture', previews: 0 }, { name: 'two', stem: 'two', full_path: 'Furniture / Desk', previews: 0 }]);
  assert.ok((await pool.query("select 1 from categories where full_path = 'Empty'")).rowCount, 'empty Drive folders still become categories (upload targets)');
  assert.equal((await state()).version, 0, 'archive-only models are not public');
  assert.equal(j.new_count, 3); assert.equal(j.skipped_count >= 3, true, 'the 3 images were skipped');
});

test('D29: running again changes nothing — new=0, updated=0, version unchanged, still no image request', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'one');
  await work((await enqueue()).id);
  const before = (await pool.query('select id, updated_at from models')).rows;
  const j2 = await work((await enqueue()).id);
  assert.deepEqual([j2.status, j2.new_count, j2.updated_count, j2.unchanged_count], ['COMPLETED', 0, 0, 1]);
  assert.deepEqual((await pool.query('select id, updated_at from models')).rows, before.map(r => ({ ...r })));
  assert.equal(media(), 0);
});

test('D29: an uploaded preview pairs with the scanned archive of the same stem (dirty names, other folder) and the model goes public once', { skip }, async () => {
  const d = folder('Desk', ROOT), other = folder('Lamp', ROOT);
  const cat = (await pool.query("insert into categories(name,slug,full_path) values('Lamp','lamp','Lamp') returning id")).rows[0].id;
  const id = (await pool.query("insert into models(category_id,name,status,stem) values($1,'Pretty One','PUBLISHED','pretty one') returning id", [cat])).rows[0].id;
  for (const v of ['sm', 'lg']) await pool.query("insert into model_previews(model_id,source,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'UPLOAD',$2,$3,10,10,10,$4,true)", [id, `${'b'.repeat(64)}.webp`, 'b'.repeat(64), v]);
  fake.state.files.push({ id: nid(), name: 'Pretty One.rar.rar', mimeType: 'application/x-rar', parents: [d.id], size: 5, md5Checksum: 'e'.repeat(32) });
  const j = await work((await enqueue()).id);
  assert.equal(j.status, 'COMPLETED');
  const m = (await pool.query('select m.category_id, m.drive_category_id, m.primary_file_id is not null as has_file, (select count(*) from models)::int as n, dc.full_path as drive_path from models m join categories dc on dc.id=m.drive_category_id')).rows;
  assert.deepEqual(m.map(r => [r.n, r.has_file, r.drive_path, r.category_id === cat]), [[1, true, 'Desk', true]], 'one model; the preview category wins; Drive category kept for the mismatch flag');
  assert.equal((await state()).version, 1);
  assert.deepEqual((await manifest.buildManifest(pool)).models.map(x => [x.id, x.name]), [[id, 'Pretty One']]);
  await work((await enqueue()).id);
  assert.equal((await state()).version, 1, 'a second scan does not bump the version');
  assert.ok(other);
});

test('D29: two archives with the same stem are a review item, never paired or created', { skip }, async () => {
  const a = folder('A', ROOT), b = folder('B', ROOT);
  for (const [p, name] of [[a.id, 'Same Name.rar'], [b.id, 'same name .zip']]) fake.state.files.push({ id: nid(), name, mimeType: 'application/zip', parents: [p], size: 5, md5Checksum: 'f'.repeat(32) });
  const id1 = (await work((await enqueue()).id));
  assert.equal(id1.status, 'COMPLETED');
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 0);
  assert.deepEqual((await pool.query("select kind, status from review_items")).rows, [{ kind: 'AMBIGUOUS_PAIR', status: 'OPEN' }]);
  assert.equal(id1.review_count, 1);
  await work((await enqueue()).id);
  assert.equal((await pool.query('select count(*)::int n from review_items')).rows[0].n, 1, 'not reopened every scan');
});

test('D29: renaming an archive on Drive detaches it from the old model (which keeps its preview) and creates an archive-only model', { skip }, async () => {
  const d = folder('Desk', ROOT);
  const { arc } = await addPair(d.id, 'old name');
  await work((await enqueue()).id);
  const oldId = (await pool.query("select id from models where stem = 'old name'")).rows[0].id;
  for (const v of ['sm', 'lg']) await pool.query("insert into model_previews(model_id,source,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'UPLOAD',$2,$3,10,10,10,$4,true)", [oldId, `${'c'.repeat(64)}.webp`, 'c'.repeat(64), v]);
  arc.name = 'new name.rar';
  await work((await enqueue()).id);
  assert.deepEqual((await pool.query('select stem, primary_file_id is not null as f, (select count(*) from model_previews p where p.model_id=m.id)::int as p from models m order by stem')).rows,
    [{ stem: 'new name', f: true, p: 0 }, { stem: 'old name', f: false, p: 2 }]);
});

test('D29 migration: a legacy model (no stem, Drive-sourced preview rows) is adopted by drive file id on the next scan', { skip }, async () => {
  const d = folder('Desk', ROOT);
  const { arc } = await addPair(d.id, 'Legacy Thing');
  const cat = (await pool.query("insert into categories(name,slug,full_path) values('Desk','desk','Desk') returning id")).rows[0].id;
  const id = (await pool.query("insert into models(category_id,name,status) values($1,'Legacy Thing','PUBLISHED') returning id", [cat])).rows[0].id;
  const f = (await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type) values($1,$2,$3,'Legacy Thing.rar','rar') returning id", [id, sourceId, arc.id])).rows[0].id;
  await pool.query('update models set primary_file_id=$1 where id=$2', [f, id]);
  await work((await enqueue()).id);
  assert.deepEqual((await pool.query('select id, stem from models')).rows, [{ id, stem: 'legacy thing' }]);
});
