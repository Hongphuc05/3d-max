// D29: tai anh preview len VPS, ghep cap theo stem, chi model DU anh + file nen len catalog cong khai. PostgreSQL that, auth gia.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, server, base, adminId, userId, sourceId, dir, manifest;
let seq = 0;

const jpeg = (seed = ++seq, ext = 'jpeg') => sharp({ create: { width: 700 + seed, height: 500, channels: 3, background: { r: seed * 11 % 255, g: 90, b: 40 } } })[ext]().toBuffer();
const up = async (category, filename, body, { replace, user = 'admin', type = 'image/jpeg' } = {}) => {
  body ??= await jpeg();
  return fetch(`${base}/api/admin/previews?category=${encodeURIComponent(category)}&filename=${encodeURIComponent(filename)}${replace ? '&replace=1' : ''}`,
    { method: 'POST', headers: { 'content-type': type, ...(user ? { 'x-test-user': user } : {}) }, body });
};
const get = (p, user = 'admin') => fetch(base + '/api/admin' + p, { headers: user ? { 'x-test-user': user } : {} });
const version = async () => Number((await pool.query('select active_version from catalog_state where id=1')).rows[0].active_version);
const pub = async () => (await manifest.buildManifest(pool)).models.map((m) => m.name).sort();
const errCode = async (r) => (await r.json()).error.code;
// Model da co file nen (nhu sau khi quet Drive): archive-only.
async function archive(stem, categoryPath = 'Drive / Cat') {
  let parent = null, p = '';
  for (const name of categoryPath.split(' / ')) {
    p = p ? `${p} / ${name}` : name;
    parent = (await pool.query('insert into categories(parent_id,name,slug,full_path) values($1,$2,$2,$3) on conflict (full_path) do update set name=excluded.name returning id', [parent, name, p])).rows[0].id;
  }
  const id = (await pool.query("insert into models(category_id,drive_category_id,name,status,stem) values($1,$1,$2,'PUBLISHED',$2) returning id", [parent, stem])).rows[0].id;
  const f = (await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes) values($1,$2,$3,$4,'rar',100) returning id", [id, sourceId, `f${++seq}`, `${stem}.rar`])).rows[0].id;
  await pool.query('update models set primary_file_id=$1 where id=$2', [f, id]);
  return id;
}

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('catalog_admin_previews');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  dir = await mkdtemp(path.join(os.tmpdir(), 'upl-previews-'));
  for (const k of ['adminId', 'userId']) {
    const id = (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
    if (k === 'adminId') adminId = id; else userId = id;
  }
  sourceId = (await pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','uplRootFolder0001','root','MY_DRIVE') returning id")).rows[0].id;
  manifest = await import('../catalog-v1/manifest.js');
  const { createCatalogAdminRouter } = await import('./routes.js');
  const { requireAdmin } = await import('../admin/access.js');
  const fakeAuth = (req, res, next) => {
    const who = req.get('x-test-user');
    if (!who) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    req.user = who === 'admin' ? { id: adminId, role: 'ADMIN' } : { id: userId, role: 'USER' }; next();
  };
  const app = express();
  app.use('/api/admin', createCatalogAdminRouter({ pool, guards: [fakeAuth, requireAdmin], previewDir: dir }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dir) await rm(dir, { recursive: true, force: true });
  if (dispose) await dispose(pool);
});
beforeEach(async () => {
  if (!configured) return;
  await pool.query('update models set primary_file_id = null');
  for (const t of ['review_items', 'model_previews', 'model_files', 'models', 'categories', 'audit_events']) await pool.query(`delete from ${t}`);
  await pool.query('update catalog_state set active_version = 0, manifest_checksum = null, published_at = null, published_by_job = null');
});

test('auth: no session is 401, a non-admin 403; nothing is written', { skip }, async () => {
  assert.equal((await up('A', 'x.jpg', undefined, { user: null })).status, 401);
  assert.equal((await up('A', 'x.jpg', undefined, { user: 'user' })).status, 403);
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 0);
});

