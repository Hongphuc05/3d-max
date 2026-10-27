import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: OfflineLibrary } = await import('./OfflineLibrary.jsx');
let root;
const container = document.getElementById('root');
const item = { id: 'chair', name: 'Ghế gỗ', category: 'Ghế', preview: null, driveFileId: 'never-visible' };
async function mount(overrides = {}) {
  const calls = [];
  const host = async (method, params, timeout, onProgress) => {
    calls.push({ method, params });
    if (overrides[method]) return overrides[method](params, onProgress);
    if (method === 'library.status') return { machineCode: 'MACHINE-123', licensed: false };
    if (method === 'library.refresh') return { items: [item], offline: true, message: 'Đang dùng catalog đã lưu.' };
    if (method === 'library.activate') return { machineCode: 'MACHINE-123', licensed: true };
    return {};
  };
  root = createRoot(container);
  await act(async () => root.render(<OfflineLibrary request={host} available={true} />));
  return calls;
}
const button = (text) => [...container.querySelectorAll('button')].find(b => b.textContent === text);
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
test('opens cached catalog with machine code without account or Drive link', async () => {
  const calls = await mount();
  assert.match(container.textContent, /MACHINE-123/);
  assert.match(container.textContent, /Ghế gỗ/);
  assert.match(container.textContent, /catalog đã lưu/);
  assert.doesNotMatch(container.textContent, /never-visible|Đăng nhập|payOS/);
  assert.equal(button('Import').disabled, true);
  assert.deepEqual(calls.map(c => c.method).sort(), ['library.refresh', 'library.status']);
});
test('valid activation enables native import using only asset ID', async () => {
  const calls = await mount();
  const textarea = container.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'signed-license');
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(button('Import').disabled, false);
  await act(async () => button('Import').click());
  assert.deepEqual(calls.find(c => c.method === 'asset.import').params, { assetId: 'chair' });
});
test('invalid license shows error and keeps import locked', async () => {
  await mount({ 'library.activate': () => { throw new Error('License không khớp máy.'); } });
  await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.match(container.textContent, /License không khớp máy/);
  assert.equal(button('Import').disabled, true);
});
test('refresh failure retains previous catalog and reports a readable error', async () => {
  let count = 0;
  await mount({ 'library.refresh': () => { if (count++) throw new Error('Không tải được catalog.'); return { items: [item] }; } });
  await act(async () => button('Tải lại').click());
  assert.match(container.textContent, /Không tải được catalog/);
  assert.match(container.textContent, /Ghế gỗ/);
});
test('browser fallback does not call native or backend', async () => {
  root = createRoot(container);
  await act(async () => root.render(<OfflineLibrary available={false} request={() => { throw new Error('Unexpected call'); }} />));
  assert.match(container.textContent, /Mở plugin trong 3ds Max/);
});
test('machine copy succeeds and provides a manual fallback on clipboard failure', async () => {
  let copied;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  await mount();
  await act(async () => button('Copy mã máy').click());
  assert.equal(copied, 'MACHINE-123');
  assert.match(container.textContent, /Đã copy mã máy/);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => { throw new Error('Denied'); } } } });
  await act(async () => button('Copy mã máy').click());
  assert.match(container.textContent, /Ctrl\+C/);
});
test('native import progress and failure are shown without losing catalog', async () => {
  let rejectImport;
  const pending = new Promise((_, reject) => { rejectImport = reject; });
  await mount({
    'library.status': () => ({ machineCode: 'MACHINE-123', licensed: true, message: 'Hợp lệ' }),
    'asset.import': (_params, progress) => { progress({ receivedBytes: 1048576, totalBytes: 2097152 }); return pending; },
  });
  await act(async () => button('Import').click());
  assert.match(container.textContent, /1 MB \/ 2 MB/);
  assert.equal(button('Import').disabled, true);
  await act(async () => rejectImport(new Error('Không tải được model.')));
  assert.match(container.textContent, /Không tải được model/);
  assert.equal(button('Import').disabled, false);
});
test('catalog and identity initial failures remain recoverable', async () => {
  await mount({ 'library.status': () => { throw new Error('Không đọc được mã máy.'); },
    'library.refresh': () => { throw new Error('Không tải được catalog.'); } });
  assert.match(container.textContent, /Không tải được catalog/);
  assert.match(container.textContent, /Chưa có model/);
  assert.equal(button('Copy mã máy').disabled, true);
});
test('search and category filtering show matching models and preview fallback', async () => {
  await mount({ 'library.refresh': () => ({ items: [
    { ...item, preview: 'data:image/png;base64,AA==' },
    { id: 'lamp', name: 'Đèn', category: 'Đèn', preview: 'https://drive.google.com/unsafe' },
  ] }) });
  const image = container.querySelector('img');
  await act(async () => image.dispatchEvent(new window.Event('error')));
  assert.equal(container.querySelectorAll('img').length, 0);
  const search = container.querySelector('[aria-label="Tìm model"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'Không tồn tại');
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.match(container.textContent, /Không tìm thấy model phù hợp/);
  const select = container.querySelector('select');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, '');
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    select.value = 'Đèn'; select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.equal(container.querySelectorAll('article').length, 1);
  assert.match(container.querySelector('article').textContent, /Đèn/);
});

