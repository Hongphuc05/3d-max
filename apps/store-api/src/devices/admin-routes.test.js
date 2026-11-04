// D28.2: admin danh sach thiet bi, thu hoi / chuyen license thu vien (1 license = 1 may). PostgreSQL that, admin that (requireAdmin).
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, adminId, userId, base, servers = [];
const sha = (b) => createHash('sha256').update(b).digest();
const api = (path, { method = 'GET', user = 'admin', body } = {}) => fetch(`${base}/api/admin${path}`, {
  method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
const code = async (r) => (await r.json()).error?.code;
const mkDevice = async (name = 'PC') => (await pool.query(
  "insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'SOFTWARE',$3,$4) returning id",
  [randomUUID(), sha(randomUUID()), `MAX-${'A7'.repeat(32)}`, name])).rows[0].id;
const license = (id, source = 'ORDER') => pool.query('insert into entitlements(device_id, source) values ($1,$2)', [id, source]);
const active = async (id) => (await pool.query('select source, granted_by from entitlements where device_id=$1 and revoked_at is null', [id])).rows;
const audits = async (action) => (await pool.query('select * from audit_events where action=$1', [action])).rows;

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('devices_admin');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  for (const k of ['admin', 'user']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'admin') adminId = id; else userId = id;
  }
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  for (const t of ['entitlements', 'devices', 'audit_events']) await pool.query(`delete from ${t}`);
  const { requireAdmin } = await import('../admin/access.js');
  const { createDeviceAdminRouter } = await import('./admin-routes.js');
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = { id: who === 'admin' ? adminId : userId, role: who === 'admin' ? 'ADMIN' : 'USER' }; next();
  };
  const app = express();
  app.use('/api/admin', createDeviceAdminRouter({ pool, guards: [fakeAuth, requireAdmin] }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(server); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); } });

test('guards: anonymous 401 and an ordinary user 403; nothing changes', { skip }, async () => {
  const a = await mkDevice(), b = await mkDevice(); await license(a);
  for (const [path, method, body] of [['/devices', 'GET'], [`/devices/${a}/license/revoke`, 'POST'], [`/devices/${a}/license/transfer`, 'POST', { toDeviceId: b }]]) {
    assert.equal((await api(path, { method, user: null, body })).status, 401, path);
    assert.equal((await api(path, { method, user: 'user', body })).status, 403, path);
  }
  assert.equal((await active(a)).length, 1); assert.equal((await active(b)).length, 0);
});

test('list: id, name, created, last seen and whether the device holds the library license', { skip }, async () => {
  const a = await mkDevice('PC-A'), b = await mkDevice('PC-B'); await license(a);
  const { items } = await (await api('/devices')).json();
  assert.deepEqual(Object.keys(items[0]).sort(), ['createdAt', 'hasLicense', 'id', 'lastSeenAt', 'name', 'status']);
  assert.equal(items.find((d) => d.id === a).hasLicense, true); assert.equal(items.find((d) => d.id === b).hasLicense, false);
  await pool.query('update entitlements set revoked_at = now()');
  assert.equal((await (await api('/devices')).json()).items.find((d) => d.id === a).hasLicense, false, 'a revoked license does not count');
});

test('revoke: ends the license, audits the admin; revoking again or a device without a license is refused', { skip }, async () => {
  const a = await mkDevice(), b = await mkDevice(); await license(a);
  const r = await api(`/devices/${a}/license/revoke`, { method: 'POST' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'REVOKED' });
  assert.equal((await active(a)).length, 0);
  const [e] = await audits('LICENSE_REVOKED');
  assert.deepEqual([e.actor_kind, e.actor_ref, e.target_type, e.target_id], ['ADMIN', adminId, 'device', a]);
  for (const id of [a, b]) assert.equal(await code(await api(`/devices/${id}/license/revoke`, { method: 'POST' })), 'LICENSE_NOT_FOUND');
  for (const id of [randomUUID(), 'not-a-uuid']) assert.equal(await code(await api(`/devices/${id}/license/revoke`, { method: 'POST' })), 'DEVICE_NOT_FOUND');
});

test('transfer: revokes on the old device, grants on the new one (still 1 license = 1 device), audits; bad targets change nothing', { skip }, async () => {
  const a = await mkDevice(), b = await mkDevice(), c = await mkDevice(); await license(a);
  const r = await api(`/devices/${a}/license/transfer`, { method: 'POST', body: { toDeviceId: b } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'TRANSFERRED' });
  assert.equal((await active(a)).length, 0);
  assert.deepEqual(await active(b), [{ source: 'ADMIN', granted_by: adminId }]);
  const [e] = await audits('LICENSE_TRANSFERRED');
  assert.deepEqual([e.actor_ref, e.target_id, e.details], [adminId, a, { toDeviceId: b }]);
  // A no longer has one; B -> A works back; B -> C when C already holds one is refused.
  assert.equal(await code(await api(`/devices/${a}/license/transfer`, { method: 'POST', body: { toDeviceId: c } })), 'LICENSE_NOT_FOUND');
  await license(c);
  const taken = await api(`/devices/${b}/license/transfer`, { method: 'POST', body: { toDeviceId: c } });
  assert.equal(taken.status, 409); assert.equal(await code(taken), 'ALREADY_ENTITLED');
  assert.equal((await active(b)).length, 1, 'refused transfer leaves the source license alone');
  assert.equal(await code(await api(`/devices/${b}/license/transfer`, { method: 'POST', body: { toDeviceId: randomUUID() } })), 'DEVICE_NOT_FOUND');
  for (const body of [{}, { toDeviceId: 'x' }, { toDeviceId: b }, { toDeviceId: 5 }])
    assert.equal(await code(await api(`/devices/${b}/license/transfer`, { method: 'POST', body })), 'INVALID_PARAMS', JSON.stringify(body));
  assert.equal((await audits('LICENSE_TRANSFERRED')).length, 1);
});

test('parallel transfers of one license to two devices: exactly one wins', { skip }, async () => {
  const a = await mkDevice(), b = await mkDevice(), c = await mkDevice(); await license(a);
  const rs = await Promise.all([b, c].map((to) => api(`/devices/${a}/license/transfer`, { method: 'POST', body: { toDeviceId: to } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await pool.query('select count(*)::int n from entitlements where revoked_at is null')).rows[0].n, 1);
});
