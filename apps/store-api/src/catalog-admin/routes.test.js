// P3.7: API admin cai dat (app_settings) va bang model (plan §2.7). PostgreSQL that; requireAdmin that, xac thuc gia.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
const ENV_PRICE = 20000;
const ACCOUNT_NO = '0123456789012';
let dispose, pool, server, base, adminId, admin2Id, userId, catId, sourceId, build, manifest;
let fileSeq = 0;

const j = (path, { method = 'GET', body, user = 'admin' } = {}) => fetch(base + '/api/admin' + path, {
  method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
const settingsBody = (over = {}) => ({ bankName: 'Vietcombank', bankBin: '970436', accountNo: ACCOUNT_NO, accountName: 'NGUYEN VAN A',
  defaultModelPriceVnd: 25000, orderTtlMinutes: 720, maxPendingOrdersPerDevice: 2, ...over });
async function addModel(name, over = {}) {
  const r = await pool.query("insert into models(category_id,name,status,price_vnd,published_at) values($1,$2,$3,$4,case when $3='PUBLISHED' then now() end) returning id",
    [catId, name, over.status ?? 'PUBLISHED', over.price ?? 15000]);
  const id = r.rows[0].id;
  // Manifest cong khai chi gom model co file chinh (join model_files), nen moi model test deu co mot.
  const f = await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes) values($1,$2,$3,'m.rar','rar',1000) returning id", [id, sourceId, `fileFor${++fileSeq}`]);
  await pool.query('update models set primary_file_id=$1 where id=$2', [f.rows[0].id, id]);
  return id;
}
const model = async (id) => (await pool.query('select * from models where id=$1', [id])).rows[0];
const audits = async (action) => (await pool.query('select * from audit_events where action=$1 order by created_at', [action])).rows;
const version = async () => Number((await pool.query('select active_version from catalog_state where id=1')).rows[0].active_version);

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('catalog_admin_routes');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  for (const k of ['adminId', 'admin2Id', 'userId']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'adminId') adminId = id; else if (k === 'admin2Id') admin2Id = id; else userId = id;
  }
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Living','living','Living / Sofa') returning id")).rows[0].id;
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','catAdminRootFolder1','root','MY_DRIVE') returning id")).rows[0].id;
  manifest = (await import('../catalog-v1/manifest.js')).buildManifest;
  const { createCatalogAdminRouter } = await import('./routes.js');
  const { requireAdmin } = await import('../admin/access.js');
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = who === 'admin' ? { id: adminId, role: 'ADMIN' } : who === 'admin2' ? { id: admin2Id, role: 'ADMIN' } : { id: userId, role: 'USER' }; next();
  };
  build = () => {
    const app = express();
    app.use('/api/admin', createCatalogAdminRouter({ pool, guards: [fakeAuth, requireAdmin], envDefaultPrice: ENV_PRICE }));
    app.use('/api/admin', (_req, res) => res.status(404).json({ legacy: 'next' })); // mo phong adminRouter cu: duong dan la phai roi xuong day
    return app;
  };
  await new Promise((r) => { server = build().listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('delete from app_settings'); await pool.query('delete from audit_events'); await pool.query('delete from models');
  await pool.query("update catalog_state set active_version = 0, manifest_checksum = null where id = 1");
});

test('guards: anonymous 401, ordinary user 403 on every route; nothing is written', { skip }, async () => {
  const id = await addModel('Sofa A');
  for (const [path, method, body] of [['/settings', 'GET'], ['/settings', 'PUT', settingsBody()], ['/models', 'GET'], [`/models/${id}`, 'PATCH', { name: 'Hack' }]]) {
    assert.equal((await j(path, { method, body, user: null })).status, 401, `anon ${method} ${path}`);
    assert.equal((await j(path, { method, body, user: 'user' })).status, 403, `user ${method} ${path}`);
  }
  assert.equal((await pool.query('select count(*)::int n from app_settings')).rows[0].n, 0);
  assert.equal((await model(id)).name, 'Sofa A');
  assert.equal((await audits('MODEL_UPDATED')).length, 0);
});

test('paths this router does not own fall through to the legacy admin router (its own guards and error format stay intact)', { skip }, async () => {
  const r = await j('/users', { user: null }); // khong phai duong dan cua router nay
  assert.equal(r.status, 404); assert.deepEqual(await r.json(), { legacy: 'next' });
});

test('GET settings before the first save: defaults (price = env value), updatedAt null, bank empty', { skip }, async () => {
  const s = await (await j('/settings')).json();
  assert.deepEqual(s, { bankName: null, bankBin: null, accountNo: null, accountName: null, defaultModelPriceVnd: ENV_PRICE,
    orderTtlMinutes: 1440, maxPendingOrdersPerDevice: 3, updatedAt: null });
});

