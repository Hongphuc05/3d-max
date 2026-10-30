import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, q, computeDiff, publishPlan, seedLegacyCatalog, manifest, sourceId;
let n = 0;
const nid = () => `U${String(++n).padStart(11, '0')}`;
const sha = s => createHash('sha256').update(s).digest('hex');
const md5 = s => createHash('md5').update(s).digest('hex');

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_publish');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
  ({ computeDiff } = await import('./diff.js'));
  ({ publishPlan } = await import('./publish.js'));
  ({ seedLegacyCatalog } = await import('./seed.js'));
  manifest = await import('../catalog-v1/manifest.js');
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','pubRootFolder001','root','MY_DRIVE') returning id")).rows[0].id;
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('update models set primary_file_id = null');
  for (const t of ['review_items', 'model_previews', 'model_files', 'models', 'categories', 'drive_inventory', 'drive_sync_job_items', 'drive_sync_jobs']) await pool.query(`delete from ${t}`);
  await pool.query('update catalog_state set active_version = 0, manifest_checksum = null, published_at = null, published_by_job = null');
});

async function scanned(entries) {
  const job = await q.enqueueJob(pool, { sourceId, mode: 'FULL' });
  await pool.query("update drive_sync_jobs set status='COMPLETED', finished_at=now(), checkpoint='{\"scan\":{\"done\":true}}'::jsonb where id=$1", [job.id]);
  for (const e of entries) {
    const id = e.id ?? nid();
    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
    await pool.query(
      `insert into drive_inventory(source_id,drive_file_id,parent_drive_id,path,filename,mime_type,is_folder,is_shortcut,size_bytes,md5_checksum,last_seen_job_id)
       values($1,$2,$3,$4,$5,'x/y',false,false,$6,$7,$8)
       on conflict (source_id, drive_file_id) do update set parent_drive_id=excluded.parent_drive_id, path=excluded.path, filename=excluded.filename,
         size_bytes=excluded.size_bytes, md5_checksum=excluded.md5_checksum, last_seen_job_id=excluded.last_seen_job_id`,
      [sourceId, id, `dir:${dir}`, e.path, e.path.split('/').pop(), e.size ?? 100, e.md5 === undefined ? md5(e.path) : e.md5, job.id]);
  }
  return job.id;
}
const pair = (dir, stem, o = {}) => [{ id: o.imageId ?? nid(), path: `${dir}/${stem}.jpg`, md5: o.imageMd5 }, { id: o.archiveId ?? nid(), path: `${dir}/${stem}.rar`, md5: o.archiveMd5, size: o.size }];
const resultsFor = (plan, skipImages = []) => Object.fromEntries(plan.previews.filter(p => !skipImages.includes(p.imageId)).map(p => {
  const mk = v => ({ path: `${sha(p.imageId + v)}.webp`, sha256: sha(p.imageId + v), fileSize: 1000, width: v === 'sm' ? 480 : 1400, height: 320 });
  return [p.imageId, { sourceMd5: p.md5, sm: mk('sm'), lg: mk('lg') }];
}));
const counts = async () => Object.fromEntries(await Promise.all(['models', 'model_files', 'model_previews', 'review_items', 'categories'].map(async t => [t, (await pool.query(`select count(*)::int n from ${t}`)).rows[0].n])));
const version = async () => (await manifest.readCatalogState(pool));
async function cycle(entries, over = {}) {
  const jobId = await scanned(entries);
  const plan = await computeDiff(pool, { sourceId, jobId });
  const results = over.results ?? resultsFor(plan, over.skipImages);
  const out = await publishPlan(pool, { sourceId, jobId, plan, results, ...over.publish });
  return { jobId, plan, results, out };
}

