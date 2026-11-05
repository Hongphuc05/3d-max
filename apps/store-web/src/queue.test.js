// Test hang doi bang Node thuan: gia lap window.chrome.webview (host 3ds Max). v3: web chi gui {modelId}; khong ticket, khong goi backend.
import test from 'node:test';
import assert from 'node:assert/strict';

const hostCalls = [];        // { modelId } host nhan duoc
let running = 0, maxRunning = 0;
const failOnce = new Set(['b']);
globalThis.fetch = async () => { throw new Error('queue must not call the backend itself'); };

const listeners = new Set();
globalThis.window = {
  chrome: {
    webview: {
      addEventListener: (_t, f) => listeners.add(f),
      postMessage({ id, method, params }) {
        assert.equal(method, 'asset.download', 'Download queue never auto-imports');
        assert.deepEqual(Object.keys(params), ['modelId'], 'the web sends nothing but the model id');
        hostCalls.push(params);
        maxRunning = Math.max(maxRunning, ++running);
        setTimeout(() => {
          running--;
          const fail = failOnce.delete(params.modelId);
          const data = fail
            ? { id, ok: false, error: { code: 'ASSET_DOWNLOAD_FAILED', message: 'loi gia' } }
            : { id, ok: true, result: { imported: 1, file: 'x.max' } };
          listeners.forEach((f) => f({ data }));
        }, 10);
      },
    },
  },
};

const { enqueue, getJobs, remove } = await import('./queue.js');
const p = (slug) => ({ slug, name: slug.toUpperCase(), info: { sizeMB: 1 } });
const settle = () => new Promise((r) => setTimeout(r, 120));

test('chong trung, chay tuan tu, loi thi bao loi', async () => {
  enqueue(p('a')); enqueue(p('a')); enqueue(p('b')); enqueue(p('c'));
  assert.equal(getJobs().length, 3);
  assert.equal(getJobs().find((j) => j.slug === 'a').status, 'running'); // bam lai khong thay job dang chay
  await settle();
  assert.equal(maxRunning, 1);
  assert.deepEqual(hostCalls.map((c) => c.modelId), ['a', 'b', 'c']);
  const st = Object.fromEntries(getJobs().map((j) => [j.slug, j.status]));
  assert.deepEqual(st, { a: 'done', b: 'failed', c: 'done' });
  assert.equal(getJobs().find((j) => j.slug === 'b').error, 'loi gia');
});

test('thu lai gui lai yeu cau (native xin phien tai moi moi lan)', async () => {
  const before = hostCalls.length;
  enqueue(p('b'));
  await settle();
  assert.equal(getJobs().find((j) => j.slug === 'b').status, 'done');
  assert.equal(hostCalls.length, before + 1);
});

test('ma loi cua may chu duoc dich ra tieng Viet de hieu', async () => {
  failOnce.add('e');
  const original = listeners.size;
  // loi NOT_ENTITLED tu native
  const post = globalThis.window.chrome.webview.postMessage;
  globalThis.window.chrome.webview.postMessage = ({ id, params }) => {
    hostCalls.push(params);
    setTimeout(() => listeners.forEach((f) => f({ data: { id, ok: false, error: { code: 'NOT_ENTITLED', message: 'raw english text' } } })), 5);
  };
  enqueue(p('f'));
  await settle();
  globalThis.window.chrome.webview.postMessage = post;
  const job = getJobs().find((j) => j.slug === 'f');
  assert.equal(job.status, 'failed');
  assert.match(job.error, /chưa có quyền/);
  assert.equal(listeners.size, original);
});

test('khong bo duoc job dang chay; bo duoc job da xong', async () => {
  enqueue(p('d'));
  remove('d'); // dang chay ngay -> giu nguyen
  assert.ok(getJobs().some((j) => j.slug === 'd'));
  await settle();
  remove('d');
  assert.ok(!getJobs().some((j) => j.slug === 'd'));
});
