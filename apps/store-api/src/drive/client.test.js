import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient, classifyDriveError, parseRetryAfter } from './client.js';
import { startFakeDrive } from './testing/fake-drive.js';

const ROOT = 'rootFolderId1', SUB = 'subFolderId01';
const files = [
  { id: SUB, name: 'Furniture', mimeType: 'application/vnd.google-apps.folder', parents: [ROOT] },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `modelFile${i}xxxx`, name: `m${i}.rar`, mimeType: 'application/x-rar', parents: [ROOT], size: 10, md5Checksum: 'abc', content: Buffer.from(`bytes-${i}`) })),
  { id: 'restrictedFile1', name: 'no.rar', mimeType: 'application/x-rar', parents: [SUB], size: 3, canDownload: false },
  { id: 'keyedFile00001', name: 'k.jpg', mimeType: 'image/jpeg', parents: [SUB], size: 3, resourceKey: 'rk-1', content: Buffer.from('k') },
];
let drive, tokens, issued;
const mk = (extra = {}) => createDriveClient({
  baseUrl: drive.baseUrl, retry: { sleep: async () => {}, random: () => 0 },
  getAccessToken: async ({ force } = {}) => { if (force) issued++; return tokens.current; }, ...extra,
});
before(async () => { drive = await startFakeDrive({ files, pageSize: 2 }); });
after(() => drive.close());
beforeEach(() => { drive.state.requests.length = 0; drive.state.failures.length = 0; tokens = { current: 'good-token' }; issued = 0; });

test('listChildren paginates through nextPageToken (>1 page)', async () => {
  const c = mk(); const seen = []; let token = null; let pages = 0;
  do { const r = await c.listChildren(ROOT, { pageToken: token }); seen.push(...r.files.map(f => f.id)); token = r.nextPageToken; pages++; } while (token);
  assert.equal(seen.length, 6); assert.ok(pages >= 3);
  assert.equal(new Set(seen).size, 6);
});

test('requests ask for shared-drive support and the fields the scanner needs', async () => {
  await mk().listChildren(ROOT);
  const q = drive.state.requests[0].query;
  assert.equal(q.supportsAllDrives, 'true'); assert.equal(q.includeItemsFromAllDrives, 'true');
  for (const f of ['md5Checksum', 'capabilities(canDownload)', 'resourceKey', 'shortcutDetails', 'modifiedTime', 'parents']) assert.match(q.fields, new RegExp(f.replace(/[()]/g, '\\$&')));
});

test('folder ids that could widen the query are rejected BEFORE any request', async () => {
  const c = mk();
  for (const evil of ["x' or 'a' in parents or 'b", "abc'--", 'a b', '', '../etc/passwd', "a'; drop", 'short']) {
    await assert.rejects(c.listChildren(evil), { code: 'INVALID_PARAMS' }, evil);
  }
  assert.equal(drive.state.requests.length, 0);
});

test('resource key is sent as X-Goog-Drive-Resource-Keys', async () => {
  const r = await mk().getFile('keyedFile00001', { resourceKey: 'rk-1' });
  assert.equal(r.name, 'k.jpg');
  assert.equal(drive.state.requests[0].headers['x-goog-drive-resource-keys'], 'keyedFile00001/rk-1');
  await assert.rejects(mk().getFile('keyedFile00001', { resourceKey: 'bad key!' }), { code: 'INVALID_PARAMS' });
});

test('401 → forces ONE token refresh and succeeds with the new token', async () => {
  tokens.current = 'stale-token';
  const c = createDriveClient({ baseUrl: drive.baseUrl, retry: { sleep: async () => {} },
    getAccessToken: async ({ force } = {}) => { if (force) { issued++; tokens.current = 'good-token'; } return tokens.current; } });
  assert.equal((await c.getFile(SUB)).name, 'Furniture');
  assert.equal(issued, 1); assert.equal(drive.state.requests.length, 2);
});

