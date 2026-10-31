import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { isolatedTestDatabase } from '../test-database.js';
import { createDriveClient } from '../drive/client.js';
import { startFakeDrive } from '../drive/testing/fake-drive.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const KEY = 'AIzaSyPreviewKey_0123456789-abcdefghij';
let dispose, pool, q, mod, fake, sourceId, dir;
let n = 0;
const nid = () => `P${String(++n).padStart(11, '0')}`;
const md5 = b => createHash('md5').update(b).digest('hex');
const sha = b => createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_previews');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
  mod = await import('./previews.js');
  fake = await startFakeDrive({ pageSize: 50, apiKeys: [KEY] });
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','prevRootFolder01','root','MY_DRIVE') returning id")).rows[0].id;
});
after(async () => { if (fake) await fake.close(); if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  fake.state.files.length = 0; fake.state.failures.length = 0; fake.state.requests.length = 0;
  await pool.query('delete from drive_sync_job_items'); await pool.query('delete from drive_sync_jobs');
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = await mkdtemp(path.join(os.tmpdir(), 'previews-'));
});

const jpeg = (w, h, extra = {}) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg(extra).toBuffer();
const addImage = (content, extra = {}) => { const f = { id: nid(), name: 'x.jpg', mimeType: 'image/jpeg', parents: ['whatever'], content, size: content.length, md5Checksum: md5(content), ...extra }; fake.state.files.push(f); return f; };
const want = (f, primary = true) => ({ fileId: nid(), imageId: f.id, md5: f.md5Checksum, primary });
const client = (wrap = c => c) => wrap(createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 1 } }));

async function newJob() { await q.enqueueJob(pool, { sourceId, mode: 'FULL' }); return q.claimJob(pool, 'prev-worker'); }
const ctxFor = (job, over = {}) => ({ signal: new AbortController().signal, cancelled: false, shuttingDown: false, saveProgress: p => q.saveProgress(pool, job.id, 'prev-worker', p), ...over });
async function run(images, { job, cl = client(), ctx, checkpoint = {}, ...opts } = {}) {
  job ??= await newJob();
  return mod.runPreviewStage({ pool, client: cl, job, images, checkpoint, ctx: ctx ?? ctxFor(job), previewDir: dir, minFreeDiskBytes: 1, freeDiskBytes: async () => 10 ** 12, ...opts });
}
const files = async () => (await readdir(dir)).filter(x => x !== 'tmp').sort();
const tmpLeft = async () => readdir(path.join(dir, 'tmp')).catch(() => []);
const items = job => pool.query('select drive_file_id, action, status, error_code from drive_sync_job_items where job_id=$1 order by drive_file_id', [job.id]).then(r => r.rows);

test('makes content-addressed WebP variants: sm 480 / lg 1400 wide, file name = sha256 of the file, metadata matches the file', { skip }, async () => {
  const src = addImage(await jpeg(2000, 1000));
  const r = await run([want(src)]);
  assert.equal(r.done, true);
  const res = r.results[want(src).imageId];
  assert.equal(res.sourceMd5, src.md5Checksum);
  for (const [variant, width] of [['sm', 480], ['lg', 1400]]) {
    const v = res[variant];
    const bytes = await readFile(path.join(dir, v.path));
    assert.equal(v.path, `${sha(bytes)}.webp`);
    assert.equal(v.sha256, sha(bytes));
    assert.deepEqual([v.fileSize, v.width, v.height], [bytes.length, width, width / 2]);
    assert.equal((await sharp(bytes).metadata()).format, 'webp');
  }
  assert.equal((await files()).length, 2);
  assert.deepEqual(await tmpLeft(), [], 'no .part left behind');
});

test('a small source is never enlarged; identical sm/lg bytes share ONE file', { skip }, async () => {
  const src = addImage(await jpeg(300, 200));
  const r = await run([want(src)]);
  const { sm, lg } = r.results[want(src).imageId];
  assert.deepEqual([sm.width, lg.width, sm.height], [300, 300, 200]);
  assert.equal(sm.path, lg.path);
  assert.equal((await files()).length, 1);
});

test('EXIF orientation is applied and metadata (GPS etc.) is not copied into the preview', { skip }, async () => {
  const withExif = await sharp(await jpeg(800, 400)).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-owner' } } }).jpeg().toBuffer();
  const src = addImage(withExif);
  const r = await run([want(src)]);
  const out = await readFile(path.join(dir, r.results[want(src).imageId].sm.path));
  const meta = await sharp(out).metadata();
  assert.ok(meta.height > meta.width, `rotated to portrait (${meta.width}x${meta.height})`);
  assert.equal(meta.exif, undefined);
  assert.ok(!out.includes(Buffer.from('secret-owner')));
});

