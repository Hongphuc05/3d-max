// PostgreSQL integration (isolated schema) + fake Google token/Drive endpoints. No real Google call.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { startFakeDrive } from './testing/fake-drive.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, migrate, drive, tokenServer, createOAuth, loadDriveConfig, decryptSecret, tokenAad, adminId, env, oauth, clock;

async function startTokenServer() {
  const s = { requests: [], respond: null };
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = Object.fromEntries(new URLSearchParams(raw));
    s.requests.push(body);
    const out = s.respond(body, s.requests.length);
    await new Promise(r => setTimeout(r, out.delay ?? 0));
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { s, url: `http://127.0.0.1:${server.address().port}/token`, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
const ok = (extra = {}) => ({ body: { access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-secret-1',
  scope: 'https://www.googleapis.com/auth/drive.readonly', token_type: 'Bearer', ...extra } });
const stateOf = url => new URL(url).searchParams.get('state');

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('drive_oauth');
  ({ pool, migrate } = await import('../db.js'));
  ({ createOAuth, loadDriveConfig } = await import('./oauth.js'));
  ({ decryptSecret, tokenAad } = await import('./crypto.js'));
  await migrate();
  adminId = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
  drive = await startFakeDrive({ user: { emailAddress: 'operator@example.test' } });
  drive.state.tokens.add('access-1');
  tokenServer = await startTokenServer();
});
after(async () => { if (!configured) return; await drive.close(); await tokenServer.close(); await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('delete from drive_sources'); await pool.query('delete from drive_connections'); await pool.query('delete from oauth_states');
  tokenServer.s.requests.length = 0; tokenServer.s.respond = () => ok();
  clock = { t: Date.now() };
  env = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'csecret', GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:4000/api/admin/drive/oauth/callback',
    DRIVE_TOKEN_KEY: randomBytes(32).toString('base64') };
  oauth = createOAuth({ pool, env, config: loadDriveConfig(env), tokenUrl: tokenServer.url, driveBase: drive.baseUrl,
    retry: { sleep: async () => {} }, now: () => clock.t });
});

test('start(): PKCE S256 + offline + consent; only the HASH of state is stored; verifier is encrypted', { skip }, async () => {
  const url = new URL(await oauth.start(adminId));
  const p = url.searchParams;
  assert.equal(p.get('scope'), 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(p.get('access_type'), 'offline'); assert.equal(p.get('prompt'), 'consent');
  assert.equal(p.get('code_challenge_method'), 'S256'); assert.equal(p.get('response_type'), 'code');
  const row = (await pool.query('select * from oauth_states')).rows[0];
  assert.deepEqual(row.id, createHash('sha256').update(p.get('state')).digest());
  assert.ok(!row.verifier_ciphertext.includes(Buffer.from(p.get('code_challenge'))));
  assert.equal(row.used_at, null); assert.equal(row.admin_user_id, adminId);
});

test('callback(): exchanges code with the PKCE verifier matching the challenge, stores token ENCRYPTED, caches access token', { skip }, async () => {
  const url = await oauth.start(adminId);
  const r = await oauth.callback({ code: 'auth-code', state: stateOf(url) });
  assert.equal(r.email, 'operator@example.test');
  const sent = tokenServer.s.requests[0];
  assert.equal(sent.grant_type, 'authorization_code'); assert.equal(sent.code, 'auth-code');
  assert.equal(createHash('sha256').update(sent.code_verifier).digest('base64url'), new URL(url).searchParams.get('code_challenge'));
  const row = (await pool.query('select * from drive_connections')).rows[0];
  assert.equal(row.status, 'CONNECTED'); assert.equal(row.auth_kind, 'OAUTH_USER'); assert.equal(row.created_by, adminId);
  assert.ok(!row.encrypted_refresh_token.includes(Buffer.from('refresh-secret-1')));
  assert.equal(decryptSecret({ ciphertext: row.encrypted_refresh_token, iv: row.token_iv, authTag: row.token_auth_tag }, tokenAad(row.id), env), 'refresh-secret-1');
  assert.equal(await oauth.getAccessToken(row.id), 'access-1');
  assert.equal(tokenServer.s.requests.length, 1, 'cached access token: no extra token request');
});

test('state is single-use: replay is rejected and does not hit Google again', { skip }, async () => {
  const state = stateOf(await oauth.start(adminId));
  await oauth.callback({ code: 'c', state });
  await assert.rejects(oauth.callback({ code: 'c', state }), { code: 'OAUTH_STATE_INVALID' });
  assert.equal(tokenServer.s.requests.length, 1);
});

test('expired, unknown and malformed states are rejected before any Google call', { skip }, async () => {
  const state = stateOf(await oauth.start(adminId));
  await pool.query("update oauth_states set expires_at = now() - interval '1 second'");
  await assert.rejects(oauth.callback({ code: 'c', state }), { code: 'OAUTH_STATE_INVALID' });
  for (const bad of [undefined, '', 'short', randomBytes(32).toString('base64url'), "'; drop table users;--", 'x'.repeat(5000)]) {
    await assert.rejects(oauth.callback({ code: 'c', state: bad }), { code: 'OAUTH_STATE_INVALID' }, String(bad).slice(0, 20));
  }
  assert.equal(tokenServer.s.requests.length, 0);
  assert.equal((await pool.query('select count(*)::int n from drive_connections')).rows[0].n, 0);
});

test('Google denies drive.readonly (granular consent) → DRIVE_SCOPE_MISSING, nothing stored', { skip }, async () => {
  tokenServer.s.respond = () => ok({ scope: 'openid email' });
  await assert.rejects(oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) }), { code: 'DRIVE_SCOPE_MISSING' });
  assert.equal((await pool.query('select count(*)::int n from drive_connections')).rows[0].n, 0);
});

