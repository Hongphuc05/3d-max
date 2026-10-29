// Admin Drive routes against PostgreSQL + fake Google. Uses the REAL requireAdmin guard.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { startFakeDrive } from './testing/fake-drive.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const ROOT = 'rootFolderId1', SUB = 'subFolderId01';
let dispose, pool, server, base, drive, tokenSrv, env, oauthMod, adminId, userId;

const stateOf = loc => new URL(loc).searchParams.get('state');
const j = (path, { method = 'GET', body, user = 'admin', redirect = 'manual' } = {}) => fetch(base + path, {
  method, redirect, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });

async function startTokenServer() {
  const s = { requests: [], next: [] };
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; s.requests.push(Object.fromEntries(new URLSearchParams(raw)));
    const out = s.next?.shift() ?? { status: 200, body: { access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-secret-1', scope: 'https://www.googleapis.com/auth/drive.readonly' } };
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${srv.address().port}/token`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}

async function build(configOverride = {}) {
  const { createOAuth, loadDriveConfig } = oauthMod;
  const { createDriveRouter } = await import('./routes.js');
  const { requireAdmin } = await import('../admin/access.js');
  const config = { ...loadDriveConfig(env), ...configOverride };
  const oauth = createOAuth({ pool, env, config, tokenUrl: tokenSrv.url, driveBase: drive.baseUrl, retry: { sleep: async () => {} } });
  const app = express();
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = who === 'admin' ? { id: adminId, role: 'ADMIN' } : { id: userId, role: 'USER' }; next();
  };
  app.use('/api/admin/drive', createDriveRouter({ pool, oauth, config, guards: [fakeAuth, requireAdmin], driveBase: drive.baseUrl }));
  return app;
}
async function listen(app) {
  if (server) await new Promise(r => server.close(r));
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('drive_routes');
  ({ pool } = await import('../db.js')); await (await import('../db.js')).migrate();
  oauthMod = await import('./oauth.js');
  for (const k of ['adminId', 'userId']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'adminId') adminId = id; else userId = id;
  }
  drive = await startFakeDrive({ files: [
    { id: ROOT, name: '3DSMOOD', mimeType: 'application/vnd.google-apps.folder', parents: ['driveRoot0001'], ownedByMe: false },
    { id: SUB, name: 'Furniture', mimeType: 'application/vnd.google-apps.folder', parents: [ROOT] },
    { id: 'plainFile0001', name: 'a.txt', mimeType: 'text/plain', parents: [ROOT], size: 4, content: Buffer.from('data') },
    { id: 'modelFile0001', name: 'm.rar', mimeType: 'application/x-rar', parents: [ROOT], size: 9, content: Buffer.from('rarbytes!') },
    { id: 'restrictedRoot1', name: 'Restricted', mimeType: 'application/vnd.google-apps.folder', parents: ['driveRoot0001'], ownedByMe: false },
    { id: 'zzRestricted01', name: 'only.rar', mimeType: 'application/x-rar', parents: ['restrictedRoot1'], size: 5, canDownload: false },
  ], user: { emailAddress: 'operator@example.test' }, pageSize: 50 });
  drive.state.tokens.add('access-1');
  tokenSrv = await startTokenServer();
});
after(async () => {
  if (!configured) return;
  if (server) await new Promise(r => server.close(r));
  await drive.close(); await tokenSrv.close(); await dispose(pool);
});
beforeEach(async () => {
  if (!configured) return;
  await pool.query('delete from drive_sources'); await pool.query('delete from drive_connections'); await pool.query('delete from oauth_states');
  tokenSrv.s.requests.length = 0; tokenSrv.s.next.length = 0; drive.state.requests.length = 0; drive.state.failures.length = 0;
  env = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'csecret', GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:4000/api/admin/drive/oauth/callback',
    DRIVE_TOKEN_KEY: randomBytes(32).toString('base64'), ADMIN_UI_URL: 'http://localhost:5173' };
  await listen(await build());
});

async function connect() {
  const start = await j('/api/admin/drive/oauth/start');
  const cb = await j(`/api/admin/drive/oauth/callback?code=c&state=${stateOf(start.headers.get('location'))}`, { user: null });
  assert.match(cb.headers.get('location'), /drive=connected/);
}

test('guards: anonymous → 401, ordinary user → 403 on every protected route, and nothing is written', { skip }, async () => {
  for (const [path, method] of [['/status', 'GET'], ['/oauth/start', 'GET'], ['/sources', 'GET'], ['/sources', 'POST'], ['/test-access', 'POST']]) {
    assert.equal((await j('/api/admin/drive' + path, { method, user: null, body: method === 'POST' ? {} : undefined })).status, 401, 'anon ' + path);
    const r = await j('/api/admin/drive' + path, { method, user: 'user', body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, 'user ' + path);
    assert.equal((await r.json()).error.code, 'FORBIDDEN');
  }
  assert.equal((await pool.query('select count(*)::int n from oauth_states')).rows[0].n, 0);
});

test('error envelope: { error:{code,message(vi),requestId} } and X-Request-Id header; no stack/provider text', { skip }, async () => {
  const r = await j('/api/admin/drive/test-access', { method: 'POST', body: {} }); // not connected
  const body = await r.json();
  assert.equal(r.status, 409); assert.equal(body.error.code, 'DRIVE_NOT_CONNECTED');
  assert.match(body.error.message, /Chưa kết nối/); assert.equal(body.error.requestId, r.headers.get('x-request-id'));
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'requestId']);
});

test('status: unconfigured server reports variable NAMES only', { skip }, async () => {
  await listen(await build({ configured: false, errors: ['GOOGLE_OAUTH_CLIENT_SECRET'] }));
  const body = await (await j('/api/admin/drive/status')).json();
  assert.deepEqual(body, { configured: false, missingConfig: ['GOOGLE_OAUTH_CLIENT_SECRET'], connection: null, sources: [] });
  const r = await j('/api/admin/drive/oauth/start');
  assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'DRIVE_OAUTH_NOT_CONFIGURED');
});

test('connect flow end-to-end through HTTP: start → Google → public callback → CONNECTED; status leaks no secret', { skip }, async () => {
  const start = await j('/api/admin/drive/oauth/start');
  assert.equal(start.status, 302);
  assert.match(start.headers.get('location'), /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const cb = await j(`/api/admin/drive/oauth/callback?code=c&state=${stateOf(start.headers.get('location'))}`, { user: null }); // no session cookie: Google's redirect
  assert.equal(cb.status, 302); assert.equal(cb.headers.get('location'), 'http://localhost:5173/admin?drive=connected');
  const raw = await (await j('/api/admin/drive/status')).text();
  const body = JSON.parse(raw);
  assert.equal(body.connection.status, 'CONNECTED'); assert.equal(body.connection.email, 'operator@example.test'); assert.equal(body.connection.authKind, 'OAUTH_USER');
  for (const secret of ['refresh-secret-1', 'access-1', 'csecret', 'encrypted', 'token_iv', 'cid']) assert.ok(!raw.includes(secret), secret);
});

test('callback failure modes redirect with a reason and never throw a 5xx page', { skip }, async () => {
  const cases = [['/api/admin/drive/oauth/callback?code=c&state=nope', 'state'], ['/api/admin/drive/oauth/callback?error=access_denied', 'consent_denied'], ['/api/admin/drive/oauth/callback', 'state']];
  for (const [path, reason] of cases) {
    const r = await j(path, { user: null });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `http://localhost:5173/admin?drive=error&reason=${reason}`);
  }
  assert.equal(tokenSrv.s.requests.length, 0);
});

