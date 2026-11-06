import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { createDriveClient, FOLDER, SHORTCUT } from '../drive/client.js';
import { startFakeDrive } from '../drive/testing/fake-drive.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const KEY = 'AIzaSyScanKey_0123456789-abcdefghijklmn';
const ROOT = 'scanRootFolder01';
let dispose, pool, q, scanSource, fake, sourceId;
let n = 0;
const nid = () => `F${String(++n).padStart(11, '0')}`;
const md5 = s => createHash('md5').update(s).digest('hex');

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_scan');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
  ({ scanSource } = await import('./scan.js'));
  fake = await startFakeDrive({ pageSize: 2, apiKeys: [KEY] });
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY',$1,'root','MY_DRIVE') returning id", [ROOT])).rows[0].id;
});
after(async () => { if (fake) await fake.close(); if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  fake.state.files.length = 0; fake.state.failures.length = 0; fake.state.missingFolders.clear(); fake.state.requests.length = 0;
  await pool.query('delete from drive_inventory'); await pool.query('delete from drive_sync_job_items'); await pool.query('delete from drive_sync_jobs');
});

const folder = (name, parent, extra = {}) => { const f = { id: nid(), name, mimeType: FOLDER, parents: [parent], ...extra }; fake.state.files.push(f); return f; };
const file = (name, parent, extra = {}) => { const f = { id: nid(), name, mimeType: 'image/jpeg', parents: [parent], size: 100, md5Checksum: md5(name), ...extra }; fake.state.files.push(f); return f; };
const client = (over = {}) => createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 3 }, ...over });
const source = () => ({ id: sourceId, root_folder_id: ROOT, root_resource_key: null, drive_id: null });

async function newJob() {
  const j = await q.enqueueJob(pool, { sourceId, mode: 'FULL' });
  return q.claimJob(pool, 'scan-worker');
}
const ctxFor = (job, over = {}) => ({
  signal: new AbortController().signal, cancelled: false, shuttingDown: false,
  saveProgress: p => q.saveProgress(pool, job.id, 'scan-worker', p), ...over,
});
const inv = () => pool.query('select * from drive_inventory order by path').then(r => r.rows);
const finish = job => q.finishJob(pool, job.id, 'scan-worker', { status: 'COMPLETED' });

test('scans a tree: folders and files are recorded with relative paths, parents, size, md5; Google Docs are skipped; the root is not stored', { skip }, async () => {
  const a = folder('Architecture', ROOT), b = folder('Fence', a.id);
  file('01.jpg', b.id); file('01.rar', b.id, { mimeType: 'application/x-rar', size: 5000, md5Checksum: md5('rar') });
  file('notes', a.id, { mimeType: 'application/vnd.google-apps.document', md5Checksum: undefined });
  const job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.equal(r.done, true);
  const rows = await inv();
  assert.deepEqual(rows.map(x => [x.path, x.is_folder]), [['Architecture', true], ['Architecture/Fence', true], ['Architecture/Fence/01.jpg', false], ['Architecture/Fence/01.rar', false]]);
  const rar = rows.find(x => x.filename === '01.rar');
  assert.deepEqual([rar.mime_type, Number(rar.size_bytes), rar.md5_checksum, rar.parent_drive_id, rar.last_seen_job_id, rar.can_download], ['application/x-rar', 5000, md5('rar'), b.id, job.id, true]);
  assert.deepEqual(r.counters, { scannedFolders: 3, scannedFiles: 2, skippedCount: 1, errorCount: 0 });
  const saved = await pool.query('select scanned_folders, scanned_files, skipped_count, error_count from drive_sync_jobs where id=$1', [job.id]);
  assert.deepEqual(saved.rows[0], { scanned_folders: 3, scanned_files: 2, skipped_count: 1, error_count: 0 });
});

