// P3.4: API "Can duyet" (plan §2.2: GET /admin/catalog/review, POST /admin/catalog/review/:id). PostgreSQL that; requireAdmin that.
// Quyet dinh cua chu du an: ACCEPT SUGGESTED_PAIR = danh dau xong + duyet model dang NEEDS_REVIEW; DISMISS khong dong den model;
// ACCEPT REMAP_CANDIDATE = GOP file moi vao model cu (giu ID/gia/ten) va xoa model moi trung; cac loai khac chi duoc DISMISS ("Da xem").
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, server, base, adminId, userId, sourceId, catId, manifest, seq = 0;

const j = (path, { method = 'GET', body, user = 'admin' } = {}) => fetch(base + '/api/admin' + path, {
  method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const version = async () => Number((await pool.query('select active_version from catalog_state where id=1')).rows[0].active_version);
const audits = async (action) => (await pool.query('select * from audit_events where action=$1 order by created_at', [action])).rows;
const review = async (id) => (await pool.query('select * from review_items where id=$1', [id])).rows[0];
const model = async (id) => (await pool.query('select * from models where id=$1', [id])).rows[0];

async function makeModel(name, o = {}) {
  const status = o.status ?? 'PUBLISHED';
  const m = (await pool.query(
    `insert into models(legacy_id, category_id, name, status, price_vnd, name_overridden, price_overridden, missing_scans, published_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,case when $4='PUBLISHED' then now() end) returning id`,
    [o.legacy ?? null, catId, name, status, o.price ?? 15000, o.nameOverridden ?? false, o.priceOverridden ?? false, o.missing ?? 0])).rows[0].id;
  const driveId = o.driveId ?? `drive-${++seq}`;
  const f = (await pool.query(
    "insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes) values($1,$2,$3,$4,$5,$6) returning id",
    [m, sourceId, driveId, o.filename ?? `${name}.rar`, o.fileType ?? 'rar', o.size ?? 1000])).rows[0].id;
  await pool.query('update models set primary_file_id=$1 where id=$2', [f, m]);
  for (const variant of ['sm', 'lg']) {
    await pool.query(
      "insert into model_previews(model_id,source,source_drive_file_id,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'DRIVE_IMAGE',$2,$3,$4,10,10,10,$5,true)",
      [m, `img-${driveId}`, `${sha(`${driveId}-${variant}`)}.webp`, sha(`${driveId}-${variant}`), variant]);
  }
  return { id: m, fileId: f, driveId };
}
async function makeReview(kind, { modelId = null, payload = {}, status = 'OPEN' } = {}) {
  const body = { path: 'Living/Sofa', files: ['a.jpg', 'a-x.rar'], fingerprint: sha(`${kind}-${++seq}`), ...payload };
  return (await pool.query('insert into review_items(source_id,kind,payload,model_id,status) values($1,$2,$3::jsonb,$4,$5) returning id',
    [sourceId, kind, JSON.stringify(body), modelId, status])).rows[0].id;
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('catalog_admin_review');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  for (const k of ['adminId', 'userId']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'adminId') adminId = id; else userId = id;
  }
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Sofa','sofa','Living / Sofa') returning id")).rows[0].id;
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','reviewRootFolder01','root','MY_DRIVE') returning id")).rows[0].id;
  manifest = (await import('../catalog-v1/manifest.js')).buildManifest;
  const { createCatalogAdminRouter } = await import('./routes.js');
  const { requireAdmin } = await import('../admin/access.js');
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = who === 'admin' ? { id: adminId, role: 'ADMIN' } : { id: userId, role: 'USER' }; next();
  };
  const app = express();
  app.use('/api/admin', createCatalogAdminRouter({ pool, guards: [fakeAuth, requireAdmin] }));
  app.use('/api/admin', (_req, res) => res.status(404).json({ legacy: 'next' }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('delete from review_items'); await pool.query('delete from audit_events');
  await pool.query('update models set primary_file_id = null'); await pool.query('delete from models');
  await pool.query('update catalog_state set active_version = 0, manifest_checksum = null where id = 1');
});

test('guards: anonymous 401, ordinary user 403 on list and on both actions; nothing changes', { skip }, async () => {
  const id = await makeReview('SUGGESTED_PAIR');
  for (const [path, method, body] of [['/catalog/review', 'GET'], [`/catalog/review/${id}`, 'POST', { action: 'DISMISS' }]]) {
    assert.equal((await j(path, { method, body, user: null })).status, 401);
    assert.equal((await j(path, { method, body, user: 'user' })).status, 403);
  }
  assert.equal((await review(id)).status, 'OPEN');
  assert.equal((await audits('REVIEW_DISMISSED')).length, 0);
});

test('GET lists only OPEN items, oldest first, with exactly {id, kind, summary, candidates} and nothing internal', { skip }, async () => {
  const old = await makeModel('Old one', { missing: 1 }), neu = await makeModel('New one', { status: 'NEEDS_REVIEW' });
  const kinds = ['AMBIGUOUS_PAIR', 'ORPHAN_IMAGE', 'ORPHAN_MODEL', 'SUGGESTED_PAIR', 'PREVIEW_IN_ARCHIVE'];
  const ids = [];
  for (const k of kinds) ids.push(await makeReview(k, { payload: { path: 'Living/Sofa', files: [`${k}-1.jpg`, `${k}-2.rar`] } }));
  const remap = await makeReview('REMAP_CANDIDATE', { modelId: neu.id, payload: { files: ['moved.rar'], previousModelId: old.id, previousModel: 'Old one' } });
  await makeReview('SUGGESTED_PAIR', { status: 'RESOLVED' }); await makeReview('ORPHAN_IMAGE', { status: 'DISMISSED' });
  const list = await (await j('/catalog/review')).json();
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 6, 'only the OPEN ones');
  assert.deepEqual(list.map((x) => x.id), [...ids, remap], 'oldest first');
  for (const item of list) assert.deepEqual(Object.keys(item).sort(), ['candidates', 'id', 'kind', 'summary']);
  const byKind = Object.fromEntries(list.map((x) => [x.kind, x]));
  assert.match(byKind.SUGGESTED_PAIR.summary, /Living\/Sofa/);
  assert.deepEqual(byKind.SUGGESTED_PAIR.candidates, [{ name: 'SUGGESTED_PAIR-1.jpg' }, { name: 'SUGGESTED_PAIR-2.rar' }]);
  assert.match(byKind.REMAP_CANDIDATE.summary, /Old one/);
  for (const x of list) assert.match(x.summary, /[a-zà-ỹ]/i);
  const text = JSON.stringify(list);
  assert.ok(!text.includes(old.id) && !text.includes(neu.id) && !text.includes(sourceId) && !/fingerprint|previousModelId/i.test(text), 'no internal ids or fingerprints');
});

