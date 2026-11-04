// P3.7: form cai dat (ngan hang, gia mac dinh, TTL don, so don cho). jsdom + fetch gia. Dinh dang kiem tai client giong may chu.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminSettingsForm } = await import('./AdminSettingsForm.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, fixture;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const v3Error = (status, code, message) => response({ error: { code, message, requestId: 'req-1' } }, status);
const unsaved = { bankName: null, bankBin: null, accountNo: null, accountName: null, libraryPriceVnd: 20000, orderTtlMinutes: 1440, maxPendingOrdersPerDevice: 3, updatedAt: null };
const saved = { bankName: 'Vietcombank', bankBin: '970436', accountNo: '0123456789', accountName: 'NGUYEN VAN A', libraryPriceVnd: 25000, orderTtlMinutes: 720, maxPendingOrdersPerDevice: 2, updatedAt: '2026-11-01T08:00:00Z' };

async function mount(initial = unsaved) {
  fixture = { current: initial, requests: [], putError: null, getError: null };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0], method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, method, body });
    if (path === '/api/admin/settings' && method === 'GET') return fixture.getError ?? response(fixture.current);
    if (path === '/api/admin/settings' && method === 'PUT') {
      if (fixture.putError) return fixture.putError;
      if (fixture.gate) await fixture.gate;
      fixture.current = { ...body, updatedAt: '2026-11-01T09:30:00Z' };
      return response(fixture.current);
    }
    throw new Error(`Unhandled settings fixture ${method} ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AdminSettingsForm />));
}
const field = (name) => { const el = container.querySelector(`[name="${name}"]`); assert.ok(el, `Missing field ${name}`); return el; };
async function type(name, value) {
  await act(async () => {
    const el = field(name);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
const saveButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Lưu cài đặt');
async function submit() { await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }
const puts = () => fixture.requests.filter((r) => r.method === 'PUT');

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('before the first save: shows the defaults, says nothing was saved yet, and the save button is off (nothing to save)', async () => {
  await mount();
  assert.match(container.textContent, /Chưa lưu lần nào/);
  assert.equal(field('libraryPriceVnd').value, '20000');
  assert.equal(field('orderTtlMinutes').value, '1440');
  assert.equal(field('bankName').value, '');
  assert.equal(saveButton().disabled, true, 'unchanged form cannot be saved');
  assert.match(container.textContent, /Điền đủ cả 4 thông tin ngân hàng/);
});

test('saved settings are loaded into the form; when all four bank fields are set the hint disappears', async () => {
  await mount(saved);
  assert.equal(field('bankName').value, 'Vietcombank'); assert.equal(field('bankBin').value, '970436');
  assert.equal(field('accountNo').value, '0123456789'); assert.equal(field('accountName').value, 'NGUYEN VAN A');
  assert.equal(field('libraryPriceVnd').value, '25000'); assert.equal(field('maxPendingOrdersPerDevice').value, '2');
  assert.equal(container.textContent.includes('Chưa lưu lần nào'), false);
  assert.match(container.textContent, /Lần lưu gần nhất/);
  assert.equal(container.textContent.includes('Điền đủ cả 4 thông tin ngân hàng'), false);
});

test('save: PUT carries all seven fields, trimmed text and real numbers; success is acknowledged and the button goes off again', async () => {
  await mount();
  await type('bankName', '  Vietcombank '); await type('bankBin', '970436'); await type('accountNo', '0123456789'); await type('accountName', 'NGUYEN VAN A');
  await type('libraryPriceVnd', '30000'); await type('orderTtlMinutes', '60'); await type('maxPendingOrdersPerDevice', '5');
  assert.equal(saveButton().disabled, false);
  await submit();
  assert.equal(puts().length, 1);
  assert.deepEqual(puts()[0].body, { bankName: 'Vietcombank', bankBin: '970436', accountNo: '0123456789', accountName: 'NGUYEN VAN A',
    libraryPriceVnd: 30000, orderTtlMinutes: 60, maxPendingOrdersPerDevice: 5 });
  assert.match(container.textContent, /Đã lưu cài đặt/);
  assert.equal(container.textContent.includes('Chưa lưu lần nào'), false);
  assert.equal(saveButton().disabled, true, 'nothing left to save');
});

test('empty optional bank fields are sent as null (clears them), not as empty text', async () => {
  await mount(saved);
  await type('bankName', ''); await type('bankBin', '   '); await type('accountNo', ''); await type('accountName', '');
  await submit();
  assert.deepEqual([puts()[0].body.bankName, puts()[0].body.bankBin, puts()[0].body.accountNo, puts()[0].body.accountName], [null, null, null, null]);
});

test('client-side checks block bad input with a clear message and send NOTHING', async () => {
  await mount();
  const cases = [
    ['bankBin', '12345', /BIN gồm đúng 6 chữ số/], ['bankBin', '12345a', /BIN gồm đúng 6 chữ số/],
    ['accountNo', '12345', /Số tài khoản gồm 6–19 chữ số/], ['accountNo', 'ABC123456', /Số tài khoản gồm 6–19 chữ số/],
    ['bankName', 'x'.repeat(101), /Tối đa 100 ký tự/],
    ['libraryPriceVnd', '100000001', /từ 1 đến 100\.000\.000/], ['libraryPriceVnd', '0', /từ 1 đến 100\.000\.000/], ['libraryPriceVnd', '-1', /từ 1 đến 100\.000\.000/], ['libraryPriceVnd', '1.5', /từ 1 đến 100\.000\.000/], ['libraryPriceVnd', '', /từ 1 đến 100\.000\.000/],
    ['orderTtlMinutes', '0', /từ 1 đến 43\.200/], ['orderTtlMinutes', '43201', /từ 1 đến 43\.200/],
    ['maxPendingOrdersPerDevice', '0', /từ 1 đến 20/], ['maxPendingOrdersPerDevice', '21', /từ 1 đến 20/],
  ];
  for (const [name, value, message] of cases) {
    await mount();
    await type(name, value);
    await submit();
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', message, `${name}=${value}`);
    assert.equal(puts().length, 0, `${name}=${value} must not reach the server`);
    await act(async () => root.unmount()); root = null;
  }
});

test('a server refusal is shown and the admin\'s edits are kept', async () => {
  await mount();
  await type('bankBin', '970436');
  fixture.putError = v3Error(400, 'INVALID_PARAMS', 'Dữ liệu gửi lên không hợp lệ.');
  await submit();
  assert.match(container.querySelector('[role="alert"]').textContent, /Dữ liệu gửi lên không hợp lệ/);
  assert.equal(field('bankBin').value, '970436');
  assert.equal(saveButton().disabled, false, 'can retry');
});

test('the save cannot be double-submitted while the request is pending', async () => {
  await mount();
  await type('orderTtlMinutes', '90');
  let release; fixture.gate = new Promise((r) => { release = r; });
  await submit();
  assert.equal(saveButton().disabled, true);
  await submit();
  assert.equal(puts().length, 1);
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.match(container.textContent, /Đã lưu cài đặt/);
});

test('editing again after a save clears the "saved" message and re-enables the button', async () => {
  await mount();
  await type('orderTtlMinutes', '90'); await submit();
  assert.match(container.textContent, /Đã lưu cài đặt/);
  await type('orderTtlMinutes', '100');
  assert.equal(container.textContent.includes('Đã lưu cài đặt'), false);
  assert.equal(saveButton().disabled, false);
});

test('a failed load shows the error with a retry', async () => {
  fixture = null;
  globalThis.fetch = async () => v3Error(500, 'INTERNAL', 'Lỗi hệ thống. Thử lại sau.');
  root = createRoot(container);
  await act(async () => root.render(<AdminSettingsForm />));
  assert.match(container.querySelector('[role="alert"]').textContent, /Lỗi hệ thống/);
  assert.ok([...container.querySelectorAll('button')].some((b) => b.textContent === 'Thử lại'));
  assert.equal(container.querySelector('form'), null, 'no form when the settings could not be loaded (cannot overwrite blindly)');
});
