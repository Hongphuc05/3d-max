import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDriveMediaProvider } from './drive-media.js';

test('OAuth media uses the source connection and passes the resource key and abort signal', async () => {
  const controller = new AbortController();
  const tokenProvider = () => 'token';
  let config, args;
  const provider = createDriveMediaProvider({ oauth: { tokenProvider: id => { assert.equal(id, 'connection'); return tokenProvider; } },
    makeClient: value => { config = value; return { openMedia: async (...a) => { args = a; return { data: Readable.from(['abc']), headers: new Headers({ 'content-length': '3' }) }; } }; } });
  const result = await provider.openDownload({ record: { sourceMode: 'OAUTH', connectionId: 'connection', driveFileId: 'file-id', resourceKey: 'key' }, size: 3 }, { signal: controller.signal });
  assert.equal(config.getAccessToken, tokenProvider);
  assert.deepEqual(args, ['file-id', { resourceKey: 'key', signal: controller.signal }]);
  assert.equal((await Array.fromAsync(result.data)).join(''), 'abc');
});

test('unconfigured source fails closed and an upstream length mismatch stops streaming', async () => {
  const provider = createDriveMediaProvider({ oauth: {}, makeClient: () => ({ openMedia: async () => ({ data: Readable.from(['bad']), headers: new Headers({ 'content-length': '3' }) }) }) });
  await assert.rejects(provider.openDownload({ record: { sourceMode: 'API_KEY' } }, {}), { code: 'STORAGE_DOWNLOAD_FAILED' });
  await assert.rejects(provider.openDownload({ record: { sourceMode: 'API_KEY' }, size: 4 }, {}), { code: 'STORAGE_DOWNLOAD_FAILED' });
  const configured = createDriveMediaProvider({ oauth: {}, apiKey: 'key', makeClient: () => ({ openMedia: async () => ({ data: Readable.from(['bad']), headers: new Headers({ 'content-length': '3' }) }) }) });
  await assert.rejects(configured.openDownload({ record: { sourceMode: 'API_KEY' }, size: 4 }, {}), { code: 'DOWNLOAD_SIZE_MISMATCH' });
});