test('DISMISS marks the item DISMISSED (who/when), leaves any linked model untouched, audits, and cannot be repeated (409)', { skip }, async () => {
  const m = await makeModel('Waiting', { status: 'NEEDS_REVIEW' });
  const id = await makeReview('SUGGESTED_PAIR', { modelId: m.id });
  const v0 = await version();
  const r = await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'DISMISS' } });
  assert.equal(r.status, 200);
  const row = await review(id);
  assert.equal(row.status, 'DISMISSED'); assert.equal(row.resolved_by, adminId); assert.ok(row.resolved_at);
  assert.equal((await model(m.id)).status, 'NEEDS_REVIEW', 'dismiss does not touch the model');
  assert.equal(await version(), v0, 'no catalog change');
  const [e] = await audits('REVIEW_DISMISSED');
  assert.equal(e.actor_ref, adminId); assert.equal(e.target_type, 'review_item'); assert.equal(e.target_id, id); assert.equal(e.details.kind, 'SUGGESTED_PAIR');
  const again = await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'DISMISS' } });
  assert.equal(again.status, 409); assert.equal((await again.json()).error.code, 'REVIEW_ALREADY_RESOLVED');
  assert.equal((await audits('REVIEW_DISMISSED')).length, 1);
});

test('every kind can be dismissed ("Da xem")', { skip }, async () => {
  for (const k of ['AMBIGUOUS_PAIR', 'ORPHAN_IMAGE', 'ORPHAN_MODEL', 'SUGGESTED_PAIR', 'REMAP_CANDIDATE', 'PREVIEW_IN_ARCHIVE']) {
    const id = await makeReview(k);
    assert.equal((await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'DISMISS' } })).status, 200, k);
    assert.equal((await review(id)).status, 'DISMISSED');
  }
});

