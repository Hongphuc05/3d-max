import express from 'express';
import path from 'node:path';
import { assetRouter } from './assets.js';
import { authRouter, requireAuth } from './auth.js';
import { validateJwtConfiguration } from './auth-jwt.js';
import { createCatalogRuntime, catalogRouter } from './catalog-runtime.js';
import { r2WebhookRouter } from './r2-http.js';
import { migrate, pool } from './db.js';
import { errorHandler, originGuard, rateLimit } from './security.js';
import { licenseRouter, deviceRouter, adminLicenseRouter, startLicenseMaintenance } from './licensing/routes.js';
import { validateLicenseConfiguration } from './licensing/crypto.js';
import * as licenseService from './licensing/service.js';
import { loadPaymentConfig } from './payments/config.js';
import { startPaymentMaintenance } from './payments/maintenance.js';
import { createPaymentProvider } from './payments/provider.js';
import { createPaymentService } from './payments/service.js';
import { createPaymentRouter, createPayosWebhookRouter } from './payments/routes.js';
import { adminRouter } from './admin/routes.js';
import { createOAuth, loadDriveConfig } from './drive/oauth.js';
import { createDriveRouter } from './drive/routes.js';
import { loadWorkerConfig } from './worker/config.js';
import { createCatalogAdminRouter } from './catalog-admin/routes.js';
import { requireAdmin } from './admin/access.js';
import { createCatalogEvents, createCatalogV1Router, createPreviewRouter } from './catalog-v1/routes.js';
import { createDeviceRouter } from './devices/routes.js';
import { loadLegacyPublicKey } from './devices/mxl1.js';
import { loadDownloadConfig } from './downloads/config.js';
import { createModelCache } from './downloads/cache.js';
import { createPublicLinkFetcher } from './downloads/public-link.js';
import { createDownloadRouter } from './downloads/routes.js';
import { createOrderService } from './orders/service.js';
import { createOrderRouter } from './orders/routes.js';
import { createOrderAdminRouter } from './orders/admin-routes.js';
import { createOrderMaintenance } from './orders/maintenance.js';
import { loadTelegramConfig } from './telegram/config.js';
import { createTelegramClient } from './telegram/client.js';
import { createTelegramNotifier } from './telegram/notifier.js';
import { createTelegramRouter } from './telegram/routes.js';

const publicLink = createPublicLinkFetcher();

const STORAGE = process.env.STORAGE_DIR || path.resolve(import.meta.dirname, '../../../storage');
// Preview v3 (ten = sha256 noi dung) o thu muc RIENG: route cu express.static('/previews') khong the phuc vu tmp/*.part.
const PREVIEW_DIR = process.env.PREVIEW_DIR || path.join(STORAGE, 'previews-v3');
const SOURCE = process.env.SOURCE_DIR || path.resolve(import.meta.dirname, '../../../source/3DSMOOD');
export const catalog = await createCatalogRuntime({pool});
export const catalogEvents = createCatalogEvents({ pool });

let licenseConfigured = false;
try { validateLicenseConfiguration(); licenseConfigured = true; } catch { /* Fail closed below. */ }
const configuredPayment = loadPaymentConfig();
const paymentConfig = { ...configuredPayment, enabled: configuredPayment.enabled && licenseConfigured };
const payments = createPaymentService({ pool, licenseService, config: paymentConfig, provider: createPaymentProvider(paymentConfig) });

export const app = express();
app.disable('x-powered-by');
// Opt-in exact trusted proxy addresses/CIDRs; never accept a client-supplied XFF blindly.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean));
if (catalog.config.webhookEnabled) app.use('/internal/r2/events', r2WebhookRouter(catalog));
app.use(express.json({ limit: '10kb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/webhooks/payos', createPayosWebhookRouter({ service: payments, rateLimit: rateLimit({ limit: 300 }) }));
app.use(originGuard);
app.use('/previews', createPreviewRouter({ dir: PREVIEW_DIR }));
app.use('/previews', express.static(path.join(STORAGE, 'previews'), { maxAge: '30d', immutable: true }));
app.use('/api/auth', rateLimit({ limit: 120 }), authRouter);
const requireLicenseConfiguration = (_req, res, next) => licenseConfigured ? next() : res.status(503).json({ error: 'LICENSE_CONFIGURATION_REQUIRED' });
app.use('/api/licenses', requireLicenseConfiguration, licenseRouter);
app.use('/api/devices', requireLicenseConfiguration, deviceRouter);
app.use('/api/admin/licenses', requireLicenseConfiguration, adminLicenseRouter);
// v3 P1: Google Drive connection. Mounted BEFORE adminRouter so its public OAuth callback is not caught by
// adminRouter's blanket requireAuth (the callback is protected by a single-use state instead).
const driveConfig = loadDriveConfig();
// v3 P3.1: quet Drive bang API key (D26); null = chua dat DRIVE_API_KEY (status bao `missingConfig`). Ma OAuth P1 van gan nhung khong la luong chinh.
app.use('/api/admin/drive', createDriveRouter({ pool, oauth: createOAuth({ pool, config: driveConfig }), config: driveConfig, apiKey: loadWorkerConfig(process.env).apiKey ?? null,
  guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }) }));
