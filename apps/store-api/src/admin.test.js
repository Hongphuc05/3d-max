import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isolatedTestDatabase } from './test-database.js';

const dispose = await isolatedTestDatabase('admin_http');
const dbTest = (name, fn) => test(name, { skip: !dispose }, fn);
let pool, migrate, server, base;
let username = 'test_admin', password = randomBytes(32).toString('base64url'), migratedAdminCount = -1;
before(async () => {
  if (!dispose) return;
  process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
  process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.LICENSE_ADMIN_USER_IDS = '';
  process.env.CATALOG_PROVIDER = 'r2';
  process.env.R2_READ_ACCESS_KEY_ID = '';
  process.env.R2_READ_SECRET_ACCESS_KEY = '';
  process.env.PAYOS_CLIENT_ID = '';
  ({ pool, migrate } = await import('./db.js'));
  // Simulate upgrading an installation whose customer registered the old
  // proposed bootstrap email before the administrator feature existed.
  await pool.query(readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));
  await pool.query(`create table schema_migrations (name text primary key,applied_at timestamptz not null default now());
    insert into schema_migrations(name) values ('001_init.sql')`);
  await pool.query("insert into users(email,password_hash) values ('3dsmood_admin@admin.invalid','existing-customer-hash')");
  await migrate();
  migratedAdminCount = Number((await pool.query("select count(*) from users where role='ADMIN'")).rows[0].count);
  const { hashPassword } = await import('./auth.js');
  await pool.query(`insert into users(email,password_hash,role,username,must_change_credentials)
    values($1,$2,'ADMIN',$3,true)`, [`${randomUUID()}@admin.invalid`, await hashPassword(password), username]);
  const { app } = await import('./server.js');
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (dispose) await dispose(pool);
});

function client() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async call(method, path, body, headers = {}) {
      const response = await fetch(base + '/api' + path, { method,
        headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const session = response.headers.getSetCookie().find(value => value.startsWith('sid='));
      if (session) cookie = session.split(';')[0];
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}
async function admin() {
  const c = client();
  assert.equal((await c.call('POST', '/auth/login', { email: username, password })).status, 200);
  return c;
}
async function customer() {
  const c = client(), email = `${randomUUID()}@test.invalid`;
  const result = await c.call('POST', '/auth/register', { email, password: 'customer-password', role: 'ADMIN', username });
  assert.equal(result.status, 201);
  assert.equal(result.body.user.role, undefined);
  return { c, user: result.body.user };
}

dbTest('migrations create no public admin; an explicitly provisioned admin must replace its temporary password', async () => {
  assert.equal(migratedAdminCount, 0, 'migrations must not ship a shared administrator credential');
  const c = client();
  const result = await c.call('POST', '/auth/login', { email: ` ${username.toUpperCase()} `, password });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.role, 'ADMIN');
  assert.equal(result.body.user.username, username);
  assert.equal(result.body.user.mustChangeCredentials, true);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(result.body).includes('password'), false);
  const row = (await pool.query('select password_hash from users where username=$1', [username])).rows[0];
  assert.match(row.password_hash, /^scrypt\$/);
  assert.equal(row.password_hash.includes(password), false);
  const existing = (await pool.query("select role,password_hash from users where email='3dsmood_admin@admin.invalid'")).rows[0];
  assert.deepEqual(existing, { role: 'USER', password_hash: 'existing-customer-hash' });
  assert.equal((await c.call('GET', '/auth/me')).body.user.role, 'ADMIN');
  assert.equal((await c.call('GET', '/admin/overview')).body.error, 'ADMIN_CREDENTIALS_CHANGE_REQUIRED');
  assert.equal((await c.call('POST', '/admin/licenses/issue', { userId: randomUUID() })).body.error, 'ADMIN_CREDENTIALS_CHANGE_REQUIRED');
  assert.equal((await c.call('GET', '/admin/catalog/sync/permission')).body.allowed, false);
});

