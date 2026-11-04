// P3.1: nguon quet bang API key (D26) qua API admin: status, sources, test-access. PostgreSQL that + Drive gia.
// Key chi nam trong env cua server: khong bao gio nam trong request/response.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { startFakeDrive } from './testing/fake-drive.js';
import { FOLDER } from './client.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const KEY = 'AIzaSyAdminApiKey_0123456789-abcdefghi';
const ROOT = 'apiKeyRootFolder1';
let dispose, pool, server, base, drive, adminId, userId, makeApp;

const j = (path, { method = 'GET', body, user = 'admin' } = {}) => fetch(base + '/api/admin/drive' + path, {
  method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });

async function listen(app) {
  if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('drive_apikey_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  for (const k of ['adminId', 'userId']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'adminId') adminId = id; else userId = id;
  }
  drive = await startFakeDrive({ pageSize: 50, apiKeys: [KEY] });
  const { createDriveRouter } = await import('./routes.js');
  const { requireAdmin } = await import('../admin/access.js');
  makeApp = (apiKey) => {
    const app = express();
    const fakeAuth = (req, res, next) => {
      const who = req.get('x-test-user');
      if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
      req.user = who === 'admin' ? { id: adminId, role: 'ADMIN' } : { id: userId, role: 'USER' }; next();
    };
    app.use('/api/admin/drive', createDriveRouter({ pool, oauth: null, config: { configured: false, errors: [] }, guards: [fakeAuth, requireAdmin], driveBase: drive.baseUrl, apiKey }));
    return app;
  };
  await listen(makeApp(KEY));
});
after(async () => { if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } if (drive) await drive.close(); if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('delete from drive_sync_jobs'); await pool.query('delete from drive_sources');
  const f = drive.state.files; f.length = 0;
  f.push({ id: ROOT, name: 'Thu vien goc', mimeType: FOLDER, parents: [] });
  f.push({ id: 'apiKeyChildFile01', name: 'a.jpg', mimeType: 'image/jpeg', parents: [ROOT], size: 1000, md5Checksum: 'a'.repeat(32), content: Buffer.from('jpeg-bytes') });
  drive.state.failures.length = 0; drive.state.requests.length = 0;
});

test('guards: anonymous 401, ordinary user 403 on status/sources/test-access; nothing is written', { skip }, async () => {
  for (const [path, method] of [['/status', 'GET'], ['/sources', 'GET'], ['/sources', 'POST'], ['/test-access', 'POST']]) {
    assert.equal((await j(path, { method, user: null, body: method === 'POST' ? {} : undefined })).status, 401, 'anon ' + path);
    assert.equal((await j(path, { method, user: 'user', body: method === 'POST' ? { rootFolderUrlOrId: ROOT } : undefined })).status, 403, 'user ' + path);
  }
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 0);
});

test('status (key configured): configured true, no missing config, no OAuth connection, sources listed; the key never appears', { skip }, async () => {
  const empty = await (await j('/status')).json();
  assert.deepEqual(Object.keys(empty).sort(), ['configured', 'connection', 'missingConfig', 'sources']);
  assert.equal(empty.configured, true); assert.deepEqual(empty.missingConfig, []); assert.equal(empty.connection, null); assert.deepEqual(empty.sources, []);

  await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  const text = await (await j('/status')).text();
  assert.ok(!text.includes(KEY) && !/AIzaSy/.test(text), 'API key leaked in status');
  const s = JSON.parse(text).sources[0];
  assert.deepEqual(Object.keys(s).sort(), ['enabled', 'id', 'lastSuccessfulSyncAt', 'rootFolderName', 'sourceType']);
  assert.equal(s.rootFolderName, 'Thu vien goc');
});

test('status (key missing): configured false and only the variable NAME is reported', { skip }, async () => {
  await listen(makeApp(null));
  try {
    const body = await (await j('/status')).json();
    assert.equal(body.configured, false); assert.deepEqual(body.missingConfig, ['DRIVE_API_KEY']); assert.equal(body.connection, null);
    const r = await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
    assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'DRIVE_NOT_CONNECTED');
    assert.equal((await j('/test-access', { method: 'POST', body: {} })).status, 400, 'no source yet');
    assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 0);
    assert.equal(drive.state.requests.length, 0, 'no call to Google without a key');
  } finally { await listen(makeApp(KEY)); }
});