test('first publish: models, files, categories tree, previews (sm+lg, primary), reviews and catalog version 1', { skip }, async () => {
  const entries = [...pair('Furniture/Desk', 'one'), ...pair('Furniture/Desk', 'two'), ...pair('Lighting/Lamp', 'three'), { path: 'Furniture/Desk/lonely.rar' }];
  const { jobId, out } = await cycle(entries);
  assert.deepEqual(out, { version: 1, changed: true, created: 3, updated: 0 });
  assert.deepEqual(await counts(), { models: 3, model_files: 3, model_previews: 6, review_items: 1, categories: 4 });
  const m = (await pool.query("select status, price_vnd, published_at is not null as pub, primary_file_id is not null as pf from models order by name")).rows;
  assert.deepEqual(m, Array(3).fill({ status: 'PUBLISHED', price_vnd: 15000, pub: true, pf: true }));
  assert.equal((await pool.query("select count(*)::int n from model_previews where is_primary")).rows[0].n, 6);
  assert.deepEqual((await pool.query('select full_path from categories order by full_path')).rows.map(r => r.full_path), ['Furniture', 'Furniture / Desk', 'Lighting', 'Lighting / Lamp']);
  const st = await pool.query('select active_version, manifest_checksum, published_by_job from catalog_state');
  assert.deepEqual([Number(st.rows[0].active_version), /^[0-9a-f]{64}$/.test(st.rows[0].manifest_checksum), st.rows[0].published_by_job], [1, true, jobId]);
});

test('publishing the same Drive state again changes NOTHING: same version, no new rows, no duplicate reviews', { skip }, async () => {
  const entries = [...pair('A/B', 'one'), ...pair('A/B', 'two'), { path: 'A/B/lonely.rar' }];
  const first = await cycle(entries);
  const snapshot = await counts();
  const second = await cycle(entries);
  assert.deepEqual([second.out.changed, second.out.version, second.out.created, second.out.updated], [false, 1, 0, 0]);
  assert.deepEqual(await counts(), snapshot);
  assert.equal(second.plan.counters.unchangedCount, 2);
  assert.ok(first.out.changed);
});

test('REAL legacy catalog: seed 360, publish adds previews and md5/size without a new model; republishing is quiet', { skip }, async () => {
  const { items } = JSON.parse(readFileSync(new URL('../../../../library/public/catalog.json', import.meta.url), 'utf8'));
  await seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd: 15000 });
  const entries = items.flatMap((it, i) => {
    const dir = it.category.replace(/ \/ /g, '/'), stem = it.fileName.replace(/\.[^.]+$/, '');
    return [{ id: `IMG${String(i).padStart(9, '0')}`, path: `${dir}/${stem}.jpg`, md5: md5(`img${i}`) }, { id: it.driveFileId, path: `${dir}/${it.fileName}`, md5: md5(it.fileName), size: 1000 + i }];
  });
  const before = await counts();
  const first = await cycle(entries);
  assert.deepEqual([first.out.created, first.out.version, first.out.changed], [0, 1, true]);
  const after = await counts();
  assert.deepEqual([after.models, after.model_files, after.categories, after.model_previews], [360, 360, before.categories, 720]);
  assert.equal((await pool.query('select count(*)::int n from model_files where md5_checksum is not null and size_bytes is not null')).rows[0].n, 360);
  assert.equal((await pool.query("select count(*)::int n from models where status='PUBLISHED'")).rows[0].n, 360);
  assert.equal((await pool.query('select count(*)::int n from models where name_overridden or price_overridden')).rows[0].n, 0);
  const again = await cycle(entries);
  assert.deepEqual([again.out.changed, again.out.version, again.plan.counters.unchangedCount], [false, 1, 360]);
});

test('ATOMIC: a failure half way leaves the catalog exactly as it was (no model, no preview, no review, version 0)', { skip }, async () => {
  const jobId = await scanned([...pair('A/B', 'one'), ...pair('A/B', 'two')]);
  const plan = await computeDiff(pool, { sourceId, jobId });
  assert.equal(plan.models.length, 2);
  // someone else grabs the drive file of the SECOND model after the plan was made -> its insert fails after the first model was written
  const holder = await pool.query("insert into categories(name,slug,full_path) values('X','x','X') returning id");
  const owner = (await pool.query("insert into models(category_id,name,status,price_vnd) values($1,'Owner','DRAFT',1) returning id", [holder.rows[0].id])).rows[0].id;
  await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type) values($1,$2,$3,'o.rar','rar')", [owner, sourceId, plan.models[1].file.id]);
  const before = await counts(), v = await version();
  await assert.rejects(publishPlan(pool, { sourceId, jobId, plan, results: resultsFor(plan) }), e => e.code === '23505');
  assert.deepEqual(await counts(), before);
  assert.deepEqual(await version(), v);
  assert.equal((await pool.query("select count(*)::int n from models where name in ('one','two')")).rows[0].n, 0);
});

