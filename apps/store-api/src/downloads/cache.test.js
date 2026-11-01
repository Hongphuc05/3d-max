// P4.2 (D26): cache ban sao model tren dia VPS. Thu muc that (tmp), nguon tai gia lap bang stream; khong mang.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createModelCache } from './cache.js';

let dir;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'model-cache-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const md5 = (b) => createHash('md5').update(b).digest('hex');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const payload = (n = 1000, seed = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 1) % 251));
const fileOf = (data, over = {}) => ({ id: randomUUID(), driveFileId: 'DriveIdForTest12345', sizeBytes: data.length, md5: md5(data), sha256: null, ...over });
// Nguon gia lap: dem so lan mo, ghi nho luong de kiem tra da bi huy chua.
function source(data, { chunk = 100, failAfter, delayMs = 0 } = {}) {
  const state = { opened: 0, streams: [] };
  const open = async (_fileId, { signal } = {}) => {
    state.opened++;
    signal?.throwIfAborted();
    let sent = 0;
    const data$ = Readable.from((async function* () {
      while (sent < data.length) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (failAfter !== undefined && sent >= failAfter) throw Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { code: 'STORAGE_DOWNLOAD_FAILED', status: 502 });
        const part = data.subarray(sent, sent + chunk); sent += part.length; yield part;
      }
    })());
    state.streams.push(data$);
    signal?.addEventListener('abort', () => data$.destroy(signal.reason), { once: true });
    return { status: 200, headers: new Headers(), data: data$ };
  };
  return { open, state };
}
const make = (open, over = {}) => createModelCache({ dir, open, maxBytes: 10 ** 9, minFreeBytes: 0, freeDiskBytes: async () => 10 ** 12, ...over });
const finals = async () => (await readdir(dir)).filter((n) => n.endsWith('.bin'));
const parts = async () => existsSync(path.join(dir, 'tmp')) ? (await readdir(path.join(dir, 'tmp'))) : [];

test('miss: downloads, verifies size + md5, stores atomically under a name derived from the record id; no .part left', async () => {
  const data = payload(2500), f = fileOf(data), src = source(data);
  const cache = make(src.open); await cache.init();
  const verified = [];
  const h = await cache.acquire(f, { onVerified: async (v) => { verified.push(v); } });
  assert.deepEqual(await readFile(h.path), data);
  assert.equal(h.size, data.length); assert.equal(h.sha256, sha(data));
  assert.deepEqual(verified, [{ sha256: sha(data), md5: md5(data), size: data.length }]);
  assert.ok(h.path.startsWith(dir) && h.path.includes(f.id));
  assert.deepEqual(await parts(), []);
  assert.equal(src.state.opened, 1);
  h.release();
});

test('hit: no second download, even for a different caller; the file is touched for LRU', async () => {
  const data = payload(500), f = fileOf(data), src = source(data);
  const cache = make(src.open); await cache.init();
  const a = await cache.acquire(f); a.release();
  const old = new Date(Date.now() - 3600_000);
  await utimes(a.path, old, old);
  const b = await cache.acquire(f);
  assert.equal(src.state.opened, 1);
  assert.ok((await stat(b.path)).mtimeMs > old.getTime() + 1000, 'touched');
  assert.equal(b.sha256, sha(data), 'sha256 of a cached file is still reported');
  b.release();
});

test('a cached file whose size no longer matches the record is not trusted: it is downloaded again', async () => {
  const data = payload(500), f = fileOf(data), src = source(data);
  const cache = make(src.open); await cache.init();
  const a = await cache.acquire(f); a.release();
  await writeFile(a.path, Buffer.from('truncated'));
  const b = await cache.acquire(f);
  assert.deepEqual(await readFile(b.path), data); assert.equal(src.state.opened, 2);
  b.release();
});

test('single flight: concurrent callers for one model share one upstream download', async () => {
  const data = payload(3000), f = fileOf(data), src = source(data, { delayMs: 5 });
  const cache = make(src.open); await cache.init();
  const hs = await Promise.all([cache.acquire(f), cache.acquire(f), cache.acquire(f)]);
  assert.equal(src.state.opened, 1);
  assert.deepEqual(new Set(hs.map((h) => h.path)).size, 1);
  hs.forEach((h) => h.release());
});

