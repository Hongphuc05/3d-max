// P5.2/P5.6: don hang (tao, claim-paid, huy, doc), xac nhan/tu choi, het han. PostgreSQL that, thiet bi that (token), thong bao Telegram gia.
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { crc16, parseTlv } from './qr.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const MACHINE = `MAX-${'D4'.repeat(32)}`;
let dispose, pool, mod, base, servers = [], notifier, svc;

const sha = (b) => createHash('sha256').update(b).digest();
async function mkDevice(status = 'ACTIVE') {
  const id = (await pool.query(
    "insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name,status) values ($1,'{}',$2,'SOFTWARE',$3,'PC-Khach',$4) returning id",
    [randomUUID(), sha(randomUUID()), MACHINE, status])).rows[0].id;
  const token = randomBytes(32).toString('base64url');
  await pool.query("insert into device_tokens(id,device_id,expires_at) values ($1,$2, now() + interval '10 minutes')", [sha(token), id]);
  return { id, token };
}
const settings = (over = {}) => pool.query(
  `insert into app_settings(id,bank_name,bank_bin,account_no,account_name,order_ttl_minutes,max_pending_orders_per_device,library_price_vnd)
   values (1,$1,$2,$3,$4,$5,$6,$7) on conflict (id) do update set bank_name=$1,bank_bin=$2,account_no=$3,account_name=$4,order_ttl_minutes=$5,max_pending_orders_per_device=$6,library_price_vnd=$7`,
  [over.bank ?? 'Test Bank', over.bin ?? '970436', over.account ?? '0123456789012', over.holder ?? 'TEST ACCOUNT', over.ttl ?? 1440, over.max ?? 3, over.price ?? 35000]);
const H = (token) => (token ? { authorization: `Device ${token}` } : {});
const call = (path, { method = 'GET', body, token } = {}) => fetch(base + '/api/v1' + path,
  { method, headers: { 'content-type': 'application/json', ...H(token) }, body: body === undefined ? undefined : JSON.stringify(body) });
const create = (token, body = {}) => call('/orders', { method: 'POST', token, body });  // D28.1: don cua ca thu vien, khong co danh sach model
const code = async (r) => (await r.json()).error?.code;
const row = async (id) => (await pool.query('select * from purchase_orders where id=$1', [id])).rows[0];
const rights = async (deviceId) => (await pool.query('select source, order_id from entitlements where device_id=$1 and revoked_at is null', [deviceId])).rows;
const audits = async (action) => (await pool.query('select * from audit_events where action=$1 order by created_at', [action])).rows;
async function placed(over = {}) {
  const dev = over.dev ?? await mkDevice();
  const r = await create(dev.token);
  assert.equal(r.status, 201, 'order creation should succeed');
  return { dev, order: await r.json() };
}
async function claimed(over = {}) {
  const x = await placed(over);
  assert.equal((await call(`/orders/${x.order.orderId}/claim-paid`, { method: 'POST', token: x.dev.token })).status, 200);
  return x;
}
async function start(opts = {}) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/v1', mod.createOrderRouter({ pool, service: svc, notifier, ...(opts.router ?? {}) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('orders_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  mod = await import('./routes.js');
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  for (const t of ['entitlements', 'purchase_orders', 'device_tokens', 'devices', 'audit_events', 'app_settings']) await pool.query(`delete from ${t}`);
  await settings();
  notifier = { claimed: [], decided: [], fail: false, async orderClaimed(summary) { if (this.fail) throw new Error('telegram down'); this.claimed.push(summary); } };
  svc = (await import('./service.js')).createOrderService({ pool });
  base = await start();
});
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); } });

