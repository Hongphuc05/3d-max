import test from 'node:test';
import assert from 'node:assert/strict';
import { watchCatalog } from './catalog-refresh.js';
import { categoryKey, categoryKeys, matchesCategory, downloadedProducts, catalogMessage } from './catalog-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function liveFixture(options = {}) {
  const source = new EventTarget();
  source.close = () => { source.closed = true; };
  let version = 1, loads = 0;
  const stop = watchCatalog({ fetchVersion: async () => ({ version }),
    fetchSnapshot: async () => { loads++; return { products: [version], categories: [] }; },
    onSnapshot() {}, onStatus() {}, onError: assert.fail,
    events: new EventTarget(), document: new EventTarget(), schedule: () => 1, unschedule() {},
    createEventSource: url => { assert.equal(url, '/api/catalog/events'); return source; }, ...options });
  return { source, stop, get loads() { return loads; }, setVersion(value) { version = value; } };
}

test('SSE changes refresh immediately and reconnect reloads even an unchanged version', async () => {
  const fixture = liveFixture(); await flush(); assert.equal(fixture.loads, 1);
  fixture.setVersion(2); fixture.source.dispatchEvent(new Event('catalog.changed')); await flush();
  assert.equal(fixture.loads, 2);
  fixture.source.dispatchEvent(new Event('open')); await flush(); assert.equal(fixture.loads, 3);
  fixture.stop(); assert.equal(fixture.source.closed, true);
  fixture.source.dispatchEvent(new Event('model.updated')); await flush(); assert.equal(fixture.loads, 3);
});

test('SSE event during an in-flight refresh is replayed after that request', async () => {
  let release, version = 1, result;
  const fixture = liveFixture({ fetchVersion: async () => ({ version }),
    fetchSnapshot: async () => { if (version === 1) await new Promise(resolve => { release = resolve; }); return { products: [version] }; },
    onSnapshot: value => { result = value; } });
  await flush(); version = 2; fixture.source.dispatchEvent(new Event('category.created')); release();
  await flush(); await flush(); assert.deepEqual(result.products, [2]); fixture.stop();
});

test('full category paths distinguish same names and match all ancestors', () => {
  assert.equal(categoryKey({ id: 'legacy-id', path: 'Furniture/Other', name: 'Other' }), 'Furniture/Other');
  assert.equal(matchesCategory({ folderPath: 'Furniture/Outdoor/Other' }, new Set(['Furniture/Outdoor'])), true);
  assert.equal(matchesCategory({ folderPath: 'Furniture/Outdoor/Other' }, new Set(['Lighting/Other'])), false);
});

test('catalog checks version every two minutes, refreshes on foreground, and cleans up', async () => {
  const events = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  let version = 1, loads = 0, scheduled, cleared, latest;
  const stop = watchCatalog({ fetchVersion: async () => ({ version, state: 'ready' }),
    fetchSnapshot: async () => ({ products: [{ id: String(version) }], categories: [] }),
    onSnapshot: value => { loads++; latest = value; }, onStatus: () => {}, onError: assert.fail,
    events, document: doc, schedule: (callback, delay) => { assert.equal(delay, 120000); scheduled = callback; return 7; },
    unschedule: id => { cleared = id; } });
  await flush();
  assert.equal(loads, 1);
  scheduled(); await flush();
  assert.equal(loads, 1);
  version = 2; events.dispatchEvent(new Event('focus')); await flush();
  assert.equal(loads, 2);
  assert.deepEqual(latest.products, [{ id: '2' }]);
  stop();
  assert.equal(cleared, 7);
  version = 3; events.dispatchEvent(new Event('focus')); scheduled(); await flush();
  assert.equal(loads, 2);
});

test('packaged app uses foreground polling every fifteen seconds without opening SSE', async () => {
  const events = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  let sourceCount = 0, scheduled, interval, cleared, versions = 0, snapshots = 0, version = 1;
  const stop = watchCatalog({
    location: new URL('https://app.3dsmood.local/'), events, document: doc,
    fetchVersion: async () => { versions++; return { version }; },
    fetchSnapshot: async () => { snapshots++; return { products: [version] }; },
    onSnapshot() {}, onStatus() {}, onError: assert.fail,
    createEventSource: () => { sourceCount++; return null; },
    schedule: (callback, delay) => { scheduled = callback; interval = delay; return 9; },
    unschedule: id => { cleared = id; },
  });
  try {
    await flush();
    assert.equal(sourceCount, 0, 'bounded native API proxy does not stream SSE');
    assert.equal(interval, 15000);
    assert.equal(snapshots, 1);
    version = 2;
    scheduled(); await flush();
    assert.equal(snapshots, 2);
    doc.visibilityState = 'hidden';
    const beforeHidden = versions;
    scheduled(); await flush();
    assert.equal(versions, beforeHidden, 'hidden app waits until returning to the foreground');
    doc.visibilityState = 'visible';
    version = 3;
    events.dispatchEvent(new Event('focus')); await flush();
    assert.equal(snapshots, 3);
  } finally { stop(); }
  assert.equal(cleared, 9);
});