test('POST /sources: creates an API_KEY source (201 {id,rootFolderName,sourceType}), idempotent, accepts a folder URL; the key goes only to Google', { skip }, async () => {
  const r = await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.deepEqual(Object.keys(body).sort(), ['id', 'rootFolderName', 'sourceType']);
  assert.equal(body.rootFolderName, 'Thu vien goc');
  const row = (await pool.query('select access_mode, root_folder_id from drive_sources')).rows;
  assert.equal(row.length, 1); assert.equal(row[0].access_mode, 'API_KEY');
  assert.ok(!JSON.stringify(row).includes('AIzaSy'), 'key never stored');

  const again = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: `https://drive.google.com/drive/folders/${ROOT}?usp=sharing` } })).json();
  assert.equal(again.id, body.id, 'same folder = same source');
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 1);
  assert.ok(drive.state.requests.every((q) => q.query.key === KEY && !q.headers.authorization), 'key in the query to Google, no bearer token');
});

test('POST /sources: bad input is 400 and writes nothing; Drive refusals map to the plan codes', { skip }, async () => {
  for (const body of [{}, { rootFolderUrlOrId: 123 }, { rootFolderUrlOrId: "x' or '1'='1" }, { rootFolderUrlOrId: 'https://evil.example/drive/folders/' + ROOT }, { rootFolderUrlOrId: ROOT, extra: 1 }, { rootFolderUrlOrId: ROOT, resourceKey: 'bad key!' }]) {
    assert.equal((await j('/sources', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  const file = await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: 'apiKeyChildFile01' } });
  assert.equal(file.status, 422); assert.equal((await file.json()).error.code, 'DRIVE_NOT_A_FOLDER');
  const missing = await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: 'doesNotExistFolder1' } });
  assert.equal(missing.status, 422); assert.equal((await missing.json()).error.code, 'DRIVE_NOT_FOUND');
  drive.state.failures.push({ status: 403, reason: 'forbidden' });
  const denied = await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  assert.equal(denied.status, 422); assert.equal((await denied.json()).error.code, 'DRIVE_PERMISSION_DENIED');
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 0);
});

test('POST /sources re-enables a source an admin had disabled (same folder)', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  await pool.query('update drive_sources set enabled=false where id=$1', [id]);
  await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  assert.equal((await pool.query('select enabled from drive_sources where id=$1', [id])).rows[0].enabled, true);
});

test('test-access on an API_KEY source: lists and proves a real download; account is null', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canList, true); assert.equal(r.sampleCount, 1); assert.equal(r.account, null);
  assert.equal(r.canDownloadSample, true);
  assert.deepEqual(r.details.map((d) => [d.check, d.ok]), [['list', true], ['download', true]]);
  assert.ok(!JSON.stringify(r).includes('AIzaSy'));
  // khong chi dinh sourceId: dung nguon dang bat dau tien
  assert.equal((await (await j('/test-access', { method: 'POST', body: {} })).json()).canList, true);
});

test('test-access: Google block page on download is reported per item with its code, not hidden', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  drive.state.failures.push({ status: 403, html: true, media: true });
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canList, true); assert.equal(r.canDownloadSample, false);
  const dl = r.details.find((d) => d.check === 'download');
  assert.equal(dl.ok, false); assert.equal(dl.code, 'DRIVE_QUOTA_EXCEEDED');
});

test('test-access: unknown or malformed sourceId is 400', { skip }, async () => {
  assert.equal((await j('/test-access', { method: 'POST', body: { sourceId: randomUUID() } })).status, 400);
  assert.equal((await j('/test-access', { method: 'POST', body: { sourceId: 'x' } })).status, 400);
  assert.equal((await j('/test-access', { method: 'POST', body: { other: 1 } })).status, 400);
});

test('POST /sources with a resourceKey: sent to Google in the resource-key header and stored on the source', { skip }, async () => {
  const r = await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT, resourceKey: 'rk-123_AB' } });
  assert.equal(r.status, 201);
  assert.equal((await pool.query('select root_resource_key from drive_sources')).rows[0].root_resource_key, 'rk-123_AB');
  assert.ok(drive.state.requests.some((q) => q.headers['x-goog-drive-resource-keys'] === `${ROOT}/rk-123_AB`), 'resource key header reached Drive');
  // khoa trong URL thu muc cung duoc nhan
  await pool.query('delete from drive_sources');
  await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: `https://drive.google.com/drive/folders/${ROOT}?resourcekey=urlKey_9` } });
  assert.equal((await pool.query('select root_resource_key from drive_sources')).rows[0].root_resource_key, 'urlKey_9');
});

