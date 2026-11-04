// P5.5/P5.6: webhook Telegram + sweeper het han. PostgreSQL that, service that, client Telegram gia.
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const SECRET = 'webhook_secret_ABCDEFGH-1234';
const PATH = 'hook_path_ABCDEFGHIJKLMNOP-12';
const OWNER = '111222333';
let dispose, pool, svc, base, servers = [], client, calls, mod, maintenance;

const sha = (b) => createHash('sha256').update(b).digest();
async function mkDevice() {
  return (await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'SOFTWARE',$3,'PC-Khach') returning id",
    [randomUUID(), sha(randomUUID()), `MAX-${'E5'.repeat(32)}`])).rows[0].id;
}
async function awaiting() {
  const device = await mkDevice();
  const order = await svc.createOrder(device);
  await pool.query("update purchase_orders set status='AWAITING_OWNER', claimed_paid_at=now() where id=$1", [order.orderId]);
  return { device, order };
}
const row = async (id) => (await pool.query('select * from purchase_orders where id=$1', [id])).rows[0];
const rights = async (device) => (await pool.query('select 1 from entitlements where device_id=$1 and revoked_at is null', [device])).rowCount;
const cb = (orderId, action, over = {}) => ({ update_id: 1, callback_query: { id: `cbq-${randomUUID()}`, from: { id: Number(OWNER) }, message: { message_id: 55, chat: { id: Number(OWNER) }, text: 'Đơn mới chờ xác nhận\nMã đơn: X' },
  data: `o:${orderId}:${action}`, ...over } });
