import express from 'express';
import path from 'node:path';
import { assetRouter } from './assets.js';
import { authRouter, requireAuth } from './auth.js';
import { validateJwtConfiguration } from './auth-jwt.js';
import { createCatalogRuntime, catalogRouter } from './catalog-runtime.js';
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

const STORAGE = process.env.STORAGE_DIR || path.resolve(import.meta.dirname, '../../../storage');
const SOURCE = process.env.SOURCE_DIR || path.resolve(import.meta.dirname, '../../../source/3DSMOOD');
export const catalog = await createCatalogRuntime({pool});

let licenseConfigured = false;
try { validateLicenseConfiguration(); licenseConfigured = true; } catch { /* Fail closed below. */ }
const configuredPayment = loadPaymentConfig();
const paymentConfig = { ...configuredPayment, enabled: configuredPayment.enabled && licenseConfigured };
const payments = createPaymentService({ pool, licenseService, config: paymentConfig, provider: createPaymentProvider(paymentConfig) });

export const app = express();
app.disable('x-powered-by');
// Opt-in exact trusted proxy addresses/CIDRs; never accept a client-supplied XFF blindly.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean));
app.use(express.json({ limit: '10kb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/webhooks/payos', createPayosWebhookRouter({ service: payments, rateLimit: rateLimit({ limit: 300 }) }));
app.use(originGuard);
app.use('/previews', express.static(path.join(STORAGE, 'previews'), { maxAge: '30d', immutable: true }));
app.use('/api/auth', rateLimit({ limit: 120 }), authRouter);
const requireLicenseConfiguration = (_req, res, next) => licenseConfigured ? next() : res.status(503).json({ error: 'LICENSE_CONFIGURATION_REQUIRED' });
app.use('/api/licenses', requireLicenseConfiguration, licenseRouter);
app.use('/api/devices', requireLicenseConfiguration, deviceRouter);
app.use('/api/admin/licenses', requireLicenseConfiguration, adminLicenseRouter);
app.use('/api/payments', rateLimit({ limit: 120 }), createPaymentRouter({ service: payments, requireUser: requireAuth, rateLimit: rateLimit({ limit: 20 }) }));
app.get('/api/health', async (_q, r) => {
  const db = await pool.query('select 1').then(() => true, () => false);
  const snapshot = db ? await catalog.snapshot().catch(() => null) : null;
  const available = db && await catalog.available().catch(() => false);
  r.status(db ? 200 : 503).json({ ok: db, db, products: snapshot?.products.length || 0,
    catalogAvailable: available, licensingAvailable: licenseConfigured, paymentsAvailable: paymentConfig.enabled });
});
app.use('/api', rateLimit({limit:240}), catalogRouter(catalog));
if (catalog.repository) app.use('/api', rateLimit({limit:120}), assetRouter(null,null,{repository:catalog.repository,sendArchive:catalog.sendArchive}));
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
  if (!paymentConfig.enabled) console.warn('Payments disabled: configure valid payment and license environment variables.');
  if (!catalog.config.configured) console.warn('Catalog configuration required:', catalog.config.errors.join(', '), 'See docs/google-drive-catalog.md.');
  const stopCatalog = catalog.start();
  const stopMaintenance = startLicenseMaintenance();
  const stopPayments = startPaymentMaintenance(payments, paymentConfig.enabled);
  const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`store-api http://localhost:${port}`));
  const stop = () => { const catalogStopped=stopCatalog(); stopPayments(); stopMaintenance(); server.close(async() => { await catalogStopped; await pool.end(); }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
