// P4.2: phien tai model (import-session + model-downloads). PostgreSQL that, cache that tren thu muc tam, nguon Google gia lap.
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const MACHINE = `MAX-${'C3'.repeat(32)}`;
let dispose, pool, catId, sourceId, mod, cacheMod, errorsMod;
let cacheDir, servers = [];
let upstream;  // driveFileId -> { data, chunk, delayMs, failAfter, error }
let opens;     // driveFileId de moi lan mo nguon
let seq = 0;

const sha = (b) => createHash('sha256').update(b).digest();
const hex = (algo, b) => createHash(algo).update(b).digest('hex');
const payload = (n, seed = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 1) % 251));

async function mkDevice(status = 'ACTIVE') {
  const id = (await pool.query(
    "insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name,status) values ($1,'{}',$2,'SOFTWARE',$3,'PC',$4) returning id",
    [randomUUID(), sha(randomUUID()), MACHINE, status])).rows[0].id;
  const token = randomBytes(32).toString('base64url');
  await pool.query("insert into device_tokens(id,device_id,expires_at) values ($1,$2, now() + interval '10 minutes')", [sha(token), id]);
  return { id, token };
}
async function mkModel({ data = payload(3000), status = 'PUBLISHED', file = {}, behaviour = {}, noPrimary = false } = {}) {
  const driveFileId = `DriveFile${String(++seq).padStart(8, '0')}`;
  const id = (await pool.query("insert into models(category_id,name,status,published_at) values ($1,$2,$3,now()) returning id", [catId, `m-${seq}`, status])).rows[0].id;
  const fid = (await pool.query(
    `insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes,md5_checksum,sha256,entry_file,can_download,download_status)
     values ($1,$2,$3,'m.rar','rar',$4,$5,$6,$7,$8,$9) returning id`,
    [id, sourceId, driveFileId, file.size === undefined ? data.length : file.size, file.md5 === undefined ? hex('md5', data) : file.md5, file.sha256 ?? null,
      file.entry ?? null, file.canDownload ?? true, file.status ?? 'OK'])).rows[0].id;
  if (!noPrimary) await pool.query('update models set primary_file_id=$1 where id=$2', [fid, id]);
  upstream.set(driveFileId, { data, chunk: 500, ...behaviour });
  return { id, fid, driveFileId, data };
}
const grant = async (deviceId) => {  // D28.1: quyen = ca thu vien; cap lai khi da co thi tra quyen hien tai
  await pool.query("insert into entitlements(device_id,source) values ($1,'ADMIN') on conflict do nothing", [deviceId]);
  return (await pool.query('select id from entitlements where device_id=$1 and revoked_at is null', [deviceId])).rows[0].id;
};
const grantAll = grant;

// Nguon gia lap: cung hinh dang voi public-link open().
async function fakeOpen(fileId, { signal } = {}) {
  opens.push(fileId);
  signal?.throwIfAborted();
  const spec = upstream.get(fileId);
  if (!spec) throw Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { code: 'STORAGE_DOWNLOAD_FAILED', status: 502 });
  if (spec.failFirstOpens > 0) { spec.failFirstOpens--; throw Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { code: 'STORAGE_DOWNLOAD_FAILED', status: 502 }); }
  if (spec.openError) throw Object.assign(new Error(spec.openError), { code: spec.openError, status: 502 });
  let sent = 0;
  const stream = Readable.from((async function* () {
    while (sent < spec.data.length) {
      if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
      if (spec.failAfter !== undefined && sent >= spec.failAfter) throw Object.assign(new Error('STORAGE_DOWNLOAD_FAILED'), { code: 'STORAGE_DOWNLOAD_FAILED', status: 502 });
      const part = spec.data.subarray(sent, sent + spec.chunk); sent += part.length; yield part;
    }
  })());
  signal?.addEventListener('abort', () => stream.destroy(signal.reason), { once: true });
  return { status: 200, headers: new Headers(), data: stream };
}