test('a download that does not match the record is never kept and is retried next time: short, long, wrong md5, wrong sha256', async () => {
  const data = payload(1000);
  const cases = {
    short: [fileOf(data, { sizeBytes: 1200 }), 'DOWNLOAD_SIZE_MISMATCH'],
    long: [fileOf(data, { sizeBytes: 800 }), 'DOWNLOAD_SIZE_MISMATCH'],
    md5: [fileOf(data, { md5: md5(Buffer.from('other')) }), 'DOWNLOAD_CHECKSUM_MISMATCH'],
    sha256: [fileOf(data, { sha256: sha(Buffer.from('other')) }), 'DOWNLOAD_CHECKSUM_MISMATCH'],
  };
  for (const [name, [f, code]] of Object.entries(cases)) {
    const src = source(data), cache = make(src.open); await cache.init();
    await assert.rejects(cache.acquire(f), (e) => e.code === code && e.status === 502, name);
    assert.deepEqual(await finals(), [], name); assert.deepEqual(await parts(), [], name);
    await assert.rejects(cache.acquire(f), (e) => e.code === code, `${name}: retried, not cached as a failure`);
    assert.equal(src.state.opened, 2, name);
  }
});

test('a matching sha256 on record is enforced and accepted; unknown size and md5 are allowed but bounded by maxFileBytes', async () => {
  const data = payload(1000);
  const ok = make(source(data).open); await ok.init();
  (await ok.acquire(fileOf(data, { sha256: sha(data) }))).release();
  const unknown = make(source(data).open, { maxFileBytes: 5000 }); await unknown.init();
  (await unknown.acquire(fileOf(data, { sizeBytes: null, md5: null }))).release();
  const tight = make(source(data).open, { maxFileBytes: 600 }); await tight.init();
  await assert.rejects(tight.acquire(fileOf(data, { sizeBytes: null, md5: null })), (e) => e.code === 'DOWNLOAD_SIZE_MISMATCH');
  assert.deepEqual(await parts(), []);
});

test('an empty download is never kept', async () => {
  const cache = make(source(Buffer.alloc(0)).open); await cache.init();
  await assert.rejects(cache.acquire(fileOf(payload(1), { sizeBytes: null, md5: null })), (e) => e.code === 'DOWNLOAD_SIZE_MISMATCH');
  assert.deepEqual(await finals(), []);
});

