import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  location: dom.window.location, sessionStorage: dom.window.sessionStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { AuthProvider, useAuth } = await import('./auth.jsx');
const { LicenseProvider, useLicense } = await import('./license.jsx');
const { default: App } = await import('./App.jsx');
const container = document.getElementById('root');
const user = { id: 'ad7c82a0-9e10-486c-b012-7bf814cfc531', email: 'ui@example.test' };
const key = '3DM-12345678-12345678-12345678-12345678-12345678';
const license = { id: 'license', type: 'LIFETIME', status: 'ACTIVE', key, last4: '5678' };
const identity = { deviceId: 'aa045744-7158-4bc2-9c37-80456955c98b',
  publicKey: { kty: 'RSA', n: 'fixture-public-key', e: 'AQAB' }, keyProtection: 'SOFTWARE', deviceName: 'UI PC' };
const orderId = 'bd6c593a-b5f3-4b1b-8668-587ee950a714';
let root, fixture, nativeListener;
function SessionControl() { fixture.auth = useAuth(); return null; }
function LicenseControl() {
  fixture.licenseState = useLicense();
  fixture.renders.push({ userId: useAuth().user?.id, key: fixture.licenseState.license?.key });
  return null;
}
const originalFetch = globalThis.fetch;
const nativeHost = {
  addEventListener: (_name, callback) => { nativeListener = callback; },
  postMessage: (message) => {
    fixture.nativeCalls.push(message);
    if (message.method === 'device.getIdentity' && fixture.identityFailure) {
      queueMicrotask(() => nativeListener({ data: { id: message.id, ok: false, error: { code: 'DEVICE_IDENTITY_LOST' } } }));
      return;
    }
    const result = message.method === 'device.getIdentity' ? identity
      : message.method === 'device.signChallenge' ? { signature: 'native-signature' }
        : message.method === 'host.getInfo' ? { hostVersion: '3ds Max fixture' } : { objects: 0, renderer: 'fixture' };
    queueMicrotask(() => nativeListener({ data: { id: message.id, ok: true, result } }));
  },
};
function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
async function mount({ host = false, loggedIn = false, licensed = false, activated = false, available = true,
  catalogAdmin = false, catalogItems = [], sessionLicenseId = license.id, identityFailure = false } = {}) {
  fixture = { loggedIn, licensed, activated, available, catalogAdmin, catalogItems, sessionLicenseId,
    requests: [], nativeCalls: [], renders: [], activationError: null, paid: false, identityFailure };
  window.chrome = host ? { webview: nativeHost } : undefined;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0];
    const body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, body, credentials: init.credentials });
    if (path === '/api/auth/me') return fixture.loggedIn ? response({ user }) : response({ error: 'UNAUTHENTICATED' }, 401);
    if (path === '/api/auth/login') { fixture.loggedIn = true; return response({ user: fixture.loginUser || user }); }
    if (path === '/api/auth/logout') { fixture.loggedIn = false; return response({ ok: true }); }
    if (path === '/api/health') return response({ ok: true });
    if (path === '/api/admin/catalog/sync/permission') return response({ allowed: fixture.catalogAdmin });
    if (path === '/api/admin/catalog/sync' && init.method === 'POST') return response({ accepted: true }, 202);
    if (path === '/api/categories') return response([]);
    if (path === '/api/catalog/version') return response({ version: 0, state: 'empty', provider: 'r2' });
    if (path === '/api/products') return response({ items: fixture.catalogItems, total: fixture.catalogItems.length });
    if (path === '/api/licenses/me') return response({ license: fixture.licensed ? license : null });
    if (path === '/api/licenses/devices') return response({ devices: fixture.licensed && fixture.activated ? [{ id: 'slot', ...identity, slotNumber: 1, activatedAt: '2026-10-25' }] : [] });
    if (path === '/api/devices/challenge') return response({ challengeId: 'challenge', message: 'server-challenge', expiresAt: new Date(Date.now() + 120000).toISOString() });
    if (path === '/api/devices/verify' && !fixture.activated) return response({ error: 'DEVICE_NOT_ACTIVATED' }, 403);
    if (path === '/api/licenses/activate' && fixture.activationError) return response({ error: fixture.activationError }, 409);
    if (path === '/api/devices/verify' || path === '/api/licenses/activate') {
      fixture.activated = true;
      return response({ license: { id: fixture.sessionLicenseId, type: license.type, status: license.status }, device: { ...identity }, expiresAt: new Date(Date.now() + 900000).toISOString() });
    }
    if (path === '/api/payments/product') return response({ product: { amountVnd: 2000, available: fixture.available } });
    if (path.startsWith('/api/payments/')) {
      if (path === '/api/payments/create' && fixture.stallCreate) return fixture.stallCreate;
      if (path.endsWith('/reconcile')) { fixture.paid = true; fixture.licensed = true; }
      return response({ order: { id: orderId, orderCode: 1234, amountVnd: 2000,
        qrCode: '00020101021238570010A0000007270127000697042201131234567890123520459995303704540420005802VN6304ABCD',
        accountNumber: '1234567890123', accountName: '3DSMOOD', bankBin: '970422', description: '3DsMood',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        status: fixture.paid ? 'PAID' : 'PENDING', checkoutUrl: 'https://pay.payos.vn/web/fixture' } });
    }
    throw new Error(`Unhandled fixture route ${path}`);
  };
  root = createRoot(container);
  await act(async () => { root.render(<AuthProvider><SessionControl /><LicenseProvider><LicenseControl /><App /></LicenseProvider></AuthProvider>); });
}
const buttons = () => [...container.querySelectorAll('button')];
const button = (label) => { const element = buttons().find((value) => value.textContent === label); assert.ok(element, `Missing button ${label}`); return element; };
async function click(element) { await act(async () => { element.click(); }); }
const flush = () => new Promise(resolve => setImmediate(resolve));
async function input(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit(form) { await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); }
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; sessionStorage.clear(); dom.window.history.replaceState(null, '', '/');
});