test('sources: validation (bad refs, extra keys), not-connected, not-a-folder, not-found', { skip }, async () => {
  for (const body of [{}, { rootFolderUrlOrId: 5 }, { rootFolderUrlOrId: 'https://evil.example/drive/folders/' + ROOT }, { rootFolderUrlOrId: "x' or 1=1" }, { rootFolderUrlOrId: ROOT, extra: 1 }, { rootFolderUrlOrId: ROOT, resourceKey: 'bad key' }]) {
    const r = await j('/api/admin/drive/sources', { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body)); assert.equal((await r.json()).error.code, 'INVALID_PARAMS');
  }
  assert.equal((await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } })).status, 409);
  await connect();
  const file = await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: 'plainFile0001' } });
  assert.equal(file.status, 422); assert.equal((await file.json()).error.code, 'DRIVE_NOT_A_FOLDER');
  const gone = await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: 'doesNotExist01' } });
  assert.equal(gone.status, 422); assert.equal((await gone.json()).error.code, 'DRIVE_NOT_FOUND');
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 0);
});

test('sources: accepts a folder URL with resourcekey; is idempotent; reports type SHARED_WITH_ME', { skip }, async () => {
  await connect();
  const body = { rootFolderUrlOrId: `https://drive.google.com/drive/folders/${ROOT}?usp=sharing&resourcekey=rk-77` };
  const a = await j('/api/admin/drive/sources', { method: 'POST', body });
  assert.equal(a.status, 201); const created = await a.json();
  assert.deepEqual(Object.keys(created).sort(), ['id', 'rootFolderName', 'sourceType']);
  assert.equal(created.rootFolderName, '3DSMOOD'); assert.equal(created.sourceType, 'SHARED_WITH_ME');
  assert.equal((await j('/api/admin/drive/sources', { method: 'POST', body })).status, 201);
  const row = (await pool.query('select * from drive_sources')).rows;
  assert.equal(row.length, 1); assert.equal(row[0].root_resource_key, 'rk-77');
  assert.equal(drive.state.requests.find(r => r.path.endsWith(ROOT)).headers['x-goog-drive-resource-keys'], `${ROOT}/rk-77`);
  const list = await (await j('/api/admin/drive/sources')).json();
  assert.ok(!JSON.stringify(list).includes(ROOT), 'GET /sources must not expose the Drive folder id');
});