test('create: price is the library price from the database (client prices are ignored), contract shape, bank snapshot stored, QR is valid and carries the code', { skip }, async () => {
  const dev = await mkDevice();
  const r = await create(dev.token, { amountVnd: 1, items: [{ modelId: randomUUID(), priceVnd: 1 }] });
  assert.equal(r.status, 201);
  const o = await r.json();
  assert.deepEqual(Object.keys(o).sort(), ['amountVnd', 'code', 'expiresAt', 'orderId', 'payment', 'status']);
  assert.equal(o.amountVnd, 35000); assert.equal(o.status, 'PENDING_PAYMENT');
  assert.match(o.code, /^3DM[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual(Object.keys(o.payment).sort(), ['accountName', 'accountNo', 'bankName', 'qrPayload', 'transferContent']);
  assert.deepEqual([o.payment.bankName, o.payment.accountNo, o.payment.accountName, o.payment.transferContent], ['Test Bank', '0123456789012', 'TEST ACCOUNT', o.code]);
  const ms = new Date(o.expiresAt) - Date.now();
  assert.ok(ms > 1439 * 60_000 && ms <= 1440 * 60_000, `ttl ${ms}`);
  const qr = o.payment.qrPayload;
  assert.equal(crc16(qr.slice(0, -4)), qr.slice(-4));
  assert.equal(parseTlv(qr).find((t) => t.tag === '54').value, '35000');
  assert.equal(parseTlv(parseTlv(qr).find((t) => t.tag === '62').value)[0].value, o.code);
  const db = await row(o.orderId);
  assert.equal(db.amount_vnd, 35000); assert.equal(db.device_id, dev.id);
  assert.deepEqual(db.bank_snapshot, { bankName: 'Test Bank', bankBin: '970436', accountNo: '0123456789012', accountName: 'TEST ACCOUNT' });
  await settings({ price: 99000 });
  assert.equal((await (await create((await mkDevice()).token)).json()).amountVnd, 99000, 'admin price change applies to new orders');
  assert.equal((await row(o.orderId)).amount_vnd, 35000, 'existing order keeps its price');
});

test('the order keeps the bank details of the moment it was created even if admin changes settings afterwards', { skip }, async () => {
  const { order } = await placed();
  await settings({ bank: 'Other Bank', account: '999999999999', holder: 'SOMEONE ELSE' });
  const db = await row(order.orderId);
  assert.equal(db.bank_snapshot.accountNo, '0123456789012');
});

test('create: a zero library price cannot be ordered; malformed JSON is refused', { skip }, async () => {
  const dev = await mkDevice();
  await settings({ price: 0 });
  const r = await create(dev.token);
  assert.equal(r.status, 503); assert.equal(await code(r), 'PAYMENT_NOT_CONFIGURED');
  const raw = await fetch(base + '/api/v1/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...H(dev.token) }, body: '{bad' });
  assert.ok(raw.status >= 400 && raw.status < 500);
  assert.equal((await pool.query('select count(*)::int n from purchase_orders')).rows[0].n, 0);
});

test('create: payment not configured (no settings row, or any bank field missing) -> 503; nothing is stored', { skip }, async () => {
  const dev = await mkDevice();
  for (const missing of ['bank_name', 'bank_bin', 'account_no', 'account_name']) {
    await pool.query(`update app_settings set ${missing} = null`);
    const r = await create(dev.token);
    assert.equal(r.status, 503, missing); assert.equal(await code(r), 'PAYMENT_NOT_CONFIGURED', missing);
    await settings();
  }
  await pool.query('delete from app_settings');
  assert.equal(await code(await create(dev.token)), 'PAYMENT_NOT_CONFIGURED');
  assert.equal((await pool.query('select count(*)::int n from purchase_orders')).rows[0].n, 0);
});

test('create: a device that already holds the library license gets ALREADY_ENTITLED; after revoke it can buy again', { skip }, async () => {
  const dev = await mkDevice();
  await pool.query("insert into entitlements(device_id,source) values ($1,'ADMIN')", [dev.id]);
  const r = await create(dev.token);
  assert.equal(r.status, 409); assert.equal(await code(r), 'ALREADY_ENTITLED');
  assert.equal((await pool.query('select count(*)::int n from purchase_orders')).rows[0].n, 0);
  await pool.query('update entitlements set revoked_at = now() where device_id = $1', [dev.id]);
  assert.equal((await create(dev.token)).status, 201, 'a revoked license can be bought again');
});

test('create: pending-order limit per device (from settings); expired and decided orders do not count; other devices unaffected', { skip }, async () => {
  await settings({ max: 2 });
  const dev = await mkDevice(), other = await mkDevice();
  assert.equal((await create(dev.token)).status, 201);
  const second = await create(dev.token); assert.equal(second.status, 201);
  const third = await create(dev.token);
  assert.equal(third.status, 429); assert.equal(await code(third), 'TOO_MANY_PENDING_ORDERS');
  assert.equal((await create(other.token)).status, 201);
  const first = (await pool.query('select id from purchase_orders where device_id=$1 order by created_at limit 1', [dev.id])).rows[0].id;
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [first]);
  assert.equal((await create(dev.token)).status, 201, 'an order past its expiry no longer counts');
  const open = (await pool.query("select id from purchase_orders where device_id=$1 and expires_at > now()", [dev.id])).rows;
  assert.equal(open.length, 2);
  await pool.query("update purchase_orders set status='CANCELLED' where id=$1", [open[0].id]);
  assert.equal((await create(dev.token)).status, 201, 'a cancelled order no longer counts');
});

test('create: parallel requests from one device cannot exceed the pending limit', { skip }, async () => {
  await settings({ max: 2 });
  const dev = await mkDevice();
  const statuses = (await Promise.all(Array.from({ length: 8 }, () => create(dev.token)))).map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 2, statuses.join(','));
});

test('every endpoint needs a live device token (blocked device too); order ids are per device', { skip }, async () => {
  const x = await placed(), blocked = await mkDevice('BLOCKED');
  for (const token of [undefined, 'A'.repeat(43), blocked.token]) {
    for (const [path, method] of [['/orders', 'POST'], [`/orders/${x.order.orderId}`, 'GET'], [`/orders/${x.order.orderId}/claim-paid`, 'POST'], [`/orders/${x.order.orderId}/cancel`, 'POST']]) {
      const r = await call(path, { method, token, body: method === 'POST' && path === '/orders' ? {} : undefined });
      assert.equal(r.status, 401, `${method} ${path}`); assert.equal(await code(r), 'UNAUTHENTICATED');
    }
  }
  const stranger = await mkDevice();
  for (const [path, method] of [[`/orders/${x.order.orderId}`, 'GET'], [`/orders/${x.order.orderId}/claim-paid`, 'POST'], [`/orders/${x.order.orderId}/cancel`, 'POST'], ['/orders/not-a-uuid', 'GET'], [`/orders/${randomUUID()}`, 'GET']]) {
    const r = await call(path, { method, token: stranger.token });
    assert.equal(r.status, 404, `${method} ${path}`); assert.equal(await code(r), 'ORDER_NOT_FOUND');
  }
  assert.equal((await row(x.order.orderId)).status, 'PENDING_PAYMENT', 'a stranger changed nothing');
});

test('claim-paid: PENDING_PAYMENT -> AWAITING_OWNER once; the owner is told with a summary (no bank data); a failing notifier does not fail the claim', { skip }, async () => {
  const x = await placed();
  const r = await call(`/orders/${x.order.orderId}/claim-paid`, { method: 'POST', token: x.dev.token });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'AWAITING_OWNER' });
  const db = await row(x.order.orderId);
  assert.equal(db.status, 'AWAITING_OWNER'); assert.ok(db.claimed_paid_at);
  assert.equal(notifier.claimed.length, 1);
  const s = notifier.claimed[0];
  assert.deepEqual([s.orderId, s.code, s.amountVnd, s.deviceName, s.models], [x.order.orderId, x.order.code, 35000, 'PC-Khach', undefined]);
  assert.equal(JSON.stringify(s).includes('0123456789012'), false, 'no account number in the owner notification');
  const again = await call(`/orders/${x.order.orderId}/claim-paid`, { method: 'POST', token: x.dev.token });
  assert.equal(again.status, 409); assert.equal(await code(again), 'ORDER_STATE_INVALID');
  assert.equal(notifier.claimed.length, 1, 'the owner is not pinged twice');
  notifier.fail = true;
  const y = await placed();
  const r2 = await call(`/orders/${y.order.orderId}/claim-paid`, { method: 'POST', token: y.dev.token });
  assert.equal(r2.status, 200, 'Telegram being down must not block the customer');
  assert.equal((await row(y.order.orderId)).status, 'AWAITING_OWNER');
  assert.equal((await audits('OWNER_NOTIFY_FAILED')).length, 1, 'the failure is recorded for the operator');
});