test('upload without an archive: model is PREVIEW_ONLY ("Thieu zip"), categories are created from the path, files are sm+lg webp on disk, NOT public', { skip }, async () => {
  const r = await up('Furniture/Desk', 'Chair One .JPG');
  assert.equal(r.status, 201);
  const out = await r.json();
  assert.deepEqual([out.state, out.replaced, out.mismatch], ['PREVIEW_ONLY', false, false]);
  assert.deepEqual((await pool.query('select full_path from categories order by full_path')).rows.map((x) => x.full_path), ['Furniture', 'Furniture / Desk']);
  const rows = (await pool.query("select variant, source, local_path, width from model_previews where model_id=$1 order by variant", [out.id])).rows;
  assert.deepEqual(rows.map((x) => [x.variant, x.source]), [['lg', 'UPLOAD'], ['sm', 'UPLOAD']]);
  assert.equal(rows.find((x) => x.variant === 'sm').width, 480);
  for (const x of rows) await access(path.join(dir, x.local_path));
  assert.equal((await pool.query('select name, stem from models')).rows[0].name, 'Chair One');
  assert.deepEqual([await version(), await pub()], [0, []], 'preview-only is admin-only: no new catalog version');
});

test('upload pairs with an existing archive across folders by stem: FULL, public, catalog version +1, category flagged as mismatch', { skip }, async () => {
  const id = await archive('chair one', 'Drive / Cat');
  const r = await up('Furniture/Desk', 'Chair One .jpg');
  const out = await r.json();
  assert.deepEqual([r.status, out.id, out.state, out.mismatch], [201, id, 'FULL', true]);
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 1);
  assert.equal((await pool.query('select c.full_path from models m join categories c on c.id=m.category_id')).rows[0].full_path, 'Furniture / Desk', 'category of the model = category of the preview');
  assert.equal(await version(), 1); assert.deepEqual(await pub(), ['Chair One'], 'name = preview file stem');
  const list = await (await get('/models?state=FULL')).json();
  assert.deepEqual([list.total, list.items[0].state, list.items[0].categoryMismatch, list.counts], [1, 'FULL', true, { FULL: 1, PREVIEW_ONLY: 0, ARCHIVE_ONLY: 0, MISMATCH: 1 }]);
});

test('only FULL models are public: archive-only and preview-only never reach the manifest; states and counts in the admin list', { skip }, async () => {
  await archive('only zip'); await up('A', 'only image.jpg'); await archive('both'); await up('A', 'both.png', await jpeg(3, 'png'), { type: 'image/png' });
  assert.deepEqual(await pub(), ['both']);
  const states = Object.fromEntries((await (await get('/models')).json()).items.map((m) => [m.name, m.state]));
  assert.deepEqual(states, { both: 'FULL', 'only image': 'PREVIEW_ONLY', 'only zip': 'ARCHIVE_ONLY' });
  assert.deepEqual((await (await get('/models?state=ARCHIVE_ONLY')).json()).items.map((m) => m.name), ['only zip']);
  assert.equal((await get('/models?state=NOPE')).status, 400);
  const cats = (await (await get('/categories')).json()).items;
  assert.ok(cats.some((c) => c.fullPath === 'A' && c.modelCount === 2));
});

test('re-uploading the same stem in the same category needs replace=1; replacing swaps the picture (new sha), keeps one primary pair, bumps the version', { skip }, async () => {
  await archive('sofa'); await up('Living', 'sofa.jpg');
  const sha0 = (await pool.query("select sha256 from model_previews where variant='sm'")).rows[0].sha256, v0 = await version();
  const dup = await up('Living', 'SOFA .jpg');
  assert.deepEqual([dup.status, await errCode(dup)], [409, 'PREVIEW_EXISTS']);
  assert.equal((await pool.query('select sha256 from model_previews where variant=\'sm\'')).rows[0].sha256, sha0, 'nothing changed');
  const r = await up('Living', 'sofa.jpg', undefined, { replace: true });
  assert.deepEqual([r.status, (await r.json()).replaced], [200, true]);
  const rows = (await pool.query('select variant, sha256, version, is_primary from model_previews order by variant')).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every((x) => x.is_primary && x.version === 2 && x.sha256 !== sha0 || x.variant === 'lg'));
  assert.equal(await version(), v0 + 1);
});