test('401 even after refresh → DRIVE_AUTH_REVOKED, no endless loop', async () => {
  tokens.current = 'never-valid';
  await assert.rejects(mk().getFile(SUB), { code: 'DRIVE_AUTH_REVOKED' });
  assert.equal(drive.state.requests.length, 2); assert.equal(issued, 1);
});

test('403 rate-limit and 429 are retried; Retry-After honoured', async () => {
  drive.state.failures.push({ status: 403, reason: 'userRateLimitExceeded' }, { status: 429, headers: { 'retry-after': '2' } });
  const waits = [];
  const c = mk({ retry: { sleep: async ms => waits.push(ms), random: () => 0 } });
  assert.equal((await c.getFile(SUB)).name, 'Furniture');
  assert.equal(drive.state.requests.length, 3); assert.deepEqual(waits, [500, 2000]);
});

test('403 permission (and 404) are NOT retried and map to clear codes', async () => {
  drive.state.failures.push({ status: 403, reason: 'forbidden' });
  await assert.rejects(mk().getFile(SUB), { code: 'DRIVE_PERMISSION_DENIED', reason: 'forbidden' });
  assert.equal(drive.state.requests.length, 1);
  await assert.rejects(mk().getFile('doesNotExist01'), { code: 'DRIVE_NOT_FOUND' });
});

test('5xx is retried then gives up with DRIVE_UPSTREAM_ERROR', async () => {
  for (let i = 0; i < 4; i++) drive.state.failures.push({ status: 503 });
  await assert.rejects(mk({ retry: { retries: 3, sleep: async () => {} } }).getFile(SUB), { code: 'DRIVE_UPSTREAM_ERROR' });
  assert.equal(drive.state.requests.length, 4);
});

test('network failure is classified as retryable upstream error', async () => {
  let calls = 0;
  const c = createDriveClient({ getAccessToken: async () => 't', retry: { retries: 2, sleep: async () => {} },
    fetchImpl: async () => { calls++; throw new TypeError('fetch failed'); } });
  await assert.rejects(c.getFile(SUB), { code: 'DRIVE_UPSTREAM_ERROR' });
  assert.equal(calls, 3);
});

test('openMedia streams the bytes and exposes the provider shape; token never in the URL', async () => {
  const r = await mk().openMedia('modelFile0xxxx');
  const chunks = []; for await (const c of r.data) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), 'bytes-0');
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-length'), '7');
  for (const req of drive.state.requests) assert.ok(!JSON.stringify(req.query).includes('good-token'));
});

test('download-restricted file → DRIVE_PERMISSION_DENIED (we do not try to bypass it)', async () => {
  await assert.rejects(mk().openMedia('restrictedFile1'), { code: 'DRIVE_PERMISSION_DENIED', reason: 'downloadRestricted' });
  assert.equal(drive.state.requests.length, 1);
});

test('caller abort propagates as an abort, not as a Drive error', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(mk().getFile(SUB, { signal: ac.signal }), e => e.code !== 'DRIVE_UPSTREAM_ERROR');
});

test('about() returns the operator e-mail', async () => {
  assert.deepEqual(await mk().about(), { email: 'operator@example.test' });
});

test('classifyDriveError is pure and total', () => {
  const h = new Headers({ 'retry-after': '5' });
  assert.equal(classifyDriveError(429, null, h).retryAfterMs, 5000);
  assert.equal(classifyDriveError(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }).retryable, true);
  assert.equal(classifyDriveError(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } }).code, 'DRIVE_PERMISSION_DENIED');
  assert.equal(classifyDriveError(400, null).code, 'DRIVE_BAD_REQUEST');
  assert.equal(classifyDriveError(418, 'not json').code, 'DRIVE_BAD_REQUEST');
});

test('parseRetryAfter: absent/empty/garbage is unknown (NOT zero); seconds and HTTP dates parse', () => {
  for (const v of [undefined, null, '', '  ', 'soon', 'NaN']) assert.equal(parseRetryAfter(v), undefined, String(v));
  assert.equal(parseRetryAfter('7'), 7000);
  assert.equal(parseRetryAfter('0'), 0);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now), 30_000);
  assert.equal(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now), 0);
});
