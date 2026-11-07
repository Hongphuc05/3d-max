// Trang cong khai: chi xem model, khong mua/gia; nut tai thu vien theo ket qua HEAD; Max van vao PluginApp.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: PublicCatalog } = await import('./PublicCatalog.jsx');
const { isPublicSite } = await import('./entry-select.js');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 20));
let zipStatus = 200;
const packageBytes = new Uint8Array([0x50, 0x4b, 3, 4, 0x11, 0x22]);
const wrongHeaderResponse = () => new Response(packageBytes, { headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="3dsmood-library.zip"' } });
let downloadResponse = wrongHeaderResponse, downloadGets = 0, blobSequence = 0;
const savedFiles = [], objectBlobs = new Map();
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
URL.createObjectURL = blob => { const url = 'blob:gallery-' + (++blobSequence); objectBlobs.set(url, blob); return url; };
URL.revokeObjectURL = url => objectBlobs.delete(url);
const originalClick = dom.window.HTMLAnchorElement.prototype.click;
dom.window.HTMLAnchorElement.prototype.click = function () {
  if (this.href.startsWith('blob:gallery-')) { savedFiles.push({ name: this.download, blob: objectBlobs.get(this.href) }); return; }
  return originalClick.call(this);
};
const original = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const path = String(url);
  if (path === '/download/3dsmood-library.mzp') {
    if (opts.method === 'HEAD') return new Response(null, { status: zipStatus });
    assert.equal(opts.method, 'GET'); downloadGets++;
    return downloadResponse(opts);
  }
  if (path === '/api/v1/catalog') return json({ models: [
    { id: id(101), name: 'Sofa One', categoryId: id(1), status: 'PUBLISHED' },
    { id: id(102), name: 'Sofa Two', categoryId: id(1), status: 'PUBLISHED' },
    { id: id(103), name: 'Bed One', categoryId: id(2), status: 'PUBLISHED' },
    { id: id(109), name: 'Apartment Scene', categoryId: id(9), contentDomain: '3dscenes', status: 'PUBLISHED' }] });
  if (path === '/api/v1/categories') return json([{ id: id(1), parentId: null, name: 'Living', fullPath: 'Living', modelCount: 2 }, { id: id(2), parentId: null, name: 'Bedroom', fullPath: 'Bedroom', modelCount: 1 }, { id: id(9), name: 'Scene Interior', fullPath: 'Scene Interior', contentDomain: '3dscenes', modelCount: 1 }]);
  if (path === '/api/v1/previews/manifest') return json({ previews: [] });
  throw new Error('unexpected ' + path);
};
after(() => { globalThis.fetch = original; dom.window.close(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; dom.window.HTMLAnchorElement.prototype.click = originalClick; });

async function mount() {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<PublicCatalog />); await flush(); });
  await act(flush); await act(flush);
  return root;
}
const cards = () => [...document.querySelectorAll('.group')].map((c) => c.textContent);

