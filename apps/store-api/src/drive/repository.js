import { createHash, randomBytes } from 'node:crypto';

const LOCK_NAMESPACE = 727008;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const categoryId = (provider, root, folder) => hash([provider, root, folder]).slice(0, 12);
const safeCode = error => /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code || '') ? error.code : 'CATALOG_SYNC_FAILED';

function ancestors(folder, byId, provider, root) {
  const result = [];
  const seen = new Set();
  let current = folder;
  while (current && !seen.has(current.folder_id)) {
    seen.add(current.folder_id);
    result.unshift(categoryId(provider, root, current.folder_id));
    current = byId.get(current.parent_folder_id);
  }
  return result;
}

export function buildSnapshot({ provider, rootFolderId, folders, models, version, status }) {
  const byId = new Map(folders.map(folder => [folder.folder_id, folder]));
  const products = models.map(model => {
    const folder = byId.get(model.folder_id);
    const folderId = categoryId(provider, rootFolderId, model.folder_id);
    const preview = model.cached_preview_path && model.preview_version
      ? `/api/catalog/models/${model.id}/preview?v=${encodeURIComponent(model.preview_version)}` : null;
    return {
      id: model.id, slug: model.id, name: model.name, category: folderId,
      subcategory: folder?.name || '', folderId, folderPath: folder?.folder_path || '',
      folderIds: ancestors(folder, byId, provider, rootFolderId),
      price: 0, thumb: preview, image: preview, downloadable: model.can_download,
      info: { sizeMB: model.file_size == null ? null : Math.round(Number(model.file_size) / 1048576),
        archiveExtension: model.archive_extension, renderers: [], formats: [], hasTextures: null },
    };
  });
  const category = folder => ({
    id: categoryId(provider, rootFolderId, folder.folder_id), name: folder.name, path: folder.folder_path,
    count: products.filter(product => product.folderIds.includes(categoryId(provider, rootFolderId, folder.folder_id))).length,
    children: folders.filter(child => child.parent_folder_id === folder.folder_id).map(category),
  });
  const categories = folders.filter(folder => !byId.has(folder.parent_folder_id)).map(category);
  return { products, categories, bySlug: new Map(products.map(product => [product.slug, product])),
    files: new Map(models.map(model => [model.id, internalModel(model)])), version: Number(version || 0), status };
}

function internalModel(model) {
  return {
    id: model.id, slug: model.id, name: model.name,
    archiveId: model.archive_file_id, folderId: model.folder_id,
    archiveExtension: model.archive_extension, size: model.file_size,
    modifiedTime: model.modified_time, checksum: model.checksum,
    resourceKey: model.resource_key, canDownload: model.can_download,
    previewId: model.preview_file_id, cachedPreviewPath: model.cached_preview_path,
    previewVersion: model.preview_version,
  };
}

function normalizedModel(model) {
  return {
    archiveId: model.archiveId, folderId: model.folderId, name: model.name,
    archiveExtension: model.archiveExtension.toLowerCase(),
    size: model.size == null ? null : String(model.size),
    modifiedTime: model.modifiedTime ? new Date(model.modifiedTime).toISOString() : null,
    checksum: model.checksum || null, resourceKey: model.resourceKey || null,
    canDownload: model.canDownload === true, preview: model.preview || null,
    cachedPreviewPath: model.cachedPreviewPath || null, previewVersion: model.previewVersion || null,
  };
}

export class CatalogRepository {
  constructor({ pool, rootFolderId, provider = 'google_drive' }) {
    if (!pool || typeof rootFolderId !== 'string' || !rootFolderId) throw new Error('Catalog repository requires pool and root folder');
    this.pool = pool;
    this.rootFolderId = rootFolderId;
    this.provider = provider;
    this.source = [provider, rootFolderId];
    this.lockKey = `${provider}:${rootFolderId}`;
  }