test('PUT settings saves one row, records who and when, returns the saved view, and audits WITHOUT bank details', { skip }, async () => {
  const r = await j('/settings', { method: 'PUT', body: settingsBody() });
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.deepEqual(Object.keys(saved).sort(), ['accountName', 'accountNo', 'bankBin', 'bankName', 'defaultModelPriceVnd', 'maxPendingOrdersPerDevice', 'orderTtlMinutes', 'updatedAt']);
  assert.equal(saved.accountNo, ACCOUNT_NO); assert.equal(saved.defaultModelPriceVnd, 25000); assert.ok(saved.updatedAt);
  const row = (await pool.query('select * from app_settings')).rows;
  assert.equal(row.length, 1); assert.equal(row[0].id, 1); assert.equal(row[0].updated_by, adminId);
  assert.deepEqual(await (await j('/settings')).json(), saved);

  const [event] = await audits('SETTINGS_UPDATED');
  assert.ok(event, 'audited'); assert.equal(event.actor_kind, 'ADMIN'); assert.equal(event.actor_ref, adminId); assert.equal(event.target_type, 'app_settings');
  assert.ok(event.details.changed.includes('accountNo') && event.details.changed.includes('defaultModelPriceVnd'));
  assert.equal(JSON.stringify(event).includes(ACCOUNT_NO), false, 'bank account number is not copied into the audit trail');
  assert.equal(JSON.stringify(event).includes('NGUYEN VAN A'), false);
  assert.deepEqual(event.details.defaultModelPriceVnd, { from: ENV_PRICE, to: 25000 });
});

test('PUT settings again: the same values write no new audit event; a change records only what changed', { skip }, async () => {
  await j('/settings', { method: 'PUT', body: settingsBody() });
  await j('/settings', { method: 'PUT', body: settingsBody() });
  assert.equal((await audits('SETTINGS_UPDATED')).length, 1, 'identical save is not an event');
  await j('/settings', { method: 'PUT', body: settingsBody({ orderTtlMinutes: 60 }) });
  const events = await audits('SETTINGS_UPDATED');
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].details.changed, ['orderTtlMinutes']);
});

test('PUT settings: empty strings clear optional bank fields; text is trimmed', { skip }, async () => {
  await j('/settings', { method: 'PUT', body: settingsBody() });
  const s = await (await j('/settings', { method: 'PUT', body: settingsBody({ bankName: '  ', bankBin: '', accountNo: null, accountName: '  A B  ' }) })).json();
  assert.equal(s.bankName, null); assert.equal(s.bankBin, null); assert.equal(s.accountNo, null); assert.equal(s.accountName, 'A B');
});

test('PUT settings validation: every bad body is 400 and the saved row is untouched', { skip }, async () => {
  await j('/settings', { method: 'PUT', body: settingsBody() });
  const before = await (await j('/settings')).json();
  const bad = [
    settingsBody({ bankBin: '97043' }), settingsBody({ bankBin: '97043a' }), settingsBody({ bankBin: 970436 }),
    settingsBody({ accountNo: '12345' }), settingsBody({ accountNo: 'ABC123456' }), settingsBody({ accountNo: '1'.repeat(20) }),
    settingsBody({ bankName: 'x'.repeat(101) }), settingsBody({ accountName: 'a\u0000b' }), settingsBody({ bankName: 5 }),
    settingsBody({ defaultModelPriceVnd: -1 }), settingsBody({ defaultModelPriceVnd: 1.5 }), settingsBody({ defaultModelPriceVnd: '100' }),
    settingsBody({ defaultModelPriceVnd: 100_000_001 }), settingsBody({ defaultModelPriceVnd: null }),
    settingsBody({ orderTtlMinutes: 0 }), settingsBody({ orderTtlMinutes: 43201 }), settingsBody({ orderTtlMinutes: 1.2 }),
    settingsBody({ maxPendingOrdersPerDevice: 0 }), settingsBody({ maxPendingOrdersPerDevice: 21 }),
    { ...settingsBody(), extra: 1 }, (({ bankBin, ...rest }) => rest)(settingsBody()), [], 'text', null,
  ];
  for (const body of bad) assert.equal((await j('/settings', { method: 'PUT', body })).status, 400, JSON.stringify(body)?.slice(0, 80));
  assert.deepEqual(await (await j('/settings')).json(), before);
  assert.equal((await audits('SETTINGS_UPDATED')).length, 1);
});

