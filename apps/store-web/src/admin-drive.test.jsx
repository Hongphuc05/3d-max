// P3.1: man "Ket noi Drive" cua admin (API key + thu muc goc). jsdom + fetch gia, theo mau admin-ui.test.jsx.
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
const admin = { id: 'admin-id', email: 'admin@admin.invalid', role: 'ADMIN', username: 'fixture_owner', mustChangeCredentials: false };
const SECRET_KEY = 'AIzaSyShouldNeverAppear_0123456789abcdef';
let root, fixture;
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const v3Error = (status, code, message) => response({ error: { code, message, requestId: 'req-1' } }, status);
const source = (over = {}) => ({ id: 'src-1', connectionId: null, rootFolderName: 'Thu vien 3DS', sourceType: 'MY_DRIVE', enabled: true, lastSuccessfulSyncAt: null, ...over });

async function mount({ configured = true, sources = [] } = {}) {
  fixture = { sources, configured, requests: [], addError: null, testResult: null };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0], body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, body, method: init.method ?? 'GET' });
    if (path === '/api/auth/me') return response({ user: admin });
    if (path === '/api/auth/logout') return response({ ok: true });
    if (path === '/api/admin/catalog/sync/permission') return response({ allowed: true });
    if (path === '/api/admin/drive/status') return response({ configured: fixture.configured, missingConfig: fixture.configured ? [] : ['DRIVE_API_KEY'], connection: null, sources: fixture.sources });
    if (path === '/api/admin/drive/sources' && init.method === 'POST') {
      if (fixture.addError) return fixture.addError;
      if (fixture.gate) await fixture.gate;
      fixture.sources = [...fixture.sources, source({ id: 'src-new', rootFolderName: 'Thu muc moi' })];
      return response({ id: 'src-new', rootFolderName: 'Thu muc moi', sourceType: 'MY_DRIVE' }, 201);
    }
    if (path === '/api/admin/drive/test-access') return fixture.testResult ?? response({ canList: true, sampleCount: 3, canDownloadSample: true, account: null, details: [{ check: 'list', ok: true, count: 3 }, { check: 'download', ok: true }] });
    throw new Error(`Unhandled drive fixture ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<App />));
}
const button = (label) => { const element = [...container.querySelectorAll('button')].find((item) => item.textContent === label); assert.ok(element, `Missing ${label}`); return element; };
async function click(element) { await act(async () => element.click()); }
async function input(name, value) {
  await act(async () => {
    const element = container.querySelector(`[name="${name}"]`);
    assert.ok(element, `Missing input ${name}`);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function submit(form) { await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }
const openDrive = async () => click(button('Kết nối Drive'));
const calls = (path, method) => fixture.requests.filter((r) => r.path === path && (!method || r.method === method));

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('the Drive section loads only when opened; configured key and sources are shown without any secret', async () => {
  await mount({ sources: [source()] });
  await openDrive();
  assert.equal(calls('/api/admin/drive/status').length, 1);
  assert.match(container.textContent, /Đã cấu hình khóa API/);
  assert.match(container.textContent, /Thu vien 3DS/);
  assert.match(container.textContent, /Drive của tôi/);
  assert.match(container.textContent, /Đang bật/);
  assert.equal(container.textContent.includes(SECRET_KEY), false);
  assert.equal(container.querySelector('input[name="apiKey"]'), null, 'the API key is never typed in the UI (it lives in .env)');
});

test('missing key: shows the variable NAME, tells the admin to set it on the server, and blocks the folder form', async () => {
  await mount({ configured: false });
  await openDrive();
  assert.match(container.textContent, /Chưa cấu hình/);
  assert.match(container.textContent, /DRIVE_API_KEY/);
  assert.equal(container.querySelector('button[type="submit"]').disabled, true);
  assert.equal(calls('/api/admin/drive/sources', 'POST').length, 0);
});

test('add root folder: sends only the filled fields, refreshes the list, resets the form', async () => {
  await mount();
  await openDrive();
  assert.match(container.textContent, /Chưa có thư mục gốc/);
  await input('rootFolderUrlOrId', '  https://drive.google.com/drive/folders/abc123  ');
  await submit(container.querySelector('form'));
  const post = calls('/api/admin/drive/sources', 'POST');
  assert.equal(post.length, 1);
  assert.deepEqual(post[0].body, { rootFolderUrlOrId: 'https://drive.google.com/drive/folders/abc123' }, 'trimmed, no empty resourceKey');
  assert.match(container.textContent, /Thu muc moi/);
  assert.equal(container.querySelector('[name="rootFolderUrlOrId"]').value, '');

  await input('rootFolderUrlOrId', 'xyz');
  await input('resourceKey', 'rk-1');
  await submit(container.querySelector('form'));
  assert.deepEqual(calls('/api/admin/drive/sources', 'POST')[1].body, { rootFolderUrlOrId: 'xyz', resourceKey: 'rk-1' });
});

test('add root folder: empty input is not sent; a server refusal shows its Vietnamese message and keeps the form', async () => {
  await mount();
  await openDrive();
  await submit(container.querySelector('form'));
  assert.equal(calls('/api/admin/drive/sources', 'POST').length, 0, 'empty input never reaches the server');
  assert.match(container.textContent, /Hãy nhập/);

  fixture.addError = v3Error(422, 'DRIVE_NOT_FOUND', 'Không tìm thấy thư mục hoặc file trên Google Drive.');
  await input('rootFolderUrlOrId', 'missingFolder1');
  await submit(container.querySelector('form'));
  assert.match(container.querySelector('[role="alert"]').textContent, /Không tìm thấy thư mục/);
  assert.equal(container.querySelector('[name="rootFolderUrlOrId"]').value, 'missingFolder1', 'input kept so the admin can fix it');
});

test('add root folder cannot be double-submitted while the request is pending', async () => {
  await mount();
  await openDrive();
  let release; fixture.gate = new Promise((r) => { release = r; });
  await input('rootFolderUrlOrId', 'abc123');
  await submit(container.querySelector('form'));
  assert.equal(container.querySelector('button[type="submit"]').disabled, true);
  await submit(container.querySelector('form'));
  assert.equal(calls('/api/admin/drive/sources', 'POST').length, 1, 'second submit ignored while pending');
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.equal(container.querySelector('button[type="submit"]').disabled, false);
});

test('test access: shows each check separately, including a failure with its code', async () => {
  await mount({ sources: [source()] });
  await openDrive();
  await click(button('Kiểm tra truy cập'));
  assert.deepEqual(calls('/api/admin/drive/test-access')[0].body, { sourceId: 'src-1' });
  assert.match(container.textContent, /Liệt kê thư mục/);
  assert.match(container.textContent, /3 mục/);
  assert.match(container.textContent, /Tải thử file/);

  fixture.testResult = response({ canList: true, sampleCount: 3, canDownloadSample: false, account: null, details: [{ check: 'list', ok: true, count: 3 }, { check: 'download', ok: false, code: 'DRIVE_QUOTA_EXCEEDED' }] });
  await click(button('Kiểm tra truy cập'));
  assert.match(container.textContent, /DRIVE_QUOTA_EXCEEDED/);
  assert.match(container.textContent, /Không đạt/);
});

test('test access: a server error is shown as an alert, not as a success', async () => {
  await mount({ sources: [source()] });
  await openDrive();
  fixture.testResult = v3Error(409, 'DRIVE_NOT_CONNECTED', 'Chưa kết nối Google Drive.');
  await click(button('Kiểm tra truy cập'));
  assert.match(container.querySelector('[role="alert"]').textContent, /Chưa kết nối Google Drive/);
  assert.equal(container.textContent.includes('Liệt kê thư mục'), false);
});

test('a disabled source is labelled as off', async () => {
  await mount({ sources: [source({ enabled: false, lastSuccessfulSyncAt: '2026-11-01T00:00:00Z' })] });
  await openDrive();
  assert.match(container.textContent, /Đã tắt/);
  assert.equal(container.textContent.includes('Đang bật'), false);
});

test('api layer: a v3 error envelope becomes ApiError{status, code string, detail}; the legacy string error still works', async () => {
  const api = await import('./api.js');
  globalThis.fetch = async () => v3Error(409, 'DRIVE_NOT_CONNECTED', 'Chưa kết nối Google Drive.');
  const v3 = await api.adminDriveStatus().catch((e) => e);
  assert.ok(v3 instanceof api.ApiError);
  assert.equal(v3.status, 409); assert.equal(v3.code, 'DRIVE_NOT_CONNECTED'); assert.equal(v3.detail, 'Chưa kết nối Google Drive.');
  globalThis.fetch = async () => response({ error: 'FORBIDDEN' }, 403);
  const legacy = await api.adminDriveStatus().catch((e) => e);
  assert.equal(legacy.code, 'FORBIDDEN'); assert.equal(legacy.detail, undefined);
});
