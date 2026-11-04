// P3.7: bang model (tim, loc, phan trang, sua ten/gia/an-hien). jsdom + fetch gia.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminModels } = await import('./AdminModels.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, fixture;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const v3Error = (status, code, message) => response({ error: { code, message, requestId: 'req-1' } }, status);
const m = (id, over = {}) => ({ id, name: `Model ${id}`, categoryPath: 'Living / Sofa', status: 'PUBLISHED', state: 'FULL', categoryMismatch: false, nameOverridden: false, updatedAt: '2026-11-01T08:00:00Z', ...over });

async function mount({ items = [m('a'), m('b')], total = items.length } = {}) {
  fixture = { items, total, requests: [], patchError: null, listError: null };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x'), path = u.pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, method, body, q: u.searchParams.get('q'), status: u.searchParams.get('status'), state: u.searchParams.get('state'), page: u.searchParams.get('page'), limit: u.searchParams.get('limit') });
    if (path === '/api/admin/categories') return response({ items: [] });
    if (path === '/api/admin/models' && method === 'GET') {
      if (fixture.listError) return fixture.listError;
      const snapshot = { items: fixture.items, total: fixture.total, page: Number(u.searchParams.get('page') ?? 1), limit: 20, counts: { FULL: 1, PREVIEW_ONLY: 2, ARCHIVE_ONLY: 3, MISMATCH: 0 } };
      if (fixture.holdNext) { const hold = fixture.holdNext; fixture.holdNext = null; await hold; }
      return response(snapshot);
    }
    const match = /^\/api\/admin\/models\/([^/]+)$/.exec(path);
    if (match && method === 'PATCH') {
      if (fixture.patchError) return fixture.patchError;
      if (fixture.gate) await fixture.gate;
      const current = fixture.items.find((x) => x.id === match[1]);
      const updated = { ...current, ...(body.name !== undefined ? { name: body.name, nameOverridden: true } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}) };
      return response(updated);
    }
    throw new Error(`Unhandled models fixture ${method} ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AdminModels />));
}
const button = (label, scope = container) => [...scope.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
const mustButton = (label, scope) => { const b = button(label, scope); assert.ok(b, `Missing button ${label}`); return b; };
async function click(el) { await act(async () => el.click()); }
async function type(name, value, scope = container) {
  await act(async () => {
    const el = scope.querySelector(`[name="${name}"]`); assert.ok(el, `Missing ${name}`);
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
const row = (id) => container.querySelector(`tr[data-model="${id}"]`);
const lists = () => fixture.requests.filter((r) => r.path === '/api/admin/models' && r.method === 'GET');
const patches = () => fixture.requests.filter((r) => r.method === 'PATCH');
async function submitSearch() { await act(async () => container.querySelector('form[role="search"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); }

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('lists models: name, category, status label; badge only for hand-edited names; never shows ids', async () => {
  await mount({ items: [m('a', { name: 'Sofa A' }), m('b', { name: 'Sofa B', status: 'HIDDEN', nameOverridden: true })] });
  assert.equal(lists()[0].page, '1'); assert.equal(lists()[0].limit, '20');
  const a = row('a'), b = row('b');
  assert.match(a.textContent, /Sofa A/); assert.match(a.textContent, /Living \/ Sofa/);  assert.equal(/\d\.\d{3}/.test(a.textContent), false, 'no per-model price column any more'); assert.match(a.textContent, /Đang bán/);
  assert.equal(/Tên đã sửa/.test(a.textContent), false);
  assert.match(b.textContent, /Đã ẩn/); assert.match(b.textContent, /Tên đã sửa/);
  assert.match(container.textContent, /2 kết quả/);
});

test('empty result says so', async () => {
  await mount({ items: [] });
  assert.match(container.textContent, /Không có model nào/);
});

test('search and status filter go to the server (trimmed), reset to page 1, and a cleared filter sends nothing', async () => {
  await mount({ items: [m('a')], total: 45 });
  await click(mustButton('Sau'));
  assert.equal(lists().at(-1).page, '2');
  await type('q', '  sofa  '); await type('statusFilter', 'HIDDEN');
  await submitSearch();
  const last = lists().at(-1);
  assert.equal(last.q, 'sofa'); assert.equal(last.status, 'HIDDEN'); assert.equal(last.page, '1', 'a new search starts from page 1');
  await type('q', ''); await type('statusFilter', '');
  await submitSearch();
  assert.equal(lists().at(-1).q, null); assert.equal(lists().at(-1).status, null);
});

test('pagination uses the server total', async () => {
  await mount({ items: [m('a')], total: 45 });
  assert.match(container.textContent, /45 kết quả/); assert.match(container.textContent, /Trang 1\/3/);
  await click(mustButton('Sau')); await click(mustButton('Sau'));
  assert.equal(lists().at(-1).page, '3');
  assert.equal(mustButton('Sau').disabled, true);
});

test('edit name only: PATCH carries just name, the row updates in place (no list reload) and gets the "Tên đã sửa" badge; there is no price field', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  assert.equal(row('a').querySelector('[name="editPrice"]'), null);
  await type('editName', 'Sofa Z', row('a'));
  const before = lists().length;
  await click(mustButton('Lưu', row('a')));
  assert.deepEqual(patches()[0].body, { name: 'Sofa Z' });
  assert.equal(patches()[0].path, '/api/admin/models/a');
  assert.match(row('a').textContent, /Sofa Z/); assert.match(row('a').textContent, /Tên đã sửa/);
  assert.equal(lists().length, before, 'updated in place without reloading the list');
  assert.equal(row('a').querySelector('input'), null, 'edit mode closed');
});

test('edit name (trimmed) and status together send both; hide sets the label to "Đã ẩn"', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  await type('editName', '  Ghế mới  ', row('a')); await type('editStatus', 'HIDDEN', row('a'));
  await click(mustButton('Lưu', row('a')));
  assert.deepEqual(patches()[0].body, { name: 'Ghế mới', status: 'HIDDEN' });
  assert.match(row('a').textContent, /Ghế mới/); assert.match(row('a').textContent, /Đã ẩn/);
});

test('saving without any change sends nothing and just closes the editor; Cancel discards edits', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  await click(mustButton('Lưu', row('a')));
  assert.equal(patches().length, 0);
  assert.equal(row('a').querySelector('input'), null);
  await click(mustButton('Sửa', row('a')));
  await type('editName', 'Throwaway', row('a'));
  await click(mustButton('Hủy', row('a')));
  assert.equal(patches().length, 0);
  assert.match(row('a').textContent, /Model a/);
  await click(mustButton('Sửa', row('a')));
  assert.equal(row('a').querySelector('[name="editName"]').value, 'Model a', 'a reopened editor starts from the saved value');
});

test('client-side checks: empty / too long name are refused without a request', async () => {
  await mount();
  const cases = [['editName', '   ', /Tên không được để trống/], ['editName', 'x'.repeat(301), /Tên tối đa 300 ký tự/]];
  for (const [name, value, message] of cases) {
    await click(mustButton('Sửa', row('a')));
    await type(name, value, row('a'));
    await click(mustButton('Lưu', row('a')));
    assert.match(row('a').querySelector('[role="alert"]')?.textContent ?? '', message, `${name}=${value}`);
    assert.equal(patches().length, 0, `${name}=${value} must not reach the server`);
    await click(mustButton('Hủy', row('a')));
  }
});

test('a server refusal stays in the row (editor stays open, values kept) and does not touch other rows', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  await type('editName', 'Draft name', row('a'));
  fixture.patchError = v3Error(422, 'MODEL_NOT_FOUND', 'Không tìm thấy model này.');
  await click(mustButton('Lưu', row('a')));
  assert.match(row('a').querySelector('[role="alert"]').textContent, /Không tìm thấy model/);
  assert.equal(row('a').querySelector('[name="editName"]').value, 'Draft name');
  assert.equal(row('b').querySelector('[role="alert"]'), null);
});

test('only one row is editable at a time; opening another closes the first without saving', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  await type('editName', 'Unsaved', row('a'));
  await click(mustButton('Sửa', row('b')));
  assert.equal(row('a').querySelector('input'), null);
  assert.match(row('a').textContent, /Model a/, 'unsaved text is not kept');
  assert.ok(row('b').querySelector('input'));
  assert.equal(patches().length, 0);
});

test('save cannot be double-submitted while pending', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  await type('editName', 'Name 777', row('a'));
  let release; fixture.gate = new Promise((r) => { release = r; });
  await click(mustButton('Lưu', row('a')));
  assert.equal(mustButton('Lưu', row('a')).disabled, true);
  await click(mustButton('Lưu', row('a')));
  assert.equal(patches().length, 1);
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.match(row('a').textContent, /Name 777/);
});

test('statuses that cannot be set by hand (DRAFT / NEEDS_REVIEW) stay visible in the editor but are not selectable targets', async () => {
  await mount({ items: [m('a', { status: 'NEEDS_REVIEW' })] });
  assert.match(row('a').textContent, /Cần duyệt/);
  await click(mustButton('Sửa', row('a')));
  const options = [...row('a').querySelectorAll('[name="editStatus"] option')].map((o) => [o.value, o.disabled]);
  assert.deepEqual(options, [['NEEDS_REVIEW', true], ['PUBLISHED', false], ['HIDDEN', false]]);
  await click(mustButton('Lưu', row('a')));
  assert.equal(patches().length, 0, 'leaving the status alone does not send it');
});

test('a failed load shows an alert with a retry; a slow OLD answer cannot overwrite a newer search', async () => {
  await mount();
  await act(async () => root.unmount()); root = null;
  fixture.listError = v3Error(500, 'INTERNAL', 'Lỗi hệ thống. Thử lại sau.');
  root = createRoot(container);
  await act(async () => root.render(<AdminModels />));
  assert.match(container.querySelector('[role="alert"]').textContent, /Lỗi hệ thống/);
  fixture.listError = null;
  await click(mustButton('Thử lại'));
  assert.ok(row('a'));

  let release; fixture.holdNext = new Promise((r) => { release = r; });
  fixture.items = [m('old')];
  await type('q', 'x');
  await submitSearch();               // request A held with the OLD snapshot
  fixture.items = [m('new')];
  await type('q', 'y');
  await submitSearch();               // request B answers at once with the new data
  assert.ok(row('new'));
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.ok(row('new') && !row('old'), 'the late old answer is ignored');
});

test('an error belongs to the editor: after Cancel (or reopening) the old error is gone', async () => {
  await mount();
  await click(mustButton('Sửa', row('a')));
  await type('editName', '   ', row('a'));
  await click(mustButton('Lưu', row('a')));
  assert.ok(row('a').querySelector('[role="alert"]'));
  await click(mustButton('Hủy', row('a')));
  assert.equal(row('a').querySelector('[role="alert"]'), null, 'no stale error in the read-only row');
  await click(mustButton('Sửa', row('a')));
  assert.equal(row('a').querySelector('[role="alert"]'), null, 'a reopened editor starts clean');
});

test('D29: pairing state column + filter (with counts) go to the server; mismatch flag is shown; delete preview needs a confirm and reloads', async () => {
  await mount({ items: [m('a', { state: 'PREVIEW_ONLY' }), m('b', { state: 'ARCHIVE_ONLY' }), m('c', { categoryMismatch: true })] });
  assert.match(row('a').textContent, /Thiếu zip/); assert.match(row('b').textContent, /Thiếu ảnh/); assert.match(row('c').textContent, /Lệch danh mục/);
  assert.equal(button('Xóa ảnh', row('b')), null, 'nothing to delete on an archive-only model');
  assert.match(container.querySelector('[name="stateFilter2"]').textContent, /Thiếu zip \(2\)/);
  await type('stateFilter2', 'PREVIEW_ONLY'); await submitSearch();
  assert.equal(lists().at(-1).state, 'PREVIEW_ONLY');
  const calls = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { if (init.method === 'DELETE') { calls.push(String(url)); return response({ deleted: 'PREVIEW' }); } return inner(url, init); };
  await click(mustButton('Xóa ảnh', row('a')));
  assert.equal(calls.length, 0, 'first click only asks to confirm');
  const before = lists().length;
  await click(mustButton('Xác nhận xóa ảnh', row('a')));
  assert.deepEqual(calls, ['/api/admin/models/a/preview']);
  assert.equal(lists().length, before + 1, 'list reloaded');
});
