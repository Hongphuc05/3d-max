// Dang nhap admin (D28.5: khong con dang ky khach; admin tao bang scripts/create-admin.js).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { isolatedTestDatabase } from './test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
let server, base, pool, dispose;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('auth_admin');
  ({ pool } = await import('./db.js'));
  await (await import('./db.js')).migrate();
  const { authRouter } = await import('./auth.js');
  const { errorHandler } = await import('./security.js');
  const app = express(); app.use(express.json()); app.use('/api/auth', authRouter); app.use(errorHandler);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(r => server.close(r)); if (dispose) await dispose(pool); });
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('create-admin.js is idempotent; the admin logs in by username, customer register is gone', { skip: !configured }, async () => {
  const run = pw => execFileSync(process.execPath, ['scripts/create-admin.js', 'Owner.1', pw], { env: process.env, cwd: new URL('..', import.meta.url) });
  run('first-password'); run('second-password');
  assert.equal((await pool.query("select count(*)::int n from users where role='ADMIN'")).rows[0].n, 1);
  assert.equal((await post('/api/auth/login', { email: 'owner.1', password: 'first-password' })).status, 401, 'old password replaced');
  const ok = await post('/api/auth/login', { email: 'owner.1', password: 'second-password' });
  assert.equal(ok.status, 200);
  const user = (await ok.json()).user;
  assert.equal(user.role, 'ADMIN'); assert.equal(user.mustChangeCredentials, false);
  assert.match(ok.headers.get('set-cookie'), /^sid=/);
  assert.equal((await post('/api/auth/register', { email: 'a@b.co', password: 'password123' })).status, 404);
});