  async acquireLock() {
    const client = await this.pool.connect();
    try {
      const result = await client.query('select pg_try_advisory_lock($1,hashtext($2)) as locked', [LOCK_NAMESPACE, this.lockKey]);
      if (!result.rows[0].locked) { client.release(); return null; }
      return { client, release: async () => {
        try { await client.query('select pg_advisory_unlock($1,hashtext($2))', [LOCK_NAMESPACE, this.lockKey]); }
        finally { client.release(); }
      } };
    } catch (error) { client.release(); throw error; }
  }

  async ensureSource(client) {
    await client.query('insert into catalog_sources(provider,root_folder_id) values($1,$2) on conflict do nothing', this.source);
  }

  async beginSync(client) {
    await this.ensureSource(client);
    await client.query(`update catalog_sync_runs set status='failed',finished_at=now(),error_code='SYNC_INTERRUPTED'
      where provider=$1 and root_folder_id=$2 and status='running'`, this.source);
    const { rows } = await client.query(`insert into catalog_sync_runs(provider,root_folder_id,status)
      values($1,$2,'running') returning id`, this.source);
    await client.query('update catalog_sources set last_sync_started_at=now(),last_error=null,updated_at=now() where provider=$1 and root_folder_id=$2', this.source);
    return rows[0].id;
  }

  async status() {
    const { rows } = await this.pool.query(`select s.*,
      exists(select 1 from pg_locks where locktype='advisory' and granted and classid=$3::oid
        and objid=(hashtext($4)::bigint & 4294967295)::oid and objsubid=2
        and database=(select oid from pg_database where datname=current_database())) as syncing
      from catalog_sources s where provider=$1 and root_folder_id=$2`, [...this.source, LOCK_NAMESPACE, this.lockKey]);
    const row = rows[0];
    const modelCount = Number((await this.pool.query("select count(*) from catalog_models where provider=$1 and root_folder_id=$2 and status='active'", this.source)).rows[0].count);
    const attempt=(await this.pool.query(`select status,started_at,finished_at,duration_ms,error_code
      from catalog_sync_runs where provider=$1 and root_folder_id=$2 order by started_at desc limit 1`,this.source)).rows[0];
    const lastAttempt=attempt?{status:attempt.status,startedAt:attempt.started_at,finishedAt:attempt.finished_at,
      durationMs:attempt.duration_ms==null?null:Number(attempt.duration_ms),error:attempt.error_code}:null;
    const run = row?.syncing && (await this.pool.query("select 1 from catalog_sync_runs where provider=$1 and root_folder_id=$2 and status='running' limit 1", this.source)).rowCount;
    const syncing = Boolean(run);
    return { provider: this.provider, rootFolderId: this.rootFolderId, modelCount,catalogKey:hash(this.source).slice(0,24),version: Number(row?.catalog_version || 0),
      lastSuccessfulSync: row?.last_successful_sync || null, syncing,
      lastError: row?.last_error || null, error: row?.last_error || null, report: row?.sync_report || null,lastAttempt,
      state: syncing ? 'syncing' : row?.last_error ? 'error' : !row?.last_successful_sync ? 'not_synced' : 'ready' };
  }

  async snapshot() {
    // All three subqueries see the same MVCC snapshot: never mix old folders with new models.
    const { rows } = await this.pool.query(`select
      coalesce((select jsonb_agg(f order by f.folder_path,f.folder_id) from catalog_folders f
        where provider=$1 and root_folder_id=$2 and status='active'),'[]') as folders,
      coalesce((select jsonb_agg(m order by m.name,m.id) from catalog_models m
        where provider=$1 and root_folder_id=$2 and status='active'),'[]') as models,
      (select catalog_version from catalog_sources where provider=$1 and root_folder_id=$2) as version`, this.source);
    return buildSnapshot({ provider: this.provider, rootFolderId: this.rootFolderId, ...rows[0] });
  }