const hook = (update, { path = PATH, secret = SECRET } = {}) => fetch(`${base}/api/telegram/webhook/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) }, body: JSON.stringify(update) });

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('telegram_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  svc = (await import('../orders/service.js')).createOrderService({ pool });
  mod = await import('./routes.js'); maintenance = await import('../orders/maintenance.js');
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  for (const t of ['entitlements', 'purchase_orders', 'device_tokens', 'devices', 'audit_events', 'app_settings']) await pool.query(`delete from ${t}`);
  await pool.query("insert into app_settings(id,bank_name,bank_bin,account_no,account_name) values (1,'Test Bank','970436','0123456789012','TEST ACCOUNT')");
  calls = []; client = { fail: false };
  for (const m of ['answerCallbackQuery', 'editMessageText']) client[m] = async (...args) => { calls.push([m, ...args]); if (client.fail) throw new Error('telegram down'); };
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/telegram', mod.createTelegramRouter({ config: { webhookPath: PATH, webhookSecret: SECRET, ownerChatIds: [OWNER, '999'] }, client, service: svc }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(server); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); } });

test('wrong path -> 404, missing or wrong secret header -> 401; neither changes anything or calls Telegram', { skip }, async () => {
  const x = await awaiting();
  assert.equal((await hook(cb(x.order.orderId, 'ok'), { path: 'wrong_path_ABCDEFGHIJKLMNOP' })).status, 404);
  for (const secret of [null, '', 'wrong', SECRET + 'x', SECRET.slice(0, -1)]) {
    const r = await hook(cb(x.order.orderId, 'ok'), { secret });
    assert.equal(r.status, 401, `secret=${secret}`);
    assert.equal((await r.json()).error.code, 'UNAUTHENTICATED');
  }
  assert.equal((await row(x.order.orderId)).status, 'AWAITING_OWNER'); assert.equal(await rights(x.device), 0); assert.equal(calls.length, 0);
  assert.equal((await hook({})).status, 200, 'the right secret gets 200 even for an update we ignore');
});

test('owner presses ✅: order CONFIRMED, entitlement granted, audited with the Telegram user, callback answered and the message edited (keyboard removed)', { skip }, async () => {
  const x = await awaiting();
  const update = cb(x.order.orderId, 'ok');
  const r = await hook(update);
  assert.equal(r.status, 200);
  const db = await row(x.order.orderId);
  assert.equal(db.status, 'CONFIRMED'); assert.equal(db.decided_by_telegram_user, OWNER); assert.equal(await rights(x.device), 1);
  const [answer, edit] = [calls.find((c) => c[0] === 'answerCallbackQuery'), calls.find((c) => c[0] === 'editMessageText')];
  assert.equal(answer[1], update.callback_query.id); assert.match(answer[2], /xác nhận/i);
  assert.deepEqual([edit[1].chatId, edit[1].messageId], [OWNER, '55']);
  assert.match(edit[1].text, /✅/); assert.match(edit[1].text, /Đơn mới chờ xác nhận/, 'the original text stays, the decision is appended');
  const a = (await pool.query("select actor_kind, actor_ref from audit_events where action='ORDER_CONFIRMED'")).rows;
  assert.deepEqual(a, [{ actor_kind: 'TELEGRAM_OWNER', actor_ref: OWNER }]);
});

test('owner presses ❌: REJECTED, nothing granted', { skip }, async () => {
  const x = await awaiting();
  assert.equal((await hook(cb(x.order.orderId, 'no'))).status, 200);
  assert.equal((await row(x.order.orderId)).status, 'REJECTED'); assert.equal(await rights(x.device), 0);
  assert.match(calls.find((c) => c[0] === 'editMessageText')[1].text, /❌/);
});

test('two presses at once (or Telegram retrying the same update) grant exactly once; the loser is told it was already handled', { skip }, async () => {
  const x = await awaiting();
  const same = cb(x.order.orderId, 'ok');
  const results = await Promise.all([hook(same), hook(same), hook(cb(x.order.orderId, 'ok')), hook(cb(x.order.orderId, 'ok'))]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(await rights(x.device), 1);
  assert.equal((await pool.query("select count(*)::int n from audit_events where action='ORDER_CONFIRMED'")).rows[0].n, 1);
  const texts = calls.filter((c) => c[0] === 'answerCallbackQuery').map((c) => c[2]);
  assert.equal(texts.filter((t) => t.startsWith("Đã xác nhận")).length, 1, "exactly one press wins");
  assert.ok(texts.some((t) => /đã được xử lý/i.test(t)));
});

test('✅ after the order expired still grants the library license (the customer had claimed payment) and edits the message', { skip }, async () => {
  const x = await awaiting();
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id=$1", [x.order.orderId]);
  assert.equal((await hook(cb(x.order.orderId, 'ok'))).status, 200);
  assert.equal(await rights(x.device), 1); assert.equal((await row(x.order.orderId)).status, 'CONFIRMED');
  assert.match(calls.find((c) => c[0] === 'editMessageText')[1].text, /ĐÃ XÁC NHẬN/);
});

test('anyone who is not an owner is ignored silently: no state change, no answer, no edit (also: owner user in a foreign chat)', { skip }, async () => {
  const x = await awaiting();
  const stranger = cb(x.order.orderId, 'ok', {}); stranger.callback_query.from = { id: 5555 }; stranger.callback_query.message.chat = { id: 5555 };
  const wrongChat = cb(x.order.orderId, 'ok'); wrongChat.callback_query.message.chat = { id: 424242 };
  const wrongUser = cb(x.order.orderId, 'ok'); wrongUser.callback_query.from = { id: 5555 };
  for (const u of [stranger, wrongChat, wrongUser]) assert.equal((await hook(u)).status, 200);
  assert.equal((await row(x.order.orderId)).status, 'AWAITING_OWNER'); assert.equal(await rights(x.device), 0); assert.equal(calls.length, 0);
});

test('malformed callback data and non-callback updates change nothing (always 200 once the secret is right)', { skip }, async () => {
  const x = await awaiting(); const id = x.order.orderId;
  const weird = [`o:${id}:maybe`, `x:${id}:ok`, `o:${id}`, `o:not-a-uuid:ok`, `o:${id}:ok:extra`, 'o:' + 'a'.repeat(200), '', null, 5, { a: 1 }];
  for (const data of weird) assert.equal((await hook(cb(id, 'ok', { data }))).status, 200, JSON.stringify(data));
  for (const update of [{}, { message: { text: '/start', chat: { id: Number(OWNER) } } }, { edited_message: {} }, { callback_query: null }, { callback_query: { id: 1 } },
    { callback_query: { id: 'x', from: { id: 'abc' }, message: { chat: { id: 1 } }, data: `o:${id}:ok` } }, { callback_query: { id: 'x', from: { id: Number(OWNER) }, data: `o:${id}:ok` } }]) {
    assert.equal((await hook(update)).status, 200, JSON.stringify(update));
  }
  assert.equal((await row(id)).status, 'AWAITING_OWNER'); assert.equal(await rights(x.device), 0);
});

test('unknown order and an order the customer never marked as paid: the owner is told, nothing is granted', { skip }, async () => {
  assert.equal((await hook(cb(randomUUID(), 'ok'))).status, 200);
  assert.match(calls.find((c) => c[0] === 'answerCallbackQuery')[2], /không tìm thấy/i);
  const device = await mkDevice();
  const pending = await svc.createOrder(device);
  calls.length = 0;
  assert.equal((await hook(cb(pending.orderId, 'ok'))).status, 200);
  assert.equal((await row(pending.orderId)).status, 'PENDING_PAYMENT'); assert.equal(await rights(device), 0);
  assert.match(calls.find((c) => c[0] === 'answerCallbackQuery')[2], /đã được xử lý|chưa/i);
});

test('Telegram being down while answering does not undo or hide the decision: still 200 and the order is confirmed', { skip }, async () => {
  const x = await awaiting();
  client.fail = true;
  assert.equal((await hook(cb(x.order.orderId, 'ok'))).status, 200);
  assert.equal((await row(x.order.orderId)).status, 'CONFIRMED'); assert.equal(await rights(x.device), 1);
});

test('a failing answer does not stop the message edit, and a failing edit does not undo the decision; an internal error (database down) still returns 200 so Telegram does not retry forever', { skip }, async () => {
  const x = await awaiting();
  client.answerCallbackQuery = async (...a) => { calls.push(['answerCallbackQuery', ...a]); throw new Error('answer failed'); };
  assert.equal((await hook(cb(x.order.orderId, 'ok'))).status, 200);
  assert.ok(calls.some((c) => c[0] === 'editMessageText'), 'the message was still edited after the answer failed');
  assert.equal((await row(x.order.orderId)).status, 'CONFIRMED');
  const broken = express(); broken.use(express.json());
  broken.use('/api/telegram', mod.createTelegramRouter({ config: { webhookPath: PATH, webhookSecret: SECRET, ownerChatIds: [OWNER] }, client, service: { decide: async () => { throw new Error('db down'); } } }));
  const s = await new Promise((r2) => { const sv = broken.listen(0, '127.0.0.1', () => r2(sv)); }); servers.push(s);
  const res = await fetch('http://127.0.0.1:' + s.address().port + '/api/telegram/webhook/' + PATH, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify(cb(randomUUID(), 'ok')) });
  assert.equal(res.status, 200);
});

test('sweeper: expired orders become EXPIRED once; Telegram messages are left alone so the owner can still confirm a late payment', { skip }, async () => {
  const a = await awaiting(), b = await awaiting();
  await pool.query("update purchase_orders set telegram_chat_id=$2, telegram_message_id=77 where id=$1", [a.order.orderId, OWNER]);
  await pool.query("update purchase_orders set expires_at = now() - interval '1 second' where id = any($1::uuid[])", [[a.order.orderId, b.order.orderId]]);
  const m = maintenance.createOrderMaintenance({ service: svc, intervalMs: 3_600_000 });
  assert.equal(await m.runOnce(), 2);
  for (const o of [a, b]) assert.equal((await row(o.order.orderId)).status, 'EXPIRED');
  assert.equal(calls.filter((x) => x[0] === 'editMessageText').length, 0);
  assert.equal(await m.runOnce(), 0, 'nothing is processed twice');
  m.stop();
});
