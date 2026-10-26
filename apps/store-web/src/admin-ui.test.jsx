import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { AuthProvider, useAuth } = await import('./auth.jsx');
const { LicenseProvider } = await import('./license.jsx');
const { default: App } = await import('./App.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
const admin = { id: 'admin-id', email: 'admin@admin.invalid', role: 'ADMIN', username: 'fixture_owner', mustChangeCredentials: false };
const customer = { id: 'customer-id', email: 'customer@example.test', createdAt: '2026-10-25T00:00:00Z', license: null, deviceCount: 0 };
let root, fixture;
function AuthControl() { fixture.auth = useAuth(); return null; }
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
async function mount({ firstLogin = false, regular = false, meGate = null } = {}) {
  fixture = { user: regular ? { id: 'regular', email: 'regular@example.test' } : { ...admin, mustChangeCredentials: firstLogin }, requests: [] };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0], body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, body, method: init.method });
    if (path === '/api/auth/me') { const user = fixture.user; if (meGate) await meGate; return response({ user }); }
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/licenses/me') return response({ license: null });
    if (path === '/api/licenses/devices') return response({ devices: [] });
    if (path === '/api/admin/overview') return response({ stats: { users: 4, activeLicenses: 2, paidOrders: 2, revenueVnd: 4000 }, catalog: { provider: 'r2', state: 'ready', version: 1, syncing: false } });
    if (path === '/api/admin/users') return response({ items: [customer], total: 1, page: 1, limit: 20 });
    if (path === `/api/admin/users/${customer.id}`) return response({ user: customer, license: fixture.license || null, devices: fixture.license ? [{ id: 'slot', deviceId: 'device-id', slotNumber: 1, deviceName: 'Workstation', keyProtection: 'TPM', activatedAt: customer.createdAt, lastSeenAt: customer.createdAt }] : [], orders: [], audit: [] });
    if (path === '/api/admin/licenses/issue') { fixture.license = { id: 'license', status: 'ACTIVE', type: 'LIFETIME', last4: 'ABCD' }; return response({ license: fixture.license }); }
    if (path === '/api/admin/licenses/revoke') { fixture.license = { ...fixture.license, status: body.status }; return response({ license: fixture.license }); }
    if (path === '/api/admin/account') { if (fixture.accountGate) await fixture.accountGate; fixture.user = { ...fixture.user, username: body.username, mustChangeCredentials: false }; return response({ user: fixture.user }); }
    if (path === '/api/admin/catalog/sync/permission') return response({ allowed: !regular });
    if (path === '/api/health') return response({ ok: true });
    if (path === '/api/categories') return response([]);
    if (path === '/api/catalog/version') return response({ provider: 'r2', state: 'empty', version: 0 });
    if (path === '/api/products') return response({ items: [], total: 0 });
    throw new Error(`Unhandled admin fixture ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AuthProvider><AuthControl /><LicenseProvider><App /></LicenseProvider></AuthProvider>));
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

test('admin enters management interface and does not mount catalog browsing', async () => {
  await mount();
  assert.match(container.textContent, /Quản trị 3DsMood/);
  assert.match(container.textContent, /Doanh thu/);
  assert.equal(fixture.requests.some(call => call.path === '/api/products'), false);
  assert.equal(container.textContent.includes('My License'), false);
});

test('first admin login blocks management until credentials change and keeps the new session', async () => {
  await mount({ firstLogin: true });
  assert.equal(fixture.requests.some(call => call.path === '/api/admin/overview'), false);
  assert.equal(button('Tài khoản & license').disabled, true);
  await input('username', 'mood_operator');
  await input('currentPassword', 'test-only-bootstrap-password');
  await input('newPassword', 'changed-password');
  await input('confirmPassword', 'changed-password');
  await submit(container.querySelector('form'));
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/account' && call.method === 'PATCH' && call.body.username === 'mood_operator'));
  assert.equal(button('Tài khoản & license').disabled, false);
  assert.match(container.textContent, /mood_operator/);
});

test('admin can issue license and review permanent revoke before submitting a reason', async () => {
  await mount();
  await click(button('Tài khoản & license'));
  await click(button('Xem chi tiết'));
  await click(button('Cấp license Lifetime'));
  await click(button('Xác nhận cấp license'));
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/licenses/issue' && call.body.userId === customer.id));
  assert.match(container.textContent, /Workstation/);
  assert.equal(container.textContent.includes('Xóa thiết bị'), false);
  await click(button('Thu hồi vĩnh viễn'));
  assert.equal(fixture.requests.some(call => call.path === '/api/admin/licenses/revoke'), false);
  await input('reason', 'Tài khoản vi phạm điều khoản sử dụng');
  await click(button('Xác nhận thu hồi'));
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/licenses/revoke' && call.body.status === 'REVOKED' && call.body.reason));
  assert.match(container.textContent, /Đã thu hồi/);
});

test('regular account continues to see storefront without admin requests', async () => {
  await mount({ regular: true });
  assert.match(container.textContent, /My License/);
  assert.equal(fixture.requests.some(call => call.path === '/api/admin/overview'), false);
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
  assert.match(container.textContent, /My License/);
  assert.equal(container.textContent.includes('Quản trị 3DsMood'), false);
});

test('late initial me response cannot restore admin after logout', async () => {
  let releaseMe;
  const meGate = new Promise(resolve => { releaseMe = resolve; });
  await mount({ meGate });
  await act(async () => fixture.auth.logout());
  await act(async () => { releaseMe(); await new Promise(resolve => setImmediate(resolve)); });
  assert.match(container.textContent, /My License/);
  assert.equal(container.textContent.includes('Quản trị 3DsMood'), false);
});
