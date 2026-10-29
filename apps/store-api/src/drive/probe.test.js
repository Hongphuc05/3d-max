import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { exportJWK, importSPKI, jwtVerify } from 'jose';
import { createDriveClient } from './client.js';
import { downloadSample, pickSamples, runProbe, surveyTree } from './probe.js';
import { serviceAccountTokenProvider } from './service-account.js';
import { startFakeDrive } from './testing/fake-drive.js';

const md5 = b => createHash('md5').update(b).digest('hex');
const FOLDER = 'application/vnd.google-apps.folder', SHORTCUT = 'application/vnd.google-apps.shortcut';
const ROOT = 'rootFolderId1', A = 'folderAAAAAAA1', B = 'folderBBBBBBB1', C = 'folderCCCCCCC1', D = 'folderDDDDDDD1';
const small = Buffer.from('tiny'), mid = Buffer.alloc(5000, 7), big = Buffer.alloc(300_000, 9);
const file = (id, name, content, extra = {}) => ({ id, name, mimeType: 'application/x-rar', size: content.length, content, md5Checksum: md5(content), ...extra });
let drive, client;

before(async () => {
  drive = await startFakeDrive({ pageSize: 2, files: [
    { id: A, name: 'A', mimeType: FOLDER, parents: [ROOT] },
    { id: B, name: 'B', mimeType: FOLDER, parents: [ROOT] },
    { id: C, name: 'C', mimeType: FOLDER, parents: [B] },
    { id: D, name: 'D-via-shortcut', mimeType: FOLDER, parents: ['someOtherRoot1'] },
    { id: 'shortcutToRoot1', name: 'loop', mimeType: SHORTCUT, parents: [C], shortcutDetails: { targetId: ROOT, targetMimeType: FOLDER } }, // cycle
    { id: 'shortcutToDDD01', name: 'to-D', mimeType: SHORTCUT, parents: [ROOT], shortcutDetails: { targetId: D, targetMimeType: FOLDER } },
    { id: 'googleDoc00001', name: 'notes', mimeType: 'application/vnd.google-apps.document', parents: [ROOT] },
    ...Array.from({ length: 5 }, (_, i) => file(`aFile${i}xxxxxxx`, `a${i}.rar`, Buffer.from(`content-${i}`), { parents: [A] })), // 5 children, pageSize 2 → 3 pages
    file('deepFile00001', 'deep.zip', mid, { parents: [C] }),
    file('smallFile0001', 'small.jpg', small, { parents: [ROOT] }),
    file('bigFile000001', 'big.rar', big, { parents: [D] }),
    file('lockedFile001', 'locked.rar', Buffer.from('lockedlocked'), { parents: [A], canDownload: false }),
    { ...file('noMd5File0001', 'nomd5.7z', Buffer.from('nm'), { parents: [A] }), md5Checksum: undefined },
  ] });
  drive.state.tokens.add('t');
  client = createDriveClient({ baseUrl: drive.baseUrl, getAccessToken: async () => 't', retry: { sleep: async () => {} } });
});
after(() => drive.close());
beforeEach(() => { drive.state.failures.length = 0; });

test('survey: recurses, paginates, follows a folder shortcut once, survives a shortcut cycle, counts the awkward cases', async () => {
  const { stats } = await surveyTree(client, { id: ROOT });
  assert.equal(stats.folders, 5, 'ROOT, A, B, C, D (D reached ONLY via shortcut)');
  assert.equal(stats.shortcuts, 2); assert.equal(stats.shortcutsFollowed, 1, 'the loop shortcut points to an already-seen folder');
  assert.equal(stats.googleDocs, 1);
  assert.equal(stats.files, 10); assert.equal(stats.maxDepth, 2);
  assert.equal(stats.maxChildrenInFolder, 7); assert.equal(stats.maxPagesInFolder, 4, 'pagination exercised');
  assert.equal(stats.noDownloadFlag, 1); assert.equal(stats.noMd5, 1);
  assert.deepEqual(stats.byExtension, { rar: 7, zip: 1, jpg: 1, '7z': 1 });
  assert.equal(stats.errors.length, 0);
});

test('survey: a failing sub-folder is recorded and the rest is still scanned; programming errors are NOT swallowed', async () => {
  drive.state.failures.push({ status: 404 }); // first list call fails
  const { stats } = await surveyTree(client, { id: ROOT });
  assert.equal(stats.errors.length, 1); assert.equal(stats.errors[0].code, 'DRIVE_NOT_FOUND');
  const broken = { listChildren: async () => { throw new TypeError('boom'); } };
  await assert.rejects(surveyTree(broken, { id: ROOT }), TypeError);
});