test('only an authorized admin can request an immediate R2 catalog sync', async () => {
  await mount({ loggedIn: true, catalogAdmin: true });
  await act(async () => { await flush(); await flush(); });
  await click(button('Sync R2 Now'));
  assert.ok(fixture.requests.some(call => call.path === '/api/admin/catalog/sync' && call.body && call.credentials === 'include'));
  assert.match(container.querySelector('[role="status"]')?.textContent || '', /quét R2/i);
  await act(async () => root.unmount());
  root = null;

  await mount({ loggedIn: true, catalogAdmin: false });
  await act(async () => { await flush(); await flush(); });
  assert.equal(buttons().some(value => value.textContent === 'Sync R2 Now'), false);
});
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('UI: login, native fallback warning, slot limit error then activation; no reset UI or persistent raw key', async () => {
  await mount({ host: true, licensed: true });
  await click(button('My License · Lifetime'));
  await click([...container.querySelectorAll('[role="dialog"] button')].find((element) => element.textContent === 'Đăng nhập'));
  await input(container.querySelector('input[autocomplete="username"]'), user.email);
  await input(container.querySelector('input[type="password"]'), 'valid-password');
  await submit(container.querySelector('input[autocomplete="username"]').closest('form'));
  assert.match(container.textContent, /mức bảo vệ thấp hơn khóa TPM/);
  assert.match(container.textContent, /Không xóa, đổi hoặc chuyển slot/);
  fixture.activationError = 'DEVICE_LIMIT_REACHED';
  const keyInput = container.querySelector('input[placeholder="3DM-…"]');
  await input(keyInput, key);
  await submit(keyInput.closest('form'));
  assert.match(container.textContent, /License đã gắn đủ 2 thiết bị/);
  fixture.activationError = null;
  await submit(keyInput.closest('form'));
  assert.match(container.textContent, /Thiết bị đã được xác minh/);
  assert.match(container.textContent, /Thiết bị đã gắn \(1\/2\)/);
  assert.equal(buttons().some((element) => /reset|deactivate|transfer/i.test(element.textContent)), false);
  assert.equal(JSON.stringify({ ...sessionStorage }).includes(key), false);
  const request = fixture.requests.find((value) => value.path === '/api/licenses/activate');
  assert.equal(request.body.signature, 'native-signature');
  assert.equal(request.credentials, 'include');
});

