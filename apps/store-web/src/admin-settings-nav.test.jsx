// P3.7: muc "Cai dat" nam trong trang quan tri, tai tre, va hien ca form lan bang model.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('./AdminEntry.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root; const requests = [];
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('the dashboard has lazy "Cài đặt" and "Model" (gallery cards with thumbnails) sections', async () => {
  requests.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0]; requests.push(path);
    if (path === '/api/auth/me') return response({ user: { id: 'admin-id', email: 'a@a.invalid', role: 'ADMIN', username: 'owner', mustChangeCredentials: false } });
    if (path === '/api/admin/catalog/sync/permission') return response({ allowed: true });
    if (path === '/api/admin/settings') return response({ bankName: null, bankBin: null, accountNo: null, accountName: null, defaultModelPriceVnd: 15000, orderTtlMinutes: 1440, maxPendingOrdersPerDevice: 3, updatedAt: null });
    if (path === '/api/admin/telegram/connections') return response({ canConnect: true, ownerChatIdsCount: 0, accounts: [] });
    if (path === '/api/admin/categories') return response({ items: [{ id: 'cat-1', parentId: null, name: 'Living', fullPath: 'Living', modelCount: 1 }] });
    if (path === '/api/admin/models') return response({ items: [{ id: 'm1', name: 'Sofa A', categoryPath: 'Living / Sofa', priceVnd: 15000, status: 'PUBLISHED', nameOverridden: false, priceOverridden: false, updatedAt: '2026-11-01T08:00:00Z', thumbUrl: '/previews/abc.webp' }], total: 1, page: 1, limit: 20 });
    throw new Error(`Unhandled ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<App />));
  const nav = [...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Cài đặt');
  assert.ok(nav, 'nav entry exists');
  assert.equal(requests.some((p) => p.startsWith('/api/admin/settings') || p.startsWith('/api/admin/models')), false, 'lazy: nothing requested before opening');
  await act(async () => nav.click());
  assert.ok(requests.includes('/api/admin/settings') && !requests.includes('/api/admin/models'));
  assert.ok(container.querySelector('[name="bankBin"]'), 'settings form is there');
  const models = [...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Model');
  assert.ok(models, 'Model nav entry exists');
  await act(async () => models.click());
  assert.ok(requests.includes('/api/admin/models'));
  assert.ok(container.querySelector('article[data-model="m1"]'), 'model gallery card is there');
  assert.equal(container.querySelector('article[data-model="m1"] img').getAttribute('src'), '/previews/abc.webp');
  assert.match(container.textContent, /Sofa A/);
});
