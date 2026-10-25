import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PreviewCache } from './preview-cache.js';
import { DriveError } from './provider.js';

const model = { archiveId: 'archive', preview: { id: 'preview', mimeType: 'image/jpeg', modifiedTime: '2026-01-01T00:00:00Z' } };

test('preview download preserves safe Drive permission, quota, resource-key and restriction diagnostics',async t=>{
  const f=await fixture(t);
  for(const code of ['DRIVE_PERMISSION_DENIED','DRIVE_QUOTA_EXCEEDED','DRIVE_FILE_OR_RESOURCE_KEY_NOT_FOUND','DRIVE_DOWNLOAD_RESTRICTED']){
    const cache=new PreviewCache({directory:f.directory,provider:{openDownload:async()=>{throw new DriveError(code);}}});
    await assert.rejects(cache.prepare(model),{code});
  }
});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'drive-previews-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const calls = [];
  const provider = { openDownload: async file => { calls.push(file.id); return { data: Readable.from([bytes]), headers: { 'content-type': 'image/jpeg' } }; } };
  return { directory, bytes, calls, cache: new PreviewCache({ directory, provider, cleanupGraceMs:0, ...options }) };
}

test('sync downloads only the preview, validates and converts it, reuses unchanged cache and versions modified images', async t => {
  const f = await fixture(t);
  const first = await f.cache.prepare(model);
  assert.equal(first.previewUpdated, true);
  assert.match(first.cachedPreviewPath, /^[a-f0-9]{64}\.webp$/);
  assert.equal((await sharp(await readFile(f.cache.resolve(first.cachedPreviewPath))).metadata()).format, 'webp');
  assert.equal((await f.cache.prepare(model)).previewUpdated, false);
  const changed = await f.cache.prepare({ ...model, preview: { ...model.preview, modifiedTime: '2026-02-01T00:00:00Z' } });
  assert.notEqual(changed.previewVersion, first.previewVersion);
  assert.deepEqual(f.calls, ['preview', 'preview']);
  assert.equal((await f.cache.prepare({ archiveId: 'archive', preview: null })).cachedPreviewPath, null);
});

test('rejects invalid MIME, corrupt image, pixel limits and byte limits without leaving cache or staging files', async t => {
  const f = await fixture(t);
  for (const [mime, bytes, maxBytes, maxPixels] of [['text/html', f.bytes, 10000, 1000], ['image/jpeg', Buffer.from('not an image'), 10000, 1000], ['image/jpeg', f.bytes, 1, 1000], ['image/jpeg', f.bytes, 10000, 1]]) {
    const cache = new PreviewCache({ directory: f.directory, maxBytes, maxPixels, provider: { openDownload: async () => ({ data: Readable.from([bytes]), headers: { 'content-type': mime } }) } });
    await assert.rejects(cache.prepare(model));
    assert.deepEqual(await readdir(f.directory), []);
  }
  await assert.rejects(f.cache.prepare({ ...model, preview: { ...model.preview, mimeType: 'text/html' } }), { code: 'PREVIEW_INVALID_MIME' });
});

test('checksum detects an incomplete or changed preview; cache cleanup only removes managed unreferenced files', async t => {
  const f = await fixture(t);
  await assert.rejects(f.cache.prepare({ ...model, preview: { ...model.preview, md5Checksum: '0'.repeat(32) } }), { code: 'PREVIEW_CHECKSUM_MISMATCH' });
  const first = await f.cache.prepare(model);
  const second = await f.cache.prepare({ ...model, preview: { ...model.preview, modifiedTime: '2026-02-01T00:00:00Z' } });
  await writeFile(path.join(f.directory, 'do-not-remove.txt'), 'safe');
  await f.cache.cleanup([second.cachedPreviewPath]);
  assert.deepEqual((await readdir(f.directory)).sort(), ['do-not-remove.txt', second.cachedPreviewPath].sort());
  assert.throws(() => f.cache.resolve('../secret'), { code: 'PREVIEW_INVALID_PATH' });
  assert.throws(() => f.cache.resolve(path.join(f.directory, first.cachedPreviewPath)), { code: 'PREVIEW_INVALID_PATH' });
});