test('test-access finds a sample file BELOW the root when the root holds only folders (real libraries look like this)', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const f = drive.state.files; f.length = 0;
  f.push({ id: ROOT, name: 'Thu vien goc', mimeType: FOLDER, parents: [] });
  f.push({ id: 'apiKeySubFolder001', name: 'Phong khach', mimeType: FOLDER, parents: [ROOT] });
  f.push({ id: 'apiKeyDeepFile0001', name: 'b.jpg', mimeType: 'image/jpeg', parents: ['apiKeySubFolder001'], size: 1000, md5Checksum: 'b'.repeat(32), content: Buffer.from('jpeg-bytes') });
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canList, true); assert.equal(r.sampleCount, 1, 'sampleCount still counts the root listing');
  assert.equal(r.canDownloadSample, true);
  assert.deepEqual(r.details.map((d) => [d.check, d.ok]), [['list', true], ['download', true]]);
});

test('test-access search below the root is bounded: a file buried too deep is NO_SAMPLE_FILE and Drive is not hammered', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const f = drive.state.files; f.length = 0;
  f.push({ id: ROOT, name: 'Thu vien goc', mimeType: FOLDER, parents: [] });
  let parent = ROOT;
  for (let i = 0; i < 20; i++) { const folder = `apiKeyChain${String(i).padStart(6, '0')}`; f.push({ id: folder, name: `c${i}`, mimeType: FOLDER, parents: [parent] }); parent = folder; }
  f.push({ id: 'apiKeyBuriedFile01', name: 'deep.jpg', mimeType: 'image/jpeg', parents: [parent], size: 1000 });
  drive.state.requests.length = 0;
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, false);
  assert.deepEqual(r.details.find((d) => d.check === 'download'), { check: 'download', ok: false, code: 'NO_SAMPLE_FILE' });
  const lists = drive.state.requests.filter((q) => q.path === '/drive/v3/files').length;
  assert.ok(lists <= 9, `at most 1 root listing + 8 folder listings, got ${lists}`);
});

test('test-access picks a REAL downloadable file: skips empty and canDownload=false files, and goes down several levels', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const f = drive.state.files; f.length = 0;
  const content = Buffer.from('jpeg-bytes');
  f.push({ id: ROOT, name: 'Thu vien goc', mimeType: FOLDER, parents: [] });
  f.push({ id: 'apiKeyEmptyFile001', name: 'empty.jpg', mimeType: 'image/jpeg', parents: [ROOT], size: 0, content: Buffer.alloc(0) });
  f.push({ id: 'apiKeyBlockedFile01', name: 'blocked.jpg', mimeType: 'image/jpeg', parents: [ROOT], size: 1000, canDownload: false, content });
  f.push({ id: 'apiKeyLevelA000001', name: 'A', mimeType: FOLDER, parents: [ROOT] });
  f.push({ id: 'apiKeyLevelB000001', name: 'B', mimeType: FOLDER, parents: ['apiKeyLevelA000001'] });
  f.push({ id: 'apiKeyGoodFile00001', name: 'good.jpg', mimeType: 'image/jpeg', parents: ['apiKeyLevelB000001'], size: 1000, content });
  drive.state.requests.length = 0;
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, true);
  const media = drive.state.requests.filter((q) => q.query.alt === 'media');
  assert.equal(media.length, 1, 'exactly one download attempt');
  assert.ok(media[0].path.endsWith('/apiKeyGoodFile00001'), `downloaded ${media[0].path}, expected the real file two levels down`);
});

test('test-access on a library shaped like the real one (11 categories → sub-folders → files at depth 3) finds a file within the cap', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const f = drive.state.files; f.length = 0;
  f.push({ id: ROOT, name: 'Thu vien goc', mimeType: FOLDER, parents: [] });
  const pad = (n) => String(n).padStart(4, '0');
  for (let c = 0; c < 11; c++) {
    f.push({ id: `apiKeyCategory${pad(c)}`, name: `Danh muc ${c}`, mimeType: FOLDER, parents: [ROOT] });
    for (let s = 0; s < 3; s++) {
      f.push({ id: `apiKeySub${pad(c)}${s}x`, name: `Con ${c}-${s}`, mimeType: FOLDER, parents: [`apiKeyCategory${pad(c)}`] });
      f.push({ id: `apiKeyFile${pad(c)}${s}xx`, name: `m${c}-${s}.jpg`, mimeType: 'image/jpeg', parents: [`apiKeySub${pad(c)}${s}x`], size: 1000, content: Buffer.from('jpeg-bytes') });
    }
  }
  drive.state.requests.length = 0;
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, true, 'a file at depth 3 must be reachable although the root has 11 category folders');
  const lists = drive.state.requests.filter((q) => q.path === '/drive/v3/files').length;
  assert.ok(lists <= 9, `bounded listings, got ${lists}`);
});

