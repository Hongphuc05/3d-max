// Test hang doi bang Node thuan: gia lap fetch (backend) va window.chrome.webview (host 3ds Max).
import test from 'node:test';
import assert from 'node:assert/strict';

const tickets = [];          // cac ticket da cap
const hostCalls = [];        // { slug, ticket } host nhan duoc
let running = 0, maxRunning = 0;
const failOnce = new Set(['b']);

globalThis.fetch = async (url) => {
  const slug = decodeURIComponent(url.split('/')[3]);
  const ticket = `t-${slug}-${tickets.length}`;
  tickets.push(ticket);
  return { ok: true, status: 200, json: async () => ({ assetId: slug, ticket }) };
};
const listeners = new Set();
globalThis.window = {
  chrome: {
    webview: {
      addEventListener: (_t, f) => listeners.add(f),
      postMessage({ id, params }) {
        hostCalls.push(params);
        maxRunning = Math.max(maxRunning, ++running);
        setTimeout(() => {
          running--;
          const fail = failOnce.delete(params.assetId);
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
  assert.deepEqual(hostCalls.map((c) => c.assetId), ['a', 'b', 'c']);
  const st = Object.fromEntries(getJobs().map((j) => [j.slug, j.status]));
  assert.deepEqual(st, { a: 'done', b: 'failed', c: 'done' });
  assert.equal(getJobs().find((j) => j.slug === 'b').error, 'loi gia');
});

test('thu lai thi xin ticket moi (ticket dung 1 lan)', async () => {
  const before = tickets.length;
  enqueue(p('b'));
  await settle();
  assert.equal(getJobs().find((j) => j.slug === 'b').status, 'done');
  assert.equal(tickets.length, before + 1);
  assert.equal(new Set(hostCalls.map((c) => c.ticket)).size, hostCalls.length);
});

test('khong bo duoc job dang chay; bo duoc job da xong', async () => {
  enqueue(p('d'));
  remove('d'); // dang chay ngay -> giu nguyen
  assert.ok(getJobs().some((j) => j.slug === 'd'));
  await settle();
  remove('d');
  assert.ok(!getJobs().some((j) => j.slug === 'd'));
});