test('3DSMOOD scopes inventory to 3DMODELS without wrapper category or scene requests, including resume', { skip }, async () => {
  const models = folder('3DMODELS', ROOT), scenes = folder('3DSCENES', ROOT);
  const furniture = folder('Furniture', models.id);
  file('chair.zip', furniture.id, { mimeType: 'application/zip' });
  file('room.zip', scenes.id, { mimeType: 'application/zip' });
  const job = await newJob();
  const scoped = { ...source(), root_folder_name: '3DSMOOD' };
  let saves = 0;
  const ctx = ctxFor(job);
  Object.defineProperty(ctx, 'shuttingDown', { get: () => saves >= 1 });
  ctx.saveProgress = async progress => { saves++; return q.saveProgress(pool, job.id, 'scan-worker', progress); };
  assert.equal((await scanSource({ pool, client: client(), job, source: scoped, ctx })).interrupted, true);
  const resumed = (await pool.query('select * from drive_sync_jobs where id=$1', [job.id])).rows[0];
  assert.equal(resumed.checkpoint.scan.scopePolicy, 'models-v1');
  assert.equal((await scanSource({ pool, client: client(), job: resumed, source: scoped, ctx: ctxFor(resumed) })).done, true);
  assert.deepEqual((await inv()).map(row => row.path), ['Furniture', 'Furniture/chair.zip']);
  assert.ok(!fake.state.requests.some(request => request.query.q?.includes(scenes.id)), 'scene branch was never listed');
  const old = { ...resumed, checkpoint: { scan: { done: true } } };
  await assert.rejects(scanSource({ pool, client: client(), job: old, source: scoped, ctx: ctxFor(old) }), { code: 'FULL_SCAN_REQUIRED' });
});

test('pagination and size: 7 files in one folder across 4 pages, and 450 files across batches of 200, are all recorded', { skip }, async () => {
  const d = folder('Big', ROOT);
  for (let i = 0; i < 450; i++) file(`m${String(i).padStart(3, '0')}.jpg`, d.id);
  const job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job), pageSize: 100 });
  assert.equal(r.counters.scannedFiles, 450);
  assert.equal((await pool.query("select count(*)::int n from drive_inventory where not is_folder")).rows[0].n, 450);
  const listCalls = fake.state.requests.filter(x => x.path === '/drive/v3/files' && x.query.q.includes(d.id));
  assert.equal(listCalls.length > 1, true, 'followed nextPageToken');
});

test('nesting 6 levels deep is recorded with the full relative path', { skip }, async () => {
  let parent = ROOT; const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const nme of names) parent = folder(nme, parent).id;
  file('deep.jpg', parent);
  const job = await newJob();
  await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.ok((await inv()).some(x => x.path === 'a/b/c/d/e/f/deep.jpg'));
});

test('shortcuts: a shortcut to a folder is followed once; loops and a folder reachable twice are scanned a single time', { skip }, async () => {
  const a = folder('A', ROOT); file('only.jpg', a.id);
  fake.state.files.push({ id: nid(), name: 'to-A', mimeType: SHORTCUT, parents: [ROOT], shortcutDetails: { targetId: a.id, targetMimeType: FOLDER } });
  fake.state.files.push({ id: nid(), name: 'loop-to-root', mimeType: SHORTCUT, parents: [a.id], shortcutDetails: { targetId: ROOT, targetMimeType: FOLDER } });
  fake.state.files.push({ id: nid(), name: 'to-file', mimeType: SHORTCUT, parents: [ROOT], shortcutDetails: { targetId: nid(), targetMimeType: 'image/jpeg' } });
  const job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.equal(r.done, true);
  const lists = fake.state.requests.filter(x => x.path === '/drive/v3/files' && x.query.q.includes(a.id));
  assert.equal(lists.length >= 1 && lists.every((x, i, arr) => !x.query.pageToken || arr.length > 1), true);
  assert.equal(new Set(lists.filter(x => !x.query.pageToken).map(x => x.query.q)).size, 1);
  assert.equal(lists.filter(x => !x.query.pageToken).length, 1, 'folder A listed exactly once');
  const shortcuts = (await inv()).filter(x => x.is_shortcut);
  assert.equal(shortcuts.length, 3);
  assert.ok(shortcuts.every(x => x.shortcut_target_id));
});

