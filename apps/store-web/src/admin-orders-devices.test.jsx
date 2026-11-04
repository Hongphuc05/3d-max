// P3.6 + D28.2: man "Don hang" (loc, xac nhan/tu choi 2 buoc, don het han van xac nhan duoc) va "Thiet bi & license" (chuyen, thu hoi). jsdom + fetch gia.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminOrders } = await import('./AdminOrders.jsx');
const { default: AdminDevices } = await import('./AdminDevices.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, requests, orders, devices, failNext;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const order = (id, status, over = {}) => ({ orderId: id, code: `3DM${id.toUpperCase()}`, amountVnd: 500000, status, createdAt: '2026-11-01T08:00:00Z', expiresAt: '2026-11-02T08:00:00Z',
  claimedPaidAt: '2026-11-01T09:00:00Z', decidedAt: null, deviceName: `PC-${id}`, deviceId: `dev${id}-0000-0000-0000-000000000000`, ...over });
const device = (id, hasLicense, over = {}) => ({ id, name: `PC-${id}`, status: 'ACTIVE', createdAt: '2026-11-01T08:00:00Z', lastSeenAt: '2026-11-03T08:00:00Z', hasLicense, ...over });

function install() {
  requests = []; failNext = null;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x'), path = u.pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, method, body, status: u.searchParams.get('status') });
    if (failNext) { const f = failNext; failNext = null; return f; }
    if (path === '/api/admin/orders') return response({ items: orders.filter((o) => !u.searchParams.get('status') || o.status === u.searchParams.get('status')) });
    if (path === '/api/admin/devices') return response({ items: devices });
    return response({ status: 'OK' });
  };
}
async function mount(element) { root = createRoot(container); await act(async () => root.render(element)); await act(async () => {}); }
const button = (label, scope = container) => [...scope.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
const mustButton = (label, scope) => { const b = button(label, scope); assert.ok(b, `Missing button ${label}`); return b; };
const click = (el) => act(async () => el.click());
async function select(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
const orderRow = (id) => container.querySelector(`tr[data-order="${id}"]`);
const deviceRow = (id) => container.querySelector(`tr[data-device="${id}"]`);
const posts = () => requests.filter((r) => r.method === 'POST');

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('orders: lists status, amount, device, created and claimed-paid time; the status filter is sent to the server', async () => {
  orders = [order('a', 'AWAITING_OWNER'), order('b', 'CONFIRMED', { decidedAt: '2026-11-01T10:00:00Z' }), order('c', 'PENDING_PAYMENT', { claimedPaidAt: null })];
  install(); await mount(<AdminOrders />);
  assert.match(orderRow('a').textContent, /Chờ chủ xác nhận/); assert.match(orderRow('a').textContent, /500\.000/); assert.match(orderRow('a').textContent, /PC-a/);
  assert.match(orderRow('c').textContent, /Chờ chuyển khoản/); assert.match(orderRow('c').textContent, /—/, 'no claimed-paid time yet');
  await select(container.querySelector('[name="statusFilter"]'), 'CONFIRMED');
  assert.equal(requests.at(-1).status, 'CONFIRMED');
  assert.ok(orderRow('b') && !orderRow('a'));
});

test('orders: confirm/reject exist only for claimed AWAITING_OWNER or EXPIRED orders and need a second click', async () => {
  orders = [order('a', 'AWAITING_OWNER'), order('e', 'EXPIRED'), order('c', 'PENDING_PAYMENT', { claimedPaidAt: null }), order('x', 'EXPIRED', { claimedPaidAt: null }), order('d', 'CONFIRMED')];
  install(); await mount(<AdminOrders />);
  for (const id of ['c', 'x', 'd']) assert.equal(button('Xác nhận', orderRow(id)), null, id);
  await click(mustButton('Xác nhận', orderRow('e')));   // an expired order the customer had claimed can still be confirmed
  assert.equal(posts().length, 0, 'first click only asks');
  await click(mustButton('Chắc chắn', orderRow('e')));
  assert.deepEqual(posts().map((p) => p.path), ['/api/admin/orders/e/confirm']);
  await click(mustButton('Từ chối', orderRow('a')));
  await click(mustButton('Hủy', orderRow('a')));
  assert.equal(posts().length, 1, 'cancelled the question');
  await click(mustButton('Từ chối', orderRow('a')));
  await click(mustButton('Chắc chắn', orderRow('a')));
  assert.deepEqual(posts().map((p) => p.path), ['/api/admin/orders/e/confirm', '/api/admin/orders/a/reject']);
});

test('orders: a server refusal is shown in Vietnamese on the row', async () => {
  orders = [order('a', 'AWAITING_OWNER')];
  install(); await mount(<AdminOrders />);
  await click(mustButton('Xác nhận', orderRow('a')));
  failNext = response({ error: { code: 'ORDER_STATE_INVALID', message: 'x', requestId: 'r' } }, 409);
  await click(mustButton('Chắc chắn', orderRow('a')));
  assert.match(orderRow('a').querySelector('[role="alert"]').textContent, /không ở trạng thái cho phép/);
});

test('devices: lists id (short), created, last seen and license; actions only on licensed devices', async () => {
  devices = [device('aaaaaaaa-1111', true), device('bbbbbbbb-2222', false), device('cccccccc-3333', false, { status: 'BLOCKED' })];
  install(); await mount(<AdminDevices />);
  assert.match(deviceRow('aaaaaaaa-1111').textContent, /aaaaaaaa/); assert.match(deviceRow('aaaaaaaa-1111').textContent, /Có/);
  assert.match(deviceRow('bbbbbbbb-2222').textContent, /Chưa/);
  assert.ok(button('Chuyển license', deviceRow('aaaaaaaa-1111')) && button('Thu hồi', deviceRow('aaaaaaaa-1111')));
  assert.equal(button('Thu hồi', deviceRow('bbbbbbbb-2222')), null);
});

test('devices: revoke asks first, then POSTs revoke and reloads', async () => {
  devices = [device('aaaaaaaa-1111', true)];
  install(); await mount(<AdminDevices />);
  await click(mustButton('Thu hồi', deviceRow('aaaaaaaa-1111')));
  assert.equal(posts().length, 0);
  const loads = requests.filter((r) => r.method === 'GET').length;
  await click(mustButton('Chắc chắn thu hồi', deviceRow('aaaaaaaa-1111')));
  assert.deepEqual(posts().map((p) => p.path), ['/api/admin/devices/aaaaaaaa-1111/license/revoke']);
  assert.equal(requests.filter((r) => r.method === 'GET').length, loads + 1, 'list reloaded');
});

test('devices: transfer offers only ACTIVE devices without a license, needs a target, and POSTs toDeviceId; errors show on the row', async () => {
  devices = [device('aaaaaaaa-1111', true), device('bbbbbbbb-2222', false), device('cccccccc-3333', false, { status: 'BLOCKED' }), device('dddddddd-4444', true)];
  install(); await mount(<AdminDevices />);
  const r = deviceRow('aaaaaaaa-1111');
  await click(mustButton('Chuyển license', r));
  const options = [...r.querySelectorAll('select option')].map((o) => o.value);
  assert.deepEqual(options, ['', 'bbbbbbbb-2222']);
  assert.equal(mustButton('Chắc chắn chuyển', r).disabled, true);
  await select(r.querySelector('select'), 'bbbbbbbb-2222');
  failNext = response({ error: { code: 'ALREADY_ENTITLED', message: 'x', requestId: 'r' } }, 409);
  await click(mustButton('Chắc chắn chuyển', r));
  assert.match(r.querySelector('[role="alert"]').textContent, /đã có license thư viện/);
  await click(mustButton('Chắc chắn chuyển', r));
  assert.deepEqual(posts().map((p) => [p.path, p.body]), [['/api/admin/devices/aaaaaaaa-1111/license/transfer', { toDeviceId: 'bbbbbbbb-2222' }], ['/api/admin/devices/aaaaaaaa-1111/license/transfer', { toDeviceId: 'bbbbbbbb-2222' }]]);
});
