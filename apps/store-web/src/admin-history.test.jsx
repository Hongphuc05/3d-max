// P3.3: lich su cac luot dong bo + danh sach file loi (plan §P3.3). Ten + duong dan, khong Drive ID. jsdom + fetch gia.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { default: AdminSyncHistory } = await import('./AdminSyncHistory.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, fixture;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const v3Error = (status, code, message) => response({ error: { code, message, requestId: 'req-1' } }, status);
const zero = { scannedFolders: 0, scannedFiles: 0, new: 0, updated: 0, unchanged: 0, missing: 0, review: 0, skipped: 0, errors: 0 };
const job = (id, status, over = {}) => ({ id, sourceId: 'SOURCE-UUID-DO-NOT-SHOW', mode: 'FULL', status, stage: null, counters: { ...zero }, bytesDownloaded: 0,
  startedAt: '2026-11-01T08:00:00Z', finishedAt: '2026-11-01T08:01:00Z', heartbeatAt: null, errorCode: null, errorMessage: null, ...over });

async function mount({ pages, items = {}, refreshKey = 0 } = {}) {
  fixture = { pages, items, requests: [], listError: null, itemsError: null };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x'), path = u.pathname, method = init.method ?? 'GET';
    fixture.requests.push({ path, method, cursor: u.searchParams.get('cursor'), limit: u.searchParams.get('limit'), status: u.searchParams.get('status') });
    if (path === '/api/admin/drive/sync-jobs' && method === 'GET') {
      if (fixture.listError) return fixture.listError;
      const page = fixture.pages[u.searchParams.get('cursor') ?? 'first'] ?? { items: [], nextCursor: null }; // chup ngay luc nhan yeu cau
      if (fixture.holdNext) { const hold = fixture.holdNext; fixture.holdNext = null; await hold; }
      if (fixture.gate) await fixture.gate;
      return response(page);
    }
    const m = /^\/api\/admin\/drive\/sync-jobs\/([^/]+)\/items$/.exec(path);
    if (m && method === 'GET') return fixture.itemsError ?? response(fixture.items[m[1]] ?? []);
    throw new Error(`Unhandled history fixture ${method} ${path}`);
  };
  root = createRoot(container);
  await act(async () => root.render(<AdminSyncHistory refreshKey={refreshKey} />));
}
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent === label) ?? null;
const mustButton = (label) => { const el = button(label); assert.ok(el, `Missing button ${label}`); return el; };
async function click(el) { await act(async () => el.click()); }
const lists = () => fixture.requests.filter((r) => r.path === '/api/admin/drive/sync-jobs');
const rows = () => [...container.querySelectorAll('tbody tr[data-job]')];

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

test('loads the first page (limit 10), newest first, one row per job with time, kind, result and numbers; never shows ids', async () => {
  await mount({ pages: { first: { items: [
    job('job-b', 'COMPLETED', { counters: { ...zero, scannedFiles: 720, unchanged: 360, review: 2 } }),
    job('job-a', 'FAILED', { mode: 'INCREMENTAL', errorCode: 'DISK_SPACE_LOW', errorMessage: 'Ổ đĩa máy chủ gần đầy.', counters: { ...zero, scannedFiles: 10 } })], nextCursor: null } } });
  assert.equal(lists().length, 1); assert.equal(lists()[0].limit, '10'); assert.equal(lists()[0].cursor, null);
  const r = rows();
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.dataset.job), ['job-b', 'job-a'], 'server order (newest first) is kept');
  assert.match(r[0].textContent, /Quét đầy đủ/); assert.match(r[0].textContent, /Hoàn tất/);
  assert.match(r[0].textContent, /720/); assert.match(r[0].textContent, /360/);
  assert.match(r[1].textContent, /Quét thay đổi/); assert.match(r[1].textContent, /Thất bại/);
  assert.equal(container.textContent.includes('SOURCE-UUID-DO-NOT-SHOW'), false, 'internal source id is not shown');
});

test('empty history says so and offers nothing to load', async () => {
  await mount({ pages: { first: { items: [], nextCursor: null } } });
  assert.match(container.textContent, /Chưa có lượt đồng bộ nào/);
  assert.equal(rows().length, 0);
  assert.equal(button('Xem thêm'), null);
});

