// P5 / plan §2.7: admin xu ly don tu web (phong khi Telegram loi hoac khach quen bam "da chuyen khoan"). requireAdmin that, xac thuc gia.
// Duong dan theo plan §2.7: /api/admin/orders (danh sach thanh toan payOS cu da doi sang /api/admin/legacy-orders).
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, svc, adminId, userId, base, servers = [], edits, mod;
const sha = (b) => createHash('sha256').update(b).digest();
const api = (path, { method = 'GET', user = 'admin' } = {}) => fetch(`${base}/api/admin${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: method === 'GET' ? undefined : '{}' });
const code = async (r) => (await r.json()).error?.code;
let n = 0;
async function order(status = 'AWAITING_OWNER') {
  const device = (await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'SOFTWARE',$3,'PC-A') returning id", [randomUUID(), sha(randomUUID()), `MAX-${'F6'.repeat(32)}`])).rows[0].id;
  const o = await svc.createOrder(device);
  if (status !== 'PENDING_PAYMENT') await pool.query('update purchase_orders set status=$2, claimed_paid_at=now() where id=$1', [o.orderId, status]);
  return { device, o };
}
const row = async (id) => (await pool.query('select * from purchase_orders where id=$1', [id])).rows[0];
const rights = async (device) => (await pool.query('select 1 from entitlements where device_id=$1 and revoked_at is null', [device])).rowCount;

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('orders_admin');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  for (const k of ['admin', 'user']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'admin') adminId = id; else userId = id;
  }
  svc = (await import('./service.js')).createOrderService({ pool });
  mod = await import('./admin-routes.js');
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  for (const t of ['entitlements', 'purchase_orders', 'devices', 'audit_events', 'app_settings']) await pool.query(`delete from ${t}`);
  await pool.query("insert into app_settings(id,bank_name,bank_bin,account_no,account_name) values (1,'Test Bank','970436','0123456789012','TEST ACCOUNT')");
  edits = [];
  const { requireAdmin } = await import('../admin/access.js');
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = { id: who === 'admin' ? adminId : userId, role: who === 'admin' ? 'ADMIN' : 'USER' }; next();
  };
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use('/api/admin', mod.createOrderAdminRouter({ service: svc, client: { async editMessageText(m) { edits.push(m); } }, guards: [fakeAuth, requireAdmin] }));
  app.use('/api/admin', (_req, res) => res.status(404).json({ legacy: 'next' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(server); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); } });

test('guards: anonymous 401 and an ordinary user 403 on every route; nothing changes', { skip }, async () => {
  const x = await order();
  for (const [path, method] of [['/orders', 'GET'], [`/orders/${x.o.orderId}/confirm`, 'POST'], [`/orders/${x.o.orderId}/reject`, 'POST']]) {
    assert.equal((await api(path, { method, user: null })).status, 401, `anon ${method} ${path}`);
    assert.equal((await api(path, { method, user: 'user' })).status, 403, `user ${method} ${path}`);
  }
  assert.equal((await row(x.o.orderId)).status, 'AWAITING_OWNER'); assert.equal(await rights(x.device), 0);
});

test('list: filter by status, newest first, no bank data; a bad filter is a 400', { skip }, async () => {
  const a = await order('AWAITING_OWNER'), b = await order('PENDING_PAYMENT');
  const r = await api('/orders');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.items.map((o) => o.orderId), [b.o.orderId, a.o.orderId]);
  assert.equal(JSON.stringify(body).includes('0123456789012'), false);
  assert.deepEqual((await (await api('/orders?status=AWAITING_OWNER')).json()).items.map((o) => o.orderId), [a.o.orderId]);
  const bad = await api('/orders?status=NOPE');
  assert.equal(bad.status, 400); assert.equal(await code(bad), 'INVALID_PARAMS');
});

test('confirm: grants the entitlement, audits the admin, edits the Telegram message if there is one', { skip }, async () => {
  const x = await order();
  await pool.query('update purchase_orders set telegram_chat_id=5, telegram_message_id=9 where id=$1', [x.o.orderId]);
  const r = await api(`/orders/${x.o.orderId}/confirm`, { method: 'POST' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'CONFIRMED' });
  assert.equal(await rights(x.device), 1);
  const a = (await pool.query("select actor_kind, actor_ref from audit_events where action='ORDER_CONFIRMED'")).rows;
  assert.deepEqual(a, [{ actor_kind: 'ADMIN', actor_ref: adminId }]);
  assert.equal(edits.length, 1); assert.deepEqual([edits[0].chatId, edits[0].messageId], ['5', '9']); assert.match(edits[0].text, /web/i);
  const again = await api(`/orders/${x.o.orderId}/confirm`, { method: 'POST' });
  assert.equal(again.status, 409); assert.equal(await code(again), 'ORDER_STATE_INVALID');
  assert.equal(await rights(x.device), 1); assert.equal(edits.length, 1);
});

test('the admin decides only orders the customer marked as paid (like Telegram); expired-but-claimed is still confirmable; reject works; never-claimed / decided / unknown are refused with the right codes', { skip }, async () => {
  const p = await order('PENDING_PAYMENT');
  const early = await api(`/orders/${p.o.orderId}/confirm`, { method: 'POST' });
  assert.equal(early.status, 409); assert.equal(await code(early), 'ORDER_STATE_INVALID'); assert.equal(await rights(p.device), 0, 'plan P5.6: only AWAITING_OWNER can be confirmed');
  const x = await order();
  const rej = await api(`/orders/${x.o.orderId}/reject`, { method: 'POST' });
  assert.equal(rej.status, 200); assert.deepEqual(await rej.json(), { status: 'REJECTED' }); assert.equal(await rights(x.device), 0);
  assert.equal(await code(await api(`/orders/${x.o.orderId}/confirm`, { method: 'POST' })), 'ORDER_STATE_INVALID');
  const late = await order();   // owner decision: a claimed order may be confirmed after it expired (money was really sent)
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [late.o.orderId]);
  await svc.expireDue();
  const r = await api(`/orders/${late.o.orderId}/confirm`, { method: 'POST' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'CONFIRMED' }); assert.equal(await rights(late.device), 1);
  const stale = await order('PENDING_PAYMENT');  // expired and never claimed: nothing to confirm
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [stale.o.orderId]);
  await svc.expireDue();
  assert.equal(await code(await api(`/orders/${stale.o.orderId}/confirm`, { method: 'POST' })), 'ORDER_STATE_INVALID'); assert.equal(await rights(stale.device), 0);
  for (const id of [randomUUID(), 'not-a-uuid']) {
    const u = await api(`/orders/${id}/confirm`, { method: 'POST' });
    assert.equal(u.status, 404); assert.equal(await code(u), 'ORDER_NOT_FOUND');
  }
});

test('other /api/admin paths still fall through to the next router (the legacy payOS list lives at /legacy-orders)', { skip }, async () => {
  assert.deepEqual(await (await api('/legacy-orders')).json(), { legacy: 'next' });
  assert.deepEqual(await (await api('/orders/x/unknown', { method: 'POST' })).json(), { legacy: 'next' });
});