test('UI: existing device restores from native proof without activation/key submission', async () => {
  await mount({ host: true, loggedIn: true, licensed: true, activated: true });
  await click(button('My License · Lifetime'));
  assert.equal(fixture.licenseState.canImport, true);
  assert.match(container.textContent, /Thiết bị đã được xác minh/);
  assert.equal(fixture.requests.some((value) => value.path === '/api/licenses/activate'), false);
  const proof = fixture.requests.find((value) => value.path === '/api/devices/verify');
  assert.deepEqual(proof.body, { challengeId: 'challenge', signature: 'native-signature' });
});

test('UI: reopening the app restores the same account and existing device slot without activation', async () => {
  for (let launch = 0; launch < 2; launch++) {
    await mount({ host: true, loggedIn: true, licensed: true, activated: true });
    await click(button('My License · Lifetime'));
    assert.equal(fixture.auth.user.id, user.id);
    assert.equal(fixture.licenseState.canImport, true);
    assert.equal(fixture.licenseState.devices.length, 1);
    assert.equal(fixture.licenseState.identity.deviceId, identity.deviceId);
    assert.match(container.textContent, /Thiết bị đã được xác minh/);
    assert.equal(container.querySelector('input[placeholder="3DM-…"]'), null);
    assert.equal(fixture.requests.some(call => ['/api/auth/login', '/api/licenses/activate'].includes(call.path)), false);
    assert.equal(fixture.requests.filter(call => call.path === '/api/devices/verify').length, 1);
    await act(async () => root.unmount());
    root = null;
  }
});

test('UI: device identity failure is shown once and pasting a key allows activation to retry identity', async () => {
  await mount({ host: true, loggedIn: true, licensed: true, identityFailure: true });
  await act(async () => { await flush(); await flush(); });
  const alerts = [...container.querySelectorAll('[role="alert"]')];
  assert.equal(alerts.filter(element => element.textContent.includes('Danh tính hoặc khóa thiết bị đã mất')).length, 1);
  assert.equal(fixture.nativeCalls.filter(call => call.method === 'device.getIdentity').length, 1);
  const keyInput = container.querySelector('input[placeholder="3DM-…"]');
  await input(keyInput, key);
  assert.equal(button('Kích hoạt máy này').disabled, false);
  fixture.identityFailure = false;
  await click(button('Kích hoạt máy này'));
  assert.ok(fixture.requests.some(call => call.path === '/api/licenses/activate'));
  assert.equal(fixture.licenseState.canImport, true);
  assert.equal(container.textContent.includes('Danh tính hoặc khóa thiết bị đã mất'), false);
});

test('UI: an account without its own license cannot import from a machine activated by another account', async () => {
  await mount({ host: true, loggedIn: true, activated: true });
  await click(button('My License · Lifetime'));
  assert.equal(fixture.licenseState.canImport, false);
  assert.equal(fixture.licenseState.license, null);
  assert.equal(fixture.licenseState.session.license.status, 'ACTIVE');
  assert.match(container.textContent, /Máy này đã được kích hoạt bằng license của tài khoản khác/);
  assert.equal(container.textContent.includes(key), false);
  assert.equal(container.querySelector('input[placeholder="3DM-…"]') !== null, false);
  assert.ok(buttons().some(element => element.textContent === 'Mua Lifetime'));
  assert.equal(fixture.requests.some(r => r.path === '/api/licenses/activate'), false);
});