test('same stem in a DIFFERENT category is a collision: 409, a review item (once), nothing changes', { skip }, async () => {
  await archive('table'); await up('Living', 'table.jpg');
  const v0 = await version();
  for (let i = 0; i < 2; i++) { const r = await up('Kitchen', 'table.jpg'); assert.deepEqual([r.status, await errCode(r)], [409, 'PREVIEW_COLLISION']); }
  assert.deepEqual((await pool.query('select kind, status, source_id from review_items')).rows, [{ kind: 'AMBIGUOUS_PAIR', status: 'OPEN', source_id: null }]);
  assert.equal(await version(), v0);
  assert.equal((await pool.query("select c.full_path from models m join categories c on c.id=m.category_id")).rows[0].full_path, 'Living');
});

test('validation: extension, category, empty body, wrong content type, fake image bytes, > 15 MB, huge pixel count', { skip }, async () => {
  assert.equal((await up('A', 'x.gif')).status, 400);
  assert.equal((await up('A', 'a/b.jpg')).status, 400);
  assert.equal((await up('A/../B', 'x.jpg')).status, 400);
  assert.equal((await up('', 'x.jpg')).status, 400);
  assert.equal(await errCode(await up('A', 'x.jpg', Buffer.alloc(0))), 'PREVIEW_INVALID');
  assert.equal(await errCode(await up('A', 'x.jpg', Buffer.from('<html>not an image at all</html>'))), 'PREVIEW_INVALID');
  assert.equal((await up('A', 'x.jpg', await jpeg(), { type: 'text/plain' })).status, 415);
  const big = await up('A', 'x.jpg', Buffer.alloc(15 * 1024 * 1024 + 1, 1));
  assert.deepEqual([big.status, await errCode(big)], [413, 'PREVIEW_TOO_LARGE']);
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 0, 'rejected uploads create nothing');
});

test('delete preview: a model with an archive falls back to ARCHIVE_ONLY (and leaves the public catalog); a preview-only model disappears', { skip }, async () => {
  const id = await archive('lamp', 'Drive / Cat'); await up('Lighting', 'lamp.jpg'); const solo = (await (await up('Lighting', 'solo.jpg')).json()).id;
  assert.deepEqual(await pub(), ['lamp']);
  const v0 = await version();
  assert.deepEqual(await (await fetch(`${base}/api/admin/models/${id}/preview`, { method: 'DELETE', headers: { 'x-test-user': 'admin' } })).json(), { deleted: 'PREVIEW' });
  assert.deepEqual(await pub(), []); assert.equal(await version(), v0 + 1);
  assert.equal((await pool.query('select c.full_path from models m join categories c on c.id=m.category_id where m.id=$1', [id])).rows[0].full_path, 'Drive / Cat', 'back to the Drive category');
  assert.deepEqual(await (await fetch(`${base}/api/admin/models/${solo}/preview`, { method: 'DELETE', headers: { 'x-test-user': 'admin' } })).json(), { deleted: 'MODEL' });
  assert.equal((await pool.query('select count(*)::int n from models')).rows[0].n, 1);
  assert.equal((await fetch(`${base}/api/admin/models/${solo}/preview`, { method: 'DELETE', headers: { 'x-test-user': 'admin' } })).status, 422);
  assert.equal((await fetch(`${base}/api/admin/models/${id}/preview`, { method: 'DELETE', headers: { 'x-test-user': 'user' } })).status, 403);
});