test('pagination: "Xem thêm" loads the next page with the cursor, appends, and disappears at the end; no double load', async () => {
  await mount({ pages: {
    first: { items: [job('j1', 'COMPLETED'), job('j2', 'COMPLETED')], nextCursor: 'CUR2' },
    CUR2: { items: [job('j3', 'CANCELLED')], nextCursor: null } } });
  assert.equal(rows().length, 2);
  let release; fixture.gate = new Promise((r) => { release = r; });
  await click(mustButton('Xem thêm'));
  assert.equal(mustButton('Xem thêm').disabled, true, 'locked while loading');
  await click(mustButton('Xem thêm'));
  assert.equal(lists().filter((x) => x.cursor === 'CUR2').length, 1, 'one request for the page');
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.deepEqual(rows().map((x) => x.dataset.job), ['j1', 'j2', 'j3']);
  assert.equal(button('Xem thêm'), null, 'no more pages');
});

test('"Xem lỗi" only on jobs that have errors; shows name + path + step + code, never ids; unknown names are labelled', async () => {
  await mount({
    pages: { first: { items: [job('clean', 'COMPLETED'), job('bad', 'COMPLETED_WITH_ERRORS', { counters: { ...zero, errors: 2 } })], nextCursor: null } },
    items: { bad: [
      { driveFileName: 'sofa.jpg', path: 'Living/Sofa/sofa.jpg', action: 'PREVIEW', status: 'FAILED', errorCode: 'PREVIEW_INVALID', errorMessage: null, driveFileId: 'LEAKED-DRIVE-ID' },
      { driveFileName: null, path: null, action: 'SCAN', status: 'FAILED', errorCode: 'DRIVE_QUOTA_EXCEEDED', errorMessage: 'Google giới hạn.' }] } });
  const r = rows();
  assert.equal([...r[0].querySelectorAll('button')].some((b) => b.textContent === 'Xem lỗi'), false, 'no button for a clean job');
  await click([...r[1].querySelectorAll('button')].find((b) => b.textContent === 'Xem lỗi'));
  const call = fixture.requests.find((x) => x.path.endsWith('/bad/items'));
  assert.equal(call.status, 'FAILED');
  const text = container.textContent;
  assert.match(text, /sofa\.jpg/); assert.match(text, /Living\/Sofa\/sofa\.jpg/); assert.match(text, /PREVIEW_INVALID/);
  assert.match(text, /Ảnh xem trước/); assert.match(text, /Quét thư mục/);
  assert.match(text, /Không rõ tên/);
  assert.match(text, /DRIVE_QUOTA_EXCEEDED/);
  assert.equal(text.includes('LEAKED-DRIVE-ID'), false, 'a Drive id is never rendered even if it slipped into the payload');
});

test('errors panel toggles: "Xem lỗi" opens it, "Ẩn lỗi" hides it', async () => {
  await mount({
    pages: { first: { items: [job('bad', 'COMPLETED_WITH_ERRORS', { counters: { ...zero, errors: 1 } })], nextCursor: null } },
    items: { bad: [{ driveFileName: 'a.jpg', path: 'X/a.jpg', action: 'PREVIEW', status: 'FAILED', errorCode: 'PREVIEW_INVALID', errorMessage: null }] } });
  await click(mustButton('Xem lỗi'));
  assert.match(container.textContent, /a\.jpg/);
  await click(mustButton('Ẩn lỗi'));
  assert.equal(container.textContent.includes('a.jpg'), false);
  assert.ok(button('Xem lỗi'));
});

test('a FAILED job shows its own error message even when it has no per-file errors', async () => {
  await mount({
    pages: { first: { items: [job('dead', 'FAILED', { errorCode: 'DISK_SPACE_LOW', errorMessage: 'Ổ đĩa máy chủ gần đầy nên không tải thêm ảnh.' })], nextCursor: null } },
    items: { dead: [] } });
  await click(mustButton('Xem lỗi'));
  assert.match(container.textContent, /Ổ đĩa máy chủ gần đầy/);
  assert.match(container.textContent, /Không có file lỗi riêng/);
});