async function start(opts = {}) {
  const cache = cacheMod.createModelCache({ dir: cacheDir, open: fakeOpen, maxBytes: 10 ** 10, minFreeBytes: 0, freeDiskBytes: async () => 10 ** 12, ...(opts.cache ?? {}) });
  await cache.init();
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/v1', mod.createDownloadRouter({ pool, cache, sessionsPerHour: 10, maxConcurrent: 3, ...(opts.router ?? {}) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
let base;
const hdr = (token) => (token ? { authorization: `Device ${token}` } : {});
const createSession = (modelId, token) => fetch(`${base}/api/v1/models/${modelId}/import-session`, { method: 'POST', headers: hdr(token) });
const openStream = (sessionId, token, init = {}) => fetch(`${base}/api/v1/model-downloads/${sessionId}`, { headers: hdr(token), ...init });
const code = async (r) => (await r.json()).error?.code;
const sessions = async () => (await pool.query('select * from model_download_sessions order by created_at')).rows;
const logs = async () => (await pool.query('select * from model_download_logs order by created_at')).rows;
async function until(fn, ms = 4000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)); } }
// Phien hop le san sang tai.
async function ready(over = {}) {
  const dev = over.dev ?? await mkDevice(), m = over.model ?? await mkModel(over.modelOpts);
  if (!over.noGrant) await grant(dev.id, m.id);
  const r = await createSession(m.id, dev.token);
  return { dev, m, r, j: r.status === 201 ? await r.json() : null };
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('download_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Living','living','Living') returning id")).rows[0].id;
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','dlRootFolder000001','root','MY_DRIVE') returning id")).rows[0].id;
  mod = await import('./routes.js'); cacheMod = await import('./cache.js'); errorsMod = await import('../drive/errors.js');
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  upstream = new Map(); opens = [];
  cacheDir = await mkdtemp(path.join(tmpdir(), 'dl-routes-'));
  for (const t of ['model_download_logs', 'model_download_sessions', 'entitlements', 'device_tokens', 'devices', 'model_files', 'models']) {
    if (t === 'model_files') await pool.query('update models set primary_file_id = null');
    await pool.query(`delete from ${t}`);
  }
  base = await start();
});
afterEach(async () => {
  for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  await rm(cacheDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); // tai nen tu phien vua tao co the con dang ghi
});

test('happy path: entitled device gets a session, then the exact bytes from our copy; session COMPLETED, log written, sha256 learned', { skip }, async () => {
  const { dev, m, r, j } = await ready({ modelOpts: { file: { entry: 'scene/main.max' } } });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(j).sort(), ['entryFile', 'expiresAt', 'fileType', 'md5', 'sessionId', 'sha256', 'sizeBytes']);
  assert.match(j.sessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([j.sizeBytes, j.md5, j.sha256, j.fileType, j.entryFile], [m.data.length, hex('md5', m.data), null, 'rar', 'scene/main.max']);
  const ms = new Date(j.expiresAt) - Date.now();
  assert.ok(ms > 4 * 60_000 && ms <= 5 * 60_000, `ttl ${ms}`);
  assert.equal(JSON.stringify(j).includes(m.driveFileId), false, 'no Drive id reaches the plugin');
  const [row] = await sessions();
  assert.equal(row.status, 'CREATED'); assert.equal(row.device_id, dev.id); assert.equal(row.model_id, m.id);
  assert.deepEqual(row.token_hash, sha(j.sessionId), 'only the hash is stored'); assert.notEqual(row.entitlement_id, null);

  const res = await openStream(j.sessionId, dev.token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('content-length'), String(m.data.length));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(JSON.stringify([...res.headers]).includes(m.driveFileId), false);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), m.data);

  const [done] = await until(async () => { const s = await sessions(); return s[0].status === 'COMPLETED' ? s : null; });
  assert.ok(done.started_at && done.finished_at);
  const [log] = await logs();
  assert.deepEqual([log.status, log.bytes_sent, log.error_code, log.device_id, log.model_id, log.session_id], ['COMPLETED', String(m.data.length), null, dev.id, m.id, row.id]);
  assert.equal((await pool.query('select sha256 from model_files where id=$1', [m.fid])).rows[0].sha256, hex('sha256', m.data), 'sha256 recorded after the first download');
  const j2 = await (await createSession(m.id, dev.token)).json();
  assert.equal(j2.sha256, hex('sha256', m.data), 'later sessions announce the sha256');
  assert.equal(opens.length, 1, 'second session served from the cache');
});

test('an ALL_MODELS entitlement (migrated MXL1) is enough', { skip }, async () => {
  const dev = await mkDevice(), m = await mkModel();
  await grantAll(dev.id);
  const r = await createSession(m.id, dev.token);
  assert.equal(r.status, 201);
});