test('pickSamples: smallest / median / largest of downloadable files, unique, never a restricted or empty one', () => {
  const files = [{ id: 'a', size: 5, canDownload: true }, { id: 'b', size: 50, canDownload: true }, { id: 'c', size: 500, canDownload: true },
    { id: 'd', size: 9999, canDownload: false }, { id: 'e', size: 0, canDownload: true }];
  assert.deepEqual(pickSamples(files).map(f => f.id), ['a', 'b', 'c']);
  assert.deepEqual(pickSamples([{ id: 'x', size: 3, canDownload: true }]).map(f => f.id), ['x'], 'one file → one sample, no duplicates');
  assert.deepEqual(pickSamples([{ id: 'x', size: 3, canDownload: false }]), []);
});

test('downloadSample verifies size AND md5; a corrupted md5 expectation is detected', async () => {
  const good = await downloadSample(client, { id: 'bigFile000001', name: 'big.rar', size: big.length, md5: md5(big) });
  assert.equal(good.ok, true); assert.equal(good.md5Matches, true); assert.ok(good.mbPerSec > 0);
  const bad = await downloadSample(client, { id: 'bigFile000001', name: 'big.rar', size: big.length, md5: md5(Buffer.from('other')) });
  assert.equal(bad.ok, false); assert.equal(bad.md5Matches, false);
  const wrongSize = await downloadSample(client, { id: 'bigFile000001', name: 'big.rar', size: big.length + 1, md5: md5(big) });
  assert.equal(wrongSize.ok, false); assert.equal(wrongSize.sizeMatches, false);
  const none = await downloadSample(client, { id: 'smallFile0001', name: 's', size: small.length });
  assert.equal(none.md5Matches, null); assert.equal(none.ok, true, 'no checksum from Drive: size-only check, flagged as null');
});

test('downloadSample reports a refusal with its reason instead of throwing', async () => {
  drive.state.failures.push({ status: 403, reason: 'downloadRestricted', media: true });
  const r = await downloadSample(client, { id: 'bigFile000001', name: 'big.rar', size: 1, md5: 'x' });
  assert.deepEqual([r.ok, r.code, r.reason], [false, 'DRIVE_PERMISSION_DENIED', 'downloadRestricted']);
});

test('runProbe: end-to-end report; verdict true only when listing is clean AND all samples verify; no ids leak', async () => {
  const report = await runProbe(client, { id: ROOT });
  assert.equal(report.verdict.listed, true); assert.equal(report.verdict.downloadable, true); assert.equal(report.downloads.length, 3);
  // 9 downloadable files (locked.rar excluded): sizes 2, 4, 9×5, 5000, 300000 → smallest, median (9), largest
  assert.deepEqual(report.downloads.map(d => d.size), [2, 9, 300_000]);
  assert.equal(report.downloads[0].md5Matches, null, 'nomd5.7z has no Drive checksum → size-only, flagged null');
  const text = JSON.stringify(report);
  for (const id of [ROOT, A, B, C, D, 'bigFile000001', 'deepFile00001']) assert.ok(!text.includes(id), `report must not contain Drive id ${id}`);
  drive.state.failures.push({ status: 403, reason: 'forbidden' }); // listing of the first folder refused
  const partial = await runProbe(client, { id: ROOT });
  assert.equal(partial.verdict.listed, false);
});

test('service account: signs RS256 JWT with the right claims, caches, refreshes on force, maps failures', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = await importSPKI(publicKey.export({ type: 'spki', format: 'pem' }), 'RS256');
  const seen = []; let mode = 'ok';
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; seen.push(Object.fromEntries(new URLSearchParams(raw)));
    if (mode === 'revoked') { res.writeHead(400); return res.end('{"error":"invalid_grant"}'); }
    if (mode === '500') { res.writeHead(503); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ access_token: `sa-${seen.length}`, expires_in: 3600 }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const tokenUrl = `http://127.0.0.1:${srv.address().port}/token`;
  try {
    let t = Date.now();
    const get = serviceAccountTokenProvider({ clientEmail: 'sa@proj.iam.gserviceaccount.com', privateKey: pem, tokenUrl, now: () => t });
    assert.equal(await get(), 'sa-1'); assert.equal(await get(), 'sa-1'); assert.equal(seen.length, 1, 'cached');
    assert.equal(seen[0].grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload, protectedHeader } = await jwtVerify(seen[0].assertion, pub, { audience: tokenUrl, issuer: 'sa@proj.iam.gserviceaccount.com' });
    assert.equal(protectedHeader.alg, 'RS256'); assert.equal(payload.scope, 'https://www.googleapis.com/auth/drive.readonly');
    assert.ok(payload.exp - payload.iat <= 3600);
    assert.equal(await get({ force: true }), 'sa-2');
    t += 2 * 3600_000; assert.equal(await get(), 'sa-3', 'expired → re-minted');
    mode = 'revoked'; await assert.rejects(get({ force: true }), { code: 'DRIVE_AUTH_REVOKED' });
    mode = '500'; await assert.rejects(get({ force: true }), { code: 'DRIVE_UPSTREAM_ERROR' });
    assert.throws(() => serviceAccountTokenProvider({ clientEmail: 'x', privateKey: 'nope' }), TypeError);
  } finally { await new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }); }
});