test('a stale plan (the model it points at is gone) is refused with PLAN_STALE and rolled back entirely', { skip }, async () => {
  const jobId = await scanned(pair('A/B', 'one'));
  const plan = await computeDiff(pool, { sourceId, jobId });
  plan.models.push({ action: 'MODIFIED', modelId: randomUUID(), name: 'ghost', categoryPath: 'A / B', status: null, file: { id: 'GHOSTFILE00001', name: 'g.rar', type: 'rar', size: 1, md5: null }, images: [], changes: { name: 'ghost' } });
  await assert.rejects(publishPlan(pool, { sourceId, jobId, plan, results: resultsFor(plan) }), e => e.code === 'PLAN_STALE');
  assert.equal((await counts()).models, 0, 'the NEW model before the stale entry must not survive');
});

test('missing and recovered: missing_scans goes up / back to 0; nothing is hidden or deleted; the manifest (and version) are untouched', { skip }, async () => {
  const cat = (await pool.query("insert into categories(name,slug,full_path) values('A','a','A') returning id")).rows[0].id;
  const mk = async (name, scans) => (await pool.query("insert into models(category_id,name,status,price_vnd,missing_scans) values($1,$2,'PUBLISHED',1,$3) returning id", [cat, name, scans])).rows[0].id;
  const [gone, back, stay] = [await mk('gone', 0), await mk('back', 2), await mk('stay', 0)];
  const out = await publishPlan(pool, { sourceId, plan: { models: [], missing: [gone], recovered: [back], reviews: [] }, results: {} });
  const rows = Object.fromEntries((await pool.query('select name, missing_scans, status from models')).rows.map(r => [r.name, [r.missing_scans, r.status]]));
  assert.deepEqual(rows, { gone: [1, 'PUBLISHED'], back: [0, 'PUBLISHED'], stay: [0, 'PUBLISHED'] });
  assert.equal(stay.length > 0, true);
  assert.equal(out.version, 0);
});

test('reviews: SUGGESTED and REMAP are linked to the new model; payloads hold no ids; a dismissed review is never reopened by a later scan', { skip }, async () => {
  const oldModelCat = (await pool.query("insert into categories(name,slug,full_path) values('Old','old','Old') returning id")).rows[0].id;
  const oldId = (await pool.query("insert into models(category_id,name,status,price_vnd) values($1,'Old model','PUBLISHED',1) returning id", [oldModelCat])).rows[0].id;
  await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes,md5_checksum) values($1,$2,'OLDFILEID00001','old.rar','rar',4242,$3)", [oldId, sourceId, md5('same')]);
  const entries = [...pair('A/B', 'p'), ...pair('A/B', 'q'), { id: nid(), path: 'A/B/x.jpg' }, { id: nid(), path: 'A/B/y-zz.rar' }, ...pair('C/D', 'moved', { archiveMd5: md5('same'), size: 4242 })];
  const first = await cycle(entries);
  const reviews = (await pool.query('select r.kind, r.model_id, r.status, r.payload, m.name, m.status as mstatus from review_items r left join models m on m.id = r.model_id order by r.kind')).rows;
  assert.deepEqual(reviews.map(r => [r.kind, r.name, r.mstatus]), [['REMAP_CANDIDATE', 'moved', 'NEEDS_REVIEW'], ['SUGGESTED_PAIR', 'y-zz', 'NEEDS_REVIEW']]);
  assert.equal(reviews[0].payload.previousModelId, oldId);
  const text = JSON.stringify(reviews.map(r => r.payload));
  for (const e of entries) assert.ok(!e.id || !text.includes(e.id), 'payload leaks a drive id');
  assert.ok(first.out.changed);

  await pool.query("update review_items set status = 'DISMISSED'");
  await cycle(entries);
  assert.deepEqual((await pool.query('select status from review_items')).rows.map(r => r.status), ['DISMISSED', 'DISMISSED'], 'no new review, none reopened');
});