test('claim-paid is refused after expiry, cancel, or when already decided; cancel works only before the claim', { skip }, async () => {
  const exp = await placed();
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [exp.order.orderId]);
  assert.equal(await code(await call(`/orders/${exp.order.orderId}/claim-paid`, { method: 'POST', token: exp.dev.token })), 'ORDER_STATE_INVALID');
  const c = await placed();
  const cancel = await call(`/orders/${c.order.orderId}/cancel`, { method: 'POST', token: c.dev.token });
  assert.equal(cancel.status, 200); assert.deepEqual(await cancel.json(), { status: 'CANCELLED' });
  assert.equal(await code(await call(`/orders/${c.order.orderId}/claim-paid`, { method: 'POST', token: c.dev.token })), 'ORDER_STATE_INVALID');
  assert.equal(await code(await call(`/orders/${c.order.orderId}/cancel`, { method: 'POST', token: c.dev.token })), 'ORDER_STATE_INVALID', 'cancelling twice');
  const k = await claimed();
  assert.equal(await code(await call(`/orders/${k.order.orderId}/cancel`, { method: 'POST', token: k.dev.token })), 'ORDER_STATE_INVALID', 'a claimed order cannot be cancelled by the customer');
  assert.equal((await row(k.order.orderId)).status, 'AWAITING_OWNER');
});

