// API catalog CONG KHAI cho plugin (contract v3 §2.3): xem catalog khi chua mua, khong can token thiet bi.
// Du lieu chi den tu buildManifest (cot cong khai). ETag gom ca version: A -> B -> A cho cung checksum nhung khac version.
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { buildManifest, CATALOG_CHANNEL, readCatalogState, withSnapshot } from './manifest.js';

const PREVIEW_NAME = /^[0-9a-f]{64}\.webp$/;

/** Cache manifest theo version; dung trong snapshot nen version va du lieu khop nhau, nhieu request cung luc chi dung 1 lan. */
function createManifestCache(pool, build = buildManifest) {
  let cached = null, inflight = null;
  return async () => {
    const { version } = await readCatalogState(pool);
    if (cached && cached.version === version) return cached;
    inflight ??= withSnapshot(pool, async (c) => ({ state: await readCatalogState(c), manifest: await build(c) }))
      .then(({ state, manifest }) => (cached = { version: state.version, publishedAt: state.publishedAt, manifest }))
      .finally(() => { inflight = null; });
    return inflight;
  };
}

const matches = (header, etag) => String(header ?? '').split(',').some((t) => { const v = t.trim().replace(/^W\//, ''); return v === etag || v === '*'; });

export function createCatalogV1Router({ pool, events, rateLimit = (_q, _s, next) => next(), maxStreams = Number(process.env.CATALOG_SSE_MAX) || 100, maxPerIp = Number(process.env.CATALOG_SSE_MAX_PER_IP) || 10, build }) {
  const router = express.Router();
  const current = createManifestCache(pool, build);
  router.use(requestId, rateLimit);

  const serve = (route, pick) => router.get(route, async (req, res, next) => {
    try {
      const c = await current();
      const etag = `"${c.version}-${c.manifest.checksum}"`;
      res.set({ ETag: etag, 'Cache-Control': 'no-cache' }); // ghi de no-store toan cuc cua /api: plugin can revalidate bang ETag
      if (matches(req.headers['if-none-match'], etag)) return res.status(304).end();
      res.json(pick(c));
    } catch (e) { next(e); }
  });
  serve('/catalog/version', (c) => ({ catalogVersion: c.version, manifestChecksum: c.manifest.checksum, publishedAt: c.publishedAt ?? null }));
  serve('/categories', (c) => c.manifest.categories);
  serve('/catalog', (c) => ({ catalogVersion: c.version, models: c.manifest.models }));
  serve('/previews/manifest', (c) => ({ catalogVersion: c.version, previews: c.manifest.previews }));

  router.get('/catalog/events', (req, res, next) => {
    // Tran theo IP de mot may khong chiem het slot. shortcut: sau Nginx phai dat TRUST_PROXY, neu khong moi client deu mang IP cua proxy va chung 1 tran.
    if (events.size >= maxStreams || events.countFor(req.ip) >= maxPerIp) return next(apiError('CATALOG_EVENTS_BUSY'));
    events.subscribe(req, res);
  });

  router.use(v3ErrorHandler);
  return router;
}

/** /previews/<sha256>.webp: chi dung ten bam noi dung; moi ten khac roi xuong route cu (khong lo tmp/*.part). */
export function createPreviewRouter({ dir }) {
  const router = express.Router();
  router.get('/:file', (req, res, next) => {
    if (!PREVIEW_NAME.test(req.params.file)) return next();
    res.sendFile(req.params.file, {
      root: dir, dotfiles: 'deny', immutable: true, maxAge: '365d',
      headers: { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff' },
    }, (err) => { if (err && !res.headersSent) next(); });
  });
  return router;
}

/**
 * Phat su kien catalog.updated cho SSE. Worker va API la 2 tien trinh nen tin hieu di qua PostgreSQL LISTEN/NOTIFY;
 * poll dinh ky la du phong khi mat ket noi LISTEN. Chi phat khi version TANG.
 */
export function createCatalogEvents({ pool, pollMs = 30_000, pingMs = 25_000, listen = true }) {
  const clients = new Map(); // res -> IP cua client (de dem theo IP)
  let last = 0, listener = null, pollTimer = null, pingTimer = null, retryTimer = null, stopped = true;

  const send = (res, text) => { try { res.write(text); } catch { clients.delete(res); } };
  const announce = (version) => {
    if (!Number.isFinite(version) || version <= last) return;
    last = version;
    for (const res of clients.keys()) send(res, `event: catalog.updated\ndata: ${JSON.stringify({ catalogVersion: version })}\n\n`);
  };
  const poll = async () => { try { announce((await readCatalogState(pool)).version); } catch { /* DB tam thoi loi: lan sau thu lai */ } };

  async function connect() {
    if (!listen || stopped) return;
    try {
      const c = await pool.connect();
      listener = c;
      c.on('notification', (n) => announce(Number(n.payload)));
      c.on('error', () => drop(true));
      await c.query(`listen ${CATALOG_CHANNEL}`);
    } catch { drop(true); }
  }
  function drop(retry) {
    const c = listener; listener = null;
    if (c) { c.removeAllListeners('notification'); c.removeAllListeners('error'); try { c.release(true); } catch { /* da dong */ } }
    if (retry && !stopped) retryTimer = setTimeout(connect, 1000);
  }

  return {
    get size() { return clients.size; },
    countFor(ip) { let n = 0; for (const v of clients.values()) if (v === ip) n++; return n; },
    async start() {
      stopped = false;
      last = (await readCatalogState(pool)).version;
      await connect();
      pollTimer = setInterval(poll, pollMs);
      pingTimer = setInterval(() => { for (const res of clients.keys()) send(res, ': ping\n\n'); }, pingMs);
    },
    subscribe(req, res) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 5000\nevent: catalog.updated\ndata: ${JSON.stringify({ catalogVersion: last })}\n\n`); // de client thay ngay version hien tai
      clients.set(res, req.ip);
      req.on('close', () => clients.delete(res));
    },
    async stop() {
      stopped = true;
      clearInterval(pollTimer); clearInterval(pingTimer); clearTimeout(retryTimer);
      for (const res of clients.keys()) { try { res.end(); } catch { /* da dong */ } }
      clients.clear();
      if (listener) { const c = listener; listener = null; c.removeAllListeners(); await c.query('unlisten *').catch(() => {}); c.release(); }
    },
  };
}