test('test-access: lists, then proves a real download by reading the first bytes', { skip }, async () => {
  await connect();
  await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  const r = await j('/api/admin/drive/test-access', { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.canList, true); assert.equal(body.canDownloadSample, true); assert.equal(body.sampleCount, 3);
  assert.deepEqual(body.details.map(d => [d.check, d.ok]), [['list', true], ['download', true]]);
  assert.ok(drive.state.requests.some(q => q.query.alt === 'media'));
});

test('test-access: Drive refuses the download → ok:false with the Google reason, no bypass attempted', { skip }, async () => {
  await connect();
  assert.equal((await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: 'restrictedRoot1' } })).status, 201);
  const body = await (await j('/api/admin/drive/test-access', { method: 'POST', body: {} })).json();
  assert.equal(body.canList, true);
  // the only file is flagged canDownload:false, so no download is even attempted and the report says so
  assert.equal(body.canDownloadSample, false);
  assert.deepEqual(body.details[1], { check: 'download', ok: false, code: 'NO_SAMPLE_FILE' });
  assert.ok(!drive.state.requests.some(q => q.query.alt === 'media'), 'must not try to fetch a file Drive says cannot be downloaded');
});

test('test-access: flag says downloadable but Drive refuses the real call → the REAL call decides, reason is reported', { skip }, async () => {
  await connect();
  await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  drive.state.failures.push({ status: 403, reason: 'downloadRestricted', media: true });
  const body = await (await j('/api/admin/drive/test-access', { method: 'POST', body: {} })).json();
  assert.equal(body.canList, true); assert.equal(body.canDownloadSample, false);
  assert.deepEqual(body.details[1], { check: 'download', ok: false, code: 'DRIVE_PERMISSION_DENIED', reason: 'downloadRestricted' });
  assert.equal(drive.state.requests.filter(q => q.query.alt === 'media').length, 1, 'permission errors are not retried or worked around');
});

test('test-access: grant revoked → Drive 401 → one forced refresh → Google says invalid_grant → 409 + RECONNECT_REQUIRED', { skip }, async () => {
  await connect();
  await j('/api/admin/drive/sources', { method: 'POST', body: { rootFolderUrlOrId: ROOT } });
  drive.state.tokens.delete('access-1');                                  // Drive stops accepting the cached token
  tokenSrv.s.next.push({ status: 400, body: { error: 'invalid_grant' } }); // …and Google refuses to mint a new one
  const r = await j('/api/admin/drive/test-access', { method: 'POST', body: {} });
  assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'DRIVE_AUTH_REVOKED');
  assert.equal((await pool.query('select status from drive_connections')).rows[0].status, 'RECONNECT_REQUIRED');
  const status = await (await j('/api/admin/drive/status')).json();
  assert.equal(status.connection.status, 'RECONNECT_REQUIRED'); assert.equal(status.connection.lastErrorCode, 'DRIVE_AUTH_REVOKED');
  drive.state.tokens.add('access-1');
});
