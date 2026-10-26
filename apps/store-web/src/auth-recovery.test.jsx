import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://app.3dsmood.local/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { AuthProvider, useAuth } = await import('./auth.jsx');
const { LicenseProvider } = await import('./license.jsx');
const { default: App } = await import('./App.jsx');
const originalFetch = globalThis.fetch;
const container = document.getElementById('root');
const customer = { id: 'persisted-account', email: 'persistent@example.test' };
const admin = { ...customer, role: 'ADMIN', username: 'operator', mustChangeCredentials: false };
let root, auth, requests;
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
function Control() { auth = useAuth(); return null; }
async function mount(me) {
  requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ path: String(url), credentials: options.credentials });
    if (url === '/api/auth/me') return me();
    if (url === '/api/auth/login') return response({ user: customer });
    if (url === '/api/auth/logout') return response({ ok: true });
    if (url === '/api/admin/overview') return response({ stats: {}, catalog: {} });
    if (url === '/api/licenses/me') return response({ license: null });
    if (url === '/api/licenses/devices') return response({ devices: [] });
    if (url === '/api/admin/catalog/sync/permission') return response({ allowed: false });
    if (url === '/api/health') return response({ ok: true });
    if (url === '/api/categories') return response([]);
    if (url === '/api/catalog/version') return response({ provider: 'r2', state: 'empty', version: 0 });
    if (String(url).startsWith('/api/products')) return response({ items: [], total: 0 });
    throw new Error(`Unexpected request ${url}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AuthProvider><Control /><LicenseProvider><App /></LicenseProvider></AuthProvider>));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('temporary startup network error keeps the persisted session unresolved and blocks the storefront', async () => {
  await mount(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(auth.user, undefined, 'network loss must not be treated as an expired login');
  assert.match(container.textContent, /kết nối Internet/i);
  assert.equal(container.textContent.includes('My License'), false);
  assert.equal(container.textContent.includes('Đăng nhập'), false);
  assert.ok([...container.querySelectorAll('button')].some(button => button.textContent === 'Thử lại'));
  assert.equal(requests[0].credentials, 'include');
});

test('retry restores the same account from its existing cookie after a temporary server outage', async () => {
  let unavailable = true;
  await mount(async () => unavailable ? response({ error: 'DATABASE_UNAVAILABLE' }, 503) : response({ user: admin }));
  assert.equal(auth.user, undefined);
  unavailable = false;
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Thử lại').click());
  assert.deepEqual(auth.user, admin);
  assert.match(container.textContent, /Quản trị 3DsMood/);
  assert.equal(requests.some(request => request.path === '/api/auth/login'), false);
});

test('restored Internet retries verification without asking for a new password', async () => {
  let unavailable = true;
  await mount(async () => { if (unavailable) throw new TypeError('offline'); return response({ user: admin }); });
  unavailable = false;
  await act(async () => window.dispatchEvent(new window.Event('online')));
  assert.deepEqual(auth.user, admin);
  assert.equal(requests.filter(request => request.path === '/api/auth/me').length, 2);
  assert.equal(requests.some(request => request.path === '/api/auth/login'), false);
});

test('only an authentication rejection clears a persisted session', async () => {
  await mount(async () => response({ error: 'UNAUTHENTICATED' }, 401));
  assert.equal(auth.user, null);
  assert.equal(auth.restoreError, '');
});

test('a late restore response cannot replace an account changed by the user', async () => {
  let release;
  await mount(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { await auth.login(customer.email, 'test-password'); });
  await act(async () => release(response({ user: admin })));
  assert.deepEqual(auth.user, customer);
});