test('cached preview uses only the validated local route and preserves refresh revision', async () => {
  const source = `https://app.3dsmood.local/library-previews/${'a'.repeat(64)}.png?v=2`;
  await mount({ 'library.refresh': () => ({ items: [
    { ...item, preview: source },
    { id: 'unsafe', name: 'Unsafe', category: 'Ghế', preview: 'https://app.3dsmood.local.evil.test/library-previews/a.png' },
  ] }) });
  assert.equal(container.querySelectorAll('img').length, 1);
  assert.equal(container.querySelector('img').src, source);
});

test('background caches every local preview with bounded concurrency and continues after errors', async () => {
  const originalImage = window.Image;
  const requested = [];
  const pending = [];
  window.Image = class { set src(value) { requested.push(value); pending.push(this); } };
  const sources = Array.from({ length: 7 }, (_, i) => `https://app.3dsmood.local/library-previews/${String(i).repeat(64)}.png?v=one`);
  try {
    await mount({ 'library.refresh': () => ({ items: [
      ...sources.map((preview, i) => ({ id: `item-${i}`, name: `Model ${i}`, category: 'A', preview })),
      { id: 'evil', name: 'Bad', category: 'A', preview: 'https://evil.test/image.png' },
    ] }) });
    assert.equal(requested.length, 4, 'at most four preloads start at once');
    const search = container.querySelector('[aria-label="Tìm model"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'no match');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
      pending.shift().onerror();
      pending.shift().onload();
      pending.shift().onload();
    });
    assert.equal(container.querySelectorAll('article').length, 0, 'filter hides cards');
    assert.deepEqual(requested, sources, 'preload reaches hidden items and skips foreign URLs');
  } finally { window.Image = originalImage; }
});

test('refresh replaces the preload queue and unmount stops queued work', async () => {
  const originalImage = window.Image;
  const requested = [];
  const pending = [];
  window.Image = class { set src(value) { requested.push(value); pending.push(this); } };
  const previews = revision => Array.from({ length: 6 }, (_, i) => ({
    id: `model-${i}`, name: `Model ${i}`, category: 'A',
    preview: `https://app.3dsmood.local/library-previews/${String(i).repeat(64)}.jpg?v=${revision}`,
  }));
  let version = 0;
  try {
    await mount({ 'library.refresh': () => ({ items: previews(++version) }) });
    const oldCallback = pending[0].onload;
    await act(async () => button('Tải lại').click());
    assert.equal(requested.length, 8, 'new catalog starts a new bounded queue');
    assert.equal(pending[0].onload, null, 'old image handlers are detached');
    oldCallback();
    assert.equal(requested.length, 8, 'late old callback does not resume old queue');
    const newCallback = pending[4].onload;
    await act(async () => root.unmount());
    root = null;
    newCallback();
    assert.equal(requested.length, 8, 'unmount prevents further preload work');
  } finally { window.Image = originalImage; }
});
