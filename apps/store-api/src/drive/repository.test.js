import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CatalogRepository, buildSnapshot } from './repository.js';
import { isolatedTestDatabase } from '../test-database.js';

test('public snapshot preserves recursive folders while hiding Drive identity and resource keys', () => {
  const folders = [
    { folder_id: 'drive-root', parent_folder_id: null, name: 'Wall light', folder_path: 'Wall light' },
    { folder_id: 'drive-child', parent_folder_id: 'drive-root', name: 'Small', folder_path: 'Wall light/Small' },
    { folder_id: 'drive-grandchild', parent_folder_id: 'drive-child', name: 'Gold', folder_path: 'Wall light/Small/Gold' },
  ];
  const models = [{ id: 'aabbcc112233', folder_id: 'drive-grandchild', archive_file_id: 'secret-drive-file', resource_key: 'secret',
    name: 'Lamp', file_size: '1048576', archive_extension: '.rar', can_download: true, cached_preview_path: 'cache.webp', preview_version: 'abc' }];
  const snapshot = buildSnapshot({ provider: 'google_drive', rootFolderId: 'drive-root', folders, models, version: 1 });
  assert.equal(snapshot.categories[0].children[0].children[0].name, 'Gold');
  assert.equal(snapshot.categories[0].count, 1);
  assert.equal(snapshot.products[0].folderIds.length, 3);
  assert.equal(snapshot.products[0].info.sizeMB, 1);
  assert.equal(snapshot.products[0].thumb, '/api/catalog/models/aabbcc112233/preview?v=abc');
  assert.equal(JSON.stringify(snapshot.products).includes('secret'), false);
  assert.equal(JSON.stringify(snapshot.categories).includes('drive-'), false);
  assert.deepEqual(snapshot.products[0].info.renderers, []);
});

const configured = Boolean(process.env.TEST_DATABASE_URL);
let pool, dispose;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('drive_catalog');
  const db = await import('../db.js');
  pool = db.pool;
  await db.migrate();
});
after(async () => { if (dispose) await dispose(pool); });

test('PostgreSQL snapshots survive restart, stable IDs/versions, rename, preview/folder deletion, and source isolation', { skip: !configured }, async () => {
  const rootFolderId = `root-${randomUUID()}`;
  const repo = new CatalogRepository({ pool, rootFolderId });
  const lock = await repo.acquireLock();
  const folders = [{ id: rootFolderId, name: 'Wall light', path: 'Wall light', parentId: null }, { id: 'child', name: 'Small', path: 'Wall light/Small', parentId: rootFolderId }];
  const model = { archiveId: 'file-a', folderId: 'child', name: 'Lamp', archiveExtension: '.rar', size: '10', modifiedTime: '2026-01-01T00:00:00Z', canDownload: true,
    preview: { id: 'preview-a' }, cachedPreviewPath: 'one.webp', previewVersion: 'one', previewUpdated: true };
  async function publish(models, nextFolders = folders) {
    const syncId = await repo.beginSync(lock.client);
    return repo.publish(lock.client, { syncId, folders: nextFolders, models, filesScanned: models.length * 2 });
  }
  try {
    assert.equal((await publish([model])).modelsAdded, 1);
    const one = await repo.snapshot();
    const id = one.products[0].id;
    assert.match(id, /^[a-f0-9]{12}$/);
    assert.equal((await new CatalogRepository({ pool, rootFolderId }).snapshot()).products[0].id, id);
    assert.equal((await publish([model])).changed, false);
    assert.equal((await repo.snapshot()).version, one.version);
    assert.equal((await publish([{ ...model, name: 'Renamed', preview: null, cachedPreviewPath: null, previewVersion: null }])).modelsUpdated, 1);
    assert.equal((await repo.find(id)).name, 'Renamed');
    assert.equal((await repo.snapshot()).products[0].thumb, null);
    assert.equal((await repo.snapshot()).products[0].id, id);
    assert.equal((await publish([], [folders[0]])).modelsRemoved, 1);
    assert.equal((await repo.snapshot()).products.length, 0);
    assert.equal(await repo.find(id), null);
    await publish([model]);
    assert.equal((await repo.snapshot()).products[0].id, id, 'archive identity survives reappearance');
    assert.equal((await new CatalogRepository({ pool, rootFolderId: `other-${rootFolderId}` }).snapshot()).products.length, 0);
    const status = await repo.status();
    assert.equal(status.state, 'ready');
    assert.ok(status.lastSuccessfulSync);
    const firstLock = await new CatalogRepository({ pool, rootFolderId }).acquireLock();
    assert.equal(firstLock, null, 'second database session cannot scan same source');
  } finally { await lock.release(); }
});

test('failed snapshot transaction does not reconcile deletions or increment catalog version', { skip: !configured }, async () => {
  const rootFolderId = `failure-${randomUUID()}`;
  const repo = new CatalogRepository({ pool, rootFolderId });
  const lock = await repo.acquireLock();
  const folders = [{ id: rootFolderId, name: 'root', path: 'root', parentId: null }];
  const model = { archiveId: 'a', folderId: rootFolderId, name: 'a', archiveExtension: '.zip', size: 1, canDownload: true };
  try {
    await repo.publish(lock.client, { folders, models: [model], filesScanned: 1, syncId: await repo.beginSync(lock.client) });
    const before = await repo.snapshot();
    const syncId = await repo.beginSync(lock.client);
    await assert.rejects(repo.publish(lock.client, { folders, models: [{ ...model, archiveExtension: '.exe' }], syncId, filesScanned: 1 }));
    await repo.markFailed(lock.client, syncId, Object.assign(new Error('private URL and API key'), { code: 'DRIVE_PERMISSION_DENIED' }));
    assert.equal((await repo.snapshot()).version, before.version);
    assert.equal((await repo.snapshot()).products.length, 1);
    assert.equal((await repo.status()).lastError, 'DRIVE_PERMISSION_DENIED');
    assert.equal((await repo.status()).state, 'error');
    const attempt=(await repo.status()).lastAttempt;
    assert.equal(attempt.status,'failed');
    assert.equal(attempt.error,'DRIVE_PERMISSION_DENIED');
    assert.ok(attempt.durationMs>=0);
    await repo.beginSync(lock.client);
    assert.equal((await repo.status()).state,'syncing');
    assert.equal((await repo.status()).error,null,'an active retry must not advertise a stale configuration failure');
    assert.equal((await repo.snapshot()).products.length,1);
  } finally { await lock.release(); }
});
