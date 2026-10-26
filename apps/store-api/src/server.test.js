import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isolatedTestDatabase } from './test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
let server, base, pool, dispose;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('server_http');
  process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), '3dm-no-catalog-'));
  process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
  process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PAYOS_CLIENT_ID = '';
  process.env.PAYOS_API_KEY = '';
  process.env.PAYOS_CHECKSUM_KEY = '';
  process.env.CATALOG_PROVIDER = 'r2';
  process.env.R2_READ_ACCESS_KEY_ID = '';
  process.env.R2_READ_SECRET_ACCESS_KEY = '';
  const db = await import('./db.js'); pool = db.pool;
  await db.migrate();
  const { app } = await import('./server.js');
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (dispose) await dispose(pool);
});

test('assembled API health and disabled payments work without model catalog', { skip: !configured }, async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, db: true, products: 0,
    catalogAvailable: false, licensingAvailable: true, paymentsAvailable: false });
  assert.equal((await fetch(base + '/api/products')).status, 200);
  const status = await (await fetch(base + '/api/catalog/version')).json();
  assert.equal(status.provider,'r2');
  assert.equal(status.state,'configuration_required');
  assert.equal(JSON.stringify(status).includes('secretAccessKey'),false);
  assert.equal((await fetch(base + '/api/licenses/me')).status, 401);
  assert.equal((await (await fetch(base + '/api/payments/product')).json()).product.available, false);
  const webhook = await fetch(base + '/api/webhooks/payos', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(webhook.status, 503);
  assert.deepEqual(await webhook.json(), { error: 'PAYMENTS_UNAVAILABLE' });
});