// v3 P5: don hang + Telegram. Khong dat bien TELEGRAM_* = tat bot (khach van mua, admin xac nhan tren web); dat thieu/sai = dung ngay, chi neu TEN bien.
const telegramConfig = loadTelegramConfig(process.env);
if (telegramConfig.errors.length) throw new Error(`Invalid Telegram configuration: ${telegramConfig.errors.join(', ')}`);
const telegramClient = telegramConfig.enabled ? createTelegramClient({ token: telegramConfig.botToken }) : null;
const orders = createOrderService({ pool });
// Admin xu ly don: gan TRUOC adminRouter cu (cung tien to /api/admin); plan §2.7: /api/admin/orders. Danh sach payOS cu o /api/admin/legacy-orders.
app.use('/api/admin', createOrderAdminRouter({ service: orders, client: telegramClient, guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }) }));
// v3 P3.7: cai dat + bang model. Guard gan tung route, duong dan khac roi xuong adminRouter cu.
app.use('/api/admin', createCatalogAdminRouter({ pool, guards: [requireAuth, requireAdmin], rateLimit: rateLimit({ limit: 60 }), envDefaultPrice: loadWorkerConfig(process.env).defaultPriceVnd }));
app.use('/api/admin', adminRouter(catalog));
app.use('/api/payments', rateLimit({ limit: 120 }), createPaymentRouter({ service: payments, requireUser: requireAuth, rateLimit: rateLimit({ limit: 20 }) }));
app.get('/api/health', async (_q, r) => {
  const db = await pool.query('select 1').then(() => true, () => false);
  const snapshot = db ? await catalog.snapshot().catch(() => null) : null;
  const available = db && await catalog.available().catch(() => false);
  r.status(db ? 200 : 503).json({ ok: db, db, products: snapshot?.products.length || 0,
    catalogAvailable: available, licensingAvailable: licenseConfigured, paymentsAvailable: paymentConfig.enabled });
});
// v3 P4.1: dang ky thiet bi + quyen so huu. Guard gan tung route nen /api/v1/catalog/* roi xuong router catalog.
// LICENSE_PUBLIC_KEY_B64 (khoa cong khai MXL1): khong dat hoac sai = bo qua MXL1 (chi log TEN bien, khong log gia tri).
let legacyPublicKey = null;
try { legacyPublicKey = loadLegacyPublicKey(process.env.LICENSE_PUBLIC_KEY_B64); } catch { console.error('[v3] LICENSE_PUBLIC_KEY_B64 khong dung duoc; bo qua license MXL1'); }
app.use('/api/v1', createDeviceRouter({ pool, legacyPublicKey, rateLimit: rateLimit({ limit: 60 }) }));
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
// v3 catalog cong khai cho plugin: gan TRUOC route catalog cu de /api/v1 khong bi route cu bat.
app.use('/api/v1', createCatalogV1Router({ pool, events: catalogEvents, rateLimit: rateLimit({ limit: 240 }) }));
app.use('/api', rateLimit({limit:240}), catalogRouter(catalog));
if (catalog.repository && catalog.sendArchive) app.use('/api', rateLimit({limit:120}), assetRouter(null,null,{repository:catalog.repository,sendArchive:catalog.sendArchive}));
else if (catalog.local) app.use('/api',rateLimit({limit:120}),assetRouter(catalog.local,SOURCE));

app.use(errorHandler);

if (process.argv[1] === import.meta.filename) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  validateJwtConfiguration();
  const runMigrations = process.env.RUN_MIGRATIONS === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.RUN_MIGRATIONS !== 'false');
  const applied = runMigrations ? await migrate() : [];
  if (applied.length) console.log('migrations:', applied.join(', '));
  const port = process.env.PORT || 4000;
  if (!licenseConfigured) console.warn('Licensing disabled: configure distinct LICENSE_HMAC_SECRET and LICENSE_ENCRYPTION_KEY (32-byte base64).');
  if (!driveConfig.configured) console.warn('Google Drive disabled: set', driveConfig.errors.join(', '), '(docs/drive-setup.md).');
  if (!paymentConfig.enabled) console.warn('Payments disabled: configure valid payment and license environment variables.');
  if (!catalog.config.configured) console.warn('Catalog configuration required:', catalog.config.errors.join(', '), 'See docs/r2-catalog.md.');
  const stopCatalog = catalog.start();
  await catalogEvents.start();
  const stopMaintenance = startLicenseMaintenance();
  const stopPayments = startPaymentMaintenance(payments, paymentConfig.enabled);
  if (!telegramConfig.enabled) console.warn('Telegram disabled: set TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_IDS, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_PATH; orders can still be confirmed from the admin web.');
  const orderMaintenance = createOrderMaintenance({ service: orders, client: telegramClient });
  orderMaintenance.start();
  const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`store-api http://localhost:${port}`));
  const stop = () => { const catalogStopped=stopCatalog(); orderMaintenance.stop(); stopPayments(); stopMaintenance(); const eventsStopped = catalogEvents.stop(); server.close(async() => { await catalogStopped; await eventsStopped; await pool.end(); }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
