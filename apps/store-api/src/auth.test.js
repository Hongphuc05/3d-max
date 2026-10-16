// Chay tren Postgres that (database store_test). Xem apps/README.md de dung Postgres.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://store:store@localhost:5432/store_test';

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';

const { pool, migrate } = await import('./db.js');
const { authRouter } = await import('./auth.js');
const { errorHandler, originGuard } = await import('./security.js');

let server, base;
before(async () => {
  await migrate();
  await pool.query('truncate users cascade');
  const app = express();
  app.use(express.json({ limit: '10kb' }), originGuard, express.Router().use('/api/auth', authRouter), errorHandler);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

// client nho: giu cookie nhu trinh duyet
function client() {
  let sid = null;
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(sid && { cookie: `sid=${sid}` }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie().find((c) => c.startsWith('sid='));
    if (set) sid = /^sid=([^;]*)/.exec(set)[1] || null;
    return { status: r.status, body: await r.json().catch(() => null), setCookie: set, sid };
  };
  return { call, get sid() { return sid; } };
}
const pw = 'mat-khau-dai-du';

test('dang ky: tao tai khoan, cookie HttpOnly + SameSite, /me dung, khong lo hash', async () => {
  const c = client();
  const r = await c.call('POST', '/api/auth/register', { email: '  An@Example.com ', password: pw });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, 'an@example.com');
  assert.ok(!JSON.stringify(r.body).includes('password'));
  assert.match(r.setCookie, /HttpOnly/i);
  assert.match(r.setCookie, /SameSite=Lax/i);
  const me = await c.call('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'an@example.com');
});

test('mat khau luu dang scrypt, khong phai ban ro; session luu dang hash', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { email: 'hash@example.com', password: pw });
  const u = (await pool.query("select password_hash from users where email = 'hash@example.com'")).rows[0];
  assert.match(u.password_hash, /^scrypt\$/);
  assert.ok(!u.password_hash.includes(pw));
  const hashed = createHash('sha256').update(c.sid).digest();
  assert.equal((await pool.query('select 1 from sessions where id = $1', [hashed])).rowCount, 1);
  assert.equal((await pool.query('select 1 from sessions where id = $1', [Buffer.from(c.sid)])).rowCount, 0);
});

test('email trung (khac hoa/thuong) -> 409; email/mat khau khong hop le -> 400', async () => {
  const c = client();
  await c.call('POST', '/api/auth/register', { email: 'dup@example.com', password: pw });
  assert.equal((await client().call('POST', '/api/auth/register', { email: 'DUP@example.com', password: pw })).status, 409);
  assert.equal((await client().call('POST', '/api/auth/register', { email: 'khong-phai-email', password: pw })).body.error, 'INVALID_EMAIL');
  assert.equal((await client().call('POST', '/api/auth/register', { email: 'a@b.co', password: 'ngan' })).body.error, 'PASSWORD_TOO_SHORT');
  assert.equal((await client().call('POST', '/api/auth/register', { email: 'a@b.co', password: 'x'.repeat(129) })).body.error, 'PASSWORD_TOO_LONG');
});

test('dang nhap sai: cung thong bao cho email la va sai mat khau', async () => {
  await client().call('POST', '/api/auth/register', { email: 'sai@example.com', password: pw });
  const a = await client().call('POST', '/api/auth/login', { email: 'sai@example.com', password: 'sai-mat-khau-1' });
  const b = await client().call('POST', '/api/auth/login', { email: 'khong-co@example.com', password: pw });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(a.body, b.body);
  assert.equal(a.setCookie, undefined);
});

test('dang nhap -> /me -> dang xuat -> /me 401, session bi xoa khoi DB', async () => {
  await client().call('POST', '/api/auth/register', { email: 'flow@example.com', password: pw });
  const c = client();
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'FLOW@example.com', password: pw })).status, 200);
  assert.equal((await c.call('GET', '/api/auth/me')).status, 200);
  const token = c.sid;
  assert.equal((await c.call('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await c.call('GET', '/api/auth/me')).status, 401);
  // dung lai token cu sau logout phai that bai
  const r = await fetch(base + '/api/auth/me', { headers: { cookie: `sid=${token}` } });
  assert.equal(r.status, 401);
});

test('chua dang nhap / cookie gia / session het han -> 401', async () => {
  assert.equal((await client().call('GET', '/api/auth/me')).status, 401);
  const fake = await fetch(base + '/api/auth/me', { headers: { cookie: 'sid=abcdef' } });
  assert.equal(fake.status, 401);
  const c = client();
  await c.call('POST', '/api/auth/register', { email: 'het-han@example.com', password: pw });
  await pool.query("update sessions set expires_at = now() - interval '1 minute'");
  assert.equal((await c.call('GET', '/api/auth/me')).status, 401);
});

test('gioi han dang nhap sai: sau 10 lan thi chan, ke ca khi dung mat khau', async () => {
  await client().call('POST', '/api/auth/register', { email: 'brute@example.com', password: pw });
  for (let i = 0; i < 10; i++) {
    assert.equal((await client().call('POST', '/api/auth/login', { email: 'brute@example.com', password: 'sai-mat-khau-' + i })).status, 401);
  }
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'brute@example.com', password: pw })).status, 429);
});

test('CSRF: Origin la bi 403, Origin cho phep thi qua, khong phai JSON thi 415', async () => {
  const evil = await client().call('POST', '/api/auth/register', { email: 'evil@example.com', password: pw }, { origin: 'http://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal((await pool.query("select 1 from users where email = 'evil@example.com'")).rowCount, 0);
  const ok = await client().call('POST', '/api/auth/register', { email: 'good@example.com', password: pw }, { origin: 'http://localhost:5173' });
  assert.equal(ok.status, 201);
  const form = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  assert.equal(form.status, 415);
});

test('JSON hong / qua lon khong lam server sap va khong lo stack', async () => {
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'BAD_JSON' });
  const big = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(20000) }) });
  assert.equal(big.status, 413);
});