test('GET models: pagination envelope, exact safe fields, ordered by name, no ids other than the public model id', { skip }, async () => {
  for (const n of ['Zebra', 'apple', 'Mango']) await addModel(n);
  const page = await (await j('/models')).json();
  assert.deepEqual(Object.keys(page).sort(), ['items', 'limit', 'page', 'total']);
  assert.equal(page.total, 3); assert.equal(page.page, 1); assert.equal(page.limit, 20);
  assert.deepEqual(page.items.map((m) => m.name), ['apple', 'Mango', 'Zebra'], 'case-insensitive order');
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['categoryPath', 'id', 'name', 'nameOverridden', 'priceOverridden', 'priceVnd', 'status', 'updatedAt']);
  assert.equal(page.items[0].categoryPath, 'Living / Sofa');
  const p2 = await (await j('/models?limit=2&page=2')).json();
  assert.deepEqual(p2.items.map((m) => m.name), ['Zebra']); assert.equal(p2.total, 3);
  assert.equal((await (await j('/models?limit=100000')).json()).limit, 100, 'limit is capped');
  const beyond = await (await j('/models?page=99')).json();
  assert.equal(beyond.items.length, 0); assert.equal(beyond.total, 3);
});

test('GET models: q is a case-insensitive substring search and wildcard characters are literal; status filter; bad status is 400', { skip }, async () => {
  await addModel('Sofa Modern'); await addModel('sofa 100% cotton'); await addModel('Chair_A', { status: 'HIDDEN' }); await addModel('ChairXA');
  assert.deepEqual((await (await j('/models?q=SOFA')).json()).items.map((m) => m.name).sort(), ['Sofa Modern', 'sofa 100% cotton']);
  assert.deepEqual((await (await j('/models?q=' + encodeURIComponent('%'))).json()).items.map((m) => m.name), ['sofa 100% cotton'], '% is not a wildcard');
  assert.deepEqual((await (await j('/models?q=' + encodeURIComponent('r_A'))).json()).items.map((m) => m.name), ['Chair_A'], '_ is not a wildcard');
  assert.equal((await (await j('/models?status=HIDDEN')).json()).total, 1);
  assert.equal((await (await j('/models?status=PUBLISHED&q=chair')).json()).total, 1);
  assert.equal((await j('/models?status=WRONG')).status, 400);
  assert.equal((await j('/models?q=' + 'x'.repeat(101))).status, 400);
});

test('PATCH model: a name edit marks name_overridden only; a price edit marks price_overridden only; the public catalog version moves', { skip }, async () => {
  const id = await addModel('Sofa A');
  await addModel('Other');
  const v0 = await version();
  const r = await j(`/models/${id}`, { method: 'PATCH', body: { name: '  Sofa B  ' } });
  assert.equal(r.status, 200);
  const item = await r.json();
  assert.equal(item.name, 'Sofa B'); assert.equal(item.nameOverridden, true); assert.equal(item.priceOverridden, false);
  assert.equal(await version(), v0 + 1, 'name is public data: the catalog version moves');
  assert.equal((await manifest(pool)).models.find((m) => m.id === id).name, 'Sofa B');

  const item2 = await (await j(`/models/${id}`, { method: 'PATCH', body: { priceVnd: 99000 } })).json();
  assert.equal(item2.priceVnd, 99000); assert.equal(item2.priceOverridden, true); assert.equal(item2.nameOverridden, true);
  assert.equal(await version(), v0 + 2);
  assert.equal((await model(id)).price_vnd, 99000);
  assert.equal((await pool.query("select count(*)::int n from models where name='Other' and price_vnd=15000 and not name_overridden and not price_overridden")).rows[0].n, 1, 'other models untouched');
});

test('PATCH model: HIDDEN removes it from the public manifest and bumps the version; PUBLISHED brings it back and stamps published_at once', { skip }, async () => {
  const id = await addModel('Sofa A'); await addModel('Other');
  await j(`/models/${id}`, { method: 'PATCH', body: { priceVnd: 15000 } }); // no real change: baseline
  const v0 = await version();
  assert.ok((await manifest(pool)).models.some((m) => m.id === id));
  await j(`/models/${id}`, { method: 'PATCH', body: { status: 'HIDDEN' } });
  assert.equal((await manifest(pool)).models.some((m) => m.id === id), false, 'hidden model is not public');
  assert.equal(await version(), v0 + 1);
  const draft = await addModel('Draft one', { status: 'DRAFT' });
  assert.equal((await model(draft)).published_at, null);
  const r = await j(`/models/${draft}`, { method: 'PATCH', body: { status: 'PUBLISHED' } });
  assert.equal((await r.json()).status, 'PUBLISHED');
  const first = (await model(draft)).published_at;
  assert.ok(first, 'published_at set when first published');
  await j(`/models/${draft}`, { method: 'PATCH', body: { status: 'HIDDEN' } });
  await j(`/models/${draft}`, { method: 'PATCH', body: { status: 'PUBLISHED' } });
  assert.equal((await model(draft)).published_at.getTime(), first.getTime(), 'published_at is not rewritten on republish (compared to the millisecond)');
});