test('get: contract shape; a pending order past its expiry reads as EXPIRED immediately (before the sweeper runs)', { skip }, async () => {
  const x = await placed();
  let r = await call(`/orders/${x.order.orderId}`, { token: x.dev.token });
  assert.equal(r.status, 200);
  const o = await r.json();
  assert.deepEqual(Object.keys(o).sort(), ['amountVnd', 'code', 'decidedAt', 'expiresAt', 'orderId', 'status']);
  assert.deepEqual([o.orderId, o.code, o.amountVnd, o.status, o.decidedAt], [x.order.orderId, x.order.code, 35000, 'PENDING_PAYMENT', null]);
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [x.order.orderId]);
  r = await call(`/orders/${x.order.orderId}`, { token: x.dev.token });
  assert.equal((await r.json()).status, 'EXPIRED');
});

test('confirm: AWAITING_OWNER -> CONFIRMED and one library license (source ORDER, linked to the order) in one step, audited; the device sees it', { skip }, async () => {
  const x = await claimed();
  const out = await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '777' });
  assert.equal(out.outcome, 'CONFIRMED');
  const db = await row(x.order.orderId);
  assert.equal(db.status, 'CONFIRMED'); assert.ok(db.decided_at); assert.equal(db.decided_by_telegram_user, '777');
  const granted = await rights(x.dev.id);
  assert.equal(granted.length, 1);
  assert.ok(granted.every((g) => g.source === 'ORDER' && g.order_id === x.order.orderId));
  const [a] = await audits('ORDER_CONFIRMED');
  assert.deepEqual([a.actor_kind, a.actor_ref, a.target_id], ['TELEGRAM_OWNER', '777', x.order.orderId]);
  assert.equal(JSON.stringify(a.details).includes('0123456789012'), false);
  const me = await (await fetch(base + '/api/v1/orders/' + x.order.orderId, { headers: H(x.dev.token) })).json();
  assert.equal(me.status, 'CONFIRMED'); assert.ok(me.decidedAt);
  assert.equal(await code(await create(x.dev.token)), 'ALREADY_ENTITLED', 'buying the library again is refused');
});

