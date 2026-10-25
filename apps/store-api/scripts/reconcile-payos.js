import { pool } from '../src/db.js';
import * as licenseService from '../src/licensing/service.js';
import { validateLicenseConfiguration } from '../src/licensing/crypto.js';
import { loadPaymentConfig } from '../src/payments/config.js';
import { createPaymentProvider } from '../src/payments/provider.js';
import { createPaymentService } from '../src/payments/service.js';
try {
  validateLicenseConfiguration();
  const config = loadPaymentConfig();
  const service = createPaymentService({ pool, config, licenseService, provider: createPaymentProvider(config) });
  const result = await service.reconcilePending({ limit: 20 });
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch { console.error('Reconciliation failed; check database, license and PayOS configuration.'); process.exitCode = 1; }
finally { await pool.end(); }