dbTest('migration 013 disables the old shared bootstrap admin and revokes its sessions', async () => {
  const { hashPassword } = await import('./auth.js');
  const email = `admin-${randomUUID()}@admin.invalid`;
  const legacy = (await pool.query(`insert into users(email,password_hash,role,username,must_change_credentials)
    values($1,$2,'ADMIN','renamed_bootstrap',true) returning id`,
  [email, await hashPassword(randomBytes(24).toString('base64url'))])).rows[0];
  const sessionId = randomBytes(32);
  await pool.query("insert into sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [sessionId, legacy.id]);
  await pool.query(readFileSync(new URL('../migrations/013_remove_public_admin_bootstrap.sql', import.meta.url), 'utf8'));
  const row = (await pool.query('select role,username,must_change_credentials from users where id=$1', [legacy.id])).rows[0];
  assert.deepEqual(row, { role: 'USER', username: null, must_change_credentials: false });
  assert.equal((await pool.query('select 1 from sessions where user_id=$1', [legacy.id])).rowCount, 0);
});

dbTest('anonymous and ordinary users cannot read or mutate admin data or self-assign admin', async () => {
  const anon = client(), { c } = await customer();
  for (const path of ['/admin/overview', '/admin/users', '/admin/orders', '/admin/audit']) {
    assert.equal((await anon.call('GET', path)).status, 401);
    assert.equal((await c.call('GET', path)).status, 403);
  }
  assert.equal((await c.call('PATCH', '/admin/account', { username: 'hijacked', currentPassword: 'customer-password' })).status, 403);
  assert.equal((await c.call('POST', '/admin/licenses/issue', { userId: randomUUID() })).status, 403);
});

dbTest('admin account changes require current password, valid input and a replacement for the temporary password', async () => {
  const c = await admin();
  for (const [body, code] of [
    [{ username: 'new_admin', currentPassword: 'wrong-password', newPassword: 'replacement-pass' }, 'INVALID_CURRENT_PASSWORD'],
    [{ username: 'bad name', currentPassword: password, newPassword: 'replacement-pass' }, 'INVALID_USERNAME'],
    [{ username, currentPassword: password, newPassword: 'short' }, 'PASSWORD_TOO_SHORT'],
    [{ username, currentPassword: password }, 'PASSWORD_CHANGE_REQUIRED'],
    [{ username, currentPassword: password, newPassword: password }, 'PASSWORD_CHANGE_REQUIRED'],
    [{ username, currentPassword: password, newPassword: 'replacement-pass', role: 'USER' }, 'INVALID_REQUEST'],
  ]) {
    assert.equal((await c.call('PATCH', '/admin/account', body)).body.error, code);
  }
  assert.equal((await c.call('PATCH', '/admin/account', { username, currentPassword: password, newPassword: 'replacement-pass' },
    { origin: 'https://evil.invalid' })).status, 403);
});

dbTest('changing admin username/password rotates all sessions and never recreates default credentials', async () => {
  const c = await admin(), other = await admin(), oldCookie = c.cookie;
  const changed = await c.call('PATCH', '/admin/account', {
    username: 'mood_owner', currentPassword: password, newPassword: 'new-admin-password',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.username, 'mood_owner');
  assert.equal(changed.body.user.mustChangeCredentials, false);
  assert.notEqual(c.cookie, oldCookie);
  assert.equal((await c.call('GET', '/auth/me')).status, 200);
  assert.equal((await other.call('GET', '/auth/me')).status, 401);
  assert.equal((await client().call('GET', '/auth/me', undefined, { cookie: oldCookie })).status, 401);
  assert.equal((await client().call('POST', '/auth/login', { email: username, password })).status, 401);
  username = 'mood_owner'; password = 'new-admin-password';
  await admin();
  assert.deepEqual(await migrate(), []);
  assert.equal(Number((await pool.query("select count(*) from users where role='ADMIN'")).rows[0].count), 1);
  assert.equal((await pool.query("select 1 from users where username='3dsmood_admin'")).rowCount, 0);
});

dbTest('administrator searches users and reviews license, device, payment and audit records without secrets', async () => {
  const c = await admin(), { user } = await customer();
  const issued = await c.call('POST', '/admin/licenses/issue', { userId: user.id });
  assert.equal(issued.status, 201);
  assert.equal(issued.body.license.status, 'ACTIVE');
  await pool.query(`insert into license_devices
    (license_id,slot_number,device_id,device_public_key,public_key_hash,device_name,key_protection)
    values ($1,1,$2,'fixture-public-key',$3,'Workstation','TPM')`, [issued.body.license.id, randomUUID(), randomBytes(32)]);
  await pool.query(`insert into orders (user_id,amount_vnd,status,paid_at,fulfillment_result)
    values ($1,2000,'PAID',now(),'ALREADY_LICENSED')`, [user.id]);
  const list = await c.call('GET', `/admin/users?q=${encodeURIComponent(user.email)}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].deviceCount, 1);
  assert.equal(list.body.items[0].license.status, 'ACTIVE');
  assert.equal((await c.call('GET', `/admin/users?q=${user.id}`)).body.total, 1);
  const detail = await c.call('GET', `/admin/users/${user.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.devices[0].deviceName, 'Workstation');
  assert.equal(detail.body.orders[0].amountVnd, 2000);
  assert.ok(detail.body.audit.some(row => row.eventType === 'ADMIN_LICENSE_ISSUE'));
  for (const secret of ['password_hash', 'key_ciphertext', 'device_public_key', 'public_key_hash', 'checkout_url', 'qr_code']) {
    assert.equal(JSON.stringify(detail.body).includes(secret), false, secret);
  }
  assert.equal(detail.body.license.key, undefined);
  const orders = await c.call('GET', `/admin/orders?status=PAID&q=${encodeURIComponent(user.email)}`);
  assert.equal(orders.body.total, 1);
  assert.equal(orders.body.items[0].email, user.email);
  const overview = await c.call('GET', '/admin/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.body.stats.activeLicenses >= 1);
  assert.equal(overview.body.stats.revenueVnd, 2000);
  assert.equal(overview.body.catalog.state, 'configuration_required');
  const suspended = await c.call('POST', '/admin/licenses/revoke', { userId: user.id, status: 'SUSPENDED', reason: 'Support review' });
  assert.equal(suspended.body.license.status, 'SUSPENDED');
  const resumed = await c.call('POST', '/admin/licenses/resume', { userId: user.id });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.license.status, 'ACTIVE');
  assert.equal((await c.call('POST', '/admin/licenses/resume', { userId: user.id })).body.error, 'LICENSE_NOT_SUSPENDED');
  const revoked = await c.call('POST', '/admin/licenses/revoke', { userId: user.id, status: 'REVOKED', reason: 'Owner request' });
  assert.equal(revoked.body.license.status, 'REVOKED');
  assert.equal((await c.call('POST', '/admin/licenses/resume', { userId: user.id })).body.error, 'LICENSE_REVOCATION_PERMANENT');
  const audit = await c.call('GET', '/admin/audit');
  assert.ok(audit.body.items.some(row => row.eventType === 'LICENSE_REVOKED' && row.targetEmail === user.email));
  assert.ok(audit.body.items.some(row => row.eventType === 'LICENSE_RESUMED' && row.targetEmail === user.email));
  assert.ok(audit.body.items.some(row => row.eventType === 'ADMIN_CREDENTIALS_CHANGED'));
  assert.equal((await c.call('GET', `/admin/users?q=${encodeURIComponent("' OR 1=1 --")}`)).body.total, 0);
});

dbTest('admin endpoints reject malformed pagination, filters, IDs and duplicate usernames', async () => {
  const c = await admin();
  for (const path of ['/admin/users?page=0', '/admin/users?page=abc', '/admin/orders?status=UNKNOWN',
    '/admin/audit?page=-1', '/admin/users?q=' + 'x'.repeat(255), '/admin/users/not-a-uuid']) {
    assert.equal((await c.call('GET', path)).status, 400, path);
  }
  assert.equal((await c.call('GET', `/admin/users/${randomUUID()}`)).status, 404);
  const { user } = await customer();
  await pool.query("update users set username='taken_admin',role='ADMIN' where id=$1", [user.id]);
  const result = await c.call('PATCH', '/admin/account', { username: 'taken_admin', currentPassword: password });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'USERNAME_TAKEN');
  assert.equal((await c.call('GET', '/auth/me')).body.user.username, username);
});

dbTest('admin can change just username and role is read from DB rather than the JWT', async () => {
  const c = await admin();
  const result = await c.call('PATCH', '/admin/account', { username: 'final_owner', currentPassword: password });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.username, 'final_owner');
  username = 'final_owner';
  await pool.query("update users set role='USER',username=null where id=$1", [result.body.user.id]);
  assert.equal((await c.call('GET', '/admin/overview')).status, 403);
});

dbTest('legacy allowlisted admin credential changes do not persist privileges after allowlist removal', async () => {
  const { c, user } = await customer();
  process.env.LICENSE_ADMIN_USER_IDS = user.id;
  try {
    assert.equal((await c.call('GET', '/admin/overview')).status, 200);
    const changed = await c.call('PATCH', '/admin/account', { username: 'legacy_owner', currentPassword: 'customer-password' });
    assert.equal(changed.status, 200);
    assert.equal((await pool.query('select role from users where id=$1', [user.id])).rows[0].role, 'USER');
    process.env.LICENSE_ADMIN_USER_IDS = '';
    assert.equal((await c.call('GET', '/admin/overview')).status, 403);
    assert.equal((await c.call('GET', '/auth/me')).body.user.role, undefined);
  } finally { process.env.LICENSE_ADMIN_USER_IDS = ''; }
});