test('UI: an owned license still requires activation against that same license', async () => {
  await mount({ host: true, loggedIn: true, licensed: true, activated: true, sessionLicenseId: 'another-license' });
  await click(button('My License · Lifetime'));
  assert.equal(fixture.licenseState.canImport, false);
  assert.match(container.textContent, /Máy này đã được kích hoạt bằng license của tài khoản khác/);
  assert.ok(container.querySelector('input[placeholder="3DM-…"]'));
  assert.equal(container.textContent.includes('Có thể Download & import.'), false);
});

test('UI: owner key is never rendered under a different logged-in account', async () => {
  await mount({ host: true, loggedIn: true, licensed: true, activated: true });
  fixture.loginUser = { id: 'a030ac89-59ba-4431-b378-d4b0bbcc7d1e', email: 'other@example.test' };
  fixture.licensed = false;
  await act(async () => { await fixture.auth.login('other@example.test', 'password'); });
  assert.equal(fixture.renders.some(r => r.userId === fixture.loginUser.id && r.key === key), false);
  assert.equal(fixture.licenseState.canImport, false);
});

test('UI: an unlicensed Max account can see a preview but has no Download or import action', async () => {
  const product = { id: 'abc123abc123', slug: 'preview-only', name: 'Preview only', category: 'Furniture',
    subcategory: 'Sofa', folderPath: 'Furniture/Sofa', status: 'ready', downloadable: true,
    thumb: '/api/catalog/models/abc123abc123/preview?v=1', image: '/api/catalog/models/abc123abc123/preview?v=1',
    info: { renderers: [], formats: [], sizeMB: 1, hasTextures: false } };
  await mount({ host: true, loggedIn: true, activated: true, catalogItems: [product] });
  await act(async () => { await flush(); await flush(); });
  assert.equal(fixture.licenseState.canImport, false);
  assert.equal(container.querySelector('img[alt="Preview only"]')?.getAttribute('src'), product.thumb);
  assert.equal(buttons().some(element => ['Download', 'Download & import vào 3ds Max'].includes(element.textContent)), false);
  assert.ok(buttons().some(element => element.textContent === 'Mua license để tải'));
});

test('UI: fake paid query remains pending; only server reconciliation exposes license', async () => {
  dom.window.history.replaceState(null, '', `/license?orderId=${orderId}&status=PAID&success=true`);
  await mount({ loggedIn: true });
  assert.match(container.textContent, /Đang chờ thanh toán/);
  assert.equal(container.textContent.includes(key), false);
  assert.equal(container.querySelector('a[href="https://pay.payos.vn/web/fixture"]')?.rel, 'noopener noreferrer');
  await click(button('Kiểm tra thanh toán'));
  assert.equal(Boolean(container.querySelector('#payment-title')), false, 'paid modal must reveal the license automatically');
  assert.match(container.textContent, /Thanh toán thành công/);
  assert.equal(container.querySelector('code')?.textContent, key);
  assert.equal(sessionStorage.getItem(`3dm-order:${user.id}`), null);
  assert.match(container.textContent, /3DsMood Lifetime - Active/);
  assert.equal(fixture.requests.some((value) => value.path === '/api/payments/create'), false);
});

test('UI: paid confirmation closes payment immediately while the owner key is still loading', async () => {
  dom.window.history.replaceState(null, '', `/license?orderId=${orderId}`);
  await mount({ loggedIn: true });
  const fetchFixture = globalThis.fetch;
  let resolveLicense;
  globalThis.fetch = async (url, init) => String(url) === '/api/licenses/me'
    ? new Promise(resolve => { resolveLicense = resolve; }) : fetchFixture(url, init);
  await click(button('Kiểm tra thanh toán'));
  assert.equal(Boolean(container.querySelector('#payment-title')), false);
  assert.match(container.textContent, /Đang tải key license từ máy chủ/);
  await act(async () => { resolveLicense(response({ license })); });
  assert.equal(Boolean(container.querySelector('#payment-title')), false);
  assert.equal(container.querySelector('code')?.textContent, key);
});

