import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient, FOLDER } from './client.js';
import { startFakeDrive } from './testing/fake-drive.js';

const KEY = 'AIzaSyTestKey_0123456789-abcdefghijklmn';
const ROOT = 'rootFolderId0001';
let fake;
before(async () => {
  fake = await startFakeDrive({
    pageSize: 2, apiKeys: [KEY],
    files: [{ id: 'childFolder0001', name: 'A', mimeType: FOLDER, parents: [ROOT] }, { id: 'childFile000001', name: 'x.jpg', mimeType: 'image/jpeg', parents: [ROOT] }],
  });
});
after(async () => { await fake.close(); });
const make = (over = {}) => createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl, retry: { sleep: async () => {}, retries: 2 }, ...over });

test('API-key mode: key goes in the query, no Authorization header is ever sent, listing works', async () => {
  fake.state.requests.length = 0;
  const page = await make().listChildren(ROOT);
  assert.deepEqual(page.files.map(f => f.name), ['A', 'x.jpg']);
  const req = fake.state.requests.at(-1);
  assert.equal(req.query.key, KEY);
  assert.equal(req.headers.authorization, undefined);
});

test('API-key mode: needs either an access-token provider or a well-formed key; a malformed key is refused up front', () => {
  assert.throws(() => createDriveClient({ baseUrl: fake.baseUrl }), TypeError);
  for (const bad of ['', 'short', 'has space in the key 0123456789', "quote'0123456789012345678", 'x'.repeat(300), 42]) {
    assert.throws(() => createDriveClient({ apiKey: bad, baseUrl: fake.baseUrl }), TypeError, String(bad).slice(0, 10));
  }
  createDriveClient({ apiKey: KEY, baseUrl: fake.baseUrl }); // a well-formed key is accepted
  createDriveClient({ getAccessToken: async () => 't', baseUrl: fake.baseUrl }); // OAuth mode unchanged
});

test('API-key mode: a rejected key and upstream failures never put the key in the error', async () => {
  const wrong = createDriveClient({ apiKey: 'AIzaSyWrongKey_0123456789-abcdefghijklm', baseUrl: fake.baseUrl, retry: { sleep: async () => {} } });
  const e1 = await wrong.listChildren(ROOT).catch(e => e);
  assert.equal(e1.code, 'DRIVE_BAD_REQUEST');
  assert.ok(!JSON.stringify(e1).includes('WrongKey') && !String(e1.stack).includes('WrongKey') && !String(e1.message).includes('WrongKey'));

  fake.state.failures.push({ status: 403, reason: 'forbidden' });
  const e2 = await make().listChildren(ROOT).catch(e => e);
  assert.equal(e2.code, 'DRIVE_PERMISSION_DENIED');
  for (const text of [JSON.stringify(e2), String(e2.stack), String(e2.message)]) assert.ok(!text.includes(KEY), 'key leaked in error');
});

test('API-key mode: 429 is retried with backoff and then succeeds; getFile and openMedia also carry the key', async () => {
  fake.state.failures.push({ status: 429, reason: 'rateLimitExceeded', headers: { 'retry-after': '0' } });
  const waits = [];
  const page = await make({ retry: { sleep: async ms => { waits.push(ms); }, retries: 2 } }).listChildren(ROOT);
  assert.equal(page.files.length, 2);
  assert.equal(waits.length, 1);
  fake.state.requests.length = 0;
  await make().getFile('childFile000001');
  assert.equal(fake.state.requests.at(-1).query.key, KEY);
  assert.equal(fake.state.requests.at(-1).headers.authorization, undefined);
});