test('idempotent: a second run (empty checkpoint) rewrites nothing; a run with the saved checkpoint downloads nothing at all', { skip }, async () => {
  const src = addImage(await jpeg(1600, 900));
  const job = await newJob();
  const first = await run([want(src)], { job });
  const names = await files();
  const mtimes = await Promise.all(names.map(async x => (await stat(path.join(dir, x))).mtimeMs));
  const second = await run([want(src)], { job });
  assert.deepEqual(second.results[src.id], first.results[src.id]);
  assert.deepEqual(await files(), names);
  assert.deepEqual(await Promise.all(names.map(async x => (await stat(path.join(dir, x))).mtimeMs)), mtimes, 'existing files are not rewritten');

  fake.state.requests.length = 0;
  await run([want(src)], { job, checkpoint: { previews: { results: first.results, failed: {}, bytes: 0, baseErrors: 0, baseBytes: 0 } } });
  assert.equal(fake.state.requests.filter(x => x.query.alt === 'media').length, 0, 'resume must not download an image already done');
});

test('resume re-makes an image whose file vanished from disk instead of trusting the checkpoint', { skip }, async () => {
  const src = addImage(await jpeg(1600, 900));
  const job = await newJob();
  const first = await run([want(src)], { job });
  await rm(path.join(dir, first.results[src.id].sm.path));
  fake.state.requests.length = 0;
  const again = await run([want(src)], { job, checkpoint: { previews: { results: first.results, failed: {}, bytes: 0, baseErrors: 0, baseBytes: 0 } } });
  assert.equal(fake.state.requests.filter(x => x.query.alt === 'media').length, 1);
  assert.ok((await files()).includes(again.results[src.id].sm.path));
});

test('bad images fail ONE item, not the stage: text with a .jpg name, GIF, TIFF, SVG (Sharp would decode these), a pixel bomb, a missing file', { skip }, async () => {
  const good = addImage(await jpeg(800, 600));
  const text = addImage(Buffer.from('this is not an image at all, just text'.repeat(5)));
  const gif = addImage(Buffer.concat([Buffer.from('GIF89a'), randomBytes(200)]));
  // 48 megapixels of one colour compresses to a small PNG but would need ~144 MB to decode
  // Sharp can decode TIFF and SVG, so only the magic-byte allowlist (JPEG/PNG/WebP) keeps them out
  const tiff = addImage(await sharp({ create: { width: 50, height: 50, channels: 3, background: '#0f0' } }).tiff().toBuffer());
  const svg = addImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>'));
  const bomb = addImage(await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer());
  const gone = want({ id: nid(), md5Checksum: null });
  const job = await newJob();
  const r = await run([want(good), want(text), want(gif), want(tiff), want(svg), want(bomb), gone], { job, maxPixels: 40_000_000 });
  assert.equal(r.done, true);
  assert.deepEqual(Object.keys(r.results), [good.id]);
  const byImage = Object.fromEntries(r.errors.map(e => [e.imageId, e.code]));
  assert.deepEqual(byImage, { [text.id]: 'PREVIEW_INVALID', [gif.id]: 'PREVIEW_INVALID', [tiff.id]: 'PREVIEW_INVALID', [svg.id]: 'PREVIEW_INVALID', [bomb.id]: 'PREVIEW_TOO_LARGE', [gone.imageId]: 'DRIVE_NOT_FOUND' });
  const rows = await items(job);
  assert.equal(rows.length, 6);
  assert.ok(rows.every(x => x.action === 'PREVIEW' && x.status === 'FAILED'));
  assert.deepEqual(await tmpLeft(), [], 'failed downloads leave no .part');
  assert.equal((await files()).length, 2, 'only the good image produced files');
  assert.equal((await pool.query('select error_count from drive_sync_jobs where id=$1', [job.id])).rows[0].error_count, 6);
});

test('a body that outgrows maxBytes mid-stream (no honest Content-Length) is cut off and counted as too large', { skip }, async () => {
  const big = addImage(Buffer.concat([await jpeg(100, 100), randomBytes(30_000)]));
  // pretend the server sent no Content-Length: the size can only be enforced while streaming
  const cl = client(c => ({ ...c, openMedia: async (...a) => { const r = await c.openMedia(...a); return { ...r, headers: new Headers() }; } }));
  const r = await run([want(big)], { cl, maxBytes: 4000 });
  assert.equal(r.errors[0].code, 'PREVIEW_TOO_LARGE');
  assert.deepEqual(await tmpLeft(), []);
});

