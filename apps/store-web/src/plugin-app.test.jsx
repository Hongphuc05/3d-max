// P4.4: PluginApp tren du lieu v3: nut theo quyen, tab "Đã tải", tu lam moi giu nguyen loc/trang/model dang chon, offline.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Set(); const calls = [];
let importOutcome = { ok: true };
dom.window.chrome = { webview: {
  addEventListener: (_t, f) => listeners.add(f),
  postMessage({ id, method, params }) {
    calls.push({ method, params });
    const reply = (data) => setTimeout(() => listeners.forEach((f) => f({ data })), 5);
    if (method === 'library.status') return reply({ id, ok: true, result: { machineCode: 'MAX-TESTCODE', offline: false } });
    if (method === 'host.getInfo') return reply({ id, ok: true, result: { hostVersion: '3ds Max 2022' } });
    if (method === 'scene.getInfo') return reply({ id, ok: true, result: { objects: 1, renderer: 'Corona' } });
    if (method === 'asset.import') return reply(importOutcome.ok ? { id, ok: true, result: { imported: 1 } } : { id, ok: false, error: { code: 'NOT_ENTITLED', message: 'english' } });
  },
} };
const emit = (event, data) => listeners.forEach((f) => f({ data: { event, data } }));
const { createRoot } = await import('react-dom/client');
const { default: PluginApp } = await import('./PluginApp.jsx');
const { getJobs, remove } = await import('./queue.js');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 20));
let version = 1, rights, cats;
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

function server() {
  version = 1; rights = { allModels: true };
  cats = [{ id: id(1), parentId: null, name: 'Living', fullPath: 'Living', modelCount: 2 }, { id: id(2), parentId: null, name: 'Bedroom', fullPath: 'Bedroom', modelCount: 1 }];
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path === '/api/v1/catalog') return json({ catalogVersion: version, models: [
      { id: id(101), name: 'Sofa One', categoryId: id(1), sizeBytes: 3 * 1048576, fileType: 'rar', status: 'PUBLISHED' },
      { id: id(102), name: 'Sofa Two', categoryId: id(1), sizeBytes: 1048576, fileType: 'zip', status: 'PUBLISHED' },
      { id: id(103), name: 'Bed One', categoryId: id(2), sizeBytes: 2 * 1048576, fileType: 'rar', status: 'PUBLISHED' },
      ...(version >= 2 ? [{ id: id(104), name: 'Sofa Three', categoryId: id(1), sizeBytes: 1048576, fileType: 'rar', status: 'PUBLISHED' }] : []),
    ] });
    if (path === '/api/v1/categories') return json(cats);
    if (path === '/api/v1/previews/manifest') return json({ catalogVersion: version, previews: [] });
    if (path === '/api/v1/me/entitlements') return rights ? json(rights) : json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    throw new Error('unexpected ' + path);
  };
}
const text = () => document.body.textContent;
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.textContent.includes(label));
const cards = () => [...document.querySelectorAll('.group')].map((c) => c.textContent);
async function mount() {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<PluginApp />); await flush(); });
  await act(flush); await act(flush);
  return root;
}
async function done(root) { await act(() => root.unmount()); getJobs().forEach((j) => remove(j.slug)); }

test('licensed device: every card shows Download and the bridge only ever sees a model id; no buy banner', async () => {
  server(); const root = await mount();
  assert.equal(document.querySelectorAll('.group').length, 3);
  for (const c of cards()) { assert.match(c, /Download/); assert.doesNotMatch(c, /Mua|khóa/); }
  assert.equal(button('Mua thư viện'), undefined);
  const download = [...document.querySelectorAll('.group')][1].querySelectorAll('button')[2];
  await act(async () => { download.click(); await flush(); });
  await act(flush); await act(flush);
  const imports = calls.filter((c) => c.method === 'asset.import');
  assert.deepEqual(imports.map((c) => c.params), [{ modelId: id(101) }]);
  assert.ok(!calls.some((c) => JSON.stringify(c).includes('ticket')));
  await done(root);
});