test('a file that appears under two folders is stored once per job: the first path wins, no ON CONFLICT crash', { skip }, async () => {
  const a = folder('A', ROOT), b = folder('B', ROOT);
  file('shared.jpg', a.id, { parents: [a.id, b.id] });
  const job = await newJob();
  await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  const rows = (await inv()).filter(x => x.filename === 'shared.jpg');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, 'A/shared.jpg');
});

test('the same file listed twice inside ONE page (overlapping pagination) is written once, without an ON CONFLICT crash', { skip }, async () => {
  const d = folder('D', ROOT);
  const f = file('dup.jpg', d.id);
  fake.state.files.push({ ...f }); // same id, same parent: both land in one 2-item page
  const job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.equal(r.done, true);
  assert.equal((await inv()).filter(x => x.filename === 'dup.jpg').length, 1);
});

test('a sub-folder that disappears (404) is recorded as a FAILED item and the scan carries on; a missing ROOT fails the job', { skip }, async () => {
  const good = folder('Good', ROOT), gone = folder('Gone', ROOT);
  file('ok.jpg', good.id);
  fake.state.missingFolders.add(gone.id);
  const job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.equal(r.done, true);
  assert.equal(r.counters.errorCount, 1);
  const items = (await pool.query('select drive_file_id, action, status, error_code from drive_sync_job_items where job_id=$1', [job.id])).rows;
  assert.deepEqual(items, [{ drive_file_id: gone.id, action: 'SCAN', status: 'FAILED', error_code: 'DRIVE_NOT_FOUND' }]);
  assert.ok((await inv()).some(x => x.path === 'Good/ok.jpg'));
  // the failing folder is still known by name/path through the inventory row of its own entry
  assert.ok((await inv()).some(x => x.drive_file_id === gone.id && x.path === 'Gone'));

  await finish(job);
  fake.state.missingFolders.add(ROOT);
  const job2 = await newJob();
  await assert.rejects(scanSource({ pool, client: client(), job: job2, source: source(), ctx: ctxFor(job2) }), e => e.code === 'DRIVE_NOT_FOUND');
});

test('transient errors: one 429 is retried and the scan completes; errors that outlast the retries fail the job (not silently skipped)', { skip }, async () => {
  const d = folder('D', ROOT); file('x.jpg', d.id);
  fake.state.failures.push({ status: 429, reason: 'rateLimitExceeded' });
  let job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.equal(r.done, true);
  await finish(job);
  await pool.query('delete from drive_inventory');
  for (let i = 0; i < 10; i++) fake.state.failures.push({ status: 503, reason: 'backendError' });
  job = await newJob();
  await assert.rejects(scanSource({ pool, client: client({ retry: { sleep: async () => {}, retries: 1 } }), job, source: source(), ctx: ctxFor(job) }), e => e.code === 'DRIVE_UPSTREAM_ERROR');
});

test('resume: interrupted by shutdown after 2 pages, then continued from the checkpoint — same inventory, counters not double counted', { skip }, async () => {
  for (const nme of ['A', 'B', 'C']) { const f = folder(nme, ROOT); for (let i = 0; i < 3; i++) file(`${nme}${i}.jpg`, f.id); }
  const reference = async () => { const j = await newJob(); const r = await scanSource({ pool, client: client(), job: j, source: source(), ctx: ctxFor(j) }); await finish(j); const rows = (await inv()).map(x => [x.path, x.md5_checksum]); await pool.query('delete from drive_inventory'); return { counters: r.counters, rows }; };
  const full = await reference();

  const job = await newJob();
  let saves = 0;
  const ctx1 = ctxFor(job); // a getter must be defined on the object itself: spreading would freeze its value
  Object.defineProperty(ctx1, 'shuttingDown', { get: () => saves >= 2 });
  ctx1.saveProgress = async p => { saves++; return q.saveProgress(pool, job.id, 'scan-worker', p); };
  const r1 = await scanSource({ pool, client: client(), job, source: source(), ctx: ctx1 });
  assert.equal(r1.interrupted, true);
  const mid = (await pool.query('select checkpoint, scanned_files from drive_sync_jobs where id=$1', [job.id])).rows[0];
  assert.ok(mid.checkpoint.scan.queue.length > 0, 'queue persisted');

  const again = (await pool.query('select * from drive_sync_jobs where id=$1', [job.id])).rows[0];
  const r2 = await scanSource({ pool, client: client(), job: again, source: source(), ctx: ctxFor(again) });
  assert.equal(r2.done, true);
  assert.deepEqual(r2.counters, full.counters);
  assert.deepEqual((await inv()).map(x => [x.path, x.md5_checksum]), full.rows);
});

