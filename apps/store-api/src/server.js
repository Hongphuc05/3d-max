import express from 'express';
import path from 'node:path';
import { authRouter, requireAuth } from './auth.js';
import { validateJwtConfiguration } from './auth-jwt.js';
import { migrate, pool } from './db.js';
import { errorHandler, originGuard, rateLimit } from './security.js';
import { adminRouter } from './admin/routes.js';
import { createDriveRouter } from './drive/routes.js';
import { loadWorkerConfig } from './worker/config.js';
import { createCatalogAdminRouter } from './catalog-admin/routes.js';
import { requireAdmin } from './admin/access.js';
import { createCatalogEvents, createCatalogV1Router, createPreviewRouter } from './catalog-v1/routes.js';
import { createDeviceRouter } from './devices/routes.js';
import { loadDownloadConfig } from './downloads/config.js';
import { createModelCache } from './downloads/cache.js';
import { createPublicLinkFetcher } from './downloads/public-link.js';
import { createDownloadRouter } from './downloads/routes.js';
import { createOrderService } from './orders/service.js';
import { createOrderRouter } from './orders/routes.js';
import { createOrderAdminRouter } from './orders/admin-routes.js';
import { createDeviceAdminRouter } from './devices/admin-routes.js';
import { createOverviewRouter } from './admin-overview/routes.js';
import { createOverviewService } from './admin-overview/service.js';
import { createOrderMaintenance } from './orders/maintenance.js';
import { loadTelegramConfig } from './telegram/config.js';
import { createTelegramClient } from './telegram/client.js';
import { createTelegramNotifier } from './telegram/notifier.js';
import { createTelegramRouter } from './telegram/routes.js';

const publicLink = createPublicLinkFetcher();

const STORAGE = process.env.STORAGE_DIR || path.resolve(import.meta.dirname, '../../../storage');
// Preview (ten = sha256 noi dung); thu muc rieng, tmp/*.part khong bao gio duoc phuc vu.
const PREVIEW_DIR = process.env.PREVIEW_DIR || path.join(STORAGE, 'previews-v3');
export const catalogEvents = createCatalogEvents({ pool });

export const app = express();
app.disable('x-powered-by');
// Opt-in exact trusted proxy addresses/CIDRs; never accept a client-supplied XFF blindly.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean));
app.use(express.json({ limit: '10kb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(originGuard);
app.use('/previews', createPreviewRouter({ dir: PREVIEW_DIR }));
app.use('/api/auth', rateLimit({ limit: 120 }), authRouter);
// Quet Drive bang API key (D26); null = chua dat DRIVE_API_KEY (status bao `missingConfig`).
app.use('/api/admin/drive', createDriveRouter({ pool, apiKey: loadWorkerConfig(process.env).apiKey ?? null,
  guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }) }));
// v3 P5: don hang + Telegram. Khong dat bien TELEGRAM_* = tat bot (khach van mua, admin xac nhan tren web); dat thieu/sai = dung ngay, chi neu TEN bien.
const telegramConfig = loadTelegramConfig(process.env);
if (telegramConfig.errors.length) throw new Error(`Invalid Telegram configuration: ${telegramConfig.errors.join(', ')}`);
const telegramClient = telegramConfig.enabled ? createTelegramClient({ token: telegramConfig.botToken }) : null;
const orders = createOrderService({ pool });
// Admin xu ly don: gan TRUOC adminRouter (cung tien to /api/admin); plan §2.7: /api/admin/orders.
app.use('/api/admin', createOrderAdminRouter({ service: orders, client: telegramClient, guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }) }));
app.use('/api/admin', createDeviceAdminRouter({ pool, guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }) }));
app.use('/api/admin', createOverviewRouter({ service: createOverviewService({ pool }), guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }) }));
// v3 P3.7: cai dat + bang model. Guard gan tung route, duong dan khac roi xuong adminRouter.
app.use('/api/admin', createCatalogAdminRouter({ pool, guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }), previewDir: PREVIEW_DIR }));
app.use('/api/admin', adminRouter());
app.get('/api/health', async (_q, r) => {
  const db = await pool.query('select 1').then(() => true, () => false);
  r.status(db ? 200 : 503).json({ ok: db, db });
});
// v3 P4.1: dang ky thiet bi + quyen so huu. Guard gan tung route nen /api/v1/catalog/* roi xuong router catalog.
app.use('/api/v1', createDeviceRouter({ pool, rateLimit: rateLimit({ limit: 60 }) }));
// v3 P5: don hang cua khach + webhook Telegram (guard gan tung route nen cac duong dan khac roi xuong router phia sau).
app.use('/api/v1', createOrderRouter({ pool, service: orders, rateLimit: rateLimit({ limit: 60 }),
  notifier: telegramClient ? createTelegramNotifier({ client: telegramClient, service: orders, ownerChatIds: telegramConfig.ownerChatIds }) : null }));
if (telegramClient) app.use('/api/telegram', rateLimit({ limit: 120 }), createTelegramRouter({ config: telegramConfig, client: telegramClient, service: orders }));
// v3 P4.2: phien tai model (D26: VPS tai ho tu link cong khai, luu ban sao tren dia). Cau hinh sai -> dung ngay, chi neu TEN bien.
const downloadConfig = loadDownloadConfig(process.env);
if (downloadConfig.errors.length) throw new Error(`Invalid download configuration: ${downloadConfig.errors.join(', ')}`);
const modelCache = createModelCache({ dir: downloadConfig.cacheDir, open: (fileId, o) => publicLink.open(fileId, o),
  maxBytes: downloadConfig.maxBytes, minFreeBytes: downloadConfig.minFreeBytes, maxFileBytes: downloadConfig.maxFileBytes });
app.use('/api/v1', createDownloadRouter({ pool, cache: modelCache, rateLimit: rateLimit({ limit: 120 }),
  sessionsPerHour: downloadConfig.sessionsPerHour, maxConcurrent: downloadConfig.maxConcurrent }));
// v3 catalog cong khai cho plugin:.
app.use('/api/v1', createCatalogV1Router({ pool, events: catalogEvents, rateLimit: rateLimit({ limit: 240 }) }));

app.use(errorHandler);

if (process.argv[1] === import.meta.filename) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  validateJwtConfiguration();
  const runMigrations = process.env.RUN_MIGRATIONS === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.RUN_MIGRATIONS !== 'false');
  const applied = runMigrations ? await migrate() : [];
  if (applied.length) console.log('migrations:', applied.join(', '));
  const port = process.env.PORT || 4000;
  if (!telegramConfig.enabled) console.warn('Telegram disabled: set TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_IDS, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_PATH; orders can still be confirmed from the admin web.');
  const orderMaintenance = createOrderMaintenance({ service: orders, client: telegramClient });
  orderMaintenance.start();
  const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`store-api http://localhost:${port}`));
  const stop = () => { orderMaintenance.stop(); const eventsStopped = catalogEvents.stop(); server.close(async() => { await eventsStopped; await pool.end(); }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