test('ACCEPT SUGGESTED_PAIR publishes the linked NEEDS_REVIEW model, resolves the item, bumps the catalog version and audits it', { skip }, async () => {
  const m = await makeModel('Pending pair', { status: 'NEEDS_REVIEW' });
  await makeModel('Another', {}); // co model khac de manifest khong rong
  const id = await makeReview('SUGGESTED_PAIR', { modelId: m.id });
  const v0 = await version();
  assert.equal((await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } })).status, 200);
  const after = await model(m.id);
  assert.equal(after.status, 'PUBLISHED'); assert.ok(after.published_at);
  const row = await review(id);
  assert.equal(row.status, 'RESOLVED'); assert.equal(row.resolved_by, adminId);
  assert.equal(await version(), v0 + 1);
  assert.ok((await manifest(pool)).models.some((x) => x.id === m.id), 'now public');
  const [e] = await audits('REVIEW_ACCEPTED');
  assert.equal(e.details.kind, 'SUGGESTED_PAIR'); assert.equal(e.details.published, true);
});

test('ACCEPT SUGGESTED_PAIR on an item with no pending model (already selling, or no link) only resolves it: no catalog change', { skip }, async () => {
  const selling = await makeModel('Already selling');
  const linked = await makeReview('SUGGESTED_PAIR', { modelId: selling.id });
  const unlinked = await makeReview('SUGGESTED_PAIR');
  await j('/catalog/review', {}); // warm
  const v0 = await version();
  for (const id of [linked, unlinked]) assert.equal((await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } })).status, 200);
  assert.equal((await review(linked)).status, 'RESOLVED'); assert.equal((await review(unlinked)).status, 'RESOLVED');
  assert.equal(await version(), v0);
  assert.ok((await audits('REVIEW_ACCEPTED')).every((e) => e.details.published === false));
});

test('ACCEPT is refused for kinds that have nothing to approve; the item stays OPEN', { skip }, async () => {
  for (const k of ['AMBIGUOUS_PAIR', 'ORPHAN_IMAGE', 'ORPHAN_MODEL', 'PREVIEW_IN_ARCHIVE']) {
    const id = await makeReview(k);
    const r = await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } });
    assert.equal(r.status, 400, k); assert.equal((await r.json()).error.code, 'INVALID_PARAMS');
    assert.equal((await review(id)).status, 'OPEN');
  }
  assert.equal((await audits('REVIEW_ACCEPTED')).length, 0);
});

