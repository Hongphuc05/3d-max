import test from 'node:test';
import assert from 'node:assert/strict';
import { watchCatalog } from './catalog-refresh.js';
import { categoryKeys, matchesCategory, downloadedProducts, catalogMessage } from './catalog-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

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

test('Drive states never instruct users to configure local catalog files', () => {
  assert.match(catalogMessage({ state: 'not_synced', provider: 'google_drive' }), /Chưa đồng bộ/);
  assert.match(catalogMessage({ state: 'syncing', syncing: true }), /Đang đồng bộ/);
  assert.match(catalogMessage({ state: 'empty', lastSuccessfulSync: '2026-10-25' }), /trống/);
  assert.match(catalogMessage({ state: 'error', error: 'GOOGLE_DRIVE_API_KEY_REQUIRED' }), /API Key/);
  assert.equal(/SOURCE_DIR|catalog\.json/.test(catalogMessage({ state: 'error', error: 'Drive unavailable' })), false);
});

test('catalog source states distinguish configuration, stale snapshots and successful empty state',()=>{
  assert.equal(catalogMessage(null),'');assert.equal(catalogMessage({state:'ready'}),'');
  assert.match(catalogMessage({error:'GOOGLE_DRIVE_API_DISABLED'}),/chưa được bật/);
  assert.match(catalogMessage({error:'GOOGLE_DRIVE_API_KEY_RESTRICTED'}),/giới hạn/);
  assert.match(catalogMessage({error:'DRIVE_AUTOMATED_REQUESTS_BLOCKED'}),/tạm chặn/);
  assert.match(catalogMessage({error:{code:'GOOGLE_DRIVE_API_KEY_REQUIRED'}}),/API Key/);
  assert.match(catalogMessage({error:'DRIVE_QUOTA_EXCEEDED',lastSuccessfulSync:'2026-10-25'}),/gần nhất/);
  assert.match(catalogMessage({error:'DRIVE_PERMISSION_DENIED'}),/Không truy cập/);
  assert.match(catalogMessage({state:'configuration_required'}),/cấu hình/);
  assert.match(catalogMessage({state:'error'}),/Không truy cập/);
  assert.match(catalogMessage({state:'syncing'}),/Đang đồng bộ/);
  assert.equal(matchesCategory({category:'Furniture',subcategory:'Chair'},new Set(['Furniture/Chair'])),true);
  assert.equal(matchesCategory({},new Set()),true);
  assert.deepEqual(categoryKeys({name:'Furniture',children:[{name:'Chair'}]}),['Furniture','Furniture/Chair']);
  assert.deepEqual(downloadedProducts([],[{status:'done'},{status:'failed',product:{id:'bad'}}]),[]);
});