test('a refused errors request shows an alert and leaves the table intact', async () => {
  await mount({ pages: { first: { items: [job('bad', 'COMPLETED_WITH_ERRORS', { counters: { ...zero, errors: 1 } })], nextCursor: null } } });
  fixture.itemsError = v3Error(422, 'JOB_NOT_FOUND', 'Không tìm thấy lượt đồng bộ này.');
  await click(mustButton('Xem lỗi'));
  assert.match(container.querySelector('[role="alert"]').textContent, /Không tìm thấy lượt đồng bộ/);
  assert.equal(rows().length, 1);
});

test('a failed list request shows an alert and "Thử lại" reloads it', async () => {
  await mount({ pages: { first: { items: [job('j1', 'COMPLETED')], nextCursor: null } } });
  await act(async () => root.unmount()); root = null;
  fixture.listError = v3Error(502, 'DRIVE_UPSTREAM_ERROR', 'Không kết nối ổn định được tới Google Drive.');
  root = createRoot(container);
  await act(async () => root.render(<AdminSyncHistory refreshKey={0} />));
  assert.match(container.querySelector('[role="alert"]').textContent, /Không kết nối ổn định/);
  fixture.listError = null;
  await click(mustButton('Thử lại'));
  assert.equal(rows().length, 1);
});

test('changing refreshKey (a job just finished) reloads the first page and replaces the list', async () => {
  await mount({ pages: { first: { items: [job('old', 'COMPLETED')], nextCursor: null } } });
  assert.equal(lists().length, 1);
  fixture.pages.first = { items: [job('new', 'COMPLETED'), job('old', 'COMPLETED')], nextCursor: null };
  await act(async () => root.render(<AdminSyncHistory refreshKey={1} />));
  assert.equal(lists().length, 2);
  assert.deepEqual(rows().map((x) => x.dataset.job), ['new', 'old']);
});

test('leaving the screen mid-request does not update an unmounted component', async () => {
  let release;
  fixture = null;
  await mount({ pages: { first: { items: [job('j1', 'COMPLETED')], nextCursor: null } } });
  await act(async () => root.unmount()); root = null;
  fixture.gate = new Promise((r) => { release = r; });
  root = createRoot(container);
  await act(async () => root.render(<AdminSyncHistory refreshKey={0} />));
  await act(async () => root.unmount()); root = null;
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
  assert.equal(container.textContent, '');
});

test('a slow OLD response must not overwrite the newer list (two loads overlap)', async () => {
  await mount({ pages: { first: { items: [job('old', 'COMPLETED')], nextCursor: null } } });
  let release; fixture.holdNext = new Promise((r) => { release = r; });
  await act(async () => root.render(<AdminSyncHistory refreshKey={1} />)); // request A (old snapshot) is held
  fixture.pages.first = { items: [job('new', 'COMPLETED')], nextCursor: null };
  await act(async () => root.render(<AdminSyncHistory refreshKey={2} />)); // request B returns the new snapshot at once
  assert.deepEqual(rows().map((x) => x.dataset.job), ['new']);
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); }); // A finally answers with the old list
  assert.deepEqual(rows().map((x) => x.dataset.job), ['new'], 'the late old answer is ignored');
});

test('a job cancelled before it ever started still shows when it ended (no start time)', async () => {
  await mount({ pages: { first: { items: [job('c', 'CANCELLED', { startedAt: null, finishedAt: '2026-11-01T09:00:00Z' })], nextCursor: null } } });
  const timeCell = rows()[0].querySelector('td');
  assert.match(timeCell.textContent, /2026/);
  assert.equal(timeCell.textContent.includes('—'), false);
});

test('when 500 errors come back it says the list is capped', async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ driveFileName: `f${i}.jpg`, path: `X/f${i}.jpg`, action: 'PREVIEW', status: 'FAILED', errorCode: 'PREVIEW_INVALID', errorMessage: null }));
  await mount({ pages: { first: { items: [job('big', 'COMPLETED_WITH_ERRORS', { counters: { ...zero, errors: 900 } })], nextCursor: null } }, items: { big: many } });
  await click(mustButton('Xem lỗi'));
  assert.match(container.textContent, /tối đa 500/);
});