  async find(id) {
    if (!/^[a-f0-9]{12}$/.test(id || '')) return null;
    const { rows } = await this.pool.query(`select * from catalog_models
      where provider=$1 and root_folder_id=$2 and id=$3 and status='active'`, [...this.source, id]);
    return rows[0] ? internalModel(rows[0]) : null;
  }

  async referencedPreviews(client = this.pool) {
    // Shared cache may serve several roots: only remove names unreferenced by every source.
    const { rows } = await client.query("select distinct cached_preview_path from catalog_models where status='active' and cached_preview_path is not null");
    return rows.map(row => row.cached_preview_path);
  }

  async markFailed(client, syncId, error) {
    const code = safeCode(error);
    await client.query(`update catalog_sync_runs set status='failed',finished_at=now(),
      duration_ms=greatest(0,extract(epoch from(now()-started_at))*1000),error_code=$2 where id=$1`, [syncId, code]);
    await client.query(`update catalog_sources set last_error=$3,updated_at=now() where provider=$1 and root_folder_id=$2`, [...this.source, code]);
  }

  async publish(client, scan) {
    validateScan(scan, this.rootFolderId);
    const models = scan.models.map(normalizedModel);
    const snapshotHash = hash({
      folders: [...scan.folders].sort((a, b) => a.id.localeCompare(b.id)).map(folder => [folder.id, folder.parentId || null, folder.name, folder.path, folder.resourceKey || null]),
      models: [...models].sort((a, b) => a.archiveId.localeCompare(b.archiveId)),
    });
    await client.query('begin');
    try {
      const previous = (await client.query('select snapshot_hash,catalog_version from catalog_sources where provider=$1 and root_folder_id=$2 for update', this.source)).rows[0];
      const old = (await client.query('select * from catalog_models where provider=$1 and root_folder_id=$2', this.source)).rows;
      const report = changesReport(old, models, scan);
      for (const folder of scan.folders) await this.upsertFolder(client, folder, scan.syncId);
      for (const model of models) await this.upsertModel(client, model, scan.syncId);
      await client.query(`update catalog_models set status='removed',cached_preview_path=null,preview_version=null,preview_file_id=null,
        preview_metadata=null,updated_at=now() where provider=$1 and root_folder_id=$2 and status='active' and last_seen_sync_id<>$3`, [...this.source, scan.syncId]);
      await client.query(`update catalog_folders set status='removed',updated_at=now()
        where provider=$1 and root_folder_id=$2 and status='active' and last_seen_sync_id<>$3`, [...this.source, scan.syncId]);
      const changed = previous?.snapshot_hash !== snapshotHash;
      const result = { ...report, changed, version: Number(previous?.catalog_version || 0) + Number(changed) };
      await client.query(`update catalog_sync_runs set status='succeeded',finished_at=now(),
        duration_ms=greatest(0,extract(epoch from(now()-started_at))*1000),report=$2 where id=$1`, [scan.syncId, result]);
      const duration = (await client.query('select duration_ms from catalog_sync_runs where id=$1', [scan.syncId])).rows[0].duration_ms;
      const fullReport = { ...result, durationMs: Number(duration), errors: [] };
      await client.query(`update catalog_sources set snapshot_hash=$3,catalog_version=$4,last_successful_sync=now(),
        last_error=null,sync_report=$5,updated_at=now() where provider=$1 and root_folder_id=$2`, [...this.source, snapshotHash, result.version, fullReport]);
      await client.query('commit');
      return fullReport;
    } catch (error) { await client.query('rollback'); throw error; }
  }