test('no license: every card is locked (no per-model buy button, no price) and one "Mua thư viện" CTA is offered', async () => {
  server(); rights = { allModels: false }; const root = await mount();
  for (const c of cards()) { assert.match(c, /Cần license thư viện/); assert.doesNotMatch(c, /Download|Mua|₫/); }
  const actions = [...document.querySelectorAll('.group')].map((g) => g.querySelectorAll('button')[2]);
  assert.ok(actions.every((b) => b.disabled), 'locked cards cannot be clicked');
  assert.equal([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Mua thư viện').length, 1, 'exactly one CTA in the list view');
  const before = calls.filter((c) => c.method === 'asset.import').length;
  await act(async () => { actions[0].click(); await flush(); });
  assert.equal(calls.filter((c) => c.method === 'asset.import').length, before);
  await done(root);
});

test('Mua thư viện opens the order dialog; after the owner confirms, the cards turn into Download without pressing refresh', async () => {
  server(); rights = { allModels: false };
  const base = globalThis.fetch; let status = 'PENDING_PAYMENT'; const orderCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url), method = init.method || 'GET';
    if (path.startsWith('/api/v1/orders')) {
      orderCalls.push(method + ' ' + path);
      if (method === 'POST' && path === '/api/v1/orders') return json({ orderId: 'o-1', code: '3DMK7Q2XA', amountVnd: 500000, status, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        payment: { bankName: 'Test Bank', accountNo: '0123456789012', accountName: 'TEST', transferContent: '3DMK7Q2XA', qrPayload: '000201...' } }, 201);
      if (path.endsWith('/claim-paid')) { status = 'AWAITING_OWNER'; return json({ status }); }
      if (method === 'GET') { if (status === 'AWAITING_OWNER') { status = 'CONFIRMED'; rights = { allModels: true }; } return json({ orderId: 'o-1', status }); }
    }
    return base(url, init);
  };
  const r = createRoot(document.getElementById('root'));
  await act(async () => { r.render(<PluginApp orderPollMs={30} />); await flush(); }); await act(flush); await act(flush);
  const importsBefore = calls.filter((c) => c.method === 'asset.import').length;
  await act(async () => { button('Mua thư viện').click(); await flush(); }); await act(flush);
  assert.ok(document.querySelector('[role=dialog]'), 'the order dialog is open');
  assert.match(text(), /Test Bank/); assert.match(text(), /3DMK7Q2XA/); assert.match(text(), /500\.000/);
  await act(async () => { button('Tôi đã chuyển khoản').click(); await flush(); });
  await act(() => flush(300)); await act(flush); await act(flush);
  assert.match(text(), /Đã xác nhận thanh toán/);
  for (const c of cards()) assert.match(c, /Download/, 'the whole library is unlocked');
  assert.equal(calls.filter((c) => c.method === 'asset.import').length, importsBefore, 'buying never starts a download by itself');
  assert.deepEqual(orderCalls.filter((c) => c.startsWith('POST /api/v1/orders') && !c.endsWith('claim-paid')), ['POST /api/v1/orders']);
  globalThis.fetch = base;
  await act(() => r.unmount()); getJobs().forEach((j) => remove(j.slug));
});

test('tab "Đã tải" lists the models imported in this session; it starts empty; unknown rights never list anything', async () => {
  server(); const root = await mount();
  await act(async () => { button('Đã tải').click(); await flush(); });
  assert.equal(document.querySelectorAll('.group').length, 0); assert.match(text(), /Chưa import model nào/);
  await act(async () => { button('Online').click(); await flush(); });
  await act(async () => { [...document.querySelectorAll('.group')][1].querySelectorAll('button')[2].click(); await flush(); });
  await act(flush); await act(flush);
  await act(async () => { button('Đã tải').click(); await flush(); });
  assert.deepEqual(cards().map((c) => c.match(/Sofa One|Sofa Two|Bed One/)[0]), ['Sofa One']);
  await done(root);
  server(); rights = null; const root2 = await mount();
  await act(async () => { button('Đã tải').click(); await flush(); });
  assert.equal(document.querySelectorAll('.group').length, 0);
  await done(root2);
});

test('unknown rights: every card says it cannot verify instead of offering Download or Mua', async () => {
  server(); rights = null; const root = await mount();
  for (const c of cards()) { assert.match(c, /Chưa xác minh được quyền/); assert.doesNotMatch(c, /Download|Mua/); }
  const actions = [...document.querySelectorAll('.group')].map((g) => g.querySelectorAll('button')[2]);
  assert.ok(actions.every((b) => b.disabled), 'the buttons are disabled, not just relabelled');
  const before = calls.filter((c) => c.method === 'asset.import').length;
  await act(async () => { actions[0].click(); await flush(); });
  assert.equal(calls.filter((c) => c.method === 'asset.import').length, before, 'clicking an unverified card downloads nothing');
  emit('library.offline', { offline: true });
  await act(flush);
  assert.match(cards()[0], /Cần Internet để xác minh quyền/);
  assert.match(text(), /Đang offline/);
  await done(root);
});

test('library.updated adds the new model while keeping the search text, the selected model and the current tab', async () => {
  server(); const root = await mount();
  const input = document.querySelector('input[placeholder="Tìm model…"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'sofa'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush();
  });
  assert.equal(document.querySelectorAll('.group').length, 2);
  await act(async () => { [...document.querySelectorAll('.group')][1].querySelector('button').click(); await flush(); });
  assert.match(text(), /Sofa Two/);
  version = 2;
  await act(async () => { emit('library.updated', { catalogVersion: 2 }); await flush(); });
  await act(flush); await act(flush);
  assert.equal(document.querySelectorAll('.group').length, 3, 'the new "Sofa Three" appeared');
  assert.equal(input.value, 'sofa', 'search text kept');
  assert.match(document.querySelector('h2').textContent, /Sofa Two/, 'the selected model stays selected');
  await done(root);
});