test('failed refresh preserves previous snapshot and retries same version', async () => {
  let version = 1, fail = false, refresh, snapshot, errors = 0;
  const stop = watchCatalog({ fetchVersion: async () => ({ version }),
    fetchSnapshot: async () => { if (fail) throw new Error('offline'); return { products: [version] }; },
    onSnapshot: value => { snapshot = value; }, onStatus: () => {}, onError: () => { errors++; },
    events: new EventTarget(), document: { addEventListener() {}, removeEventListener() {} },
    schedule: callback => { refresh = callback; return 1; }, unschedule() {} });
  await flush(); version = 2; fail = true; refresh(); await flush();
  assert.deepEqual(snapshot.products, [1]); assert.equal(errors, 1);
  fail = false; refresh(); await flush(); assert.deepEqual(snapshot.products, [2]); stop();
});

test('unmount aborts an in-flight request and prevents state updates', async () => {
  let signal, complete, calls = 0;
  const stop = watchCatalog({ fetchVersion: input => { signal = input; return new Promise(resolve => { complete = resolve; }); },
    fetchSnapshot: async () => { calls++; }, onSnapshot: () => { calls++; }, onStatus: () => { calls++; }, onError: assert.fail,
    events: new EventTarget(), document: { addEventListener() {}, removeEventListener() {} }, schedule: () => 1, unschedule() {} });
  stop(); complete({ version: 1 }); await flush();
  assert.equal(signal.aborted, true); assert.equal(calls, 0);
});

test('recursive category keys distinguish duplicate names and include folders with direct models', () => {
  const folder = { id: 'root', name: 'Root', children: [{ id: 'a', name: 'Same', children: [{ id: 'b', name: 'Deep', children: [] }] }] };
  assert.deepEqual(categoryKeys(folder), ['root', 'a', 'b']);
  assert.equal(matchesCategory({ folderIds: ['root', 'a', 'b'], folderId: 'b' }, new Set(['a'])), true);
  assert.equal(matchesCategory({ folderIds: ['other'], folderId: 'other' }, new Set(['a'])), false);
});

test('downloaded product snapshots survive removal from online catalog', () => {
  const snapshot = { id: 'gone', slug: 'gone', name: 'Local model' };
  assert.deepEqual(downloadedProducts([], [{ status: 'done', product: snapshot }]), [snapshot]);
  assert.deepEqual(downloadedProducts([{ ...snapshot, name: 'Renamed' }], [{ status: 'done', product: snapshot }])[0].name, 'Renamed');
});

test('R2 states never instruct users to configure local catalog files', () => {
  assert.match(catalogMessage({ state: 'not_synced', provider: 'r2' }), /Chưa đồng bộ/);
  assert.match(catalogMessage({ state: 'syncing', syncing: true }), /Đang đồng bộ/);
  assert.match(catalogMessage({ state: 'empty', lastSuccessfulSync: '2026-10-25' }), /trống/);
  assert.match(catalogMessage({ state: 'error', error: 'R2_READ_ACCESS_KEY_REQUIRED' }), /cấu hình/);
  assert.equal(/SOURCE_DIR|catalog\.json/.test(catalogMessage({ state: 'error', error: 'R2 unavailable' })), false);
});

test('catalog source states distinguish configuration, stale snapshots and successful empty state',()=>{
  assert.equal(catalogMessage(null),'');assert.equal(catalogMessage({state:'ready'}),'');
  assert.match(catalogMessage({error:'R2_ACCESS_DENIED'}),/Không truy cập/);
  assert.match(catalogMessage({error:'R2_UNAVAILABLE'}),/Không truy cập/);
  assert.match(catalogMessage({error:'R2_CONFIGURATION_REQUIRED'}),/cấu hình/);
  assert.match(catalogMessage({error:{code:'R2_READ_ACCESS_KEY_REQUIRED'}}),/cấu hình/);
  assert.match(catalogMessage({error:'R2_UNAVAILABLE',lastSuccessfulSync:'2026-10-25'}),/gần nhất/);
  assert.match(catalogMessage({error:'R2_ACCESS_DENIED'}),/Không truy cập/);
  assert.match(catalogMessage({state:'configuration_required'}),/cấu hình/);
  assert.match(catalogMessage({state:'error'}),/Không truy cập/);
  assert.match(catalogMessage({state:'syncing'}),/Đang đồng bộ/);
  assert.equal(matchesCategory({category:'Furniture',subcategory:'Chair'},new Set(['Furniture/Chair'])),true);
  assert.equal(matchesCategory({},new Set()),true);
  assert.deepEqual(categoryKeys({name:'Furniture',children:[{name:'Chair'}]}),['Furniture','Furniture/Chair']);
  assert.deepEqual(downloadedProducts([],[{status:'done'},{status:'failed',product:{id:'bad'}}]),[]);
});