test('an over-size file is refused from Content-Length before its body is read', { skip }, async () => {
  const big = addImage(Buffer.concat([await jpeg(100, 100), randomBytes(60_000)]));
  let bodyReads = 0;
  const cl = client(c => ({ ...c, openMedia: async (...a) => { const r = await c.openMedia(...a); r.data.on('data', () => { bodyReads++; }); return r; } }));
  const r = await run([want(big)], { cl, maxBytes: 4000 });
  assert.equal(r.errors[0].code, 'PREVIEW_TOO_LARGE');
  assert.ok(bodyReads <= 1, `body should not be consumed (reads: ${bodyReads})`);
});

test('at most 2 images are downloaded at once, and all of them are processed', { skip }, async () => {
  const srcs = []; for (let i = 0; i < 7; i++) srcs.push(addImage(await jpeg(500 + i, 300)));
  let live = 0, peak = 0;
  const cl = client(c => ({ ...c, openMedia: async (...a) => { live++; peak = Math.max(peak, live); try { await sleep(40); return await c.openMedia(...a); } finally { live--; } } }));
  const r = await run(srcs.map(s => want(s)), { cl });
  assert.equal(Object.keys(r.results).length, 7);
  assert.equal(peak, 2);
});

test('disk guard: too little free space fails the stage BEFORE any download; the check repeats every N images', { skip }, async () => {
  const srcs = []; for (let i = 0; i < 6; i++) srcs.push(addImage(await jpeg(600 + i, 300)));
  const job = await newJob();
  await assert.rejects(run(srcs.map(s => want(s)), { job, freeDiskBytes: async () => 100, minFreeDiskBytes: 1000 }), e => e.code === 'DISK_SPACE_LOW');
  assert.equal(fake.state.requests.filter(x => x.query.alt === 'media').length, 0);

  let calls = 0;
  await assert.rejects(run(srcs.map(s => want(s)), { job, diskCheckEvery: 2, minFreeDiskBytes: 1000, freeDiskBytes: async () => (++calls <= 2 ? 10 ** 9 : 10) }), e => e.code === 'DISK_SPACE_LOW');
  const saved = (await pool.query('select checkpoint from drive_sync_jobs where id=$1', [job.id])).rows[0].checkpoint;
  assert.ok(Object.keys(saved.previews?.results ?? {}).length >= 1, 'images finished before the failure stay in the checkpoint');
  assert.deepEqual(await tmpLeft(), []);
});

test('cancel and shutdown stop between images with the finished ones saved; a lost lease reports it', { skip }, async () => {
  const srcs = []; for (let i = 0; i < 6; i++) srcs.push(addImage(await jpeg(700 + i, 300)));
  let job = await newJob();
  let started = 0;
  const ctx = ctxFor(job); Object.defineProperty(ctx, 'shuttingDown', { get: () => started >= 2 });
  const cl = client(c => ({ ...c, openMedia: async (...a) => { started++; return c.openMedia(...a); } }));
  const r = await run(srcs.map(s => want(s)), { job, ctx, cl, concurrency: 1 });
  assert.equal(r.interrupted, true);
  const saved = (await pool.query('select checkpoint, bytes_downloaded from drive_sync_jobs where id=$1', [job.id])).rows[0];
  const doneCount = Object.keys(saved.checkpoint.previews.results).length;
  assert.ok(doneCount >= 1 && doneCount < 6, `partial progress saved (${doneCount})`);
  assert.ok(Number(saved.bytes_downloaded) > 0, 'bytesDownloaded is recorded');
  assert.deepEqual(await tmpLeft(), []);

  await q.finishJob(pool, job.id, 'prev-worker', { status: 'CANCELLED' });
  job = await newJob();
  const c2 = await run(srcs.map(s => want(s)), { job, ctx: ctxFor(job, { cancelled: true }) });
  assert.equal(c2.status, 'CANCELLED');
  await q.finishJob(pool, job.id, 'prev-worker', { status: 'CANCELLED' });
  job = await newJob();
  const lost = await run(srcs.map(s => want(s)), { job, ctx: ctxFor(job, { saveProgress: async () => false }) });
  assert.equal(lost.leaseLost, true);
});

test('an abort in the MIDDLE of a download (shutdown) is not recorded as an image failure; the image is simply redone next run', { skip }, async () => {
  const src = addImage(await jpeg(1200, 800));
  const job = await newJob();
  const ac = new AbortController();
  const ctx = ctxFor(job, { signal: ac.signal });
  Object.defineProperty(ctx, 'shuttingDown', { get: () => ac.signal.aborted });
  const cl = client(c => ({ ...c, openMedia: async (id, o) => { setTimeout(() => ac.abort(), 20); await sleep(60); return c.openMedia(id, o); } }));
  const r = await run([want(src)], { job, ctx, cl });
  assert.equal(r.interrupted, true);
  assert.deepEqual(await items(job), [], 'no FAILED item for an interrupted image');
  const saved = (await pool.query('select checkpoint, error_count from drive_sync_jobs where id=$1', [job.id])).rows[0];
  assert.deepEqual([saved.checkpoint.previews?.failed ?? {}, saved.error_count], [{}, 0]);
  assert.deepEqual(await tmpLeft(), []);
});

