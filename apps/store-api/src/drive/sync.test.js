import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncWorker } from './sync.js';

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async acquireLock() { calls.push('lock'); return { client: {}, release: async () => calls.push('unlock') }; },
    async beginSync() { calls.push('begin'); return 'generation'; },
    async publish(_client, scan) { calls.push(['publish', scan]); return { changed: true, modelsAdded: 1 }; },
    async markFailed(_client, _id, error) { calls.push(['failed', error.code]); },
    async referencedPreviews() { return ['kept.webp']; },
    ...overrides.repository,
  };
  const provider = { async scan() { calls.push('scan'); return { folders: [{ id: 'root' }], models: [{ archiveId: 'archive' }], filesScanned: 2 }; }, ...overrides.provider };
  const previewCache = { async prepare(model) { calls.push('preview'); return { cachedPreviewPath: 'kept.webp', previewVersion: 'one', previewUpdated: true }; }, async cleanup(paths) { calls.push(['cleanup', paths]); }, ...overrides.previewCache };
  return { calls, worker: createSyncWorker({ repository, provider, previewCache, logger: { warn() {}, error() {} },...overrides.workerOptions }) };
}

test('sync scans and prepares previews before atomic publication, then safely cleans cache', async () => {
  const { calls, worker } = fixture();
  const result = await worker.sync();
  assert.equal(result.changed, true);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ['lock', 'begin', 'scan', 'preview', 'publish', 'cleanup', 'unlock']);
  assert.equal(calls.find(call => call[0] === 'publish')[1].models[0].cachedPreviewPath, 'kept.webp');
});

for (const code of ['DRIVE_TIMEOUT', 'DRIVE_PERMISSION_DENIED', 'DRIVE_QUOTA_EXCEEDED', 'PARTIAL_PAGINATION']) {
  test(`${code}: failed scan never publishes or deletes previous snapshot`, async () => {
    const { calls, worker } = fixture({ provider: { async scan() { throw Object.assign(new Error('secret provider payload'), { code }); } } });
    await assert.rejects(worker.sync(), { code });
    assert.equal(calls.some(call => Array.isArray(call) && ['publish', 'cleanup'].includes(call[0])), false);
    assert.deepEqual(calls.at(-2), ['failed', code]);
    assert.equal(calls.at(-1), 'unlock');
  });
}

test('preview validation failure preserves catalog and releases lock', async () => {
  const { calls, worker } = fixture({ previewCache: { async prepare() { throw Object.assign(new Error('invalid image'), { code: 'PREVIEW_INVALID' }); } } });
  await assert.rejects(worker.sync(), { code: 'PREVIEW_INVALID' });
  assert.equal(calls.some(call => call[0] === 'publish'), false);
  assert.equal(calls.at(-1), 'unlock');
});

test('parallel manual/scheduled requests share one in-process sync; database lock protects other instances', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const { calls, worker } = fixture({ provider: { async scan() { await pending; return { folders: [], models: [], filesScanned: 0 }; } } });
  const first = worker.sync(), second = worker.sync();
  complete();
  await Promise.all([first, second]);
  assert.equal(calls.filter(call => call === 'lock').length, 1);
  const other = fixture({ repository: { async acquireLock() { return null; } } });
  assert.equal((await other.worker.sync()).skipped, true);
  assert.deepEqual(other.calls, []);
});

test('cleanup failure cannot turn a successfully committed snapshot into failed sync', async () => {
  const { calls, worker } = fixture({ previewCache: { async cleanup() { throw new Error('disk unavailable'); } } });
  assert.equal((await worker.sync()).changed, true);
  assert.equal(calls.some(call => call[0] === 'failed'), false);
});

test('startup schedules initial sync without blocking and stop prevents later interval work',async()=>{
  const {worker,calls}=fixture();const stop=worker.start();
  assert.equal(typeof stop,'function');worker.start();
  await new Promise(r=>setImmediate(r));assert.ok(calls.includes('scan'));stop();stop();
});

test('restart honors the persisted retry interval after a failed sync instead of hammering Drive',async()=>{
  let now=2_000_000,timeout,interval,cleared=false;
  const scheduler={setTimeout(callback,delay){timeout={callback,delay};return 1;},clearTimeout(){cleared=true;},
    setInterval(callback,delay){interval={callback,delay};return 2;},clearInterval(){cleared=true;}};
  const {worker,calls}=fixture({repository:{status:async()=>({lastAttempt:{status:'failed',finishedAt:new Date(now-60_000).toISOString()}})},workerOptions:{scheduler,now:()=>now}});
  const stop=worker.start();await new Promise(r=>setImmediate(r));
  assert.equal(calls.includes('scan'),false);
  assert.equal(timeout.delay,29*60_000);
  now+=timeout.delay;timeout.callback();await new Promise(r=>setImmediate(r));
  assert.equal(calls.includes('scan'),true);assert.equal(interval.delay,30*60_000);
  stop();assert.equal(cleared,true);
});
