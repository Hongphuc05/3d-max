// P3.2: man "Quet dong bo" cua admin (plan §P3.2): nut quet FULL/INCREMENTAL, khoa nut khi dang chay, tien do qua SSE,
// thanh khong xac dinh khi chua co tong, Huy/Thu lai, tu chuyen sang polling 3s neu SSE loi. jsdom + fetch gia + EventSource gia.
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/admin' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
  sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.closed = false; this.handlers = {}; FakeEventSource.instances.push(this); }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  close() { this.closed = true; }
  emit(type, data) { for (const fn of this.handlers[type] ?? []) fn({ data: JSON.stringify(data) }); }
  fail() { this.onerror?.({}); }
}
globalThis.EventSource = FakeEventSource;

const { createRoot } = await import('react-dom/client');
const { default: AdminSync } = await import('./AdminSync.jsx');
const { default: App } = await import('./AdminEntry.jsx');
const container = document.getElementById('root');
const originalFetch = globalThis.fetch;
let root, fixture;

const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const v3Error = (status, code, message) => response({ error: { code, message, requestId: 'req-1' } }, status);
const src = (over = {}) => ({ id: 'src-1', connectionId: null, rootFolderName: 'Thu vien 3DS', sourceType: 'MY_DRIVE', enabled: true, lastSuccessfulSyncAt: null, ...over });
const summary = { hasFullScan: true, driveArchiveCount: 318, lastFullScanAt: '2026-11-01T10:00:00Z', previewCount: 100, readyCount: 80, previewOnlyCount: 20, archiveOnlyCount: 15, openReviewCount: 0 };
const zeroCounters = { scannedFolders: 0, scannedFiles: 0, new: 0, updated: 0, unchanged: 0, missing: 0, review: 0, skipped: 0, errors: 0 };
const job = (id, status, over = {}) => ({ id, sourceId: 'src-1', mode: 'FULL', status, stage: null, counters: { ...zeroCounters }, bytesDownloaded: 0,
  startedAt: null, finishedAt: null, heartbeatAt: null, errorCode: null, errorMessage: null, ...over });