test('the open detail panel closes when its model disappears from the catalog', async () => {
  server(); const root = await mount();
  await act(async () => { [...document.querySelectorAll('.group')][0].querySelector('button').click(); await flush(); });
  assert.match(document.querySelector('h2').textContent, /Bed One/);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === '/api/v1/catalog') return json({ catalogVersion: 3, models: [{ id: id(101), name: 'Sofa One', categoryId: id(1), sizeBytes: 1048576, fileType: 'rar', status: 'PUBLISHED' }] });
    return original(url, init);
  };
  await act(async () => { emit('library.updated', {}); await flush(); });
  await act(flush);
  assert.equal(document.querySelector('h2'), null);
  globalThis.fetch = original;
  await done(root);
});

test('a download error from the host is shown in Vietnamese in the queue', async () => {
  server(); importOutcome = { ok: false }; const root = await mount();
  const download = [...document.querySelectorAll('.group')][1].querySelectorAll('button')[2];
  await act(async () => { download.click(); await flush(); });
  await act(flush); await act(flush);
  assert.match(text(), /chưa có quyền tải model này/);
  importOutcome = { ok: true };
  await done(root);
});

test('the header badge follows the host: ONLINE, then OFFLINE when the host reports it, then ONLINE again', async () => {
  server(); const root = await mount();
  assert.match(document.querySelector('header').textContent, /ONLINE/);
  await act(async () => { emit('library.offline', { offline: true }); await flush(); });
  assert.match(document.querySelector('header').textContent, /OFFLINE/);
  await act(async () => { emit('library.offline', { offline: false }); await flush(); });
  assert.match(document.querySelector('header').textContent, /ONLINE/);
  await done(root);
});

test('changing the search goes back to page 1', async () => {
  server(); const many = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url) === '/api/v1/catalog' ? json({ catalogVersion: 1, models: Array.from({ length: 70 }, (_, i) => ({ id: id(500 + i), name: 'Lamp ' + String(i).padStart(2, '0'), categoryId: id(1), sizeBytes: 1048576, fileType: 'rar', status: 'PUBLISHED' })) }) : many(url, init);
  const root = await mount();
  await act(async () => { button('Sau').click(); await flush(); });
  assert.ok(text().includes("Trang 2 / 3"), "second page of 70 models");
  const input = document.querySelector('input[placeholder="Tìm model…"]');
  await act(async () => { const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set; set.call(input, 'lamp'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
  assert.ok(!text().includes("Trang 2"), "after searching, the grid is not stuck on page 2"); assert.match(text(), /Lamp 00/);
  globalThis.fetch = many;
  await done(root);
});

test('the device popup shows the machine code from the host; category filter narrows the grid', async () => {
  server(); const root = await mount();
  await act(async () => { button('Thiết bị').click(); await flush(); });
  assert.match(text(), /MAX-TESTCODE/);
  await act(async () => { document.querySelector('aside [type=checkbox]').click(); await flush(); });
  assert.ok(document.querySelectorAll('.group').length < 3, 'selecting a category narrows the list');
  await done(root);
});


test('first run with the VPS down: clear message + "Thử lại" loads the catalog; preview progress shows a bar', async () => {
  server(); const base = globalThis.fetch; let down = true;
  globalThis.fetch = async (url) => {
    if (down && String(url).startsWith('/api/v1/')) return json({ error: { code: 'SERVER_UNAVAILABLE' } }, 503);
    return base(url);
  };
  const root = await mount();
  assert.match(document.querySelector('[role="alert"]').textContent, /Internet/);
  assert.equal(cards().length, 0);
  down = false;
  await act(async () => { button('Thử lại').click(); await flush(); });
  await act(flush); await act(flush);
  assert.equal(cards().length, 3); assert.equal(document.querySelector('[role="alert"]'), null);
  await act(async () => { emit('library.previewProgress', { done: 3, total: 12 }); await flush(); });
  const bar = document.querySelector('[role="progressbar"]');
  assert.equal(bar.getAttribute('aria-valuenow'), '3'); assert.equal(bar.getAttribute('aria-valuemax'), '12');
  assert.match(text(), /3\/12/);
  await act(async () => { emit('library.previewProgress', { done: 12, total: 12 }); await flush(); });
  assert.equal(document.querySelector('[role="progressbar"]'), null);
  globalThis.fetch = base; await done(root);
});