test('no entitlement, revoked entitlement, or another device\'s entitlement: NOT_ENTITLED 403 and no session row', { skip }, async () => {
  const dev = await mkDevice(), other = await mkDevice(), m = await mkModel();
  let r = await createSession(m.id, dev.token);
  assert.equal(r.status, 403); const e = (await r.json()).error;
  assert.equal(e.code, 'NOT_ENTITLED'); assert.ok(e.requestId); assert.match(e.message, /[À-ỹ]/);
  await grant(other.id, m.id);
  assert.equal(await code(await createSession(m.id, dev.token)), 'NOT_ENTITLED');
  const mine = await grant(dev.id, m.id);
  await pool.query('update entitlements set revoked_at = now() where id=$1', [mine]);
  assert.equal(await code(await createSession(m.id, dev.token)), 'NOT_ENTITLED');
  assert.equal((await sessions()).length, 0);
});

test('model not offerable: unpublished/hidden, no main file, missing/errored file, nonexistent -> MODEL_NOT_AVAILABLE 409; restricted -> MODEL_DOWNLOAD_RESTRICTED 409', { skip }, async () => {
  const dev = await mkDevice(); await grantAll(dev.id);
  const cases = {
    draft: [await mkModel({ status: 'DRAFT' }), 'MODEL_NOT_AVAILABLE'], hidden: [await mkModel({ status: 'HIDDEN' }), 'MODEL_NOT_AVAILABLE'],
    review: [await mkModel({ status: 'NEEDS_REVIEW' }), 'MODEL_NOT_AVAILABLE'], noPrimary: [await mkModel({ noPrimary: true }), 'MODEL_NOT_AVAILABLE'],
    missing: [await mkModel({ file: { status: 'MISSING' } }), 'MODEL_NOT_AVAILABLE'], errored: [await mkModel({ file: { status: 'ERROR' } }), 'MODEL_NOT_AVAILABLE'],
    restricted: [await mkModel({ file: { status: 'RESTRICTED' } }), 'MODEL_DOWNLOAD_RESTRICTED'], noDownload: [await mkModel({ file: { canDownload: false } }), 'MODEL_DOWNLOAD_RESTRICTED'],
  };
  for (const [name, [m, expected]] of Object.entries(cases)) {
    const r = await createSession(m.id, dev.token);
    assert.equal(r.status, 409, name); assert.equal(await code(r), expected, name);
  }
  assert.equal(await code(await createSession(randomUUID(), dev.token)), 'MODEL_NOT_AVAILABLE');
  assert.equal((await createSession('not-a-uuid', dev.token)).status, 400);
  assert.equal((await sessions()).length, 0);
  assert.equal(opens.length, 0, 'nothing is fetched for a refused request');
});

test('without a valid device token both endpoints answer a v3 401, even for a blocked device', { skip }, async () => {
  const dev = await mkDevice(), blocked = await mkDevice('BLOCKED'), m = await mkModel();
  await grant(dev.id, m.id); await grant(blocked.id, m.id);
  const { j } = await ready({ dev, model: m, noGrant: true });
  for (const token of [undefined, 'A'.repeat(43), blocked.token]) {
    for (const r of [await createSession(m.id, token), await openStream(j.sessionId, token)]) {
      assert.equal(r.status, 401); assert.equal(await code(r), 'UNAUTHENTICATED');
    }
  }
});

test('a session is single use, bound to its device, and expires: each of these is the same 404 SESSION_INVALID without consuming a valid session', { skip }, async () => {
  const { dev, m, j } = await ready();
  const intruder = await mkDevice(); await grant(intruder.id, m.id);
  let r = await openStream(j.sessionId, intruder.token);
  assert.equal(r.status, 404); assert.equal(await code(r), 'SESSION_INVALID');
  assert.equal((await sessions())[0].status, 'CREATED', 'a foreign attempt does not burn the owner\'s session');
  for (const bad of ['short', 'A'.repeat(43), 'x'.repeat(44), encodeURIComponent('../etc/passwd'), 'a b']) {
    assert.equal(await code(await openStream(bad, dev.token)), 'SESSION_INVALID', bad);
  }
  assert.equal((await openStream(j.sessionId, dev.token)).status, 200);
  r = await openStream(j.sessionId, dev.token);
  assert.equal(r.status, 404); assert.equal(await code(r), 'SESSION_INVALID');

  const second = await (await createSession(m.id, dev.token)).json();
  await pool.query("update model_download_sessions set expires_at = now() - interval '1 second', created_at = now() - interval '1 minute' where token_hash = $1", [sha(second.sessionId)]);
  assert.equal(await code(await openStream(second.sessionId, dev.token)), 'SESSION_INVALID', 'expired');
});