function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0], method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
    fixture.requests.push({ path, method, body, search: String(url).split('?')[1] ?? '' });
    if (path === '/api/auth/me') return response({ user: { id: 'admin-id', email: 'a@a.invalid', role: 'ADMIN', username: 'owner', mustChangeCredentials: false } });
    if (path === '/api/admin/catalog/sync/permission') return response({ allowed: true });
    if (path === '/api/admin/drive/status') return response({ configured: fixture.configured, missingConfig: fixture.configured ? [] : ['DRIVE_API_KEY'], connection: null, sources: fixture.sources });
    if (path === '/api/admin/drive/summary') return response(fixture.summary);
    if (path === '/api/admin/drive/sync-jobs' && method === 'GET') {
      const limit = new URLSearchParams(String(url).split('?')[1] ?? '').get('limit');
      return response({ items: limit === '1' ? fixture.latest : (fixture.history ?? []), nextCursor: null }); // limit=1: job moi nhat; con lai: lich su
    }
    if (path === '/api/admin/drive/sync-jobs' && method === 'POST') {
      if (fixture.startError) return fixture.startError;
      if (fixture.gate) await fixture.gate;
      return response({ jobId: 'job-1' }, 202);
    }
    let m;
    if ((m = /^\/api\/admin\/drive\/sync-jobs\/([^/]+)\/cancel$/.exec(path)) && method === 'POST') return fixture.cancelError ?? new Response(null, { status: 202 });
    if ((m = /^\/api\/admin\/drive\/sync-jobs\/([^/]+)\/retry$/.exec(path)) && method === 'POST') return fixture.retryError ?? response({ jobId: 'job-2' }, 202);
    if ((m = /^\/api\/admin\/drive\/sync-jobs\/([^/]+)$/.exec(path)) && method === 'GET') {
      const j = fixture.jobs[m[1]];
      return j ? response(j) : v3Error(422, 'JOB_NOT_FOUND', 'Không tìm thấy lượt đồng bộ này.');
    }
    throw new Error(`Unhandled sync fixture ${method} ${path}`);
  };
}
async function mount({ sources = [src()], configured = true, latest = [], jobs = {}, summary: stats = summary, pollMs = 20 } = {}) {
  fixture = { sources, configured, latest, jobs, summary: stats, requests: [], startError: null, cancelError: null, retryError: null };
  FakeEventSource.instances.length = 0;
  installFetch();
  root = createRoot(container);
  await act(async () => root.render(<AdminSync pollMs={pollMs} />));
}
const button = (label) => { const el = [...container.querySelectorAll('button')].find((b) => b.textContent === label); return el ?? null; };
const mustButton = (label) => { const el = button(label); assert.ok(el, `Missing button ${label}`); return el; };
async function click(el) { await act(async () => el.click()); }
async function pick(name, value) {
  await act(async () => {
    const el = container.querySelector(`[name="${name}"]`);
    assert.ok(el, `Missing ${name}`);
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const calls = (path, method) => fixture.requests.filter((r) => r.path === path && (!method || r.method === method));
const stream = () => FakeEventSource.instances.at(-1);
const emit = (type, data) => act(async () => stream().emit(type, data));

afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
after(() => { globalThis.fetch = originalFetch; delete globalThis.EventSource; dom.window.close(); });

test('no source or no key: explains what to do and the scan button is disabled', async () => {
  await mount({ sources: [] });
  assert.match(container.textContent, /Chưa có thư mục gốc/);
  assert.equal(mustButton('Quét đồng bộ').disabled, true);
  await act(async () => root.unmount()); root = null;

  await mount({ configured: false });
  assert.match(container.textContent, /Chưa cấu hình/);
  assert.equal(mustButton('Quét đồng bộ').disabled, true);
});

test('start: posts {sourceId, mode}, defaults to FULL, can pick INCREMENTAL, locks the button, and shows only "Đang chờ" while queued', async () => {
  await mount();
  assert.equal(mustButton('Quét đồng bộ').disabled, false);
  await click(mustButton('Quét đồng bộ'));
  assert.deepEqual(calls('/api/admin/drive/sync-jobs', 'POST')[0].body, { sourceId: 'src-1', mode: 'FULL', contentDomain: '3dmodels' });
  assert.equal(stream().url, '/api/admin/drive/sync-jobs/job-1/events');
  await emit('progress', job('job-1', 'QUEUED'));
  assert.match(container.textContent, /Đang chờ/);
  assert.equal(/worker/i.test(container.textContent), false, 'choice 1: no worker hint');
  assert.equal(mustButton('Quét đồng bộ').disabled, true, 'locked while the job is active');
  assert.equal(container.querySelector('[name="mode"]').disabled, true);

  await emit('done', job('job-1', 'COMPLETED'));
  assert.equal(mustButton('Quét đồng bộ').disabled, false);
  await pick('mode', 'INCREMENTAL');
  await click(mustButton('Quét đồng bộ'));
  assert.deepEqual(calls('/api/admin/drive/sync-jobs', 'POST')[1].body, { sourceId: 'src-1', mode: 'INCREMENTAL', contentDomain: '3dmodels' });
});

test('the scan button cannot be double-clicked while the request is pending', async () => {
  await mount();
  let release; fixture.gate = new Promise((r) => { release = r; });
  await click(mustButton('Quét đồng bộ'));
  assert.equal(mustButton('Quét đồng bộ').disabled, true);
  await click(mustButton('Quét đồng bộ'));
  assert.equal(calls('/api/admin/drive/sync-jobs', 'POST').length, 1);
  await act(async () => { release(); await new Promise((r) => setImmediate(r)); });
});

test('progress: stage, counters and bytes update live; the bar is indeterminate (no total exists while scanning)', async () => {
  await mount();
  await click(mustButton('Quét đồng bộ'));
  await emit('progress', job('job-1', 'RUNNING', { stage: 'SCANNING', counters: { ...zeroCounters, scannedFolders: 12, scannedFiles: 340 } }));
  assert.match(container.textContent, /Đang quét thư mục/);
  assert.match(container.textContent, /340/);
  const bar = container.querySelector('[role="progressbar"]');
  assert.ok(bar, 'a progress bar exists while running');
  assert.equal(bar.hasAttribute('aria-valuenow'), false, 'indeterminate: no fake percentage');

  await emit('progress', job('job-1', 'RUNNING', { stage: 'DOWNLOADING_PREVIEWS', bytesDownloaded: 5 * 1048576, counters: { ...zeroCounters, scannedFiles: 720, errors: 2 } }));
  assert.match(container.textContent, /Đang tải ảnh xem trước/);
  assert.match(container.textContent, /5,0 MB|5\.0 MB/);
  assert.equal(container.textContent.includes('340'), false, 'old numbers are replaced');

  await emit('done', job('job-1', 'COMPLETED', { counters: { ...zeroCounters, scannedFiles: 720, unchanged: 360 }, finishedAt: '2026-11-01T10:00:00Z' }));
  assert.match(container.textContent, /Hoàn tất/);
  assert.equal(container.querySelector('[role="progressbar"]'), null, 'no bar once finished');
  assert.equal(stream().closed, true, 'stream closed after done');
});

test('SSE failure falls back to polling every pollMs, updates the UI, and stops polling when the job ends', async () => {
  await mount({ jobs: { 'job-1': job('job-1', 'RUNNING', { stage: 'COMPARING' }) } });
  await click(mustButton('Quét đồng bộ'));
  await emit('progress', job('job-1', 'QUEUED'));
  await act(async () => stream().fail());
  assert.equal(stream().closed, true, 'broken stream is closed, not left reconnecting');
  await wait(80);
  const polls = calls('/api/admin/drive/sync-jobs/job-1', 'GET').length;
  assert.ok(polls >= 2, `polled repeatedly, got ${polls}`);
  assert.match(container.textContent, /Đang so sánh/);

  fixture.jobs['job-1'] = job('job-1', 'FAILED', { errorCode: 'DISK_SPACE_LOW', errorMessage: 'Ổ đĩa máy chủ gần đầy.' });
  await wait(80);
  assert.match(container.textContent, /Thất bại/);
  const after = calls('/api/admin/drive/sync-jobs/job-1', 'GET').length;
  await wait(100);
  assert.equal(calls('/api/admin/drive/sync-jobs/job-1', 'GET').length, after, 'polling stops once the job is terminal');
});

test('cancel: available while queued/running, posts once, and is gone when cancelling or finished', async () => {
  await mount();
  await click(mustButton('Quét đồng bộ'));
  await emit('progress', job('job-1', 'RUNNING', { stage: 'SCANNING' }));
  await click(mustButton('Hủy'));
  assert.equal(calls('/api/admin/drive/sync-jobs/job-1/cancel', 'POST').length, 1);
  await emit('progress', job('job-1', 'CANCELLING', { stage: 'SCANNING' }));
  assert.match(container.textContent, /Đang hủy/);
  assert.equal(button('Hủy'), null, 'cannot cancel twice');
  await emit('done', job('job-1', 'CANCELLED'));
  assert.match(container.textContent, /Đã hủy/);
  assert.equal(button('Hủy'), null);
});

test('cancel refused by the server shows its message', async () => {
  await mount();
  await click(mustButton('Quét đồng bộ'));
  await emit('progress', job('job-1', 'RUNNING', { stage: 'SCANNING' }));
  fixture.cancelError = v3Error(409, 'JOB_NOT_CANCELLABLE', 'Lượt đồng bộ đã kết thúc nên không hủy được.');
  await click(mustButton('Hủy'));
  assert.match(container.querySelector('[role="alert"]').textContent, /không hủy được/);
});

test('retry: offered after FAILED / CANCELLED / COMPLETED_WITH_ERRORS, shows the error, and opens the new job stream', async () => {
  await mount();
  await click(mustButton('Quét đồng bộ'));
  await emit('done', job('job-1', 'FAILED', { errorCode: 'DRIVE_QUOTA_EXCEEDED', errorMessage: 'Google Drive đang giới hạn lượt truy cập.' }));
  assert.match(container.textContent, /Thất bại/);
  assert.match(container.textContent, /giới hạn lượt truy cập/);
  const first = stream();
  await click(mustButton('Thử lại'));
  assert.equal(calls('/api/admin/drive/sync-jobs/job-1/retry', 'POST').length, 1);
  assert.equal(stream().url, '/api/admin/drive/sync-jobs/job-2/events', 'attached to the NEW job');
  assert.notEqual(stream(), first);
  await emit('progress', job('job-2', 'QUEUED'));
  assert.equal(button('Thử lại'), null, 'no retry while a job is active');
  await emit('done', job('job-2', 'COMPLETED_WITH_ERRORS', { counters: { ...zeroCounters, errors: 3 } }));
  assert.match(container.textContent, /có lỗi/);
  assert.ok(button('Thử lại'));
  await emit('progress', job('job-2', 'COMPLETED'));
});

test('no retry for a clean COMPLETED job', async () => {
  await mount();
  await click(mustButton('Quét đồng bộ'));
  await emit('done', job('job-1', 'COMPLETED'));
  assert.equal(button('Thử lại'), null);
});

test('opens on the latest job: an active one is attached (no new POST), and the scan button stays locked', async () => {
  await mount({ latest: [job('job-1', 'RUNNING', { stage: 'SCANNING', counters: { ...zeroCounters, scannedFiles: 50 } })] });
  assert.equal(stream().url, '/api/admin/drive/sync-jobs/job-1/events');
  await emit('progress', job('job-1', 'RUNNING', { stage: 'SCANNING', counters: { ...zeroCounters, scannedFiles: 50 } }));
  assert.equal(mustButton('Quét đồng bộ').disabled, true);
  assert.equal(calls('/api/admin/drive/sync-jobs', 'POST').length, 0);
  assert.match(container.textContent, /50/);
});

test('start refused with 409: shows the server message and attaches to the job that is already running', async () => {
  await mount();
  fixture.startError = v3Error(409, 'SYNC_ALREADY_RUNNING', 'Đang có một lượt đồng bộ chạy hoặc chờ chạy cho nguồn này.');
  fixture.latest = [job('job-9', 'RUNNING', { stage: 'SCANNING' })];
  await click(mustButton('Quét đồng bộ'));
  assert.match(container.querySelector('[role="alert"]').textContent, /Đang có một lượt đồng bộ/);
  assert.equal(stream().url, '/api/admin/drive/sync-jobs/job-9/events');
});

test('leaving the screen closes the stream and stops polling (no leaks)', async () => {
  await mount({ jobs: { 'job-1': job('job-1', 'RUNNING') } });
  await click(mustButton('Quét đồng bộ'));
  const es = stream();
  await act(async () => root.unmount()); root = null;
  assert.equal(es.closed, true);

  await mount({ jobs: { 'job-1': job('job-1', 'RUNNING') } });
  await click(mustButton('Quét đồng bộ'));
  await act(async () => stream().fail());
  await wait(60);
  await act(async () => root.unmount()); root = null;
  const n = calls('/api/admin/drive/sync-jobs/job-1', 'GET').length;
  await wait(100);
  assert.equal(calls('/api/admin/drive/sync-jobs/job-1', 'GET').length, n, 'no polling after unmount');
});

test('the admin dashboard has a "Quét đồng bộ" section that loads the latest job and sources', async () => {
  fixture = { sources: [src()], configured: true, latest: [], jobs: {}, summary, requests: [] };
  FakeEventSource.instances.length = 0;
  installFetch();
  root = createRoot(container);
  await act(async () => root.render(<App />));
  const nav = [...container.querySelectorAll('nav button')].find((b) => b.textContent === 'Quét đồng bộ');
  assert.ok(nav, 'nav entry exists');
  assert.equal(calls('/api/admin/drive/sync-jobs', 'GET').length, 0, 'lazy: nothing requested before opening');
  await click(nav);
  assert.equal(calls('/api/admin/drive/sync-jobs', 'GET').length >= 1, true);
  assert.ok(button('Quét đồng bộ') && container.querySelector('main'));
});

test('polling: a 4xx answer (job gone / not allowed) is shown and polling stops instead of hammering the server', async () => {
  await mount({ jobs: {} });
  await click(mustButton('Quét đồng bộ'));
  await act(async () => stream().fail());
  await wait(80);
  assert.match(container.querySelector('[role="alert"]').textContent, /Không tìm thấy lượt đồng bộ/);
  const n = calls('/api/admin/drive/sync-jobs/job-1', 'GET').length;
  await wait(120);
  assert.equal(calls('/api/admin/drive/sync-jobs/job-1', 'GET').length, n, 'no more polling after a 4xx');
});

test('several sources: the chosen one is the one scanned', async () => {
  await mount({ sources: [src(), src({ id: 'src-2', rootFolderName: 'Nguon thu hai' }), src({ id: 'src-3', rootFolderName: 'Nguon tat', enabled: false })] });
  const options = [...container.querySelectorAll('[name="sourceId"] option')].map((o) => o.textContent);
  assert.deepEqual(options, ['Thu vien 3DS', 'Nguon thu hai'], 'disabled sources are not offered');
  await pick('sourceId', 'src-2');
  await click(mustButton('Quét đồng bộ'));
  assert.equal(calls('/api/admin/drive/sync-jobs', 'POST')[0].body.sourceId, 'src-2');
});

test('INCREMENTAL explains that it pairs previews with the latest full-scan snapshot', async () => {
  await mount();
  assert.ok(container.querySelector('[data-testid="full-note"]'), 'full scan explanation is shown by default');
  await pick('mode', 'INCREMENTAL');
  const note = container.querySelector('[data-testid="incremental-note"]');
  assert.ok(note, 'note shown for INCREMENTAL');
  assert.match(note.textContent, /snapshot file nén/);
  assert.match(note.textContent, /không gọi Drive/);
  assert.match(note.textContent, /chỉ được nhận ra sau lần quét đầy đủ/);
  await click(mustButton('Quét đồng bộ'));
  assert.equal(calls('/api/admin/drive/sync-jobs', 'POST')[0].body.mode, 'INCREMENTAL');
  await pick('mode', 'FULL').catch(() => {}); // o chon bi khoa khi job dang chay: khong the doi
});

test('the indeterminate bar is a moving segment (class animate-indeterminate), not a static fill that looks like a percentage', async () => {
  await mount();
  await click(mustButton('Quét đồng bộ'));
  await emit('progress', job('job-1', 'RUNNING', { stage: 'SCANNING' }));
  const inner = container.querySelector('[role="progressbar"] > div');
  assert.ok(inner.className.includes('animate-indeterminate'), inner.className);
  assert.equal(inner.className.includes('animate-pulse'), false, 'the old static pulse is gone');
  const css = (await import('node:fs')).readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes indeterminate/);
  assert.match(css, /prefers-reduced-motion[\s\S]*animate-indeterminate/, 'reduced motion is handled without implying a percentage');
});

test('P3.3: the history panel sits on the same screen and is reloaded when the current job ends', async () => {
  await mount({ latest: [] });
  const historyCalls = () => fixture.requests.filter((r) => r.path === '/api/admin/drive/sync-jobs' && r.method === 'GET' && r.search.includes('limit=10'));
  assert.equal(historyCalls().length, 1, 'loaded once when the screen opens');
  assert.match(container.textContent, /Lịch sử đồng bộ/);
  assert.match(container.textContent, /Chưa có lượt đồng bộ nào/);
  fixture.history = [job('job-1', 'COMPLETED', { counters: { ...zeroCounters, scannedFiles: 720, unchanged: 360 }, startedAt: '2026-11-01T08:00:00Z', finishedAt: '2026-11-01T08:01:00Z' })];
  await click(mustButton('Quét đồng bộ'));
  await emit('progress', job('job-1', 'RUNNING', { stage: 'SCANNING' }));
  assert.equal(historyCalls().length, 1, 'not reloaded while running');
  await emit('done', job('job-1', 'COMPLETED', { finishedAt: '2026-11-01T08:01:00Z' }));
  assert.equal(historyCalls().length, 2, 'reloaded once when the job ended');
  assert.ok(container.querySelector('tr[data-job="job-1"]'), 'the finished job shows up in the history');
});

test('Scenes switches summary, latest jobs, history and scan requests to its domain', async () => {
  await mount();
  await click(mustButton('Scenes'));
  const domainOf = request => new URLSearchParams(request.search).get('contentDomain');
  assert.equal(domainOf(calls('/api/admin/drive/summary').at(-1)), '3dscenes');
  assert.ok(calls('/api/admin/drive/sync-jobs').slice(-2).every(request => domainOf(request) === '3dscenes'));
  await click(mustButton('Qu\u00e9t \u0111\u1ed3ng b\u1ed9'));
  assert.deepEqual(calls('/api/admin/drive/sync-jobs', 'POST').at(-1).body, { sourceId: 'src-1', mode: 'FULL', contentDomain: '3dscenes' });
  await click(mustButton('Models'));
  assert.equal(domainOf(calls('/api/admin/drive/summary').at(-1)), '3dmodels');
});