test('a NEW model whose primary preview failed is NOT published (NEEDS_REVIEW) and is absent from the public manifest', { skip }, async () => {
  const good = pair('A/B', 'good'), bad = pair('A/B', 'bad');
  const jobId = await scanned([...good, ...bad]);
  const plan = await computeDiff(pool, { sourceId, jobId });
  const failedImage = bad[0].id;
  const out = await publishPlan(pool, { sourceId, jobId, plan, results: resultsFor(plan, [failedImage]) });
  assert.equal(out.created, 2);
  const st = Object.fromEntries((await pool.query('select name, status from models')).rows.map(r => [r.name, r.status]));
  assert.deepEqual(st, { good: 'PUBLISHED', bad: 'NEEDS_REVIEW' });
  const man = await manifest.buildManifest(pool);
  assert.deepEqual(man.models.map(m => m.name), ['good']);
  assert.equal(man.previews.length, 2);
});

test('MODIFIED: rename, category move, changed archive (sha256 reset), replaced image (version+1, primary flips), removed image gone, failed re-download keeps the old rows', { skip }, async () => {
  const [a, b, ia1, ia2, ib] = [nid(), nid(), nid(), nid(), nid()];
  const first = await cycle([{ id: ia1, path: 'A/B/old.jpg', md5: md5('ia1') }, { id: a, path: 'A/B/old.rar', md5: md5('a1'), size: 10 },
    { id: ib, path: 'A/B/keep.jpg', md5: md5('ib1') }, { id: b, path: 'A/B/keep.rar', md5: md5('b'), size: 10 }]);
  await pool.query("update model_files set sha256 = $1", [sha('had-a-hash')]);
  const second = await cycle([
    { id: ia1, path: 'C/D/new.jpg', md5: md5('ia1') }, { id: a, path: 'C/D/new.rar', md5: md5('a2'), size: 20 },   // renamed + moved + new content
    { id: ib, path: 'A/B/keep.jpg', md5: md5('ib2') }, { id: b, path: 'A/B/keep.rar', md5: md5('b'), size: 10 },   // image changed but its download FAILS
  ], { skipImages: [ib] });
  assert.equal(second.out.updated, 2);
  const rowA = (await pool.query("select m.name, c.full_path, f.filename, f.md5_checksum, f.size_bytes, f.sha256 from models m join categories c on c.id=m.category_id join model_files f on f.model_id=m.id where f.drive_file_id=$1", [a])).rows[0];
  assert.deepEqual(rowA, { name: 'new', full_path: 'C / D', filename: 'new.rar', md5_checksum: md5('a2'), size_bytes: '20', sha256: null });
  const rowB = (await pool.query("select f.sha256 from model_files f where f.drive_file_id=$1", [b])).rows[0];
  assert.equal(rowB.sha256, sha('had-a-hash'), 'untouched file keeps its sha256');
  const prevB = (await pool.query("select variant, version, is_primary, source_md5 from model_previews where source_drive_file_id=$1 order by variant", [ib])).rows;
  assert.deepEqual(prevB.map(r => [r.variant, r.version, r.is_primary, r.source_md5]), [['lg', 1, true, md5('ib1')], ['sm', 1, true, md5('ib1')]], 'old preview kept when the new download failed');
  assert.ok(first.out.changed && second.out.version >= 1);
});

