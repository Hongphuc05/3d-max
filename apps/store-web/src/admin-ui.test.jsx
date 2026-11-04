import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { AuthProvider, useAuth } = await import('./auth.jsx');
const { Gate } = await import('./AdminEntry.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
const admin = { id: 'admin-id', email: 'admin@admin.invalid', role: 'ADMIN', username: 'fixture_owner', mustChangeCredentials: false };
let root, fixture;
function AuthControl() { fixture.auth = useAuth(); return null; }
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function mount({ firstLogin = false, regular = false, meGate = null } = {}) {
  fixture = { user: regular ? { id: 'regular', email: 'regular@example.test' } : { ...admin, mustChangeCredentials: firstLogin }, requests: [] };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0], body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, body, method: init.method });
    if (path === '/api/auth/me') { const user = fixture.user; if (meGate) await meGate; return response({ user }); }
    if (path === '/api/auth/login') { fixture.user = { ...admin }; return response({ user: fixture.user }); }
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/admin/account') { if (fixture.accountGate) await fixture.accountGate; fixture.user = { ...fixture.user, username: body.username, mustChangeCredentials: false }; return response({ user: fixture.user }); }
    if (path.startsWith('/api/admin/')) return response({ configured: true, missingConfig: [], sources: [], items: [] });
    throw new Error(`Unhandled admin fixture ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AuthProvider><AuthControl /><Gate /></AuthProvider>));
}
const button = (label) => { const element = [...container.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(element, `Missing ${label}`); return element; };
async function click(element) { await act(async () => element.click()); }
async function input(name, value) {
  await act(async () => {
    const element = container.querySelector(`[name="${name}"]`);
    assert.ok(element, `Missing input ${name}`);
    const type = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit(form) { await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('admin enters management interface (Drive first) and nothing of the old storefront is mounted', async () => {
  await mount();
  assert.match(container.textContent, /Quản trị 3DsMood/);
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/drive/status'));
  assert.equal(fixture.requests.some(call => call.path === '/api/products' || call.path.startsWith('/api/licenses')), false);
  assert.equal(container.textContent.includes('My License'), false);
});

test('first admin login blocks management until credentials change and keeps the new session', async () => {
  await mount({ firstLogin: true });
  assert.equal(fixture.requests.some(call => call.path === '/api/admin/drive/status'), false);
  assert.equal(button('Kết nối Drive').disabled, true);
  await input('username', 'mood_operator');
  await input('currentPassword', 'test-only-bootstrap-password');
  await input('newPassword', 'changed-password');
  await input('confirmPassword', 'changed-password');
  await submit(container.querySelector('form'));
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/account' && call.method === 'PATCH' && call.body.username === 'mood_operator'));
  assert.equal(button('Kết nối Drive').disabled, false);
  assert.match(container.textContent, /mood_operator/);
});

test('a signed-in non-admin account sees the login form and no admin requests', async () => {
  await mount({ regular: true });
  assert.ok(container.querySelector('input[autocomplete="username"]'));
  assert.equal(fixture.requests.some(call => call.path.startsWith('/api/admin/')), false);
});

test('login form sends the username in the legacy `email` field and opens the dashboard', async () => {
  await mount({ regular: true });
  await act(async () => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); };
    set(container.querySelector('input[autocomplete="username"]'), 'fixture_owner');
    set(container.querySelector('input[type="password"]'), 'test-only-bootstrap-password');
  });
  await submit(container.querySelector('form'));
  assert.deepEqual(fixture.requests.find(call => call.path === '/api/auth/login').body, { email: 'fixture_owner', password: 'test-only-bootstrap-password' });
  assert.match(container.textContent, /Kết nối Drive/);
});

test('logout waits for pending credential renewal and delayed save cannot reopen admin', async () => {
  await mount({ firstLogin: true });
  let releaseAccount;
  fixture.accountGate = new Promise(resolve => { releaseAccount = resolve; });
  await input('currentPassword', 'test-only-bootstrap-password');
  await input('newPassword', 'changed-password');
  await input('confirmPassword', 'changed-password');
  await submit(container.querySelector('form'));
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/account'));
  try {
    await click(button('Đăng xuất'));
    assert.equal(fixture.requests.some(call => call.path === '/api/auth/logout'), false, 'logout must be sent after the renewed cookie arrives');
  } finally {
    await act(async () => { releaseAccount(); await new Promise(resolve => setImmediate(resolve)); });
  }
  assert.ok(fixture.requests.some(call => call.path === '/api/auth/logout'));
  assert.ok(container.querySelector('input[autocomplete="username"]'));
  assert.equal(container.textContent.includes('Quản trị 3DsMood'), true, 'the login screen carries the same product name');
  assert.equal(container.textContent.includes('Kết nối Drive'), false);
});

test('late initial me response cannot restore admin after logout', async () => {
  let releaseMe;
  const meGate = new Promise(resolve => { releaseMe = resolve; });
  await mount({ meGate });
  await act(async () => fixture.auth.logout());
  await act(async () => { releaseMe(); await new Promise(resolve => setImmediate(resolve)); });
  assert.ok(container.querySelector('input[autocomplete="username"]'));
  assert.equal(container.textContent.includes('Kết nối Drive'), false);
});
