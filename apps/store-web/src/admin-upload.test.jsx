// D29: tai anh preview: nut theo danh muc, tai ca thu muc, song song 2, ket qua, xac nhan thay.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminUpload, planItems } = await import('./AdminUpload.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, uploads, inflight, maxInflight, existing;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const cats = [{ id: 'c1', parentId: null, name: 'Furniture', fullPath: 'Furniture', modelCount: 1 }, { id: 'c2', parentId: 'c1', name: 'Desk', fullPath: 'Furniture / Desk', modelCount: 0 }];
const img = (name, rel) => { const f = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' }); if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel }); return f; };

async function mount(onChanged = () => {}) {
  uploads = []; inflight = 0; maxInflight = 0; existing = new Set();
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname === '/api/admin/categories') return response({ items: cats });
    if (u.pathname === '/api/admin/previews' && init.method === 'POST') {
      const q = { category: u.searchParams.get('category'), filename: u.searchParams.get('filename'), replace: u.searchParams.get('replace'), type: init.headers['Content-Type'] };
      uploads.push(q);
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 15)); inflight--;
      if (q.filename.startsWith('dup') && !q.replace) return response({ error: { code: 'PREVIEW_EXISTS', message: 'x' } }, 409);
      if (q.filename.startsWith('clash')) return response({ error: { code: 'PREVIEW_COLLISION', message: 'x' } }, 409);
      if (q.filename.startsWith('bad')) return response({ error: { code: 'PREVIEW_INVALID', message: 'Không đọc được ảnh.' } }, 415);
      return response({ id: 'm', state: q.filename.startsWith('full') ? 'FULL' : 'PREVIEW_ONLY', replaced: Boolean(q.replace), mismatch: false }, 201);
    }
    throw new Error(`Unhandled ${init.method ?? 'GET'} ${u.pathname}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AdminUpload onChanged={onChanged} />));
}
async function choose(input, files) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  for (let i = 0; i < 40 && container.querySelector('[role="progressbar"]') && /đang tải/.test(container.textContent); i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('planItems: non-images are skipped; folder mode drops the picked folder name and keeps Category/Sub; root-level files get no category', () => {
  const { items, skipped } = planItems([img('a.jpg', '3dsmood/Furniture/Desk/a.jpg'), img('b.txt', '3dsmood/b.txt'), img('c.PNG', '3dsmood/c.PNG')], null);
  assert.deepEqual(items.map((i) => i.category), ['Furniture/Desk', '']); assert.deepEqual(skipped, ['b.txt']);
  assert.equal(planItems([img('x.jpg')], 'A/B').items[0].category, 'A/B');
});

test('each category row has its own upload button; files go into THAT category with the right content type; results and overall bar are shown', async () => {
  const changed = []; await mount(() => changed.push(1));
  const row = container.querySelector('[data-category="Furniture / Desk"]');
  assert.ok(row && container.querySelector('[data-category="Furniture"]'));
  await choose(row.querySelector('input'), [img('full1.jpg'), img('only2.jpg'), img('notes.txt')]);
  assert.deepEqual(uploads.map((u) => [u.category, u.filename, u.type]).sort(), [['Furniture/Desk', 'full1.jpg', 'image/jpeg'], ['Furniture/Desk', 'only2.jpg', 'image/jpeg']]);
  assert.match(container.textContent, /2\/2 ảnh — xong/); assert.match(container.textContent, /bỏ qua 1 file/);
  assert.match(container.textContent, /full1\.jpg — Đã ghép/); assert.match(container.textContent, /only2\.jpg — Thiếu zip/);
  assert.equal(container.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '100');
  assert.ok(changed.length >= 1, 'parent reloads the model table');
});

test('uploads run at most 2 at a time', async () => {
  await mount();
  await choose(container.querySelector('[name="uploadFiles"]'), Array.from({ length: 6 }, (_, i) => img(`p${i}.jpg`)));
  assert.equal(uploads.length, 6); assert.equal(maxInflight, 2);
});

test('folder upload maps Category/Sub paths; a root-level image is reported, not sent', async () => {
  await mount();
  await choose(container.querySelector('[name="uploadFolder"]'), [img('a.jpg', 'lib/Lighting/Spot/a.jpg'), img('b.jpg', 'lib/b.jpg')]);
  assert.deepEqual(uploads.map((u) => u.category), ['Lighting/Spot']);
  assert.match(container.textContent, /b\.jpg — Thiếu danh mục/);
});

test('existing pictures wait for confirmation; collisions and invalid images are reported; confirming re-sends with replace=1 only the existing ones', async () => {
  await mount();
  await choose(container.querySelector('[name="uploadFiles"]'), [img('dup1.jpg'), img('dup2.jpg'), img('clash.jpg'), img('bad.jpg')]);
  assert.match(container.textContent, /2 ảnh đã có sẵn/); assert.match(container.textContent, /Trùng tên ở danh mục khác/); assert.match(container.textContent, /Không đọc được ảnh/);
  assert.equal(uploads.filter((u) => u.replace).length, 0);
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Thay 2 ảnh');
  await act(async () => btn.click());
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  assert.deepEqual(uploads.filter((u) => u.replace).map((u) => u.filename).sort(), ['dup1.jpg', 'dup2.jpg']);
  assert.equal(uploads.length, 6);
});