test('MODIFIED previews: a replaced image bumps its version, a removed image disappears, the primary flag follows the plan', { skip }, async () => {
  const [a, i1, i2, i3] = [nid(), nid(), nid(), nid()];
  await cycle([{ id: i1, path: 'A/M/preview_1.jpg', md5: md5('i1') }, { id: i2, path: 'A/M/preview_2.jpg', md5: md5('i2') }, { id: a, path: 'A/M/model.max', md5: md5('a'), size: 5 }]);
  const before = (await pool.query('select source_drive_file_id, version, is_primary from model_previews where variant=\'sm\' order by source_drive_file_id')).rows;
  assert.deepEqual(before.map(r => [r.source_drive_file_id, r.version, r.is_primary]), [[i1, 1, true], [i2, 1, false]]);
  // now: i1 removed from Drive, i2 re-uploaded with new content, i3 added and it sorts first (becomes primary)
  await pool.query('delete from drive_inventory');
  const second = await cycle([{ id: i3, path: 'A/M/preview_0.jpg', md5: md5('i3') }, { id: i2, path: 'A/M/preview_2.jpg', md5: md5('i2-new') }, { id: a, path: 'A/M/model.max', md5: md5('a'), size: 5 }]);
  assert.deepEqual([second.out.changed, second.out.version], [true, 2], 'a change that only touches previews is visible to customers');
  assert.equal((await manifest.buildManifest(pool)).previews.length, 2, 'the manifest carries the primary image only (sm + lg), not the gallery');
  const after = (await pool.query('select source_drive_file_id, version, is_primary from model_previews where variant=\'sm\' order by source_drive_file_id')).rows;
  assert.deepEqual(after.map(r => [r.source_drive_file_id, r.version, r.is_primary]).sort(), [[i2, 2, false], [i3, 1, true]].sort());
  assert.equal((await pool.query("select count(*)::int n from model_previews where is_primary and variant='sm'")).rows[0].n, 1);
});

test('admin edits survive a sync: price and an overridden name are not touched by a MODIFIED update', { skip }, async () => {
  const [a, i] = [nid(), nid()];
  await cycle([{ id: i, path: 'A/B/x.jpg', md5: md5('i') }, { id: a, path: 'A/B/x.rar', md5: md5('a1'), size: 1 }]);
  await pool.query("update models set price_vnd = 99000, price_overridden = true, name = 'Admin name', name_overridden = true");
  const touched = (await pool.query('select updated_at from models')).rows[0].updated_at;
  await cycle([{ id: i, path: 'A/B/renamed.jpg', md5: md5('i') }, { id: a, path: 'A/B/renamed.rar', md5: md5('a2'), size: 2 }]);
  const m = (await pool.query('select name, price_vnd from models')).rows[0];
  assert.deepEqual(m, { name: 'Admin name', price_vnd: 99000 });
  assert.equal((await pool.query('select filename from model_files')).rows[0].filename, 'renamed.rar');
  assert.deepEqual((await pool.query('select updated_at from models')).rows[0].updated_at, touched, 'a file-only change does not touch the model row');
});

test('a MODIFIED update never overwrites a known md5/size with NULL', { skip }, async () => {
  const [a, i] = [nid(), nid()];
  await cycle([{ id: i, path: 'A/B/x.jpg', md5: md5('i') }, { id: a, path: 'A/B/x.rar', md5: md5('a'), size: 77 }]);
  const modelId = (await pool.query('select model_id from model_files where drive_file_id = $1', [a])).rows[0].model_id;
  const plan = { models: [{ action: 'MODIFIED', modelId, name: 'x', categoryPath: 'A / B', status: null, images: [], changes: { file: true },
    file: { id: a, name: 'x.rar', type: 'rar', size: null, md5: null } }], missing: [], recovered: [], reviews: [] };
  await publishPlan(pool, { sourceId, plan, results: {} });
  const f = (await pool.query('select size_bytes, md5_checksum from model_files where drive_file_id = $1', [a])).rows[0];
  assert.deepEqual([f.size_bytes, f.md5_checksum], ['77', md5('a')]);
});

