// Trang Tong quan admin: so lieu tren PostgreSQL that (schema co lap), Telegram qua fetch gia, auth that (requireAdmin).
import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';
import { createOverviewRouter } from './routes.js';
import { createOverviewService } from './service.js';
import { requireAdmin } from '../admin/access.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, adminId, userId, base, servers = [], deviceId, clock;
const TOKEN = '123456789:' + 'A'.repeat(35);
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OWNER_CHAT_IDS: '42', TELEGRAM_WEBHOOK_SECRET: 's'.repeat(20), TELEGRAM_WEBHOOK_PATH: 'p'.repeat(20),
  TELEGRAM_WEBHOOK_BASE_URL: 'https://shop.example', STORAGE_DIR: '/tmp' };
const GOOD_URL = `https://shop.example/api/telegram/webhook/${'p'.repeat(20)}`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
// fetch gia: ghi lai lenh goi, tra ket qua theo method.
function fakeTelegram(over = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const method = String(url).split('/').pop(); calls.push({ method, body: init?.body });
    if (over[method]) return over[method]();
    if (method === 'getMe') return json({ ok: true, result: { username: 'mood_bot' } });
    if (method === 'getWebhookInfo') return json({ ok: true, result: { url: GOOD_URL, pending_update_count: 3, last_error_message: 'oops', last_error_date: 1700000000 } });
    return json({ ok: true, result: { message_id: 1 } });
  };
  fn.calls = calls; return fn;
}
function mount({ fetchImpl = fakeTelegram(), env = ENV, diskStat } = {}) {
  clock = { t: 1_000_000 };
  const service = createOverviewService({ pool, env, fetchImpl, now: () => clock.t, diskStat: diskStat ?? (async () => ({ bavail: 10n, bsize: 100n, blocks: 40n })) });
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = { id: who === 'admin' ? adminId : userId, role: who === 'admin' ? 'ADMIN' : 'USER' }; next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createOverviewRouter({ service, guards: [fakeAuth, requireAdmin], now: () => clock.t }));
  return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => { servers.push(s); base = `http://127.0.0.1:${s.address().port}`; r(); }); });
}
const api = (path, { method = 'GET', user = 'admin' } = {}) => fetch(`${base}/api/admin${path}`, { method, headers: user ? { 'x-test-user': user } : {} });
// Moc thoi gian theo gio Viet Nam: hom nay 00:30 (tinh la hom nay) va 23:30 hom qua (UTC cung ngay voi hom nay -> bat loi mui gio).
const vn = (offset) => `((date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') + interval '${offset}') at time zone 'Asia/Ho_Chi_Minh')`;
async function order(status, amount, at) {
  await pool.query(`insert into purchase_orders(code,device_id,amount_vnd,status,decided_at,expires_at,bank_snapshot) values ($1,$2,$3,$4,${at},now()+interval '1 day','{}')`,
    [`C${randomUUID().slice(0, 8)}`, deviceId, amount, status]);
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('overview');
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
  for (const t of ['entitlements', 'purchase_orders', 'devices']) await pool.query(`delete from ${t}`);
  deviceId = (await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'SOFTWARE',$3,'PC') returning id", [randomUUID(), createHash('sha256').update(randomUUID()).digest(), `MAX-${'AB'.repeat(32)}`])).rows[0].id;
});
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); } });

test('auth: anonymous 401, ordinary user 403 on every route', { skip }, async () => {
  await mount();
  for (const [p, m] of [['/overview', 'GET'], ['/health', 'GET'], ['/health/telegram-test', 'POST']]) {
    assert.equal((await api(p, { method: m, user: null })).status, 401, p);
    assert.equal((await api(p, { method: m, user: 'user' })).status, 403, p);
  }
});

