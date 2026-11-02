import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

test('assembled API health works without model catalog; the retired payOS endpoints no longer exist (P7)', { skip: !configured }, async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, db: true, products: 0,
    catalogAvailable: false, licensingAvailable: true });
  assert.equal((await fetch(base + '/api/products')).status, 200);
  const status = await (await fetch(base + '/api/catalog/version')).json();
  assert.equal(status.provider,'r2');
  assert.equal(status.state,'configuration_required');
  assert.equal(JSON.stringify(status).includes('secretAccessKey'),false);
  assert.equal((await fetch(base + '/api/licenses/me')).status, 401);
  for (const [path, method] of [['/api/payments/product', 'GET'], ['/api/payments/create', 'POST'], ['/api/webhooks/payos', 'POST']]) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 404, `${method} ${path} must be gone`);
  }
});

test('v3 P1: Drive admin API is wired in order — protected routes need auth, the OAuth callback does not', { skip: !configured }, async () => {
  assert.equal((await fetch(base + '/api/admin/drive/status')).status, 401);
  assert.equal((await fetch(base + '/api/admin/drive/oauth/start', { redirect: 'manual' })).status, 401);
  // The callback is reached by Google's redirect, with no API session. It must NOT be swallowed by adminRouter's requireAuth.
  const cb = await fetch(base + '/api/admin/drive/oauth/callback?error=access_denied', { redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /\/admin\?drive=error&reason=consent_denied$/);
  // Existing admin routes keep their behaviour.
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401);
});

test('v3 public catalog is mounted on the assembled API: no login, revalidating cache headers, legacy preview route still answers', { skip: !configured }, async () => {
  const v = await fetch(base + '/api/v1/catalog/version');
  assert.equal(v.status, 200);
  assert.equal(v.headers.get('cache-control'), 'no-cache');
  assert.equal((await v.json()).catalogVersion, 0);
  assert.deepEqual((await (await fetch(base + '/api/v1/catalog')).json()).models, []);
  assert.deepEqual(await (await fetch(base + '/api/v1/categories')).json(), []);
  assert.equal((await fetch(base + '/previews/' + 'a'.repeat(64) + '.webp')).status, 404);
  // a real content-addressed file under the v3 preview directory is served; a partial download next to it is not
  const dir = path.join(process.env.STORAGE_DIR, 'previews-v3');
  mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  writeFileSync(path.join(dir, 'b'.repeat(64) + '.webp'), 'RIFFxxxxWEBPfake');
  writeFileSync(path.join(dir, 'tmp', 'x.part'), 'partial');
  const hit = await fetch(base + '/previews/' + 'b'.repeat(64) + '.webp');
  assert.deepEqual([hit.status, hit.headers.get('content-type')], [200, 'image/webp']);
  assert.equal((await fetch(base + '/previews/tmp/x.part')).status, 404);
  assert.equal((await fetch(base + '/previews/abc-sm.webp')).status, 404, 'old names still reach the legacy static route');
});

test('P3.7 admin routes are mounted behind the admin guard in the assembled API (anonymous = 401, nothing leaks)', { skip: !configured }, async () => {
  for (const [path, method] of [['/api/admin/settings', 'GET'], ['/api/admin/settings', 'PUT'], ['/api/admin/models', 'GET'], ['/api/admin/models/00000000-0000-0000-0000-000000000000', 'PATCH'], ['/api/admin/catalog/review', 'GET'], ['/api/admin/catalog/review/00000000-0000-0000-0000-000000000000', 'POST']]) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${method} ${path}`);
    assert.ok(r.headers.get('x-request-id'), 'answered by the NEW router (it sets X-Request-Id before its guards); the legacy adminRouter would also say 401');
    assert.equal((await r.text()).includes('bank'), false);
  }
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401, 'legacy admin routes still answer after the new router');
  const legacy = await fetch(base + '/api/admin/catalog/sync/permission');
  assert.equal(legacy.status, 401, 'the legacy catalog sync route next to /catalog/review is untouched');
  assert.equal(legacy.headers.get('x-request-id'), null, '...and still answered by the legacy router, not the new one');
});

test('P4.1 device API is mounted before the catalog router: anonymous /me/entitlements = v3 401, bad challenge = v3 400, catalog still public', { skip: !configured }, async () => {
  const me = await fetch(base + '/api/v1/me/entitlements');
  assert.equal(me.status, 401);
  assert.ok(me.headers.get('x-request-id'));
  assert.equal((await me.json()).error.code, 'UNAUTHENTICATED');
  const bad = await fetch(base + '/api/v1/device/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_PARAMS');
  assert.equal((await fetch(base + '/api/v1/catalog/version')).status, 200, 'catalog routes fall through the device router');
});

test('P5 orders are mounted: anonymous customer calls get a v3 401, the admin order routes sit behind the admin guard, the legacy payOS list moved to /api/admin/legacy-orders, and the Telegram webhook does not exist while the bot is not configured', { skip: !configured }, async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [path, method] of [['/api/v1/orders', 'POST'], [`/api/v1/orders/${id}`, 'GET'], [`/api/v1/orders/${id}/claim-paid`, 'POST'], [`/api/v1/orders/${id}/cancel`, 'POST']]) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 401, `${method} ${path}`);
    assert.ok(r.headers.get('x-request-id')); assert.equal((await r.json()).error.code, 'UNAUTHENTICATED');
  }
  for (const [path, method] of [['/api/admin/orders', 'GET'], [`/api/admin/orders/${id}/confirm`, 'POST'], [`/api/admin/orders/${id}/reject`, 'POST']]) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 401, `${method} ${path}`); assert.ok(r.headers.get('x-request-id'), 'answered by the new router');
  }
  const legacy = await fetch(base + '/api/admin/legacy-orders');
  assert.equal(legacy.status, 401); assert.equal(legacy.headers.get('x-request-id'), null, 'the legacy orders list is still answered by the legacy router');
  assert.equal((await fetch(base + '/api/telegram/webhook/anything_at_all_1234567', { method: 'POST' })).status, 404, 'no webhook route when Telegram is off');
});

test('P4.2 download API is mounted: anonymous callers get a v3 401 from the new routers, not a legacy answer', { skip: !configured }, async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [path, method] of [[`/api/v1/models/${id}/import-session`, 'POST'], ['/api/v1/model-downloads/' + 'A'.repeat(43), 'GET']]) {
    const r = await fetch(base + path, { method });
    assert.equal(r.status, 401, `${method} ${path}`);
    assert.ok(r.headers.get('x-request-id'), 'answered by the new router');
    assert.equal((await r.json()).error.code, 'UNAUTHENTICATED');
  }
});