test('test-access uses a file already known from the last scan (inventory): one download, no tree crawling, even when most folders are empty', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const f = drive.state.files; f.length = 0;
  f.push({ id: ROOT, name: 'Thu vien goc', mimeType: FOLDER, parents: [] });
  for (let i = 0; i < 12; i++) f.push({ id: `apiKeyEmptyDir${String(i).padStart(4, '0')}`, name: `rong ${i}`, mimeType: FOLDER, parents: [ROOT] }); // thu muc rong nhu thu vien that
  f.push({ id: 'apiKeyKnownSmall01', name: 'small.jpg', mimeType: 'image/jpeg', parents: ['apiKeyEmptyDir0011'], size: 500, content: Buffer.from('jpeg-bytes') });
  f.push({ id: 'apiKeyKnownBig0001', name: 'big.jpg', mimeType: 'image/jpeg', parents: ['apiKeyEmptyDir0011'], size: 9000, content: Buffer.from('jpeg-bytes') });
  const ins = (fid, size, extra = '') => pool.query(`insert into drive_inventory(source_id,drive_file_id,path,filename,mime_type,size_bytes${extra ? ', ' + extra.split('=')[0] : ''}) values($1,$2,$3,$4,'image/jpeg',$5${extra ? ', ' + extra.split('=')[1] : ''})`, [id, fid, `X/Y/${fid}`, `${fid}.jpg`, size]);
  await ins('apiKeyKnownBig0001', 9000);
  await ins('apiKeyKnownSmall01', 500);
  await ins('apiKeyZeroSized001', 0);
  await ins('apiKeyBlockedInv001', 100, 'can_download=false');
  drive.state.requests.length = 0;
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, true);
  const media = drive.state.requests.filter((q) => q.query.alt === 'media');
  assert.equal(media.length, 1);
  assert.ok(media[0].path.endsWith('/apiKeyKnownSmall01'), `expected the smallest usable known file, got ${media[0].path}`);
  const lists = drive.state.requests.filter((q) => q.path === '/drive/v3/files').length;
  assert.equal(lists, 1, 'only the root listing; the tree is not crawled when the inventory has a sample');
});

test('test-access ignores the inventory of ANOTHER source and falls back to crawling when this source has no known file', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  const other = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','otherRootFolder001','other','MY_DRIVE') returning id")).rows[0].id;
  await pool.query("insert into drive_inventory(source_id,drive_file_id,path,filename,mime_type,size_bytes) values($1,'apiKeyOtherSrcFile1','X/Y/z.jpg','z.jpg','image/jpeg',10)", [other]);
  drive.state.requests.length = 0;
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, true, 'fallback crawl found the file in the root');
  assert.ok(!drive.state.requests.some((q) => q.path.endsWith('/apiKeyOtherSrcFile1')), "another source's file is never requested");
});

test('test-access: a known file that no longer exists on Drive is reported with its code (stale inventory is not hidden)', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  await pool.query("insert into drive_inventory(source_id,drive_file_id,path,filename,mime_type,size_bytes) values($1,'apiKeyGoneFile0001','X/Y/gone.jpg','gone.jpg','image/jpeg',10)", [id]);
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, false);
  const dl = r.details.find((d) => d.check === 'download');
  assert.equal(dl.ok, false); assert.equal(dl.code, 'DRIVE_NOT_FOUND');
});

test('test-access sends the known file\'s resource key to Drive', { skip }, async () => {
  const { id } = await (await j('/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).json();
  drive.state.files.push({ id: 'apiKeyKeyedFile0001', name: 'k.jpg', mimeType: 'image/jpeg', parents: [ROOT], size: 5, content: Buffer.from('jpeg-bytes') });
  await pool.query("insert into drive_inventory(source_id,drive_file_id,path,filename,mime_type,size_bytes,resource_key) values($1,'apiKeyKeyedFile0001','X/Y/k.jpg','k.jpg','image/jpeg',5,'rk-inv_1')", [id]);
  drive.state.requests.length = 0;
  const r = await (await j('/test-access', { method: 'POST', body: { sourceId: id } })).json();
  assert.equal(r.canDownloadSample, true);
  const media = drive.state.requests.find((q) => q.query.alt === 'media');
  assert.equal(media.headers['x-goog-drive-resource-keys'], 'apiKeyKeyedFile0001/rk-inv_1');
});
