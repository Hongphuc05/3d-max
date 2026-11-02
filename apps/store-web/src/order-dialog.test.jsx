// P5.8: hop thoai mua model. Backend gia lap bang fetch; QR/ngan hang/so tien deu do "may chu" tra ve.
import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { createRoot } = await import('react-dom/client');
const { default: OrderDialog } = await import('./OrderDialog.jsx');

const MODEL = { id: '00000000-0000-4000-8000-000000000101', name: 'Sofa One' };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const original = globalThis.fetch;
after(() => { globalThis.fetch = original; dom.window.close(); });

let calls, server, root, closed, confirmed;
const orderBody = (over = {}) => ({ orderId: 'order-1', code: '3DMK7Q2XA', amountVnd: 35000, status: 'PENDING_PAYMENT', expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
  payment: { bankName: 'Test Bank', accountNo: '0123456789012', accountName: 'TEST ACCOUNT', transferContent: '3DMK7Q2XA', qrPayload: '00020101021238...6304ABCD' }, ...over });
beforeEach(() => {
  calls = []; closed = 0; confirmed = 0;
  server = { create: () => json(orderBody(), 201), claim: () => json({ status: 'AWAITING_OWNER' }), get: () => json({ orderId: 'order-1', status: 'AWAITING_OWNER' }), cancel: () => json({ status: 'CANCELLED' }) };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url), method = init.method || 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    if (method === 'POST' && path === '/api/v1/orders') return server.create();
    if (method === 'POST' && path.endsWith('/claim-paid')) return server.claim();
    if (method === 'POST' && path.endsWith('/cancel')) return server.cancel();
    if (method === 'GET' && path.startsWith('/api/v1/orders/')) return server.get();
    throw new Error('unexpected ' + method + ' ' + path);
  };
});
const text = () => document.body.textContent;
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(label));
async function mount(props = {}) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<OrderDialog model={MODEL} pollMs={30} onClose={() => { closed++; }} onConfirmed={() => { confirmed++; }} {...props} />); await flush(); });
  await act(() => flush());
}
const unmount = async () => { if (root) { const r = root; root = null; await act(() => r.unmount()); } };
afterEach(unmount); // a failing assertion must not leave a dialog (and its timers) behind for the next test
const count = (pred) => calls.filter(pred).length;

test('opening creates ONE order with only the model id, then shows amount, code, bank details, a QR and a countdown', async () => {
  await mount();
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [['POST', '/api/v1/orders', { items: [{ modelId: MODEL.id }] }]]);
  for (const part of ['35.000', '3DMK7Q2XA', 'Test Bank', 'TEST ACCOUNT', '0123456789012', 'Sofa One', 'Đơn hết hạn sau']) assert.ok(text().includes(part), part);
  assert.ok(document.querySelector('svg[aria-label="Mã VietQR thanh toán"]'), 'QR rendered');
  assert.ok(button('Tôi đã chuyển khoản') && !button('Tôi đã chuyển khoản').disabled);
  await unmount();
});

test('"Tôi đã chuyển khoản" claims the order, then polls until confirmed: onConfirmed fires once and polling stops', async () => {
  let polls = 0;
  server.get = () => json({ orderId: 'order-1', status: ++polls < 3 ? 'AWAITING_OWNER' : 'CONFIRMED' });
  await mount();
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  assert.equal(count((c) => c.path.endsWith('/claim-paid')), 1);
  assert.match(text(), /Đang chờ xác nhận/);
  await act(() => flush(250));
  assert.match(text(), /Đã xác nhận thanh toán/);
  assert.equal(confirmed, 1);
  const after = count((c) => c.method === 'GET'); await act(() => flush(150));
  assert.equal(count((c) => c.method === 'GET'), after, 'no more polling after the final state');
  assert.equal(count((c) => c.path.endsWith('/cancel')), 0);
  await unmount();
});

test('rejected, expired and cancelled outcomes are explained and never call onConfirmed', async () => {
  for (const [status, re] of [['REJECTED', /từ chối|chưa nhận được tiền/], ['EXPIRED', /hết hạn/], ['CANCELLED', /đã hủy/]]) {
    server.get = () => json({ orderId: 'order-1', status });
    await mount();
    await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
    await act(() => flush(300)); // effects of the waiting phase (the poll timer) start once the first act has settled
    assert.match(text(), re, status); assert.equal(confirmed, 0, status);
    await unmount();
  }
});

test('create errors are shown in Vietnamese; ALREADY_ENTITLED also refreshes the library', async () => {
  for (const [code, status, re] of [['TOO_MANY_PENDING_ORDERS', 429, /quá nhiều đơn/], ['PAYMENT_NOT_CONFIGURED', 503, /chưa được cấu hình/], ['MODEL_NOT_AVAILABLE', 409, /không bán được/], ['ALREADY_ENTITLED', 409, /đã sở hữu/]]) {
    server.create = () => json({ error: { code, message: 'x', requestId: 'r' } }, status);
    confirmed = 0; await mount();
    assert.match(document.querySelector('[role=alert]').textContent, re, code);
    assert.equal(confirmed, code === 'ALREADY_ENTITLED' ? 1 : 0, code);
    assert.equal(button('Tôi đã chuyển khoản'), undefined);
    await unmount();
  }
  server.create = () => { throw new TypeError('offline'); };
  await mount();
  assert.ok(document.querySelector('[role=alert]'), 'a network failure shows an error too');
  await unmount();
});