test('no refresh_token in the response → OAUTH_NO_REFRESH_TOKEN, nothing stored', { skip }, async () => {
  tokenServer.s.respond = () => ok({ refresh_token: undefined });
  await assert.rejects(oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) }), { code: 'OAUTH_NO_REFRESH_TOKEN' });
  assert.equal((await pool.query('select count(*)::int n from drive_connections')).rows[0].n, 0);
});

test('expired access token is refreshed; N concurrent callers cause exactly ONE refresh request', { skip }, async () => {
  await oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) });
  const id = (await pool.query('select id from drive_connections')).rows[0].id;
  clock.t += 2 * 3600_000; // access token (1h) expired
  tokenServer.s.requests.length = 0;
  tokenServer.s.respond = () => ({ ...ok({ access_token: 'access-2', refresh_token: undefined }), delay: 30 });
  const got = await Promise.all(Array.from({ length: 8 }, () => oauth.getAccessToken(id)));
  assert.deepEqual([...new Set(got)], ['access-2']);
  assert.equal(tokenServer.s.requests.length, 1);
  assert.equal(tokenServer.s.requests[0].grant_type, 'refresh_token'); assert.equal(tokenServer.s.requests[0].refresh_token, 'refresh-secret-1');
});

test('force=true bypasses the cache (used after a 401)', { skip }, async () => {
  await oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) });
  const id = (await pool.query('select id from drive_connections')).rows[0].id;
  tokenServer.s.requests.length = 0; tokenServer.s.respond = () => ok({ access_token: 'access-3', refresh_token: undefined });
  assert.equal(await oauth.getAccessToken(id, { force: true }), 'access-3');
  assert.equal(tokenServer.s.requests.length, 1);
});

test('invalid_grant (revoked / Testing-mode expiry) → RECONNECT_REQUIRED, and later calls fail fast without Google', { skip }, async () => {
  await oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) });
  const id = (await pool.query('select id from drive_connections')).rows[0].id;
  clock.t += 2 * 3600_000; tokenServer.s.requests.length = 0;
  tokenServer.s.respond = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked. SECRET-DETAIL' } });
  await assert.rejects(oauth.getAccessToken(id), { code: 'DRIVE_AUTH_REVOKED' });
  const row = (await pool.query('select status, last_error_code from drive_connections')).rows[0];
  assert.deepEqual(row, { status: 'RECONNECT_REQUIRED', last_error_code: 'DRIVE_AUTH_REVOKED' });
  await assert.rejects(oauth.getAccessToken(id), { code: 'DRIVE_AUTH_REVOKED' });
  assert.equal(tokenServer.s.requests.length, 1, 'second call must not contact Google');
});

