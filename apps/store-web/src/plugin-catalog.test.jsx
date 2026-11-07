// P4.4: hook catalog cua plugin: doc /api/v1 cuc bo, quyen cua thiet bi, tu lam moi theo su kien host, giu du lieu khi loi.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Set();
dom.window.chrome = { webview: { addEventListener: (_t, f) => listeners.add(f), postMessage() {} } };
const emit = (event, data) => listeners.forEach((f) => f({ data: { event, data } }));
const { createRoot } = await import('react-dom/client');
const { usePluginCatalog } = await import('./usePluginCatalog.js');
const { onHostEvent } = await import('./integrations/3dsmax/bridge.js');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 15));
let snap, state, requests, requestHeaders;
function Probe({ k = 0 }) { snap = usePluginCatalog(k); return null; }
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

function server() {
  state = { version: 1, models: 2, entitlements: { allModels: false, modelIds: [id(101)] }, fail: false, entitlementsStatus: 200 };
  requests = []; requestHeaders = [];
  globalThis.fetch = async (url, options) => {
    requestHeaders.push(options?.headers);
    requests.push(String(url));
    if (state.fail) throw new TypeError('offline');
    const path = String(url);
    if (path === '/api/v1/catalog') return json({ catalogVersion: state.version, models: Array.from({ length: state.models }, (_, i) => ({ id: id(101 + i), name: `V${state.version} M${i + 1}`, categoryId: id(1), priceVnd: 15000, sizeBytes: 1048576, fileType: 'rar', status: 'PUBLISHED' })) });
    if (path === '/api/v1/categories') return json([{ id: id(1), parentId: null, name: 'Living', fullPath: 'Living', modelCount: state.models }]);
    if (path === '/api/v1/previews/manifest') return json({ catalogVersion: state.version, previews: [] });
    if (path === '/api/v1/me/entitlements') return state.entitlementsStatus === 200 ? json(state.entitlements) : json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    throw new Error('unexpected request ' + path);
  };
}
const mount = async (props) => { const root = createRoot(document.getElementById('root')); await act(async () => { root.render(<Probe {...props} />); await flush(); }); await act(flush); return root; };

test('loads catalog, categories, previews and the device rights from the local /api/v1 routes', async () => {
  server(); const root = await mount();
  assert.equal(snap.state, 'ready'); assert.equal(snap.error, '');
  assert.deepEqual(snap.products.map((p) => p.name), ['V1 M1', 'V1 M2']);
  assert.equal(snap.tree[0].name, 'Living');
  assert.deepEqual(snap.entitlements, { allModels: false, modelIds: [id(101)] });
  assert.deepEqual([...new Set(requests)].sort(), ['/api/v1/catalog', '/api/v1/categories', '/api/v1/me/entitlements', '/api/v1/previews/manifest']);
  assert.ok(requestHeaders.every(headers => headers['X-3dsmood-Content-Domains'] === '1'), 'catalog requests opt into mixed domain responses');
  assert.ok(requests.every((r) => r.startsWith('/api/v1/')), 'never an old /api/products or /api/auth route');
  await act(() => root.unmount());
});

test('library.updated reloads catalog and rights; the old data stays until the new data arrives', async () => {
  server(); const root = await mount();
  state.version = 2; state.models = 3; state.entitlements = { allModels: true, modelIds: [] };
  await act(async () => { emit('library.updated', { catalogVersion: 2 }); await flush(); });
  await act(flush);
  assert.deepEqual(snap.products.map((p) => p.name), ['V2 M1', 'V2 M2', 'V2 M3']);
  assert.equal(snap.entitlements.allModels, true);
  await act(() => root.unmount());
});

test('a failed refresh keeps the grid and does not turn the screen into an error; a failed first load shows the message', async () => {
  server(); const root = await mount();
  state.fail = true;
  await act(async () => { emit('library.updated', {}); await flush(); });
  await act(flush);
  assert.equal(snap.state, 'ready'); assert.equal(snap.products.length, 2);
  assert.equal(snap.entitlements, null, 'rights unknown while the call fails: no download is offered');
  await act(() => root.unmount());
  server(); state.fail = true;
  const root2 = await mount();
  assert.equal(snap.state, 'error'); assert.match(snap.error, /Làm mới/);
  await act(() => root2.unmount());
});

test('offline and preview progress events are reflected; progress clears when finished', async () => {
  server(); const root = await mount();
  await act(async () => { emit('library.offline', { offline: true }); emit('library.previewProgress', { done: 3, total: 10 }); await flush(); });
  assert.equal(snap.offline, true); assert.deepEqual(snap.progress, { done: 3, total: 10 });
  await act(async () => { emit('library.offline', { offline: false }); emit('library.previewProgress', { done: 10, total: 10 }); await flush(); });
  assert.equal(snap.offline, false); assert.equal(snap.progress, null);
  await act(async () => { emit('library.previewProgress', null); emit('library.offline', null); await flush(); });
  assert.equal(snap.progress, null); assert.equal(snap.offline, false);
  await act(() => root.unmount());
});

test('a rejected rights call (401) means "unknown", not "owns everything"', async () => {
  server(); state.entitlementsStatus = 401; const root = await mount();
  assert.equal(snap.entitlements, null);
  await act(() => root.unmount());
});

test('unmounting removes the host listeners (no update after unmount)', async () => {
  server(); const before = requests.length;
  const root = await mount(); await act(() => root.unmount());
  const after = requests.length;
  emit('library.updated', {}); await flush();
  assert.equal(requests.length, after, 'no request after unmount'); assert.ok(after > before);
});

test('host events: handlers are isolated, unsubscribe works, unknown shapes are ignored', async () => {
  const seen = [];
  const off = onHostEvent('x.test', (d) => seen.push(['a', d]));
  onHostEvent('x.test', () => { throw new Error('bad handler'); });
  onHostEvent('x.test', (d) => seen.push(['c', d]));
  emit('x.test', 1);
  assert.deepEqual(seen, [['a', 1], ['c', 1]], 'a throwing handler does not block the others');
  off(); emit('x.test', 2);
  assert.deepEqual(seen.map((s) => s[0]), ['a', 'c', 'c']);
  listeners.forEach((f) => { f({ data: { event: 'x.test', id: 'some-request', data: 3 } }); f({ data: null }); f({ data: { event: 5 } }); });
  assert.equal(seen.length, 3, 'a message with a request id or a non-string event is not a host event');
});