test('ACCEPT REMAP_CANDIDATE merges the new file into the OLD model: old id, price, hand-edited name and legacy id survive; the duplicate is deleted', { skip }, async () => {
  const old = await makeModel('Old pretty name', { missing: 2, price: 99000, priceOverridden: true, nameOverridden: true, legacy: 'plugin-legacy-id', driveId: 'old-drive-file', fileType: 'rar', size: 111 });
  const neu = await makeModel('new-file-name', { status: 'NEEDS_REVIEW', driveId: 'new-drive-file', fileType: 'zip', size: 222 });
  const id = await makeReview('REMAP_CANDIDATE', { modelId: neu.id, payload: { files: ['new-file-name.zip'], previousModelId: old.id, previousModel: 'Old pretty name' } });
  const v0 = await version();
  const r = await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } });
  assert.equal(r.status, 200);

  assert.equal(await model(neu.id), undefined, 'the duplicate model is gone');
  const o = await model(old.id);
  assert.equal(o.name, 'Old pretty name'); assert.equal(o.price_vnd, 99000); assert.equal(o.legacy_id, 'plugin-legacy-id');
  assert.equal(o.price_overridden, true); assert.equal(o.name_overridden, true); assert.equal(o.status, 'PUBLISHED'); assert.equal(o.missing_scans, 0);
  const files = (await pool.query('select id, drive_file_id, file_type, size_bytes from model_files where model_id=$1', [old.id])).rows;
  assert.deepEqual(files.map((f) => [f.drive_file_id, f.file_type, Number(f.size_bytes)]), [['new-drive-file', 'zip', 222]], 'only the new file remains, old (gone from Drive) removed');
  assert.equal(o.primary_file_id, neu.fileId);
  assert.equal((await pool.query("select count(*)::int n from model_files where drive_file_id='old-drive-file'")).rows[0].n, 0);
  const prev = (await pool.query('select variant, is_primary, source_drive_file_id from model_previews where model_id=$1 order by variant', [old.id])).rows;
  assert.deepEqual(prev.map((p) => [p.variant, p.is_primary, p.source_drive_file_id]), [['lg', true, 'img-new-drive-file'], ['sm', true, 'img-new-drive-file']], 'previews come from the new image, still exactly one primary per variant');
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 1);
  const row = await review(id);
  assert.equal(row.status, 'RESOLVED'); assert.equal(row.resolved_by, adminId);
  assert.equal(await version(), v0 + 1);
  const pub = (await manifest(pool)).models.find((x) => x.id === old.id);
  assert.equal(pub.fileType, 'zip'); assert.equal(pub.sizeBytes, 222); assert.equal(pub.priceVnd, 99000);
  const [e] = await audits('REVIEW_ACCEPTED');
  assert.equal(e.details.kind, 'REMAP_CANDIDATE'); assert.equal(e.details.mergedInto, old.id);
});

test('REMAP that no longer applies is refused with 409 REVIEW_NOT_APPLICABLE and NOTHING changes (old model came back / duplicate gone / ids missing)', { skip }, async () => {
  const snapshot = async () => JSON.stringify([
    (await pool.query('select id, name, status, missing_scans, primary_file_id from models order by id')).rows,
    (await pool.query('select model_id, drive_file_id from model_files order by drive_file_id')).rows,
    (await pool.query('select model_id, variant from model_previews order by model_id, variant')).rows]);
  const cases = [];
  { const old = await makeModel('Back again', { missing: 0 }); const neu = await makeModel('dup1', { status: 'NEEDS_REVIEW' });
    cases.push(await makeReview('REMAP_CANDIDATE', { modelId: neu.id, payload: { previousModelId: old.id } })); }
  { const old = await makeModel('Missing', { missing: 1 }); cases.push(await makeReview('REMAP_CANDIDATE', { modelId: null, payload: { previousModelId: old.id } })); }
  { const neu = await makeModel('dup2', { status: 'NEEDS_REVIEW' }); cases.push(await makeReview('REMAP_CANDIDATE', { modelId: neu.id, payload: { previousModelId: randomUUID() } })); }
  { const neu = await makeModel('dup3', { status: 'NEEDS_REVIEW' }); cases.push(await makeReview('REMAP_CANDIDATE', { modelId: neu.id, payload: {} })); }
  { const same = await makeModel('same', { missing: 1 }); cases.push(await makeReview('REMAP_CANDIDATE', { modelId: same.id, payload: { previousModelId: same.id } })); }
  const before = await snapshot(), v0 = await version();
  for (const id of cases) {
    const r = await j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } });
    assert.equal(r.status, 409, id); assert.equal((await r.json()).error.code, 'REVIEW_NOT_APPLICABLE');
    assert.equal((await review(id)).status, 'OPEN');
  }
  assert.equal(await snapshot(), before, 'no model, file or preview was touched');
  assert.equal(await version(), v0);
  assert.equal((await audits('REVIEW_ACCEPTED')).length, 0);
});