test('two different downloads started together cannot both claim the last free space (reservation + serialised room check)', async () => {
  const dA = payload(1000, 3), dB = payload(1000, 5), A = fileOf(dA, { driveFileId: 'DriveIdAAAAAAAAAAAA' }), B = fileOf(dB, { driveFileId: 'DriveIdBBBBBBBBBBBB' });
  const open = (id, o) => source(id === A.driveFileId ? dA : dB, { delayMs: 3 }).open(id, o);
  const cache = make(open, { maxBytes: 1500 }); await cache.init();
  const results = await Promise.allSettled([cache.acquire(A), cache.acquire(B)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'DISK_SPACE_LOW');
  assert.equal((await finals()).length, 1);
});

test('the room check itself is serialised even when the disk probe is slow', async () => {
  const dA = payload(1000, 3), dB = payload(1000, 5), A = fileOf(dA, { driveFileId: 'DriveIdAAAAAAAAAAAA' }), B = fileOf(dB, { driveFileId: 'DriveIdBBBBBBBBBBBB' });
  const open = (id, o) => source(id === A.driveFileId ? dA : dB).open(id, o);
  const slowDisk = async () => { await new Promise((r) => setTimeout(r, 30)); return 10 ** 12; };
  const cache = make(open, { maxBytes: 1500, freeDiskBytes: slowDisk }); await cache.init();
  const results = await Promise.allSettled([cache.acquire(A), cache.acquire(B)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
});

test('a known size above maxFileBytes is refused before contacting upstream', async () => {
  const data = payload(1000), src = source(data), cache = make(src.open, { maxFileBytes: 500 }); await cache.init();
  await assert.rejects(cache.acquire(fileOf(data)), (e) => e.code === 'DOWNLOAD_SIZE_MISMATCH');
  assert.equal(src.state.opened, 0);
});

test('a failed attempt does not leave the file pinned forever (it can be evicted after a later success)', async () => {
  const dK = payload(1000, 3), dL = payload(1000, 5), K = fileOf(dK, { driveFileId: 'DriveIdKKKKKKKKKKKK' }), L = fileOf(dL, { driveFileId: 'DriveIdLLLLLLLLLLLL' });
  let first = true;
  const open = (id, o) => { if (id === K.driveFileId && first) { first = false; return source(dK, { failAfter: 100 }).open(id, o); } return source(id === K.driveFileId ? dK : dL).open(id, o); };
  const cache = make(open, { maxBytes: 1500 }); await cache.init();
  await assert.rejects(cache.acquire(K));
  (await cache.acquire(K)).release();
  (await cache.acquire(L)).release(); // needs K's room
  assert.equal((await finals()).length, 1);
});

test('upstream failure mid-stream keeps its classified code, leaves no .part, caches nothing', async () => {
  const data = payload(1000);
  const cache = make(source(data, { failAfter: 300 }).open); await cache.init();
  await assert.rejects(cache.acquire(fileOf(data)), (e) => e.code === 'STORAGE_DOWNLOAD_FAILED' && e.status === 502);
  assert.deepEqual(await finals(), []); assert.deepEqual(await parts(), []);
});

test('onVerified failing (database down) does not fail the download', async () => {
  const data = payload(300), cache = make(source(data).open); await cache.init();
  const h = await cache.acquire(fileOf(data), { onVerified: async () => { throw new Error('db down'); } });
  assert.equal(h.size, 300); h.release();
});

test('abort: the only waiter leaving cancels the upstream and removes the partial file', async () => {
  const data = payload(100_000), src = source(data, { delayMs: 2 }), cache = make(src.open); await cache.init();
  const c = new AbortController();
  const p = cache.acquire(fileOf(data), { signal: c.signal });
  await new Promise((r) => setTimeout(r, 30));
  c.abort();
  await assert.rejects(p);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(src.state.streams[0].destroyed, true, 'upstream destroyed');
  assert.deepEqual(await parts(), []); assert.deepEqual(await finals(), []);
  await assert.rejects(cache.acquire(fileOf(data), { signal: AbortSignal.abort() }));
});

test('abort: one of two waiters leaving does NOT cancel the shared download', async () => {
  const data = payload(20_000), src = source(data, { delayMs: 2 }), cache = make(src.open); await cache.init();
  const f = fileOf(data), c = new AbortController();
  const leaving = cache.acquire(f, { signal: c.signal });
  const staying = cache.acquire(f);
  await new Promise((r) => setTimeout(r, 20));
  c.abort();
  await assert.rejects(leaving);
  const h = await staying;
  assert.deepEqual(await readFile(h.path), data); assert.equal(src.state.opened, 1);
  h.release();
});

test('LRU eviction keeps the cache under maxBytes, never evicts a file in use, and refuses (DISK_SPACE_LOW) when nothing can go', async () => {
  const mk = (seed) => { const d = payload(1000, seed); return [d, fileOf(d)]; };
  const [dA, A] = mk(3), [dB, B] = mk(5), [dC, C] = mk(11);
  const byId = new Map([[A.id, dA], [B.id, dB], [C.id, dC]]);
  const opened = [];
  const open = async (_id, o) => { const f = [A, B, C].find((x) => x.driveFileId === _id); opened.push(f.id); return source(byId.get(f.id)).open(_id, o); };
  [A.driveFileId, B.driveFileId, C.driveFileId] = ['DriveIdAAAAAAAAAAAA', 'DriveIdBBBBBBBBBBBB', 'DriveIdCCCCCCCCCCCC'];
  const cache = make(open, { maxBytes: 2500 }); await cache.init();
  const a = await cache.acquire(A); a.release();
  await utimes(a.path, new Date(Date.now() - 20_000), new Date(Date.now() - 20_000));
  const b = await cache.acquire(B); // B stays in use
  await utimes(b.path, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
  const c = await cache.acquire(C); // needs room: A (oldest, unused) goes
  assert.equal(existsSync(a.path), false, 'LRU unused file evicted');
  assert.equal(existsSync(b.path), true, 'in-use file kept');
  assert.equal(existsSync(c.path), true);
  await assert.rejects(cache.acquire(A), (e) => e.code === 'DISK_SPACE_LOW', 'B and C in use, no room for A');
  assert.equal(existsSync(b.path) && existsSync(c.path), true, 'a refused request destroys nothing');
  b.release(); c.release(); b.release(); // release is idempotent
  const a2 = await cache.acquire(A);
  assert.equal(existsSync(b.path), false, 'now B (older) can go'); assert.equal(existsSync(c.path), true);
  a2.release();
});

test('low free disk: refused before contacting upstream; reserve counts the file size; unknown size is re-checked while streaming', async () => {
  const data = payload(1000), f = fileOf(data);
  const src = source(data), cache = make(src.open, { freeDiskBytes: async () => 1500, minFreeBytes: 600 }); await cache.init();
  await assert.rejects(cache.acquire(f), (e) => e.code === 'DISK_SPACE_LOW');
  assert.equal(src.state.opened, 0);
  let calls = 0;
  const src2 = source(data, { chunk: 50 }), c2 = make(src2.open, { freeDiskBytes: async () => (++calls <= 1 ? 10 ** 9 : 10), minFreeBytes: 1000, diskCheckEveryBytes: 100 }); await c2.init();
  await assert.rejects(c2.acquire(fileOf(data, { sizeBytes: null, md5: null })), (e) => e.code === 'DISK_SPACE_LOW');
  assert.deepEqual(await parts(), []);
});

test('init(): creates the folders, removes stale .part files, keeps finished files', async () => {
  const cache = make(source(payload(10)).open);
  await mkdir(path.join(dir, 'tmp'), { recursive: true });
  await writeFile(path.join(dir, 'tmp', 'old.part'), 'x'); await writeFile(path.join(dir, `${randomUUID()}-abc.bin`), 'keep');
  await cache.init();
  assert.deepEqual(await parts(), []); assert.equal((await finals()).length, 1);
});

test('record ids that could escape the folder are refused before any I/O', async () => {
  const src = source(payload(10)), cache = make(src.open); await cache.init();
  for (const id of ['../x', 'a/b', '', 'x'.repeat(100), undefined, null, 5]) {
    await assert.rejects(cache.acquire({ ...fileOf(payload(10)), id }), (e) => e.code === 'STORAGE_DOWNLOAD_FAILED', String(id));
  }
  await assert.rejects(cache.acquire({ ...fileOf(payload(10)), md5: '../../etc/passwd' }), (e) => e.code === 'STORAGE_DOWNLOAD_FAILED');
  assert.equal(src.state.opened, 0);
});

test('memory stays flat while a 192 MB file streams through (no buffering of the whole file)', async () => {
  const chunk = Buffer.alloc(1 << 20, 7), total = 192, size = total * chunk.length;
  const open = async () => ({ status: 200, headers: new Headers(), data: Readable.from((async function* () { for (let i = 0; i < total; i++) yield chunk; })()) });
  const cache = make(open, { maxFileBytes: size * 2 }); await cache.init();
  global.gc?.();
  const before = process.memoryUsage().rss;
  const h = await cache.acquire({ id: randomUUID(), driveFileId: 'DriveIdForTest12345', sizeBytes: size, md5: null, sha256: null });
  const growth = process.memoryUsage().rss - before;
  assert.equal(h.size, size);
  assert.ok(growth < 96 * 1024 * 1024, `RSS grew ${(growth / 1048576).toFixed(0)} MB for a ${total} MB file`);
  h.release();
});