test('entitlement revoked between session and stream: refused (NOT_ENTITLED 403), session FAILED, logged, no bytes', { skip }, async () => {
  const { dev, m, j } = await ready();
  await pool.query('update entitlements set revoked_at = now() where device_id = $1', [dev.id]);
  const r = await openStream(j.sessionId, dev.token);
  assert.equal(r.status, 403); assert.equal(await code(r), 'NOT_ENTITLED');
  const [s] = await sessions(); assert.equal(s.status, 'FAILED'); assert.ok(s.finished_at);
  const [log] = await logs(); assert.deepEqual([log.status, log.error_code, log.bytes_sent], ['FAILED', 'NOT_ENTITLED', '0']);
  assert.equal(await code(await openStream(j.sessionId, dev.token)), 'SESSION_INVALID');
  void m;
});

test('model withdrawn between session and stream: MODEL_NOT_AVAILABLE 409, session FAILED', { skip }, async () => {
  const { dev, m, j } = await ready();
  await pool.query("update models set status = 'HIDDEN' where id = $1", [m.id]);
  const r = await openStream(j.sessionId, dev.token);
  assert.equal(r.status, 409); assert.equal(await code(r), 'MODEL_NOT_AVAILABLE');
  assert.equal((await sessions())[0].status, 'FAILED');
});

test('per-device rate limit: the (N+1)th session in an hour is RATE_LIMITED 429; other devices and older sessions are unaffected', { skip }, async () => {
  base = await start({ router: { sessionsPerHour: 2 } });
  const dev = await mkDevice(), other = await mkDevice(), m = await mkModel();
  await grant(dev.id, m.id); await grant(other.id, m.id);
  assert.equal((await createSession(m.id, dev.token)).status, 201);
  assert.equal((await createSession(m.id, dev.token)).status, 201);
  const r = await createSession(m.id, dev.token);
  assert.equal(r.status, 429); assert.equal(await code(r), 'RATE_LIMITED');
  assert.equal((await createSession(m.id, other.token)).status, 201);
  assert.equal((await sessions()).filter((s) => s.device_id === dev.id).length, 2);
  await pool.query("update model_download_sessions set created_at = now() - interval '61 minutes', expires_at = now() - interval '56 minutes' where device_id = $1", [dev.id]);
  assert.equal((await createSession(m.id, dev.token)).status, 201);
});

test('creating a session starts the download in the background so the plugin does not wait on Google at stream time', { skip }, async () => {
  const { m } = await ready({ modelOpts: { behaviour: { delayMs: 2 } } });
  await until(() => existsSync(cacheDir) && opens.length === 1);
  await until(async () => (await pool.query('select sha256 from model_files where id=$1', [m.fid])).rows[0].sha256);
});

test('global concurrency: when all slots are busy the answer is DOWNLOAD_BUSY 503 and the session is NOT consumed (retry works)', { skip }, async () => {
  base = await start({ router: { maxConcurrent: 1 } });
  const dev = await mkDevice(), m = await mkModel({ data: payload(4000), behaviour: { delayMs: 15, chunk: 100 } });
  await grant(dev.id, m.id);
  const a = await (await createSession(m.id, dev.token)).json(), b = await (await createSession(m.id, dev.token)).json();
  const first = openStream(a.sessionId, dev.token);
  await new Promise((r) => setTimeout(r, 100)); // first is waiting for the copy to fill
  const busy = await openStream(b.sessionId, dev.token);
  assert.equal(busy.status, 503); assert.equal(await code(busy), 'DOWNLOAD_BUSY');
  assert.equal((await sessions()).find((s) => s.token_hash.equals(sha(b.sessionId))).status, 'CREATED');
  const done = await first; assert.equal(done.status, 200); await done.arrayBuffer();
  const retry = await openStream(b.sessionId, dev.token);
  assert.equal(retry.status, 200); await retry.arrayBuffer();
});

