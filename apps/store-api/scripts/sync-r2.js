import { migrate, pool } from '../src/db.js';
import { createCatalogRuntime } from '../src/catalog-runtime.js';

try {
  const runtime = await createCatalogRuntime({ pool });
  if (runtime.config.provider !== 'r2' || !runtime.worker) {
    throw Object.assign(new Error(), { code: runtime.config.errors[0] || 'R2_CONFIGURATION_REQUIRED' });
  }
  const applied = await migrate();
  if (applied.length) console.log('migrations:', applied.join(', '));
  console.log('Starting read-only R2 catalog reconciliation; objects will not be changed.');
  console.log(JSON.stringify(await runtime.worker.sync()));
} catch (error) {
  console.error('R2 sync failed:', /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CATALOG_SYNC_FAILED');
  process.exitCode = 1;
} finally {
  await pool.end();
}