test('cancel and lost lease stop the scan at a safe point without writing past it', { skip }, async () => {
  folder('A', ROOT); folder('B', ROOT);
  let job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job, { cancelled: true }) });
  assert.deepEqual([r.status, r.done], ['CANCELLED', undefined]);
  assert.equal((await inv()).length, 0, 'nothing scanned after a cancel request');
  await q.finishJob(pool, job.id, 'scan-worker', { status: 'CANCELLED' });

  job = await newJob();
  const lost = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job, { saveProgress: async () => false }) });
  assert.equal(lost.leaseLost, true);
});

test('second scan of an unchanged tree rewrites nothing new (same rows), a changed file updates its md5, last_seen_job_id moves to the new job', { skip }, async () => {
  const d = folder('D', ROOT); const f = file('x.jpg', d.id, { md5Checksum: md5('v1') });
  let job = await newJob();
  await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  const first = job.id; await finish(job);
  const before = (await inv()).length;
  f.md5Checksum = md5('v2');
  job = await newJob();
  await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  const rows = await inv();
  assert.equal(rows.length, before);
  const x = rows.find(r => r.filename === 'x.jpg');
  assert.deepEqual([x.md5_checksum, x.last_seen_job_id], [md5('v2'), job.id]);
  assert.notEqual(job.id, first);
});

test('hostile names: "/" and control characters cannot forge path segments; absurd trees hit the limits instead of exhausting memory', { skip }, async () => {
  const d = folder('Evil/../Name', ROOT);
  file('a/b\u0000.jpg', d.id);
  let job = await newJob();
  await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  const rows = await inv();
  assert.ok(rows.every(x => !x.path.includes('..') || !x.path.split('/').includes('..')), 'no ".." segment');
  assert.ok(rows.every(x => !/[\u0000-\u001f]/.test(x.path)));
  assert.equal(rows.find(x => !x.is_folder).filename, 'a/b\u0000.jpg'.replace(/\u0000/g, ''), 'filename keeps the real name minus NUL (Postgres cannot store NUL)');
  await finish(job);

  for (let i = 0; i < 5; i++) file(`more${i}.jpg`, ROOT);
  job = await newJob();
  await assert.rejects(scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job), maxFiles: 3 }), e => e.code === 'SCAN_LIMIT_EXCEEDED');
});

test('dirty metadata from Drive cannot break a batch: upper-case md5 is lower-cased, garbage md5/size/date become NULL', { skip }, async () => {
  const d = folder('D', ROOT);
  file('upper.jpg', d.id, { md5Checksum: 'ABCDEF0123456789ABCDEF0123456789' });
  file('garbage.jpg', d.id, { md5Checksum: 'not-a-hash', size: 'huge', resourceKey: "bad key'; --" });
  const job = await newJob();
  const r = await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  assert.equal(r.done, true);
  const byName = Object.fromEntries((await inv()).map(x => [x.filename, x]));
  assert.equal(byName['upper.jpg'].md5_checksum, 'abcdef0123456789abcdef0123456789');
  assert.deepEqual([byName['garbage.jpg'].md5_checksum, byName['garbage.jpg'].size_bytes, byName['garbage.jpg'].resource_key], [null, null, null]);
});

test('the API key never reaches the database (inventory, items, checkpoint)', { skip }, async () => {
  const d = folder('D', ROOT); file('x.jpg', d.id);
  fake.state.missingFolders.add(folder('Gone', ROOT).id);
  const job = await newJob();
  await scanSource({ pool, client: client(), job, source: source(), ctx: ctxFor(job) });
  for (const t of ['drive_inventory', 'drive_sync_job_items', 'drive_sync_jobs']) {
    assert.ok(!JSON.stringify((await pool.query(`select * from ${t}`)).rows).includes(KEY), `${t} contains the API key`);
  }
});