test('client disconnects mid-stream: session FAILED / CLIENT_ABORTED with the bytes actually read, slot released', { skip }, async () => {
  base = await start({ router: { maxConcurrent: 1 } });
  const { dev, j } = await ready({ modelOpts: { data: payload(48 * 1024 * 1024, 3), behaviour: { chunk: 1 << 20 } } });
  await until(() => opens.length === 1);
  const controller = new AbortController();
  const res = await openStream(j.sessionId, dev.token, { signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader(); await reader.read();
  controller.abort(); await reader.cancel().catch(() => {});
  const [s] = await until(async () => { const x = await sessions(); return x[0].status === 'FAILED' ? x : null; });
  assert.ok(s.finished_at);
  const [log] = await logs(); assert.equal(log.status, 'FAILED'); assert.equal(log.error_code, 'CLIENT_ABORTED');
  assert.ok(Number(log.bytes_sent) < 48 * 1024 * 1024, 'only part of the file was read');
  assert.ok(Number(log.bytes_sent) > 0, 'and the bytes that were read are recorded');
  const next = await (await createSession((await sessions())[0].model_id, dev.token)).json();
  const again = await openStream(next.sessionId, dev.token);
  assert.equal(again.status, 200, 'the slot was released'); again.body.cancel();
});

test('Google side failures reach the plugin only as STORAGE_DOWNLOAD_FAILED 502 (no provider text); the real class is logged; nothing is cached; a later session recovers', { skip }, async () => {
  const cases = {
    'open fails': { openError: 'STORAGE_DOWNLOAD_FAILED' }, 'mid-stream': { failAfter: 600 }, 'bad checksum': { overrideSha: true },
  };
  for (const [name, behaviour] of Object.entries(cases)) {
    const dev = await mkDevice();
    const data = payload(3000, 9);
    const m = await mkModel({ data, behaviour: behaviour.overrideSha ? {} : behaviour, file: behaviour.overrideSha ? { sha256: hex('sha256', Buffer.from('other')) } : {} });
    await grant(dev.id, m.id);
    const j = await (await createSession(m.id, dev.token)).json();
    const r = await openStream(j.sessionId, dev.token);
    assert.equal(r.status, 502, name);
    const text = await r.text();
    assert.equal(JSON.parse(text).error.code, 'STORAGE_DOWNLOAD_FAILED', name);
    assert.equal(/google|drive|http|DriveFile/i.test(text), false, `${name}: no provider text`);
    const s = (await sessions()).find((x) => x.token_hash.equals(sha(j.sessionId)));
    assert.equal(s.status, 'FAILED', name);
    const log = (await logs()).find((x) => x.session_id === s.id);
    assert.equal(log.status, 'FAILED', name);
    assert.equal(log.error_code, behaviour.overrideSha ? 'DOWNLOAD_CHECKSUM_MISMATCH' : 'STORAGE_DOWNLOAD_FAILED', name);
    if (!behaviour.overrideSha) {
      upstream.get(m.driveFileId).failAfter = undefined; upstream.get(m.driveFileId).openError = undefined; // Google recovers
      const j2 = await (await createSession(m.id, dev.token)).json();
      const ok = await openStream(j2.sessionId, dev.token);
      assert.equal(ok.status, 200, `${name}: recovers`); assert.deepEqual(Buffer.from(await ok.arrayBuffer()), data);
    }
  }
});

test('parallel session requests from one device cannot exceed the hourly limit (device row lock)', { skip }, async () => {
  base = await start({ router: { sessionsPerHour: 2 } });
  const dev = await mkDevice(), m = await mkModel(); await grant(dev.id, m.id);
  const statuses = (await Promise.all(Array.from({ length: 8 }, () => createSession(m.id, dev.token)))).map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 2, statuses.join(','));
  assert.equal((await sessions()).length, 2);
});

test('the stream path also learns the sha256 when the background warm-up failed', { skip }, async () => {
  const { dev, m, j } = await ready({ modelOpts: { behaviour: { failFirstOpens: 1 } } });
  await until(() => opens.length === 1); // warm-up consumed the failure
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await pool.query('select sha256 from model_files where id=$1', [m.fid])).rows[0].sha256, null);
  const res = await openStream(j.sessionId, dev.token);
  assert.equal(res.status, 200); await res.arrayBuffer();
  assert.equal((await pool.query('select sha256 from model_files where id=$1', [m.fid])).rows[0].sha256, hex('sha256', m.data));
});

test('a finished download leaves its copy evictable: a cache that fits one file serves two models in turn', { skip }, async () => {
  base = await start({ cache: { maxBytes: 5000 } });
  const dev = await mkDevice(); await grantAll(dev.id);
  for (let i = 0; i < 2; i++) {
    const m = await mkModel({ data: payload(3000, 3 + i) });
    const j = await (await createSession(m.id, dev.token)).json();
    const res = await openStream(j.sessionId, dev.token);
    assert.equal(res.status, 200, `model ${i}`); await res.arrayBuffer();
    await until(async () => (await sessions()).every((s) => s.status === 'COMPLETED'));
  }
});