test('closing before claiming cancels the order (frees the pending slot); closing while waiting keeps it; Escape closes', async () => {
  await mount();
  await act(async () => { button('Đóng').click(); await flush(); });
  assert.equal(count((c) => c.path.endsWith('/cancel')), 1); assert.equal(closed, 1);
  await unmount();
  calls.length = 0; closed = 0;
  await mount();
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  await act(async () => { button('Đóng').click(); await flush(); });
  assert.equal(count((c) => c.path.endsWith('/cancel')), 0, 'a claimed order is kept: the owner may still confirm it'); assert.equal(closed, 1);
  await unmount();
  calls.length = 0; closed = 0;
  await mount();
  await act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })); await flush(); });
  assert.equal(closed, 1); assert.equal(count((c) => c.path.endsWith('/cancel')), 1);
  await unmount();
});

test('a failed claim keeps the dialog usable and says why; a lost connection while waiting keeps polling and recovers', async () => {
  server.claim = () => json({ error: { code: 'ORDER_STATE_INVALID', message: 'x', requestId: 'r' } }, 409);
  await mount();
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  assert.match(document.querySelector('[role=alert]').textContent, /không còn ở trạng thái/);
  assert.ok(button('Tôi đã chuyển khoản'), 'can try again');
  await unmount();
  server.claim = () => json({ status: 'AWAITING_OWNER' });
  let n = 0;
  server.get = () => { n++; if (n === 2) throw new TypeError('offline'); return json({ orderId: 'order-1', status: n < 4 ? 'AWAITING_OWNER' : 'CONFIRMED' }); };
  await mount();
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  await act(() => flush(300));
  assert.match(text(), /Đã xác nhận thanh toán/); assert.equal(confirmed, 1);
  await unmount();
});

test('an order past its expiry cannot be claimed; unmounting stops all timers; copy buttons copy the account and the content', async () => {
  server.create = () => json(orderBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }), 201);
  await mount();
  assert.equal(button('Tôi đã chuyển khoản').disabled, true); assert.match(text(), /đã hết hạn/);
  await unmount();
  server.create = () => json(orderBody(), 201);
  const copied = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (v) => { copied.push(v); } }, configurable: true });
  await mount();
  const buttons = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Sao chép');
  await act(async () => { buttons[0].click(); await flush(); await buttons[1].click(); await flush(); });
  assert.deepEqual(copied, ['0123456789012', '3DMK7Q2XA']); assert.match(text(), /Đã sao chép/);
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  await unmount();
  const polled = count((c) => c.method === 'GET'); await flush(150);
  assert.equal(count((c) => c.method === 'GET'), polled, 'no request after unmount');
});

test('PENDING_PAYMENT while waiting keeps polling; a reply that arrives after unmount never confirms or refreshes', async () => {
  let polls = 0;
  server.get = () => json({ orderId: 'order-1', status: ++polls < 3 ? 'PENDING_PAYMENT' : 'AWAITING_OWNER' });
  await mount();
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  await act(() => flush(200));
  assert.ok(polls >= 3 && /Đang chờ xác nhận/.test(text()), 'still waiting, not shown as a final state');
  await unmount();
  let release; const late = new Promise((r) => { release = r; });
  server.get = () => late.then(() => json({ orderId: 'order-1', status: 'CONFIRMED' }));
  await mount();
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  await act(() => flush(80)); // a poll is now in flight
  await unmount();
  release(); await flush(50);
  assert.equal(confirmed, 0, 'a CONFIRMED that lands after the dialog is gone must not call onConfirmed');
});

test('a create that fails after unmount does nothing (no library refresh); Escape does not reach other keydown listeners', async () => {
  let fail; server.create = () => new Promise((_, reject) => { fail = () => reject(Object.assign(new Error('x'), { code: 'ALREADY_ENTITLED' })); });
  await mount();
  await unmount();
  fail(); await flush(50);
  assert.equal(confirmed, 0);
  server.create = () => json(orderBody(), 201);
  await mount();
  let leaked = 0; const spy = () => { leaked++; };
  document.addEventListener('keydown', spy);
  await act(async () => { document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush(); });
  document.removeEventListener('keydown', spy);
  assert.equal(closed, 1); assert.equal(leaked, 0, 'Escape closes the dialog only, not whatever is behind it');
  await unmount();
});

test('countdown: seconds are zero-padded and an expired order shows no negative time and a disabled claim button', async () => {
  server.create = () => json(orderBody({ expiresAt: new Date(Date.now() + 3 * 3600_000 + 5500).toISOString() }), 201);
  await mount();
  assert.match(document.querySelector('[role=timer]').textContent, /3:00:0\d$/);
  await unmount();
  server.create = () => json(orderBody({ expiresAt: new Date(Date.now() - 90_000).toISOString() }), 201);
  await mount();
  assert.equal(document.querySelector('[role=timer]').textContent, 'Đơn đã hết hạn.');
  assert.equal(button('Tôi đã chuyển khoản').disabled, true);
  await unmount();
});