test('two admins accepting the same item at once: exactly one wins, the other gets 409, the merge happens once', { skip }, async () => {
  const old = await makeModel('Old', { missing: 1 }), neu = await makeModel('new', { status: 'NEEDS_REVIEW' });
  const id = await makeReview('REMAP_CANDIDATE', { modelId: neu.id, payload: { previousModelId: old.id } });
  const results = await Promise.all([1, 2, 3].map(() => j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } }).then((r) => r.status)));
  assert.deepEqual(results.sort(), [200, 409, 409]);
  assert.equal((await audits('REVIEW_ACCEPTED')).length, 1);
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 1);
});

test('request validation: bad id is 422 REVIEW_NOT_FOUND; missing/unknown action, extra keys and any "choice" are 400; nothing changes', { skip }, async () => {
  const id = await makeReview('SUGGESTED_PAIR');
  for (const target of [randomUUID(), 'not-a-uuid']) {
    const r = await j(`/catalog/review/${target}`, { method: 'POST', body: { action: 'DISMISS' } });
    assert.equal(r.status, 422); assert.equal((await r.json()).error.code, 'REVIEW_NOT_FOUND');
  }
  for (const body of [{}, { action: 'accept' }, { action: 'DELETE' }, { action: 1 }, { action: 'DISMISS', extra: 1 }, { action: 'ACCEPT', choice: 'x' }, { action: 'DISMISS', choice: null }, [], 'x', null])
    assert.equal((await j(`/catalog/review/${id}`, { method: 'POST', body })).status, 400, JSON.stringify(body));
  assert.equal((await review(id)).status, 'OPEN');
});

test('errors use the v3 envelope with a request id', { skip }, async () => {
  const r = await j(`/catalog/review/${randomUUID()}`, { method: 'POST', body: { action: 'DISMISS' } });
  const body = await r.json();
  assert.ok(body.error.requestId && r.headers.get('x-request-id')); assert.ok(body.error.message);
});

test('the row lock itself decides races: concurrent ACCEPT (and ACCEPT vs DISMISS) on a SUGGESTED_PAIR resolves it exactly once', { skip }, async () => {
  const m = await makeModel('Pending', { status: 'NEEDS_REVIEW' });
  const id = await makeReview('SUGGESTED_PAIR', { modelId: m.id });
  const codes = await Promise.all([1, 2, 3].map(() => j(`/catalog/review/${id}`, { method: 'POST', body: { action: 'ACCEPT' } }).then((r) => r.status)));
  assert.deepEqual(codes.sort(), [200, 409, 409]);
  assert.equal((await audits('REVIEW_ACCEPTED')).length, 1, 'one decision, one audit event');

  const m2 = await makeModel('Pending 2', { status: 'NEEDS_REVIEW' });
  const id2 = await makeReview('SUGGESTED_PAIR', { modelId: m2.id });
  const mixed = await Promise.all(['ACCEPT', 'DISMISS'].map((action) => j(`/catalog/review/${id2}`, { method: 'POST', body: { action } }).then((r) => r.status)));
  assert.deepEqual(mixed.sort(), [200, 409]);
  const status = (await review(id2)).status;
  assert.ok(['RESOLVED', 'DISMISSED'].includes(status));
  assert.equal((await model(m2.id)).status, status === 'RESOLVED' ? 'PUBLISHED' : 'NEEDS_REVIEW', 'the model follows the one decision that won');
});