test('UI: payment confirmation loads the key without starting another native device verification', async () => {
  dom.window.history.replaceState(null, '', `/license?orderId=${orderId}`);
  await mount({ host: true, loggedIn: true });
  const fetchFixture = globalThis.fetch;
  let resolveVerification, verificationStarted = false;
  globalThis.fetch = async (url, init) => String(url) === '/api/devices/verify'
    ? new Promise(resolve => { verificationStarted = true; resolveVerification = resolve; }) : fetchFixture(url, init);
  await click(button('Kiểm tra thanh toán'));
  try {
    assert.equal(container.querySelector('code')?.textContent, key);
    assert.equal(Boolean(container.querySelector('#payment-title')), false);
    assert.equal(verificationStarted, false);
  } finally {
    if (resolveVerification) await act(async () => { resolveVerification(response({ error: 'DEVICE_NOT_ACTIVATED' }, 403)); });
  }
});

test('UI: missing provider configuration disables purchase', async () => {
  await mount({ loggedIn: true, available: false });
  await click(button('My License · Lifetime'));
  assert.equal(button('Mua Lifetime').disabled, true);
  assert.match(container.textContent, /Thanh toán tạm thời chưa khả dụng/);
});

test('UI: buy displays local VietQR, price, bank fields and countdown; close keeps pending order for reload', async () => {
  await mount({ loggedIn: true });
  await click(button('My License · Lifetime'));
  assert.match(container.textContent, /2\.000 ₫/);
  await click(button('Mua Lifetime'));
  assert.match(container.textContent, /Thanh toán 3DsMood Lifetime/);
  assert.ok(container.querySelector('svg[aria-label="Mã VietQR thanh toán"] path'));
  assert.match(container.textContent, /1234567890123/);
  assert.match(container.textContent, /QR hết hạn sau/);
  assert.equal(sessionStorage.getItem(`3dm-order:${user.id}`), orderId);
  await click(button('Đóng thanh toán'));
  assert.equal(container.querySelector('svg[aria-label="Mã VietQR thanh toán"]'), null);
  await click(button('Tiếp tục đơn thanh toán'));
  assert.ok(container.querySelector('svg[aria-label="Mã VietQR thanh toán"]'));
  assert.equal(fixture.requests.filter(r => r.path === '/api/payments/create').length, 1);
});

test('UI: custom callback path opens owner order without trusting cancel or paid URL status', async () => {
  dom.window.history.replaceState(null, '', `/payment/cancel?orderId=${orderId}&status=PAID&cancel=true`);
  await mount({ loggedIn: true });
  assert.match(container.textContent, /Thanh toán 3DsMood Lifetime/);
  assert.match(container.textContent, /Đang chờ thanh toán/);
  assert.equal(fixture.requests.some(r => r.path === '/api/payments/create'), false);
});

test('UI: account change cancels stale checkout and restores purchase controls', async () => {
  await mount({ loggedIn: true });
  await click(button('My License · Lifetime'));
  let resolve;
  fixture.stallCreate = new Promise(done => { resolve = done; });
  await click(button('Mua Lifetime'));
  assert.equal(button('Đang xử lý…').disabled, true);
  await act(async () => { await fixture.auth.logout(); });
  await act(async () => { await fixture.auth.login('ui@example.test', 'password'); });
  assert.equal(button('Mua Lifetime').disabled, false);
  await act(async () => { resolve(response({ order: { id: orderId, status: 'PENDING' } })); });
  assert.equal(container.textContent.includes('Thanh toán 3DsMood Lifetime'), false);
});