test('confirm twice, even in parallel: exactly one set of entitlements and one audit event', { skip }, async () => {
  const x = await claimed();
  const results = await Promise.all(Array.from({ length: 6 }, () => svc.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '1' })));
  assert.equal(results.filter((r) => r.outcome === 'CONFIRMED').length, 1);
  assert.ok(results.filter((r) => r.outcome !== 'CONFIRMED').every((r) => r.outcome === 'ALREADY_DECIDED' && r.order.status === 'CONFIRMED'));
  assert.equal((await rights(x.dev.id)).length, 1);
  assert.equal((await audits('ORDER_CONFIRMED')).length, 1);
});

test('confirm after the order expired STILL grants the license when the customer had claimed payment (owner decision); unknown orders are NOT_FOUND', { skip }, async () => {
  const x = await claimed();
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [x.order.orderId]);
  await svc.expireDue(); // sweeper ran: AWAITING_OWNER -> EXPIRED
  assert.equal((await row(x.order.orderId)).status, 'EXPIRED');
  const out = await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '1' });
  assert.equal(out.outcome, 'CONFIRMED');
  assert.equal((await rights(x.dev.id)).length, 1);
  assert.equal((await row(x.order.orderId)).status, 'CONFIRMED');
  const y = await claimed();   // expired but not yet swept: reject is possible too
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [y.order.orderId]);
  assert.equal((await svc.decide(y.order.orderId, 'REJECT', { kind: 'ADMIN', ref: 'a' })).outcome, 'REJECTED');
  const z = await placed();    // never claimed + expired: nothing to confirm
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [z.order.orderId]);
  await svc.expireDue();
  assert.equal((await svc.decide(z.order.orderId, 'CONFIRM', { kind: 'ADMIN', ref: 'a' })).outcome, 'ALREADY_DECIDED');
  assert.equal((await rights(z.dev.id)).length, 0);
  assert.equal((await svc.decide(randomUUID(), 'CONFIRM', { kind: 'ADMIN', ref: 'a' })).outcome, 'NOT_FOUND');
  assert.equal((await svc.decide('not-a-uuid', 'CONFIRM', { kind: 'ADMIN', ref: 'a' })).outcome, 'NOT_FOUND');
});

test('reject: AWAITING_OWNER -> REJECTED, no entitlements, audited; a decided order cannot be flipped either way', { skip }, async () => {
  const x = await claimed();
  const out = await svc.decide(x.order.orderId, 'REJECT', { kind: 'TELEGRAM_OWNER', ref: '9' });
  assert.equal(out.outcome, 'REJECTED');
  assert.equal((await row(x.order.orderId)).status, 'REJECTED'); assert.equal((await rights(x.dev.id)).length, 0);
  assert.equal((await audits('ORDER_REJECTED')).length, 1);
  assert.equal((await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '9' })).outcome, 'ALREADY_DECIDED');
  assert.equal((await rights(x.dev.id)).length, 0, 'a rejected order cannot be confirmed later');
  const y = await claimed();
  await svc.decide(y.order.orderId, 'CONFIRM', { kind: 'ADMIN', ref: 'a' });
  assert.equal((await svc.decide(y.order.orderId, 'REJECT', { kind: 'ADMIN', ref: 'a' })).outcome, 'ALREADY_DECIDED');
  assert.equal((await rights(y.dev.id)).length, 1, 'a confirmed order cannot be rejected afterwards');
});

test('nobody — Telegram or the web admin — may confirm an order the customer never marked as paid (plan P5.6)', { skip }, async () => {
  const x = await placed();
  assert.equal((await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '1' })).outcome, 'ALREADY_DECIDED', 'not awaiting the owner: refused for Telegram');
  assert.equal((await rights(x.dev.id)).length, 0);
  assert.equal((await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'ADMIN', ref: 'admin-1' })).outcome, 'ALREADY_DECIDED');
  assert.equal((await svc.decide(x.order.orderId, 'REJECT', { kind: 'ADMIN', ref: 'admin-1' })).outcome, 'ALREADY_DECIDED');
  assert.equal((await rights(x.dev.id)).length, 0); assert.equal((await audits('ORDER_CONFIRMED')).length, 0);
});