test('manifest: public shape only, category counts include children, hidden models are excluded, no Drive id anywhere, checksum is deterministic', { skip }, async () => {
  const entries = [...pair('Furniture/Desk', 'one'), ...pair('Furniture/Desk', 'two'), ...pair('Furniture/Chair', 'three'), ...pair('Lighting/Lamp', 'four')];
  await cycle(entries);
  await pool.query("update models set status = 'HIDDEN' where name = 'four'");
  const man = await manifest.buildManifest(pool);
  const byPath = Object.fromEntries(man.categories.map(c => [c.fullPath, c.modelCount]));
  assert.deepEqual(byPath, { Furniture: 3, 'Furniture / Chair': 1, 'Furniture / Desk': 2 });
  assert.deepEqual(Object.keys(man.models[0]).sort(), ['categoryId', 'fileType', 'id', 'name', 'priceVnd', 'sizeBytes', 'status']);
  assert.deepEqual(Object.keys(man.previews[0]).sort(), ['fileSize', 'height', 'modelId', 'sha256', 'url', 'variant', 'version', 'width']);
  assert.ok(man.previews.every(p => p.url === `/previews/${p.sha256}.webp`));
  const text = JSON.stringify(man);
  for (const e of entries) assert.ok(!text.includes(e.id), 'manifest leaks a drive id');
  assert.ok(!text.includes(sourceId), 'manifest leaks the source id');
  assert.equal((await manifest.buildManifest(pool)).checksum, man.checksum);
});

test('refreshCatalogState (used by admin edits): a visible change bumps the version once, an invisible one does not', { skip }, async () => {
  await cycle(pair('A/B', 'one'));
  const refresh = async () => { const c = await pool.connect(); try { await c.query('begin'); const r = await manifest.refreshCatalogState(c); await c.query('commit'); return r; } finally { c.release(); } };
  assert.equal((await refresh()).changed, false);
  await pool.query("update models set missing_scans = 5");
  assert.equal((await refresh()).changed, false, 'missing_scans is invisible to customers');
  await pool.query('update models set price_vnd = 20000');
  const bumped = await refresh();
  assert.deepEqual([bumped.changed, bumped.version], [true, 2]);
  assert.equal((await refresh()).changed, false);
});

test('two publishes at the same time are serialized: exactly one creates the models, the database stays consistent', { skip }, async () => {
  const jobId = await scanned([...pair('A/B', 'one'), ...pair('A/B', 'two')]);
  const plan = await computeDiff(pool, { sourceId, jobId });
  const run = () => publishPlan(pool, { sourceId, jobId, plan, results: resultsFor(plan) });
  const settled = await Promise.allSettled([run(), run()]);
  assert.equal(settled.filter(s => s.status === 'fulfilled').length, 1);
  assert.equal(settled.find(s => s.status === 'rejected').reason.code, '23505');
  assert.deepEqual([(await counts()).models, (await version()).version], [2, 1]);
});

test('NOTIFY: a visible change announces the new version after COMMIT; an unchanged publish and a rolled-back one announce nothing', { skip }, async () => {
  const listener = await pool.connect();
  const got = [];
  listener.on('notification', n => got.push([n.channel, n.payload]));
  await listener.query('listen catalog_v1');
  try {
    await cycle(pair('A/B', 'one'));
    await cycle(pair('A/B', 'one')); // nothing changed
    const jobId = await scanned(pair('A/B', 'two'));
    const plan = await computeDiff(pool, { sourceId, jobId });
    plan.models.push({ ...plan.models[0], action: 'MODIFIED', modelId: randomUUID(), changes: { name: 'x' } }); // stale -> rollback after the NEW insert
    await assert.rejects(publishPlan(pool, { sourceId, jobId, plan, results: resultsFor(plan) }), e => e.code === 'PLAN_STALE');
    await new Promise(r => setTimeout(r, 150));
    assert.deepEqual(got, [['catalog_v1', '1']]);
  } finally { await listener.query('unlisten *'); listener.release(); }
});

test('input checks: a negative default price is refused before anything is written', { skip }, async () => {
  const jobId = await scanned(pair('A/B', 'one'));
  const plan = await computeDiff(pool, { sourceId, jobId });
  await assert.rejects(publishPlan(pool, { sourceId, jobId, plan, results: {}, defaultPriceVnd: -1 }), /price/i);
  assert.equal((await counts()).models, 0);
});
