import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveApiLister } from './drive-api.mjs';

const apiKey = 'AIzaSyExampleKeyForUnitTesting123456';
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

test('Drive API lister paginates and normalizes folder rows', async () => {
  const requests = [];
  const lister = createDriveApiLister({
    apiKey,
    pageSize: 1,
    fetchImpl: async url => {
      requests.push(new URL(url));
      if (requests.length === 1) return response({
        files: [{ id: 'archivefile123', name: 'Chair.zip', mimeType: 'application/zip', size: '123', modifiedTime: '2026-01-01T00:00:00.000Z' }],
        nextPageToken: 'next-page'
      });
      return response({ files: [{ id: 'previewfile123', name: 'Chair.jpg', mimeType: 'image/jpeg', size: '45' }] });
    }
  });

  const files = await lister('rootfolder123');
  assert.deepEqual(files, [
    { id: 'archivefile123', name: 'Chair.zip', mime: 'application/zip', size: 123, modified: '2026-01-01T00:00:00.000Z' },
    { id: 'previewfile123', name: 'Chair.jpg', mime: 'image/jpeg', size: 45, modified: '' }
  ]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('key'), apiKey);
  assert.equal(requests[0].searchParams.get('q'), "'rootfolder123' in parents and trashed = false");
  assert.equal(requests[1].searchParams.get('pageToken'), 'next-page');
  assert.equal(requests[0].searchParams.get('pageSize'), '1');
});

test('Drive API lister rejects incomplete listings, malformed metadata and repeated page tokens', async () => {
  const make = listing => createDriveApiLister({ apiKey, fetchImpl: async () => response(listing) });
  await assert.rejects(make({ files: [], incompleteSearch: true })('rootfolder123'), /incomplete/i);
  await assert.rejects(make({ files: [{ id: 'bad', name: 'bad.zip', mimeType: 'application/zip' }] })('rootfolder123'), /invalid file metadata/i);

  let calls = 0;
  const loop = createDriveApiLister({
    apiKey,
    fetchImpl: async () => {
      calls += 1;
      return response({ files: [], nextPageToken: 'repeat-me' });
    }
  });
  await assert.rejects(loop('rootfolder123'), /invalid page token/i);
  assert.equal(calls, 2);
});

test('Drive API lister marks rate limits transient and does not disclose the API key', async () => {
  const lister = createDriveApiLister({ apiKey, fetchImpl: async () => new Response('quota details', { status: 429 }) });
  await assert.rejects(lister('rootfolder123'), error => {
    assert.equal(error.transient, true);
    assert.doesNotMatch(error.message, new RegExp(apiKey));
    return true;
  });
  assert.throws(() => createDriveApiLister({ apiKey: 'short' }), /missing or invalid/i);
});