test('the same image listed twice is downloaded once', { skip }, async () => {
  const src = addImage(await jpeg(900, 600));
  fake.state.requests.length = 0;
  const r = await run([want(src), { ...want(src), fileId: nid() }]);
  assert.equal(Object.keys(r.results).length, 1);
  assert.equal(fake.state.requests.filter(x => x.query.alt === 'media').length, 1);
});

test('bytes downloaded add up exactly when two downloads overlap (no lost update)', { skip }, async () => {
  const a = addImage(await jpeg(700, 500)), b = addImage(Buffer.concat([await jpeg(900, 600), Buffer.alloc(3000, 7)]));
  const job = await newJob();
  // the SMALLER file finishes LAST, so the larger one's update is the one that would be overwritten
  const cl = client(c => ({ ...c, openMedia: async (id, o) => { const r = await c.openMedia(id, o); await sleep(id === a.id ? 80 : 10); return r; } }));
  await run([want(a), want(b)], { job, cl });
  const saved = (await pool.query('select bytes_downloaded from drive_sync_jobs where id=$1', [job.id])).rows[0].bytes_downloaded;
  assert.equal(Number(saved), a.content.length + b.content.length);
});

test('cleanStaleParts removes only old .part files; recent ones and finished .webp files stay', { skip }, async () => {
  await mkdir(path.join(dir, 'tmp'), { recursive: true });
  const old = path.join(dir, 'tmp', 'old.part'), fresh = path.join(dir, 'tmp', 'fresh.part'), keep = path.join(dir, `${'a'.repeat(64)}.webp`);
  await Promise.all([writeFile(old, 'x'), writeFile(fresh, 'x'), writeFile(keep, 'x')]);
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  await utimes(old, twoHoursAgo, twoHoursAgo);
  assert.equal(await mod.cleanStaleParts(dir), 1);
  assert.deepEqual((await readdir(path.join(dir, 'tmp'))).sort(), ['fresh.part']);
  assert.deepEqual(await files(), [`${'a'.repeat(64)}.webp`]);
  assert.equal(await mod.cleanStaleParts(path.join(dir, 'does-not-exist')), 0);
});

test('nothing derived from Drive input ever becomes a path: output names are hashes, and the API key is not stored anywhere', { skip }, async () => {
  const src = addImage(await jpeg(900, 500), { name: '../../etc/passwd.jpg' });
  const job = await newJob();
  const r = await run([want(src)], { job });
  assert.ok((await files()).every(x => /^[0-9a-f]{64}\.webp$/.test(x)));
  const saved = JSON.stringify((await pool.query('select * from drive_sync_jobs where id=$1', [job.id])).rows);
  assert.ok(!saved.includes(KEY));
  assert.ok(r.done);
});

test('delayMs spaces downloads apart and stops waiting at once on shutdown', { skip }, async () => {
  const srcs = []; for (let i = 0; i < 3; i++) srcs.push(addImage(await jpeg(900 + i, 300)));
  let job = await newJob();
  const t0 = Date.now();
  const r = await run(srcs.map(s => want(s)), { job, concurrency: 1, delayMs: 300 });
  assert.equal(r.done, true);
  assert.ok(Date.now() - t0 >= 600, 'two gaps of 300 ms between three images');

  await q.finishJob(pool, job.id, 'prev-worker', { status: 'CANCELLED' });
  const ac = new AbortController();
  job = await newJob();
  const ctx = ctxFor(job); Object.defineProperty(ctx, 'signal', { value: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const t1 = Date.now();
  await run(srcs.map(s => want(s)), { job, ctx, concurrency: 1, delayMs: 60_000 }).catch(() => {});
  assert.ok(Date.now() - t1 < 5000, 'abort cuts the pause short');
});

test('a Google block page pauses and retries the same image: no failure recorded, progress continues', { skip }, async () => {
  const src = addImage(await jpeg(950, 300));
  const job = await newJob();
  fake.state.failures.push({ status: 403, html: true, media: true }, { status: 403, html: true, media: true });
  const r = await run([want(src)], { job, concurrency: 1, cooldownMs: 50 });
  assert.equal(r.done, true);
  assert.deepEqual(r.errors, []);
  assert.ok(r.results[want(src).imageId], 'image ends up done after the block lifts');
});
