import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
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

test('assembled API health works with an empty database; the retired endpoints no longer exist (D28.5)', { skip: !configured }, async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, db: true });
  for (const [path, method] of [['/api/products', 'GET'], ['/api/catalog/version', 'GET'], ['/api/licenses/me', 'GET'], ['/api/payments/create', 'POST'],
    ['/api/webhooks/payos', 'POST'], ['/api/auth/register', 'POST']]) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 404, `${method} ${path} must be gone`);
  }
});

test('Drive admin API is wired behind the admin guard (anonymous = 401)', { skip: !configured }, async () => {
  assert.equal((await fetch(base + '/api/admin/drive/status')).status, 401);
});

test('v3 public catalog is mounted on the assembled API: no login, revalidating cache headers, preview route answers', { skip: !configured }, async () => {
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
  assert.equal((await fetch(base + '/previews/abc-sm.webp')).status, 404);
});

test('P3.7 admin routes are mounted behind the admin guard in the assembled API (anonymous = 401, nothing leaks)', { skip: !configured }, async () => {
  for (const [path, method] of [['/api/admin/settings', 'GET'], ['/api/admin/settings', 'PUT'], ['/api/admin/models', 'GET'], ['/api/admin/models/00000000-0000-0000-0000-000000000000', 'PATCH'], ['/api/admin/catalog/review', 'GET'], ['/api/admin/catalog/review/00000000-0000-0000-0000-000000000000', 'POST']]) {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${method} ${path}`);
    assert.ok(r.headers.get('x-request-id'), 'answered by the v3 router (it sets X-Request-Id before its guards)');
    assert.equal((await r.text()).includes('bank'), false);
  }
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

test('P5 orders are mounted: anonymous customer calls get a v3 401, the admin order routes sit behind the admin guard, and the Telegram webhook does not exist while the bot is not configured', { skip: !configured }, async () => {
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
  assert.equal((await fetch(base + '/api/telegram/webhook/anything_at_all_1234567', { method: 'POST' })).status, 404, 'no webhook route when Telegram is off');
});

test('P4.2 download API is mounted: anonymous callers get a v3 401', { skip: !configured }, async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [path, method] of [[`/api/v1/models/${id}/import-session`, 'POST'], ['/api/v1/model-downloads/' + 'A'.repeat(43), 'GET']]) {
    const r = await fetch(base + path, { method });
    assert.equal(r.status, 401, `${method} ${path}`);
    assert.ok(r.headers.get('x-request-id'), 'answered by the new router');
    assert.equal((await r.json()).error.code, 'UNAUTHENTICATED');
  }
});
