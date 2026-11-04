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

test('API-key mode: the HTML 403 block page is a rate limit (not "permission denied"); a JSON 403 stays permission denied', async () => {
  fake.state.failures.push({ status: 403, html: true, media: true });
  const e = await make().openMedia('childFile000001').catch(x => x);
  assert.equal(e.code, 'DRIVE_QUOTA_EXCEEDED');
  assert.ok(!e.retryable, 'no in-client retry: the worker decides how long to wait');
  fake.state.failures.push({ status: 403, reason: 'forbidden', media: true });
  assert.equal((await make().openMedia('childFile000001').catch(x => x)).code, 'DRIVE_PERMISSION_DENIED');
});

test('backup key is used on key rejection or quota, but not file permission errors', async () => {
  const backup = 'AIzaSyBackup_0123456789-abcdefghijklmn';
  for (const [status, reason, shouldFallback] of [[400, 'keyInvalid', true], [403, 'quotaExceeded', true], [403, 'forbidden', false]]) {
    const seen = [];
    const client = createDriveClient({ apiKey: KEY, backupApiKey: backup, retry: { retries: 0 }, fetchImpl: async url => {
      seen.push(url.searchParams.get('key'));
      if (seen.length === 1) return Response.json({ error: { errors: [{ reason }] } }, { status });
      return Response.json({ files: [] });
    }});
    if (shouldFallback) await client.listChildren(ROOT);
    else await assert.rejects(client.listChildren(ROOT), { code: 'DRIVE_PERMISSION_DENIED' });
    assert.deepEqual(seen, shouldFallback ? [KEY, backup] : [KEY]);
  }
});