test('client leaves while the copy is still being filled: logged as CLIENT_ABORTED, the fill continues for the next caller', { skip }, async () => {
  const { dev, m, j } = await ready({ modelOpts: { data: payload(6000), behaviour: { delayMs: 15, chunk: 100 } } });
  const controller = new AbortController();
  const pending = openStream(j.sessionId, dev.token, { signal: controller.signal }).catch(() => null);
  await new Promise((r) => setTimeout(r, 80));
  controller.abort(); await pending;
  await until(async () => (await logs()).length === 1);
  assert.equal((await logs())[0].error_code, 'CLIENT_ABORTED');
  const j2 = await (await createSession(m.id, dev.token)).json();
  const res = await openStream(j2.sessionId, dev.token);
  assert.equal(res.status, 200); assert.deepEqual(Buffer.from(await res.arrayBuffer()), m.data);
  assert.equal(opens.length, 1, 'the fill was shared, not restarted');
});

test('disk full on the server is hidden from the plugin as STORAGE_DOWNLOAD_FAILED but logged as DISK_SPACE_LOW', { skip }, async () => {
  base = await start({ cache: { freeDiskBytes: async () => 10, minFreeBytes: 10 ** 6 } });
  const { dev, j } = await ready();
  const r = await openStream(j.sessionId, dev.token);
  assert.equal(r.status, 502); assert.equal(await code(r), 'STORAGE_DOWNLOAD_FAILED');
  assert.equal((await logs())[0].error_code, 'DISK_SPACE_LOW');
});

test('expired unstarted sessions are swept to EXPIRED when the next session is created', { skip }, async () => {
  const { dev, m, j } = await ready();
  await pool.query("update model_download_sessions set expires_at = now() - interval '1 second', created_at = now() - interval '1 minute'");
  await createSession(m.id, dev.token);
  const old = (await sessions()).find((s) => s.token_hash.equals(sha(j.sessionId)));
  assert.equal(old.status, 'EXPIRED');
});

test('router config is validated: bad limits are rejected at startup', { skip }, async () => {
  const cache = { acquire() {} };
  for (const bad of [{ sessionsPerHour: 0 }, { sessionsPerHour: 1.5 }, { maxConcurrent: 0 }, { maxConcurrent: 'x' }]) {
    assert.throws(() => mod.createDownloadRouter({ pool, cache, ...bad }), /config/i, JSON.stringify(bad));
  }
});

test('loadDownloadConfig: defaults, overrides and bad values (errors name the variable only, never the value)', async () => {
  const { loadDownloadConfig } = await import('./config.js');
  const d = loadDownloadConfig({ STORAGE_DIR: '/data' });
  assert.equal(d.cacheDir, path.resolve('/data', 'model-cache'));
  assert.deepEqual([d.maxBytes, d.minFreeBytes, d.maxFileBytes, d.sessionsPerHour, d.maxConcurrent], [20 * 1024 ** 3, 2 * 1024 ** 3, 4 * 1024 ** 3, 10, 3]);
  const o = loadDownloadConfig({ MODEL_CACHE_DIR: '/x/cache', MODEL_CACHE_MAX_BYTES: '5000', MODEL_CACHE_MIN_FREE_BYTES: '0', MODEL_MAX_FILE_BYTES: '9000', DOWNLOAD_SESSIONS_PER_HOUR: '4', DOWNLOAD_MAX_CONCURRENT: '2' });
  assert.deepEqual([o.cacheDir, o.maxBytes, o.minFreeBytes, o.maxFileBytes, o.sessionsPerHour, o.maxConcurrent], [path.resolve('/x/cache'), 5000, 0, 9000, 4, 2]);
  for (const [name, value] of [['MODEL_CACHE_MAX_BYTES', '-1'], ['MODEL_CACHE_MAX_BYTES', 'abc'], ['MODEL_CACHE_MAX_BYTES', '1e3'], ['DOWNLOAD_SESSIONS_PER_HOUR', '0'], ['DOWNLOAD_MAX_CONCURRENT', '0'], ['MODEL_MAX_FILE_BYTES', '0'], ['DOWNLOAD_MAX_CONCURRENT', '65']]) {
    assert.deepEqual(loadDownloadConfig({ [name]: value }).errors, [name], `${name}=${value}: names the variable, nothing else`);
  }
  assert.deepEqual(loadDownloadConfig({}).errors, []);
});