test('lists all models without any buy/price/license UI; search and category filter work', async () => {
  const root = await mount();
  assert.equal(cards().length, 3);
  assert.doesNotMatch(document.body.textContent, /Mua|₫|VND|giá|license|Download\b|đơn hàng/i);
  const input = document.querySelector('input[aria-label="Tìm model"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'bed');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.deepEqual(cards().map((c) => c.includes('Bed One')), [true]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const living = [...document.querySelectorAll('label,button')].find((e) => e.textContent.trim().startsWith('Living'));
  await act(async () => { living.querySelector('input')?.click() ?? living.click(); });
  assert.equal(cards().length, 2);
  await act(() => root.unmount());
});

test('click a card opens the lightbox with name and category', async () => {
  const root = await mount();
  await act(async () => { document.querySelectorAll('.group')[0].click(); });
  const dialog = document.querySelector('[role=dialog]');
  assert.ok(dialog); assert.match(dialog.textContent, /Living|Bedroom/);
  await act(() => root.unmount());
});

test('download button is a link when the zip exists, disabled "Bản cài đặt sắp có" otherwise', async () => {
  zipStatus = 200; let root = await mount();
  const a = document.querySelector('a[download]');
  assert.equal(a.getAttribute('href'), '/download/3dsmood-library.mzp'); assert.match(a.textContent, /Tải xuống thư viện/);
  await act(() => root.unmount());
  zipStatus = 404; root = await mount();
  assert.equal(document.querySelector('a[download]'), null);
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Bản cài đặt sắp có');
  assert.ok(b && b.disabled);
  await act(() => root.unmount());
});

test('inside the Max host the entry is PluginApp (not public); admin never public', () => {
  assert.equal(isPublicSite('/'), true);
  dom.window.chrome = { webview: { addEventListener() {}, postMessage() {} } };
  assert.equal(isPublicSite('/'), false);
  delete dom.window.chrome;
  assert.equal(isPublicSite('/admin'), false);
});

test('gallery saves exactly one unchanged MZP even when the server forces a ZIP filename and MIME type', async () => {
  zipStatus = 200; downloadGets = 0; savedFiles.length = 0;
  let releaseResponse;
  downloadResponse = () => new Promise(resolve => { releaseResponse = resolve; });
  const root = await mount();
  const link = document.querySelector('a[download]');
  await act(() => { link.click(); link.click(); });
  assert.equal(downloadGets, 1, 'double-click must not create duplicate package downloads');
  assert.equal(link.getAttribute('aria-busy'), 'true');
  await act(async () => { releaseResponse(wrongHeaderResponse()); await flush(); });
  assert.equal(savedFiles.length, 1);
  assert.equal(savedFiles[0].name, '3dsmood-library.mzp');
  assert.equal(savedFiles[0].blob.type, 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await savedFiles[0].blob.arrayBuffer()), packageBytes, 'response bytes are saved without unpacking or adding files');
  assert.equal(link.getAttribute('aria-busy'), 'false');
  await act(() => root.unmount()); downloadResponse = wrongHeaderResponse;
});

test('HTML and failed HTTP responses are not saved as installers; download can be retried', async () => {
  zipStatus = 200; downloadGets = 0; savedFiles.length = 0;
  const responses = [new Response('<html>not an installer</html>', { headers: { 'content-type': 'text/html' } }), new Response(null, { status: 503 }), wrongHeaderResponse()];
  downloadResponse = () => responses.shift();
  const root = await mount();
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => { document.querySelector('a[download]').click(); await flush(); });
    assert.equal(savedFiles.length, 0);
    assert.match(document.querySelector('[role=alert]').textContent, /Không tải được/);
  }
  await act(async () => { document.querySelector('a[download]').click(); await flush(); });
  assert.equal(downloadGets, 3); assert.equal(savedFiles.length, 1);
  assert.equal(savedFiles[0].name, '3dsmood-library.mzp');
  assert.equal(document.querySelector('[role=alert]'), null);
  await act(() => root.unmount()); downloadResponse = wrongHeaderResponse;
});

test('leaving the gallery cancels an in-flight package request without saving a file', async () => {
  zipStatus = 200; savedFiles.length = 0;
  let releaseResponse, downloadSignal;
  downloadResponse = opts => { downloadSignal = opts.signal; return new Promise(resolve => { releaseResponse = resolve; }); };
  const root = await mount();
  await act(() => document.querySelector('a[download]').click());
  await act(() => root.unmount());
  assert.equal(downloadSignal.aborted, true);
  await act(async () => { releaseResponse(wrongHeaderResponse()); await flush(); });
  assert.equal(savedFiles.length, 0);
  downloadResponse = wrongHeaderResponse;
});

test("public gallery keeps Models scope when the capability response contains Scenes", async () => {
  const root = await mount();
  assert.equal(cards().length, 3);
  assert.doesNotMatch(document.body.textContent, /Apartment Scene|Scene Interior/);
  await act(() => root.unmount());
});