test('a database failure in the middle of confirming leaves no orphan entitlement and the order stays awaiting', { skip }, async () => {
  const x = await claimed();
  const flaky = {
    query: pool.query.bind(pool),
    connect: async () => {
      const c = await pool.connect();
      return { query: (sql, p) => (/insert into entitlements/.test(String(sql)) ? Promise.reject(new Error('db went away')) : c.query(sql, p)), release: () => c.release() };
    },
  };
  const broken = (await import('./service.js')).createOrderService({ pool: flaky });
  await assert.rejects(broken.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '1' }), /db went away/);
  assert.equal((await row(x.order.orderId)).status, 'AWAITING_OWNER');
  assert.equal((await rights(x.dev.id)).length, 0);
  assert.equal((await audits('ORDER_CONFIRMED')).length, 0);
  assert.equal((await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'TELEGRAM_OWNER', ref: '1' })).outcome, 'CONFIRMED', 'and the owner can simply press again');
});

test('confirm does not break when the device already holds a license by another route', { skip }, async () => {
  const x = await claimed();
  await pool.query("insert into entitlements(device_id,source) values ($1,'ADMIN')", [x.dev.id]);
  assert.equal((await svc.decide(x.order.orderId, 'CONFIRM', { kind: 'ADMIN', ref: 'a' })).outcome, 'CONFIRMED');
  assert.equal((await rights(x.dev.id)).length, 1);
});

test('expireDue: pending and awaiting orders past their expiry become EXPIRED (once), reporting their Telegram message ids; others are untouched', { skip }, async () => {
  const pend = await placed(), wait = await claimed(), live = await placed(), done = await claimed();
  await svc.decide(done.order.orderId, 'CONFIRM', { kind: 'ADMIN', ref: 'a' });
  await pool.query("update purchase_orders set telegram_chat_id=5, telegram_message_id=9 where id=$1", [wait.order.orderId]);
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id = any($1::uuid[])", [[pend.order.orderId, wait.order.orderId, done.order.orderId]]);
  const swept = await svc.expireDue();
  assert.deepEqual(swept.map((s) => s.id).sort(), [pend.order.orderId, wait.order.orderId].sort());
  assert.deepEqual(swept.find((s) => s.id === wait.order.orderId).telegramMessageId, '9');
  assert.equal((await row(pend.order.orderId)).status, 'EXPIRED'); assert.equal((await row(wait.order.orderId)).status, 'EXPIRED');
  assert.equal((await row(live.order.orderId)).status, 'PENDING_PAYMENT');
  assert.equal((await row(done.order.orderId)).status, 'CONFIRMED', 'a decided order never expires');
  assert.deepEqual(await svc.expireDue(), [], 'idempotent');
});

test('admin listing filters by status, newest first, and exposes only what the admin needs (no bank snapshot)', { skip }, async () => {
  const a = await claimed(), b = await placed();
  const all = await svc.listOrders({});
  assert.deepEqual(all.map((o) => o.orderId), [b.order.orderId, a.order.orderId]);
  assert.deepEqual((await svc.listOrders({ status: 'AWAITING_OWNER' })).map((o) => o.orderId), [a.order.orderId]);
  assert.deepEqual(Object.keys(all[0]).sort(), ['amountVnd', 'claimedPaidAt', 'code', 'createdAt', 'decidedAt', 'deviceId', 'deviceName', 'expiresAt', 'orderId', 'status']);
  assert.equal(JSON.stringify(all).includes('0123456789012'), false);
  await assert.rejects(svc.listOrders({ status: 'WHATEVER' }), (e) => e.code === 'INVALID_PARAMS');
});