test('PATCH model: a request that changes nothing writes no audit event, no flag and no version bump', { skip }, async () => {
  const id = await addModel('Sofa A');
  await j(`/models/${id}`, { method: 'PATCH', body: { name: 'Sofa A2' } });
  const v = await version(); const events = (await audits('MODEL_UPDATED')).length;
  const r = await j(`/models/${id}`, { method: 'PATCH', body: { name: 'Sofa A2', priceVnd: 15000, status: 'PUBLISHED' } });
  assert.equal(r.status, 200);
  const m = await model(id);
  assert.equal(m.price_overridden, false, 'same price = not an override');
  assert.equal(await version(), v); assert.equal((await audits('MODEL_UPDATED')).length, events);
});

test('PATCH model audits what changed (field names + old/new price and status), attributed to the admin', { skip }, async () => {
  const id = await addModel('Sofa A');
  await j(`/models/${id}`, { method: 'PATCH', body: { priceVnd: 20000, status: 'HIDDEN' } });
  const [e] = await audits('MODEL_UPDATED');
  assert.equal(e.actor_kind, 'ADMIN'); assert.equal(e.actor_ref, adminId); assert.equal(e.target_type, 'model'); assert.equal(e.target_id, id);
  assert.deepEqual(e.details.changed.sort(), ['priceVnd', 'status']);
  assert.deepEqual(e.details.priceVnd, { from: 15000, to: 20000 });
  assert.deepEqual(e.details.status, { from: 'PUBLISHED', to: 'HIDDEN' });
});

test('PATCH model validation: bad body is 400 and nothing changes; unknown or malformed id is 422 MODEL_NOT_FOUND', { skip }, async () => {
  const id = await addModel('Sofa A');
  const before = await model(id);
  const bad = [{}, [], 'x', null, { name: '' }, { name: '   ' }, { name: 'x'.repeat(301) }, { name: 'a\u0007b' }, { name: 5 },
    { priceVnd: -1 }, { priceVnd: 1.5 }, { priceVnd: '100' }, { priceVnd: 100_000_001 },
    { status: 'DRAFT' }, { status: 'NEEDS_REVIEW' }, { status: 'published' }, { status: 1 }, { legacyId: 'x' }, { name: 'ok', extra: 1 }];
  for (const body of bad) assert.equal((await j(`/models/${id}`, { method: 'PATCH', body })).status, 400, JSON.stringify(body)?.slice(0, 60));
  assert.deepEqual(await model(id), before);
  for (const target of [randomUUID(), 'not-a-uuid']) {
    const r = await j(`/models/${target}`, { method: 'PATCH', body: { name: 'X' } });
    assert.equal(r.status, 422); assert.equal((await r.json()).error.code, 'MODEL_NOT_FOUND');
  }
  assert.equal((await audits('MODEL_UPDATED')).length, 0);
});

test('errors use the v3 envelope with a request id and Vietnamese text, and never leak SQL', { skip }, async () => {
  const r = await j('/settings', { method: 'PUT', body: { nope: 1 } });
  const body = await r.json();
  assert.equal(body.error.code, 'INVALID_PARAMS'); assert.ok(body.error.requestId); assert.ok(r.headers.get('x-request-id'));
  assert.ok(!/select|insert|app_settings/i.test(JSON.stringify(body)));
});

test('the LAST admin to save is recorded (updated_by follows the editor, not just the first save)', { skip }, async () => {
  await j('/settings', { method: 'PUT', body: settingsBody() });
  assert.equal((await pool.query('select updated_by from app_settings')).rows[0].updated_by, adminId);
  await j('/settings', { method: 'PUT', body: settingsBody({ orderTtlMinutes: 90 }), user: 'admin2' });
  assert.equal((await pool.query('select updated_by from app_settings')).rows[0].updated_by, admin2Id);
  assert.equal((await audits('SETTINGS_UPDATED')).at(-1).actor_ref, admin2Id);
});

test('PATCH response has exactly the same safe fields as the list (no legacy id, no internal columns)', { skip }, async () => {
  const id = await addModel('Sofa A');
  await pool.query("update models set legacy_id = 'plugin-visible-old-id' where id = $1", [id]);
  const body = await (await j(`/models/${id}`, { method: 'PATCH', body: { priceVnd: 1 } })).json();
  assert.deepEqual(Object.keys(body).sort(), ['categoryPath', 'id', 'name', 'nameOverridden', 'priceOverridden', 'priceVnd', 'status', 'updatedAt']);
  assert.equal(body.categoryPath, 'Living / Sofa');
  assert.equal(JSON.stringify(body).includes('plugin-visible-old-id'), false);
});
