// Admin API cho nguon Drive (quet bang API key, D26).
// Guards are injected so tests can run without the full auth stack; production passes requireAuth + requireAdmin.
// Nothing here returns tokens, ciphertext, or Drive file IDs of customer-facing models.
import { Router } from 'express';
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from './errors.js';
import { createDriveClient, FOLDER, validId } from './client.js';
import { createDriveRepository } from './repository.js';
import { createSyncJobsRouter } from './sync-routes.js';
import { ensureApiKeySource } from '../worker/source.js';

// Uu tien file da biet tu lan quet truoc (drive_inventory): nho nhat, co kich thuoc, duoc phep tai. Mot yeu cau tai, khong dao cay.
// Thu vien that co nhieu thu muc rong xen ke nen dao cay de tim mau la mong manh; chi dao khi nguon chua quet lan nao.
async function knownSample(pool, source) {
  const row = (await pool.query(
    `select drive_file_id, resource_key from drive_inventory
      where source_id = $1 and not is_folder and not is_shortcut and size_bytes > 0 and coalesce(can_download, true)
      order by size_bytes asc limit 1`, [source.id])).rows[0];
  return row ? { id: row.drive_file_id, resourceKey: row.resource_key ?? undefined } : null;
}

// Thu vien that co file nam sau thu muc danh muc, goc chi chua thu muc. Toi da `maxLists` lan liet ke de test-access
// khong dap vao Drive (shortcut: neu nhanh dau toan thu muc rong thi co the khong thay file, nang gioi han khi can).
const isSample = f => f.mimeType !== FOLDER && f.capabilities?.canDownload !== false && Number(f.size) > 0;
async function findSample(client, source, firstPage, { maxLists = 8 } = {}) {
  const found = firstPage.files.find(isSample);
  if (found) return found;
  // Theo chieu SAU (ngan xep): file nam o do sau 3 (goc -> danh muc -> thu muc con -> file), tim theo chieu rong se het luot o tang danh muc.
  const stack = firstPage.files.filter(f => f.mimeType === FOLDER).map(f => f.id).reverse();
  for (let n = 0; stack.length && n < maxLists; n++) {
    const page = await client.listChildren(stack.pop(), { driveId: source.drive_id, pageSize: 100 });
    const hit = page.files.find(isSample);
    if (hit) return hit;
    stack.push(...page.files.filter(f => f.mimeType === FOLDER).map(f => f.id).reverse());
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodyKeys = (body, allowed) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw apiError('INVALID_PARAMS');
  return body;
};

// Accepts a bare id or a drive.google.com folder URL (…/folders/<id>?resourcekey=<key>, or ?id=<id>).
export function parseFolderRef(input, explicitKey) {
  if (typeof input !== 'string' || input.length > 2000) throw apiError('INVALID_PARAMS');
  const text = input.trim();
  let id = null, key = typeof explicitKey === 'string' && explicitKey ? explicitKey.trim() : null;
  if (validId(text)) id = text;
  else {
    let url;
    try { url = new URL(text); } catch { throw apiError('INVALID_PARAMS'); }
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') throw apiError('INVALID_PARAMS');
    id = /\/folders\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
    key ??= url.searchParams.get('resourcekey');
  }
  if (!validId(id) || (key && !/^[A-Za-z0-9_-]{1,100}$/.test(key))) throw apiError('INVALID_PARAMS');
  return { id, resourceKey: key || null };
}

// Drive API keys come from encrypted admin slots; DRIVE_API_KEY remains a server-side legacy fallback.
// Secret material is never returned to browsers or included in API errors.
export function createDriveRouter({ pool, guards = [], rateLimit, fetchImpl, driveBase, apiKey, credentialStore }) {
  const repo = createDriveRepository(pool);
  const apiClient = () => {
    if (!credentialStore && !apiKey) throw apiError('DRIVE_NOT_CONNECTED');
    return credentialStore
      ? createDriveClient({ getApiKey: options => credentialStore.getActiveCredential(options), onRateLimit: credentialStore.markRateLimited,
        ...(driveBase ? { baseUrl: driveBase } : {}), ...(fetchImpl ? { fetchImpl } : {}) })
      : createDriveClient({ apiKey, ...(driveBase ? { baseUrl: driveBase } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
  };
  const router = Router();
  router.use(requestId, ...(rateLimit ? [rateLimit] : []));
  router.use(...guards);
  router.use(express.json({ limit: '4kb' }));

  router.get('/status', async (_req, res, next) => {
    try {
      const configured = credentialStore ? await credentialStore.hasConfiguredKeys() : Boolean(apiKey);
      res.json({ configured, missingConfig: configured ? [] : ['DRIVE_API_KEY'], connection: null, sources: await repo.listSources() });
    } catch (e) { next(e); }
  });

  router.get('/keys', async (_req, res, next) => {
    try {
      res.json({ slots: credentialStore ? await credentialStore.listSlots() : [], automaticCheckMinutes: 10,
        configured: credentialStore ? await credentialStore.hasConfiguredKeys() : Boolean(apiKey),
        legacyFallback: credentialStore ? await credentialStore.legacyKeyActive() : Boolean(apiKey) });
    } catch (e) { next(e); }
  });

  router.put('/keys/:slot', async (req, res, next) => {
    try {
      if (!credentialStore) throw apiError('DRIVE_NOT_CONNECTED');
      bodyKeys(req.body, ['apiKey']);
      const saved = await credentialStore.saveSlot(req.params.slot, req.body);
      res.json(saved);
    } catch (e) { next(e); }
  });

  router.delete('/keys/:slot', async (req, res, next) => {
    try {
      if (!credentialStore) throw apiError('DRIVE_NOT_CONNECTED');
      await credentialStore.clearSlot(req.params.slot);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  router.post('/keys/:slot/test', async (req, res, next) => {
    try {
      if (!credentialStore) throw apiError('DRIVE_NOT_CONNECTED');
      const credential = await credentialStore.credentialForSlot(req.params.slot);
      if (!credential) throw apiError('INVALID_PARAMS');
      const source = await repo.firstEnabledSourceInternal();
      if (!source) throw apiError('INVALID_PARAMS');
      const client = createDriveClient({ apiKey: credential.apiKey, apiKeyHeader: true, retry: { retries: 0 },
        ...(driveBase ? { baseUrl: driveBase } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
      try {
        await client.getFile(source.root_folder_id, { resourceKey: source.root_resource_key, driveId: source.drive_id });
        await credentialStore.markHealthy(credential);
        res.json({ ok: true, status: 'HEALTHY', checkedAt: new Date().toISOString() });
      } catch (error) {
        if (error.code === 'DRIVE_QUOTA_EXCEEDED') await credentialStore.markRateLimited(credential, error);
        else await credentialStore.markFailed(credential, error.reason ?? error.code);
        throw error;
      }
    } catch (e) { next(e); }
  });

  router.get('/sources', async (_req, res, next) => { try { res.json(await repo.listSources()); } catch (e) { next(e); } });

  router.post('/sources', async (req, res, next) => {
    try {
      bodyKeys(req.body, ['rootFolderUrlOrId', 'resourceKey']);
      const ref = parseFolderRef(req.body.rootFolderUrlOrId, req.body.resourceKey);
      const source = await ensureApiKeySource({ pool, client: apiClient(), rootFolderId: ref.id, resourceKey: ref.resourceKey });
      res.status(201).json(source);
    } catch (e) { next(e); }
  });

  // Proves the two things that matter before building anything else: we can LIST the shared folder and we can
  // actually open a file for DOWNLOAD (capabilities.canDownload is only advisory — the real call decides).
  router.post('/test-access', async (req, res, next) => {
    try {
      const { sourceId } = bodyKeys(req.body ?? {}, ['sourceId']);
      if (sourceId !== undefined && !UUID.test(sourceId)) throw apiError('INVALID_PARAMS'); // neu khong, Postgres bao loi kieu uuid -> 500
      const source = sourceId ? await repo.getSourceInternal(sourceId) : await repo.firstEnabledSourceInternal();
      if (!source) throw apiError('INVALID_PARAMS');
      const client = apiClient();
      const details = [];
      const page = await client.listChildren(source.root_folder_id, { resourceKey: source.root_resource_key, driveId: source.drive_id, pageSize: 100 });
      details.push({ check: 'list', ok: true, count: page.files.length });
      const sample = (await knownSample(pool, source)) ?? await findSample(client, source, page);
      let canDownloadSample = false;
      if (sample) {
        const ac = new AbortController();
        try {
          const media = await client.openMedia(sample.id, { resourceKey: sample.resourceKey, signal: ac.signal });
          for await (const chunk of media.data) { canDownloadSample = chunk.length > 0; break; } // first bytes are proof enough
          details.push({ check: 'download', ok: canDownloadSample });
        } catch (error) {
          if (!error.code) throw error;
          details.push({ check: 'download', ok: false, code: error.code, reason: error.reason });
        } finally { ac.abort(); }
      } else details.push({ check: 'download', ok: false, code: 'NO_SAMPLE_FILE' });
      res.json({ canList: true, sampleCount: page.files.length, canDownloadSample, account: null, details });
    } catch (e) { next(e); }
  });

  router.use(createSyncJobsRouter({ pool }));

  router.use(v3ErrorHandler);
  return router;
}
