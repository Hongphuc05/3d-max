// P3.4: man "Can duyet" (plan §P3.4). Nhom theo loai; Chap nhan / Bo qua; REMAP can buoc xac nhan truoc khi gop. jsdom + fetch gia.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminReview } = await import('./AdminReview.jsx');
const { default: App } = await import('./AdminEntry.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, fixture;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const v3Error = (status, code, message) => response({ error: { code, message, requestId: 'req-1' } }, status);
const item = (id, kind, files = ['a.jpg', 'a-x.rar'], summary = `Tóm tắt ${kind}`) => ({ id, kind, summary, candidates: files.map((name) => ({ name })) });

async function mount(items) {
  fixture = { items, requests: [], actionError: null, listError: null };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0], method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, method, body });
    if (path === '/api/admin/catalog/review' && method === 'GET') {
      if (fixture.listError) return fixture.listError;
      const snapshot = fixture.items; // chup luc nhan yeu cau
      if (fixture.holdNext) { const hold = fixture.holdNext; fixture.holdNext = null; await hold; }
      return response(snapshot);
    }
    const m = /^\/api\/admin\/catalog\/review\/([^/]+)$/.exec(path);
    if (m && method === 'POST') {
      if (fixture.actionError) return fixture.actionError;
      if (fixture.gate) await fixture.gate;
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unhandled review fixture ${method} ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AdminReview />));
}
const row = (id) => container.querySelector(`li[data-review="${id}"]`);
const button = (label, scope = container) => [...scope.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
const mustButton = (label, scope) => { const b = button(label, scope); assert.ok(b, `Missing button ${label}`); return b; };
async function click(el) { await act(async () => el.click()); }
const posts = () => fixture.requests.filter((r) => r.method === 'POST');
const lists = () => fixture.requests.filter((r) => r.path === '/api/admin/catalog/review' && r.method === 'GET');

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('groups the open items by kind with a label and count, shows the summary and candidate file names, and no ids', async () => {
  await mount([item('r1', 'REMAP_CANDIDATE', ['moved.zip']), item('s1', 'SUGGESTED_PAIR', ['198034.jpg', '198034-yzbmix.zip']), item('s2', 'SUGGESTED_PAIR', ['605389.jpg', '605389-2reavm.rar']), item('o1', 'ORPHAN_IMAGE', ['lonely.jpg'])]);
  const sections = [...container.querySelectorAll('section[data-kind]')];
  assert.deepEqual(sections.map((s) => s.dataset.kind), ['REMAP_CANDIDATE', 'SUGGESTED_PAIR', 'ORPHAN_IMAGE'], 'fixed kind order, only kinds that have items');
  const suggested = container.querySelector('section[data-kind="SUGGESTED_PAIR"]');
  assert.match(suggested.textContent, /Gợi ý ghép cặp/); assert.match(suggested.textContent, /\(2\)/);
  assert.match(row('s1').textContent, /Tóm tắt SUGGESTED_PAIR/);
  assert.match(row('s1').textContent, /198034-yzbmix\.zip/); assert.match(row('s1').textContent, /198034\.jpg/);
  assert.equal(container.textContent.includes('r1'), false, 'ids stay out of the visible text');
  assert.equal(lists().length, 1);
});

test('empty list says nothing needs review', async () => {
  await mount([]);
  assert.match(container.textContent, /Không có mục nào cần duyệt/);
  assert.equal(container.querySelectorAll('li').length, 0);
});

test('actions depend on the kind: pairs can be accepted, remap can be merged, everything else can only be marked seen', async () => {
  await mount([item('s1', 'SUGGESTED_PAIR'), item('r1', 'REMAP_CANDIDATE'), item('a1', 'AMBIGUOUS_PAIR'), item('m1', 'ORPHAN_MODEL'), item('i1', 'ORPHAN_IMAGE'), item('p1', 'PREVIEW_IN_ARCHIVE')]);
  const labels = (id) => [...row(id).querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(labels('s1'), ['Chấp nhận', 'Bỏ qua']);
  assert.deepEqual(labels('r1'), ['Xác nhận gộp', 'Bỏ qua']);
  for (const id of ['a1', 'm1', 'i1', 'p1']) assert.deepEqual(labels(id), ['Đã xem'], id);
  assert.match(container.textContent, /ghép tay và chọn ảnh chính/i, 'says what is not available yet');
});

test('Chấp nhận / Bỏ qua / Đã xem send the right action and remove the item', async () => {
  await mount([item('s1', 'SUGGESTED_PAIR'), item('s2', 'SUGGESTED_PAIR'), item('o1', 'ORPHAN_IMAGE')]);
  await click(mustButton('Chấp nhận', row('s1')));
  assert.deepEqual(posts()[0], { path: '/api/admin/catalog/review/s1', method: 'POST', body: { action: 'ACCEPT', contentDomain: '3dmodels' } });
  assert.equal(row('s1'), null); assert.match(container.textContent, /Đã chấp nhận/);
  await click(mustButton('Bỏ qua', row('s2')));
  assert.deepEqual(posts()[1].body, { action: 'DISMISS', contentDomain: '3dmodels' }); assert.equal(row('s2'), null);
  await click(mustButton('Đã xem', row('o1')));
  assert.deepEqual(posts()[2], { path: '/api/admin/catalog/review/o1', method: 'POST', body: { action: 'DISMISS', contentDomain: '3dmodels' } });
  assert.match(container.textContent, /Không có mục nào cần duyệt/);
  assert.equal(lists().length, 1, 'removed in place, no reload');
});

test('merging a remap needs an explicit confirmation that spells out what is deleted; Cancel sends nothing', async () => {
  await mount([item('r1', 'REMAP_CANDIDATE')]);
  await click(mustButton('Xác nhận gộp', row('r1')));
  assert.equal(posts().length, 0, 'the first click only opens the confirmation');
  assert.match(row('r1').textContent, /xóa model mới/i); assert.match(row('r1').textContent, /không hoàn tác/i);
  await click(mustButton('Hủy', row('r1')));
  assert.equal(posts().length, 0);
  assert.ok(button('Xác nhận gộp', row('r1')), 'back to the normal buttons');
  await click(mustButton('Xác nhận gộp', row('r1')));
  await click(mustButton('Gộp', row('r1')));
  assert.deepEqual(posts()[0].body, { action: 'ACCEPT', contentDomain: '3dmodels' });
  assert.equal(row('r1'), null);
});

test('buttons lock while a request is pending: no double submit', async () => {
  await mount([item('s1', 'SUGGESTED_PAIR')]);
  let release; fixture.gate = new Promise((r) => { release = r; });
  await click(mustButton('Chấp nhận', row('s1')));
  assert.equal(mustButton('Chấp nhận', row('s1')).disabled, true); assert.equal(mustButton('Bỏ qua', row('s1')).disabled, true);
  await click(mustButton('Chấp nhận', row('s1')));
  assert.equal(posts().length, 1);
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.equal(row('s1'), null);
});

test('409 already-resolved removes the item with the server message; 409 not-applicable and other errors keep it with an alert', async () => {
  await mount([item('a', 'SUGGESTED_PAIR'), item('b', 'REMAP_CANDIDATE'), item('c', 'SUGGESTED_PAIR')]);
  fixture.actionError = v3Error(409, 'REVIEW_ALREADY_RESOLVED', 'Mục này đã được xử lý trước đó.');
  await click(mustButton('Chấp nhận', row('a')));
  assert.equal(row('a'), null, 'someone else already handled it: it disappears');
  assert.match(container.textContent, /đã được xử lý trước đó/);

  fixture.actionError = v3Error(409, 'REVIEW_NOT_APPLICABLE', 'Mục này không còn áp dụng được vì dữ liệu liên quan đã thay đổi.');
  await click(mustButton('Xác nhận gộp', row('b'))); await click(mustButton('Gộp', row('b')));
  assert.ok(row('b'), 'stays so the admin can dismiss it');
  assert.match(row('b').querySelector('[role="alert"]').textContent, /không còn áp dụng được/);
  assert.ok(button('Bỏ qua', row('b')));

  fixture.actionError = v3Error(500, 'INTERNAL', 'Lỗi hệ thống. Thử lại sau.');
  await click(mustButton('Chấp nhận', row('c')));
  assert.ok(row('c')); assert.match(row('c').querySelector('[role="alert"]').textContent, /Lỗi hệ thống/);
  assert.equal(mustButton('Chấp nhận', row('c')).disabled, false, 'can retry');
});

test('a failed load shows an alert with a retry; Làm mới reloads the list', async () => {
  await mount([item('s1', 'SUGGESTED_PAIR')]);
  await act(async () => root.unmount()); root = null;
  fixture.listError = v3Error(500, 'INTERNAL', 'Lỗi hệ thống. Thử lại sau.');
  root = createRoot(container);
  await act(async () => root.render(<AdminReview />));
  assert.match(container.querySelector('[role="alert"]').textContent, /Lỗi hệ thống/);
  fixture.listError = null;
  await click(mustButton('Thử lại'));
  assert.ok(row('s1'));
  fixture.items = [item('s2', 'SUGGESTED_PAIR')];
  await click(mustButton('Làm mới'));
  assert.ok(row('s2') && !row('s1'));
});

test('the dashboard has a lazy "Cần duyệt" section', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    const path = String(url).split('?')[0]; requests.push(path);
    if (path === '/api/auth/me') return response({ user: { id: 'admin-id', email: 'a@a.invalid', role: 'ADMIN', username: 'owner', mustChangeCredentials: false } });
    if (path === '/api/admin/catalog/sync/permission') return response({ allowed: true });
    if (path === '/api/admin/catalog/review') return response([item('s1', 'SUGGESTED_PAIR')]);
    throw new Error(`Unhandled ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<App />));
  const nav = [...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Cần duyệt');
  assert.ok(nav, 'nav entry exists');
  assert.equal(requests.includes('/api/admin/catalog/review'), false, 'lazy');
  await act(async () => nav.click());
  assert.ok(requests.includes('/api/admin/catalog/review'));
  assert.ok(container.querySelector('li[data-review="s1"]'));
});

test('a slow OLD list answer cannot overwrite a newer one (two reloads overlap)', async () => {
  await mount([item('old', 'SUGGESTED_PAIR')]);
  let release; fixture.holdNext = new Promise((r) => { release = r; });
  await click(mustButton('Làm mới'));             // request A is held and will answer with the OLD snapshot
  fixture.items = [item('new', 'SUGGESTED_PAIR')];
  await click(mustButton('Làm mới'));             // request B answers at once with the new data
  assert.ok(row('new'));
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.ok(row('new') && !row('old'), 'the late old answer is ignored');
});

test('Scenes review actions send the selected domain', async () => {
  await mount([item('scene-review', 'ORPHAN_IMAGE')]);
  await click(mustButton('Scenes'));
  await click(row('scene-review').querySelector('button'));
  assert.deepEqual(posts()[0].body, { action: 'DISMISS', contentDomain: '3dscenes' });
});
