import test from 'node:test';
import assert from 'node:assert/strict';
const listeners = new Set(), requests = [];
globalThis.window = { chrome: { webview: { addEventListener: (_type, listener) => listeners.add(listener), postMessage: request => requests.push(request) } } };
const { importDownloaded, getImports } = await import('./local-imports.js');
const reply = data => listeners.forEach(listener => listener({ data }));
const flush = () => new Promise(resolve => setImmediate(resolve));
const option = { optionId: 'a'.repeat(64), label: 'model.max', relativePath: 'model.max', format: 'max' };
test('single local file imports with opaque ID; grid/detail deduplicate actions', async () => {
  const pending = importDownloaded('local-model'); await importDownloaded('local-model');
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'library.importOptions');
  reply({ id: requests[0].id, ok: true, result: { options: [option] } }); await flush();
  const request = requests.at(-1); assert.equal(request.method, 'asset.import');
  assert.deepEqual(request.params, { modelId: 'local-model', optionId: option.optionId });
  await importDownloaded('local-model'); assert.equal(requests.length, 2);
  reply({ id: request.id, ok: true, result: { imported: 1 } }); await pending;
  assert.equal(getImports()[0].status, 'done'); assert.ok(getImports()[0].finishedAt);
});
test('missing local model reports error without downloading', async () => {
  const pending = importDownloaded('missing-model'), request = requests.at(-1);
  reply({ id: request.id, ok: false, error: { code: 'MODEL_NOT_DOWNLOADED', message: 'Model không còn trên máy.' } }); await pending;
  const state=getImports().find(item=>item.modelId==='missing-model');
  assert.equal(state.status,'failed'); assert.match(state.error,/không còn/);
  assert.ok(requests.every(item=>['library.importOptions','asset.import'].includes(item.method)));
});
test('empty file list never guesses or downloads', async () => {
  const before=requests.filter(r=>r.method==='asset.import').length;
  const pending=importDownloaded('empty-model'),request=requests.at(-1);
  reply({id:request.id,ok:true,result:{options:[]}}); await pending;
  assert.equal(getImports().find(item=>item.modelId==='empty-model').status,'failed');
  assert.equal(requests.filter(r=>r.method==='asset.import').length,before);
});