test('overview: revenue counts only CONFIRMED, day boundary is Asia/Ho_Chi_Minh', { skip }, async () => {
  await order('CONFIRMED', 15000, vn('30 minutes'));      // hom nay 00:30 gio VN
  await order('CONFIRMED', 30000, vn('-30 minutes'));     // hom qua 23:30 gio VN
  await order('AWAITING_OWNER', 99000, 'now()');          // khong tinh
  await order('PENDING_PAYMENT', 77000, 'now()');
  await order('REJECTED', 55000, 'now()');
  await mount();
  const r = await api('/overview'); assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.revenue.today, 15000);
  assert.ok(b.revenue.month >= 15000 && b.revenue.month <= 45000);
  assert.equal(b.revenue.total, 45000);
  assert.equal(b.revenue.daily.length, 30);
  assert.deepEqual(b.revenue.daily.slice(-2).map((d) => d.amountVnd), [30000, 15000]);
  assert.match(b.revenue.daily[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(b.orders, { awaitingConfirm: 1, pending: 1 });
  assert.equal(b.catalog.lastSync, null);
});

test('overview: licenses count distinct active devices and new devices in 7 days', { skip }, async () => {
  const mk = () => pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name,first_seen_at) values ($1,'{}',$2,'SOFTWARE',$3,'PC', now() - interval '30 days') returning id", [randomUUID(), createHash('sha256').update(randomUUID()).digest(), `MAX-${'CD'.repeat(32)}`]).then((x) => x.rows[0].id);
  const old = await mk(), revoked = await mk();
  await pool.query("insert into entitlements(device_id,source) values ($1,'ADMIN'),($2,'ADMIN')", [old, revoked]);
  await pool.query('update entitlements set revoked_at = now() where device_id = $1', [revoked]);
  await mount();
  const b = await (await api('/overview')).json();
  assert.deepEqual(b.licenses, { activeDevices: 1, newDevices7d: 1 }); // chi thiet bi beforeEach la moi
});

test('health: telegram ok, matching webhook, never leaks token or secret path', { skip }, async () => {
  const f = fakeTelegram(); await mount({ fetchImpl: f });
  const raw = await (await api('/health')).text(); const b = JSON.parse(raw);
  assert.deepEqual([b.telegram.configured, b.telegram.botOk, b.telegram.botUsername, b.telegram.webhookMatches, b.telegram.pendingUpdates, b.telegram.lastErrorMessage],
    [true, true, 'mood_bot', true, 3, 'oops']);
  assert.equal(b.telegram.webhookUrl, 'https://shop.example');
  assert.ok(!raw.includes(TOKEN) && !raw.includes('p'.repeat(20)));
  assert.deepEqual(b.disk, { freeBytes: 1000, totalBytes: 4000 });
  assert.equal(b.db.ok, true); assert.equal(b.backup.lastAt, null);
  assert.equal(b.modelCache.bytes, 0); assert.ok(b.modelCache.limitBytes > 0);
  await api('/health'); assert.equal(f.calls.filter((c) => c.method === 'getMe').length, 1, 'cache 60s');
  clock.t += 61_000; await api('/health'); assert.equal(f.calls.filter((c) => c.method === 'getMe').length, 2);
});

test('health: invalid token -> botOk false with short code; webhook mismatch; unconfigured', { skip }, async () => {
  await mount({ fetchImpl: fakeTelegram({ getMe: () => json({ ok: false, description: `bad ${TOKEN}` }, 401) }) });
  let raw = await (await api('/health')).text(), b = JSON.parse(raw);
  assert.equal(b.telegram.botOk, false); assert.equal(b.telegram.error, 'TOKEN_INVALID'); assert.ok(!raw.includes(TOKEN));
  for (const s of servers.splice(0)) await new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
  await mount({ fetchImpl: fakeTelegram({ getWebhookInfo: () => json({ ok: true, result: { url: 'https://other.example/x', pending_update_count: 0 } }) }) });
  b = await (await api('/health')).json();
  assert.deepEqual([b.telegram.botOk, b.telegram.webhookMatches], [true, false]);
  for (const s of servers.splice(0)) await new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
  await mount({ env: {} });
  b = await (await api('/health')).json();
  assert.deepEqual([b.telegram.configured, b.telegram.botOk, b.telegram.error], [false, false, 'NOT_CONFIGURED']);
});

test('telegram-test: sends to owner chat, 1 per 10s', { skip }, async () => {
  const f = fakeTelegram(); await mount({ fetchImpl: f });
  const r = await api('/health/telegram-test', { method: 'POST' });
  assert.deepEqual(await r.json(), { ok: true });
  const sent = f.calls.find((c) => c.method === 'sendMessage'); assert.equal(JSON.parse(sent.body).chat_id, 42);
  const again = await api('/health/telegram-test', { method: 'POST' });
  assert.equal(again.status, 429); assert.equal((await again.json()).error.code, 'RATE_LIMITED');
  clock.t += 10_001;
  assert.equal((await api('/health/telegram-test', { method: 'POST' })).status, 200);
});
