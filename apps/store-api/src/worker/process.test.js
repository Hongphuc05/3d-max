import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { isolatedTestDatabase } from '../test-database.js';
import { createDriveClient, FOLDER } from '../drive/client.js';
import { startFakeDrive } from '../drive/testing/fake-drive.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const KEY = 'AIzaSyProcessKey_0123456789-abcdefghi';
const ROOT = 'procRootFolder001';
let dispose, pool, q, mod, runWorker, ensureApiKeySource, manifest, fake, sourceId, dir;
let n = 0;
const nid = () => `T${String(++n).padStart(11, '0')}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jpegs = new Map();
const jpeg = async (seed) => { if (!jpegs.has(seed)) jpegs.set(seed, await sharp({ create: { width: 900 + seed, height: 600, channels: 3, background: { r: seed * 7 % 255, g: 80, b: 120 } } }).jpeg().toBuffer()); return jpegs.get(seed); };

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
after(async () => { if (fake) await fake.close(); if (dir) await rm(dir, { recursive: true, force: true }); if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  fake.state.files.length = 0; fake.state.failures.length = 0; fake.state.missingFolders.clear(); fake.state.requests.length = 0;
  await pool.query('update models set primary_file_id = null');
  for (const t of ['review_items', 'model_previews', 'model_files', 'models', 'categories', 'drive_inventory', 'drive_sync_job_items', 'drive_sync_jobs', 'drive_sources']) await pool.query(`delete from ${t}`);
  await pool.query('update catalog_state set active_version = 0, manifest_checksum = null, published_at = null, published_by_job = null');
  fake.state.files.push({ id: ROOT, name: 'root', mimeType: FOLDER, parents: [] });
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY',$1,'root','MY_DRIVE') returning id", [ROOT])).rows[0].id;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = await mkdtemp(path.join(os.tmpdir(), 'proc-previews-'));
});

const folder = (name, parent) => { const f = { id: nid(), name, mimeType: FOLDER, parents: [parent] }; fake.state.files.push(f); return f; };
async function addPair(parent, stem, seed = ++n, { badImage = false } = {}) {
  const content = badImage ? Buffer.from('this is plain text, not a picture'.repeat(4)) : await jpeg(seed);
  const img = { id: nid(), name: `${stem}.jpg`, mimeType: 'image/jpeg', parents: [parent], content, size: content.length, md5Checksum: `${String(seed).padStart(32, 'a').slice(-32)}`.replace(/[^0-9a-f]/g, 'b') };
  const arc = { id: nid(), name: `${stem}.rar`, mimeType: 'application/x-rar', parents: [parent], content: Buffer.from('rar-bytes-' + stem), size: 100 + seed, md5Checksum: `${String(seed + 1000).padStart(32, 'c').slice(-32)}`.replace(/[^0-9a-f]/g, 'd') };
  fake.state.files.push(img, arc);
  return { img, arc };
}
const makeHandler = (over = {}) => mod.createSyncHandler({
  pool, previewDir: dir, minFreeDiskBytes: 1, defaultPriceVnd: 15000, freeDiskBytes: async () => 10 ** 12,
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

test('a FULL job scans, compares, downloads previews and publishes: models live, files on disk, version 1, counters recorded', { skip }, async () => {
  const a = folder('Furniture', ROOT), d = folder('Desk', a.id);
  await addPair(d.id, 'one'); await addPair(d.id, 'two'); await addPair(d.id, 'three');
  fake.state.files.push({ id: nid(), name: 'orphan.rar', mimeType: 'application/x-rar', parents: [d.id], content: Buffer.from('x'), size: 1, md5Checksum: 'e'.repeat(32) });
  fake.state.files.push({ id: nid(), name: 'doc', mimeType: 'application/vnd.google-apps.document', parents: [d.id] });
  const j = await enqueue();
  const done = await work(j.id);
  assert.equal(done.status, 'COMPLETED', JSON.stringify([done.error_code, done.error_message]));
  assert.deepEqual([done.stage, done.lease_owner, done.error_count, done.new_count, done.updated_count, done.review_count, done.scanned_folders, done.skipped_count], [null, null, 0, 3, 0, 1, 3, 1]);
  assert.ok(done.finished_at && Number(done.bytes_downloaded) > 0);
  const models = (await pool.query("select m.name, m.status, c.full_path from models m join categories c on c.id = m.category_id order by m.name")).rows;
  assert.deepEqual(models, ['one', 'three', 'two'].map(name => ({ name, status: 'PUBLISHED', full_path: 'Furniture / Desk' })));
  assert.equal((await readdir(dir)).filter(f => f.endsWith('.webp')).length, 6);
  assert.equal((await state()).version, 1);
  assert.equal((await pool.query('select last_successful_sync_at is not null as ok from drive_sources')).rows[0].ok, true);
  const man = await manifest.buildManifest(pool);
  assert.deepEqual([man.models.length, man.previews.length], [3, 6]);
});

test('P2.8: running it AGAIN changes nothing — new=0, updated=0, no image downloaded, version unchanged, no new files', { skip }, async () => {
  const d = folder('Desk', ROOT);
  for (const s of ['one', 'two', 'three']) await addPair(d.id, s);
  assert.equal((await work((await enqueue()).id)).status, 'COMPLETED');
  const filesBefore = (await readdir(dir)).sort(), v = (await state()).version;
  fake.state.requests.length = 0;
  const second = await work((await enqueue()).id);
  assert.equal(second.status, 'COMPLETED');
  assert.deepEqual([second.new_count, second.updated_count, second.unchanged_count, second.missing_count, second.error_count], [0, 0, 3, 0, 0]);
  assert.equal(media(), 0, 'no image may be downloaded again');
  assert.deepEqual([(await readdir(dir)).sort(), (await state()).version], [filesBefore, v]);
});

test('adding one model on Drive downloads only that model\'s image and bumps the version once', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'one'); await addPair(d.id, 'two');
  await work((await enqueue()).id);
  await addPair(d.id, 'three');
  fake.state.requests.length = 0;
  const j = await work((await enqueue()).id);
  assert.deepEqual([j.status, j.new_count, j.unchanged_count], ['COMPLETED', 1, 2]);
  assert.equal(media(), 1);
  assert.equal((await state()).version, 2);
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 3);
});

test('a broken image fails ITS model only: job COMPLETED_WITH_ERRORS, the model waits in NEEDS_REVIEW, the rest is live', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'good'); await addPair(d.id, 'bad', 99, { badImage: true });
  const j = await work((await enqueue()).id);
  assert.equal(j.status, 'COMPLETED_WITH_ERRORS');
  assert.equal(j.error_count, 1);
  assert.deepEqual(Object.fromEntries((await pool.query('select name, status from models')).rows.map(r => [r.name, r.status])), { good: 'PUBLISHED', bad: 'NEEDS_REVIEW' });
  assert.deepEqual((await pool.query('select action, status, error_code from drive_sync_job_items where job_id=$1', [j.id])).rows, [{ action: 'PREVIEW', status: 'FAILED', error_code: 'PREVIEW_INVALID' }]);
  assert.equal((await manifest.buildManifest(pool)).models.length, 1);
});

test('missing root folder / exhausted rate limit / low disk end the job FAILED with a code and a safe message — the catalog is untouched', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'one');
  await work((await enqueue()).id);
  const snapshot = JSON.stringify((await pool.query('select id, name, status from models order by id')).rows), v = (await state()).version;
  const check = async (label, code, setup, over) => {
    await setup?.();
    const j = await work((await enqueue()).id, { handler: makeHandler(over) });
    assert.deepEqual([label, j.status, j.error_code], [label, 'FAILED', code]);
    assert.ok(j.error_message && !j.error_message.includes(KEY) && !/http|googleapis|Error:/i.test(j.error_message), `${label}: message must be safe`);
    assert.equal(JSON.stringify((await pool.query('select id, name, status from models order by id')).rows), snapshot, label);
    assert.equal((await state()).version, v, label);
    fake.state.failures.length = 0; fake.state.missingFolders.clear();
  };
  await check('root deleted', 'DRIVE_NOT_FOUND', () => fake.state.missingFolders.add(ROOT));
  await check('rate limited for good', 'DRIVE_QUOTA_EXCEEDED', () => { for (let i = 0; i < 20; i++) fake.state.failures.push({ status: 429, reason: 'rateLimitExceeded' }); });
  await check('permission revoked', 'DRIVE_PERMISSION_DENIED', () => fake.state.failures.push({ status: 403, reason: 'forbidden' }));
  await check('disk full', 'DISK_SPACE_LOW', async () => { await addPair(d.id, 'two'); }, { freeDiskBytes: async () => 5, minFreeDiskBytes: 1000 }); // a NEW image needs downloading
});

test('P2.8: a worker killed in the middle of DOWNLOADING_PREVIEWS is resumed by the next one; finished images are not downloaded again', { skip }, async () => {
  const d = folder('Desk', ROOT);
  for (let i = 0; i < 8; i++) await addPair(d.id, `m${i}`, i + 1);
  const j = await enqueue();
  const ac = new AbortController();
  const killAfter = 3;
  const slow = makeHandler({ createClient: () => {
    const c = createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 1 } });
    return { ...c, openMedia: async (...a) => { const r = await c.openMedia(...a); r.data.on('error', () => {}); /* the test holds the stream before handing it over */ if (media() >= killAfter) ac.abort(); await sleep(15); return r; } };
  } });
  const first = await work(j.id, { handler: slow, signal: ac.signal, until: () => ac.signal.aborted });
  await sleep(100);
  const parked = await job(j.id);
  assert.deepEqual([parked.status, parked.lease_owner], ['QUEUED', null], 'graceful stop puts the job back in the queue');
  assert.ok(Object.keys(parked.checkpoint.previews.results).length >= 1, 'finished images are in the checkpoint');
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 0, 'nothing published yet');
  const finished = new Set(Object.keys(parked.checkpoint.previews.results));
  assert.ok(media() >= killAfter && finished.size < 8);

  fake.state.requests.length = 0;
  const done = await work(j.id);
  assert.equal(done.status, 'COMPLETED');
  const again = fake.state.requests.filter(r => r.query.alt === 'media').map(r => r.path.split('/').pop());
  assert.ok(again.every(id => !finished.has(id)), 'an image that was FINISHED before the kill is never downloaded again');
  assert.equal(again.length, 8 - finished.size, 'the second worker downloads exactly what is left (an image cut off mid-download is redone)');
  assert.equal((await pool.query("select count(*)::int n from models where status='PUBLISHED'")).rows[0].n, 8);
  assert.ok(first.id === j.id);
});

test('the plan is recomputed right before publishing: a model created by someone else while previews were downloading is not duplicated', { skip }, async () => {
  const d = folder('Desk', ROOT);
  const { arc } = await addPair(d.id, 'one');
  let injected = false;
  const handler = makeHandler({ createClient: () => {
    const c = createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 1 } });
    return { ...c, openMedia: async (...a) => {
      if (!injected) { // an admin tool adds the very same Drive file as a model while we are busy downloading
        injected = true;
        const cat = (await pool.query("insert into categories(name,slug,full_path) values('Desk','desk','Desk') returning id")).rows[0].id;
        const m = (await pool.query("insert into models(category_id,name,status,price_vnd) values($1,'one','DRAFT',1) returning id", [cat])).rows[0].id;
        await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type) values($1,$2,$3,'one.rar','rar')", [m, sourceId, arc.id]);
      }
      return c.openMedia(...a);
    } };
  } });
  const j = await work((await enqueue()).id, { handler });
  assert.equal(j.status, 'COMPLETED', JSON.stringify([j.error_code, j.error_message]));
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 1, 'no duplicate model');
  assert.equal((await pool.query('select count(*)::int n from model_previews')).rows[0].n, 2, 'the existing model got its previews');
});

test('an unexpected error (even one carrying a secret) ends the job FAILED with a generic code; its text is never stored', { skip }, async () => {
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'one');
  const handler = makeHandler({ createClient: () => { throw new Error('Bearer ya29.SUPER-SECRET-TOKEN leaked from the client'); } });
  const j = await work((await enqueue()).id, { handler });
  assert.deepEqual([j.status, j.error_code], ['FAILED', 'JOB_HANDLER_ERROR']);
  assert.ok(!JSON.stringify(j).includes('SUPER-SECRET'));
  assert.ok(!j.error_message.includes('Bearer'));
});

test('cancelling during the previews stops the job as CANCELLED and publishes nothing', { skip }, async () => {
  const d = folder('Desk', ROOT);
  for (let i = 0; i < 6; i++) await addPair(d.id, `m${i}`, i + 1);
  const j = await enqueue();
  let cancelled = false;
  const handler = makeHandler({ createClient: () => {
    const c = createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 1 } });
    return { ...c, openMedia: async (...a) => { if (media() >= 2 && !cancelled) { cancelled = true; await q.cancelJob(pool, j.id); await sleep(120); } else await sleep(20); return c.openMedia(...a); } };
  } });
  const done = await work(j.id, { handler });
  assert.equal(done.status, 'CANCELLED');
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 0);
  assert.equal((await state()).version, 0);
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
  assert.deepEqual((await pool.query('select access_mode, connection_id, root_folder_name, enabled from drive_sources')).rows, [{ access_mode: 'API_KEY', connection_id: null, root_folder_name: 'root', enabled: true }]);
  await pool.query('update drive_sources set enabled = false');
  await ensureApiKeySource({ pool, client, rootFolderId: ROOT });
  assert.equal((await pool.query('select enabled from drive_sources')).rows[0].enabled, true);
  const file = { id: nid(), name: 'x.jpg', mimeType: 'image/jpeg', parents: [ROOT] }; fake.state.files.push(file);
  await assert.rejects(ensureApiKeySource({ pool, client, rootFolderId: file.id }), e => e.code === 'DRIVE_NOT_A_FOLDER');
  await assert.rejects(ensureApiKeySource({ pool, client, rootFolderId: 'does-not-exist-123' }), e => e.code === 'DRIVE_NOT_FOUND');
  await assert.rejects(ensureApiKeySource({ pool, client, rootFolderId: "x' or '1'='1" }), e => e.code === 'INVALID_PARAMS');
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 1);
});

// ---- P3.7: gia mac dinh cua model MOI lay tu app_settings (D25); chua co cai dat thi dung gia cau hinh (bien moi truong) ----
const priceOf = async (name) => (await pool.query('select price_vnd from models where name = $1', [name])).rows[0]?.price_vnd;

test('P3.7: new models get the price saved on the admin page; with no saved settings the configured (env) price is used; models already priced keep their price', { skip }, async () => {
  await pool.query('delete from app_settings');
  const d = folder('Desk', ROOT);
  await addPair(d.id, 'first');
  await work((await enqueue()).id, { handler: makeHandler({ defaultPriceVnd: 12345 }) });
  assert.equal(await priceOf('first'), 12345, 'no saved settings: env price');

  await pool.query('insert into app_settings(id, default_model_price_vnd) values (1, 33000)');
  await addPair(d.id, 'second');
  await work((await enqueue()).id, { handler: makeHandler({ defaultPriceVnd: 12345 }) });
  assert.equal(await priceOf('second'), 33000, 'saved settings win over the env price');
  assert.equal(await priceOf('first'), 12345, 'an existing model keeps its price when the default changes');
  await pool.query('delete from app_settings');
});

test('P3.7: the saved price is read when publishing (not when the handler is built) and a price of 0 is honoured', { skip }, async () => {
  await pool.query('delete from app_settings');
  const handler = makeHandler({ defaultPriceVnd: 12345 }); // built BEFORE the admin saves anything
  await pool.query('insert into app_settings(id, default_model_price_vnd) values (1, 0)');
  await addPair(folder('Desk', ROOT).id, 'free');
  await work((await enqueue()).id, { handler });
  assert.equal(await priceOf('free'), 0, 'read at publish time; 0 is a valid saved price, not "unset"');
  await pool.query('delete from app_settings');
});

test('P3.7: a database where migration 017 is not applied yet still publishes (env price) instead of failing the whole job', { skip }, async () => {
  await pool.query('delete from app_settings');
  const down = (await import('node:fs')).readFileSync(new URL('../../migrations/rollback/017_app_settings.sql', import.meta.url), 'utf8');
  await pool.query(down);
  try {
    await addPair(folder('Desk', ROOT).id, 'legacy');
    const j = await work((await enqueue()).id, { handler: makeHandler({ defaultPriceVnd: 12345 }) });
    assert.equal(j.status, 'COMPLETED');
    assert.equal(await priceOf('legacy'), 12345);
  } finally { await (await import('../db.js')).migrate(); }
  assert.ok((await pool.query("select to_regclass('app_settings') t")).rows[0].t, 'migration re-applied for the other tests');
});

test('P3.7: any OTHER failure reading the saved price (e.g. the database dropping) fails the job; it must not silently publish at the wrong price', { skip }, async () => {
  await pool.query('delete from app_settings');
  await addPair(folder('Desk', ROOT).id, 'risky');
  const flaky = {
    query: (sql, ...rest) => (/app_settings/.test(String(sql)) ? Promise.reject(Object.assign(new Error('connection terminated'), { code: '57P03' })) : pool.query(sql, ...rest)),
    connect: () => pool.connect(),
  };
  const j = await work((await enqueue()).id, { handler: makeHandler({ pool: flaky, defaultPriceVnd: 12345 }) });
  assert.equal(j.status, 'FAILED');
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 0, 'nothing was published at a guessed price');
});