test('refresh-token rotation is persisted (and still encrypted)', { skip }, async () => {
  await oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) });
  const id = (await pool.query('select id from drive_connections')).rows[0].id;
  clock.t += 2 * 3600_000; tokenServer.s.respond = () => ok({ access_token: 'a2', refresh_token: 'refresh-rotated-2' });
  await oauth.getAccessToken(id);
  const row = (await pool.query('select * from drive_connections')).rows[0];
  assert.ok(!row.encrypted_refresh_token.includes(Buffer.from('refresh-rotated-2')));
  assert.equal(decryptSecret({ ciphertext: row.encrypted_refresh_token, iv: row.token_iv, authTag: row.token_auth_tag }, tokenAad(id), env), 'refresh-rotated-2');
});

test('reconnecting the same Gmail updates the SAME row (no duplicates) and clears the error state', { skip }, async () => {
  await oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) });
  await pool.query("update drive_connections set status='RECONNECT_REQUIRED', last_error_code='DRIVE_AUTH_REVOKED'");
  tokenServer.s.respond = () => ok({ refresh_token: 'refresh-new' });
  await oauth.callback({ code: 'c2', state: stateOf(await oauth.start(adminId)) });
  const rows = (await pool.query('select * from drive_connections')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'CONNECTED'); assert.equal(rows[0].last_error_code, null);
  assert.equal(decryptSecret({ ciphertext: rows[0].encrypted_refresh_token, iv: rows[0].token_iv, authTag: rows[0].token_auth_tag }, tokenAad(rows[0].id), env), 'refresh-new');
});

test('a ciphertext copied to another connection row cannot be decrypted (AAD binding)', { skip }, async () => {
  await oauth.callback({ code: 'c', state: stateOf(await oauth.start(adminId)) });
  const row = (await pool.query('select * from drive_connections')).rows[0];
  assert.throws(() => decryptSecret({ ciphertext: row.encrypted_refresh_token, iv: row.token_iv, authTag: row.token_auth_tag }, tokenAad(randomUUID()), env));
});

test('not configured: start/getAccessToken fail with DRIVE_OAUTH_NOT_CONFIGURED; config reports NAMES only', { skip }, async () => {
  const bad = { GOOGLE_OAUTH_CLIENT_ID: 'id-value-xyz', GOOGLE_OAUTH_REDIRECT_URI: 'ftp://nope', DRIVE_TOKEN_KEY: 'short' };
  const cfg = loadDriveConfig(bad);
  assert.equal(cfg.configured, false);
  assert.deepEqual(cfg.errors.sort(), ['DRIVE_TOKEN_KEY', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'].sort());
  assert.ok(!JSON.stringify(cfg.errors).includes('id-value-xyz'));
  const o = createOAuth({ pool, config: cfg, env: bad });
  await assert.rejects(o.start(adminId), { code: 'DRIVE_OAUTH_NOT_CONFIGURED' });
  await assert.rejects(o.getAccessToken(randomUUID()), { code: 'DRIVE_OAUTH_NOT_CONFIGURED' });
});

test('http redirect URI is accepted only on loopback; https anywhere', () => {
  const mk = uri => loadDriveConfig({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', GOOGLE_OAUTH_REDIRECT_URI: uri, DRIVE_TOKEN_KEY: randomBytes(32).toString('base64') }).configured;
  assert.equal(mk('http://localhost:4000/cb'), true); assert.equal(mk('https://admin.example.com/cb'), true);
  assert.equal(mk('http://admin.example.com/cb'), false); assert.equal(mk('https://u:p@example.com/cb'), false);
});