  async upsertFolder(client, folder, syncId) {
    await client.query(`insert into catalog_folders(provider,root_folder_id,folder_id,parent_folder_id,name,folder_path,resource_key,last_seen_sync_id)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(provider,root_folder_id,folder_id) do update set
      parent_folder_id=excluded.parent_folder_id,name=excluded.name,folder_path=excluded.folder_path,
      resource_key=excluded.resource_key,status='active',last_seen_sync_id=excluded.last_seen_sync_id,
      updated_at=case when (catalog_folders.parent_folder_id,catalog_folders.name,catalog_folders.folder_path,catalog_folders.resource_key,catalog_folders.status)
        is distinct from (excluded.parent_folder_id,excluded.name,excluded.folder_path,excluded.resource_key,'active') then now() else catalog_folders.updated_at end`,
    [...this.source, folder.id, folder.parentId || null, folder.name, folder.path, folder.resourceKey || null, syncId]);
  }

  async upsertModel(client, model, syncId) {
    const values = [randomBytes(6).toString('hex'), ...this.source, model.folderId, model.archiveId, model.name,
      model.archiveExtension, model.size, model.modifiedTime, model.checksum, model.resourceKey, model.canDownload,
      model.preview?.id || null, model.preview, model.cachedPreviewPath, model.previewVersion, hash(model), syncId];
    await client.query(`insert into catalog_models(id,provider,root_folder_id,folder_id,archive_file_id,name,
      archive_extension,file_size,modified_time,checksum,resource_key,can_download,preview_file_id,preview_metadata,
      cached_preview_path,preview_version,content_hash,last_seen_sync_id)
      values(${values.map((_value, index) => `$${index + 1}`).join(',')})
      on conflict(provider,root_folder_id,archive_file_id) do update set folder_id=excluded.folder_id,name=excluded.name,
      archive_extension=excluded.archive_extension,file_size=excluded.file_size,modified_time=excluded.modified_time,
      checksum=excluded.checksum,resource_key=excluded.resource_key,can_download=excluded.can_download,
      preview_file_id=excluded.preview_file_id,preview_metadata=excluded.preview_metadata,cached_preview_path=excluded.cached_preview_path,
      preview_version=excluded.preview_version,content_hash=excluded.content_hash,status='active',last_seen_sync_id=excluded.last_seen_sync_id,
      updated_at=case when catalog_models.content_hash is distinct from excluded.content_hash or catalog_models.status<>'active'
        then now() else catalog_models.updated_at end`, values);
  }
}

function validateScan(scan, rootFolderId) {
  if (!scan?.syncId || !Array.isArray(scan.folders) || !Array.isArray(scan.models)) throw new Error('Invalid complete catalog snapshot');
  const ids = new Set(scan.folders.map(folder => folder.id));
  if (!ids.has(rootFolderId) || ids.size !== scan.folders.length) throw new Error('Incomplete or duplicate folder snapshot');
  for (const folder of scan.folders) {
    if (typeof folder.name !== 'string' || typeof folder.path !== 'string' || (folder.id !== rootFolderId && !ids.has(folder.parentId))) throw new Error('Invalid folder snapshot');
  }
  const archives = new Set(scan.models.map(model => model.archiveId));
  if (archives.size !== scan.models.length || scan.models.some(model => !model.archiveId || !ids.has(model.folderId))) throw new Error('Invalid archive snapshot');
}

function changesReport(old, models, scan) {
  const byId = new Map(old.map(model => [model.archive_file_id, model]));
  const newIds = new Set(models.map(model => model.archiveId));
  return {
    foldersScanned: scan.folders.length, filesScanned: scan.filesScanned,
    modelsAdded: models.filter(model => !byId.has(model.archiveId) || byId.get(model.archiveId).status !== 'active').length,
    modelsUpdated: models.filter(model => byId.get(model.archiveId)?.status === 'active' && byId.get(model.archiveId).content_hash !== hash(model)).length,
    modelsRemoved: old.filter(model => model.status === 'active' && !newIds.has(model.archive_file_id)).length,
    previewsUpdated: scan.models.filter(model => model.previewUpdated || byId.get(model.archiveId)?.preview_file_id !== (model.preview?.id || null)).length,
  };
}
