// Admin API for the Drive connection (docs/v3-implementation-plan.md §2.2, P1 subset).
// Guards are injected so tests can run without the full auth stack; production passes requireAuth + requireAdmin.
// Nothing here returns tokens, ciphertext, or Drive file IDs of customer-facing models.
import { Router } from 'express';
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from './errors.js';
import { createDriveClient, FOLDER, validId } from './client.js';
import { createDriveRepository } from './repository.js';
import { createSyncJobsRouter } from './sync-routes.js';
import { ensureApiKeySource } from '../worker/source.js';

// Thu vien that co file nam sau thu muc danh muc, goc chi chua thu muc. Tim theo chieu rong, toi da `maxLists` lan liet ke
// de test-access khong dap vao Drive (shortcut: khong tim sau hon, nang len neu thu vien co nhieu tang rong).
const isSample = f => f.mimeType !== FOLDER && f.capabilities?.canDownload !== false && Number(f.size) > 0;
async function findSample(client, source, firstPage, { maxLists = 8 } = {}) {
  const found = firstPage.files.find(isSample);
  if (found) return found;
  const queue = firstPage.files.filter(f => f.mimeType === FOLDER).map(f => f.id);
  for (let n = 0; queue.length && n < maxLists; n++) {
    const page = await client.listChildren(queue.shift(), { driveId: source.drive_id, pageSize: 100 });
    const hit = page.files.find(isSample);
    if (hit) return hit;
    queue.push(...page.files.filter(f => f.mimeType === FOLDER).map(f => f.id));
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

// `apiKey` !== undefined bat che do API key (D26, plan 2.1 "P3.1 doi thanh cau hinh API key"): null = chua cau hinh DRIVE_API_KEY.
// Key chi di tu env cua server toi Google; khong bao gio nhan tu request hay tra ra response.
// Bo qua `apiKey` thi router giu nguyen hanh vi OAuth cua P1 (ma OAuth duoc giu lai theo plan).
export function createDriveRouter({ pool, oauth, config, guards = [], rateLimit, fetchImpl, driveBase, apiKey }) {
  const repo = createDriveRepository(pool);
  const apiMode = apiKey !== undefined;
  const apiClient = () => {
    if (!apiKey) throw apiError('DRIVE_NOT_CONNECTED');
    return createDriveClient({ apiKey, ...(driveBase ? { baseUrl: driveBase } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
  };
  const router = Router();
  router.use(requestId, ...(rateLimit ? [rateLimit] : []));

  // Public by design: Google redirects the browser here. Protected by the single-use `state` row, not a session.
  router.get('/oauth/callback', async (req, res) => {
    const back = result => res.redirect(302, `${config.adminUiUrl}/admin?drive=${result}`);
    try {
      if (typeof req.query.error === 'string') return back('error&reason=consent_denied');
      await oauth.callback({ code: req.query.code, state: req.query.state });
      back('connected');
    } catch (error) {
      const reason = { OAUTH_STATE_INVALID: 'state', OAUTH_NO_REFRESH_TOKEN: 'no_refresh_token', DRIVE_SCOPE_MISSING: 'scope',
        DRIVE_OAUTH_NOT_CONFIGURED: 'not_configured' }[error?.code] ?? 'failed';
      if (!error?.code) console.error('[drive] oauth callback failed');
      back(`error&reason=${reason}`);
    }
  });

  router.use(...guards);
  router.use(express.json({ limit: '4kb' }));

  const clientFor = async connectionId => createDriveClient({ getAccessToken: oauth.tokenProvider(connectionId), ...(driveBase ? { baseUrl: driveBase } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
  const connectedOrThrow = async () => {
    const connection = await repo.latestConnection();
    if (!connection) throw apiError('DRIVE_NOT_CONNECTED');
    return connection;
  };

  router.get('/status', async (_req, res, next) => {
    try {
      if (apiMode) return res.json({ configured: Boolean(apiKey), missingConfig: apiKey ? [] : ['DRIVE_API_KEY'], connection: null, sources: await repo.listSources() });
      res.json({ configured: config.configured, missingConfig: config.errors, connection: await repo.latestConnection(), sources: await repo.listSources() });
    } catch (e) { next(e); }
  });

  router.get('/oauth/start', async (req, res, next) => {
    try { res.redirect(302, await oauth.start(req.user.id)); } catch (e) { next(e); }
  });

  router.get('/sources', async (_req, res, next) => { try { res.json(await repo.listSources()); } catch (e) { next(e); } });

  router.post('/sources', async (req, res, next) => {
    try {
      bodyKeys(req.body, ['rootFolderUrlOrId', 'resourceKey']);
      const ref = parseFolderRef(req.body.rootFolderUrlOrId, req.body.resourceKey);
      if (apiMode) {
        const source = await ensureApiKeySource({ pool, client: apiClient(), rootFolderId: ref.id, resourceKey: ref.resourceKey });
        return res.status(201).json(source);
      }
      const connection = await connectedOrThrow();
      const meta = await (await clientFor(connection.id)).getFile(ref.id, { resourceKey: ref.resourceKey });
      if (meta.mimeType !== FOLDER) throw apiError('DRIVE_NOT_A_FOLDER');
      const sourceType = meta.driveId ? 'SHARED_DRIVE' : meta.ownedByMe ? 'MY_DRIVE' : 'SHARED_WITH_ME';
      const source = await repo.insertSource({ connectionId: connection.id, folderId: ref.id, name: meta.name || 'Drive folder',
        resourceKey: ref.resourceKey ?? meta.resourceKey, sourceType, driveId: meta.driveId });
      res.status(201).json({ id: source.id, rootFolderName: source.rootFolderName, sourceType: source.sourceType });
    } catch (e) { next(e); }
  });

  // Proves the two things that matter before building anything else: we can LIST the shared folder and we can
  // actually open a file for DOWNLOAD (capabilities.canDownload is only advisory — the real call decides).
  router.post('/test-access', async (req, res, next) => {
    try {
      const { sourceId } = bodyKeys(req.body ?? {}, ['sourceId']);
      if (sourceId !== undefined && !UUID.test(sourceId)) throw apiError('INVALID_PARAMS'); // neu khong, Postgres bao loi kieu uuid -> 500
      const connection = apiMode ? null : await connectedOrThrow();
      const source = sourceId ? await repo.getSourceInternal(sourceId) : await repo.firstEnabledSourceInternal();
      if (!source) throw apiError('INVALID_PARAMS');
      const client = source.access_mode === 'API_KEY' ? apiClient() : await clientFor(source.connection_id);
      const details = [];
      const page = await client.listChildren(source.root_folder_id, { resourceKey: source.root_resource_key, driveId: source.drive_id, pageSize: 100 });
      details.push({ check: 'list', ok: true, count: page.files.length });
      const sample = await findSample(client, source, page);
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
      res.json({ canList: true, sampleCount: page.files.length, canDownloadSample, account: connection?.email ?? null, details });
    } catch (e) { next(e); }
  });

  router.use(createSyncJobsRouter({ pool }));

  router.use(v3ErrorHandler);
  return router;
}
