// Trang Tong quan admin: tile VND, bieu do SVG, suc khoe + nut "Gui tin thu". jsdom + fetch gia.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminOverview } = await import('./AdminOverview.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, requests;

const res = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const daily = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amountVnd: i === 29 ? 45000 : 0 }));
const overview = { revenue: { today: 45000, month: 120000, total: 1500000, daily }, orders: { awaitingConfirm: 2, pending: 5 },
  licenses: { activeDevices: 7, newDevices7d: 3 }, catalog: { models: 360, lastSync: { status: 'COMPLETED', finishedAt: '2026-11-01T08:00:00Z', errorCode: null } } };
const health = { telegram: { configured: true, botOk: true, botUsername: 'mood_bot', webhookUrl: 'https://shop.example', webhookMatches: false, pendingUpdates: 0, lastErrorMessage: null, lastErrorDate: null },
  disk: { freeBytes: 50 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }, modelCache: { bytes: 1024 ** 3, limitBytes: 20 * 1024 ** 3 }, backup: { lastAt: null }, db: { ok: true } };

async function mount(props = {}, { testResponse = () => res({ ok: true }) } = {}) {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), 'http://x').pathname, method = init.method ?? 'GET';
    requests.push(`${method} ${path}`);
    if (path === '/api/admin/overview') return res(overview);
    if (path === '/api/admin/health') return res(health);
    if (path === '/api/admin/health/telegram-test' && method === 'POST') return testResponse();
    throw new Error(`Unhandled ${method} ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AdminOverview {...props} />));
}
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('renders VND tiles, a 30-bar chart and health dots (green/red)', async () => {
  await mount();
  const text = container.textContent;
  assert.match(text, /Doanh thu hôm nay/); assert.match(text, /45\.000 ₫/); assert.match(text, /1\.500\.000 ₫/);
  assert.match(text, /Đơn chờ duyệt/); assert.match(text, /5 đơn chờ thanh toán/);
  assert.equal(container.querySelectorAll('svg rect').length, 30);
  const rows = [...container.querySelectorAll('li[data-ok]')];
  assert.ok(rows.find((r) => /Cơ sở dữ liệu/.test(r.textContent)).dataset.ok === 'true');
  assert.ok(rows.find((r) => /Webhook/.test(r.textContent)).dataset.ok === 'false', 'webhook mismatch is red');
  assert.ok(rows.find((r) => /Sao lưu/.test(r.textContent)).dataset.ok === 'false');
});

test('pending-orders tile is clickable only when a handler is given', async () => {
  let opened = 0;
  await mount({ onOpenOrders: () => { opened++; } });
  await act(async () => button('Đơn chờ duyệt').click());
  assert.equal(opened, 1);
  await act(async () => root.unmount()); root = createRoot(container);
  await mount();
  assert.equal(button('Đơn chờ duyệt'), undefined);
});

test('"Gửi tin thử" posts and reports; refresh refetches both endpoints', async () => {
  await mount();
  await act(async () => button('Gửi tin thử').click());
  assert.ok(requests.includes('POST /api/admin/health/telegram-test'));
  assert.match(container.textContent, /Đã gửi tin thử/);
  const before = requests.filter((r) => r === 'GET /api/admin/overview').length;
  await act(async () => button('Làm mới').click());
  assert.equal(requests.filter((r) => r === 'GET /api/admin/overview').length, before + 1);
  assert.equal(requests.filter((r) => r === 'GET /api/admin/health').length, 2);
});

test('a failed test message shows the server message in Vietnamese', async () => {
  await mount({}, { testResponse: () => res({ error: { code: 'RATE_LIMITED', message: 'Thao tác quá nhanh. Thử lại sau.', requestId: 'r' } }, 429) });
  await act(async () => button('Gửi tin thử').click());
  assert.match(container.textContent, /Thao tác quá nhanh/);
});
