import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, q, computeDiff, seedLegacyCatalog, sourceId;
let n = 0;
const nid = () => `D${String(++n).padStart(11, '0')}`;
const md5 = s => createHash('md5').update(s).digest('hex');

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_diff');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  q = await import('./queue.js');
  ({ computeDiff } = await import('./diff.js'));
  ({ seedLegacyCatalog } = await import('./seed.js'));
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','diffRootFolder01','root','MY_DRIVE') returning id")).rows[0].id;
});
after(async () => { if (dispose) await dispose(pool); });
beforeEach(async () => {
  if (!configured) return;
  await pool.query('update models set primary_file_id = null');
  for (const t of ['review_items', 'model_previews', 'model_files', 'models', 'categories', 'drive_inventory', 'drive_sync_job_items', 'drive_sync_jobs']) await pool.query(`delete from ${t}`);
});

// A finished scan: inventory rows tagged with the job, checkpoint.scan.done = true.
async function scanned(entries, { done = true } = {}) {
  const job = await q.enqueueJob(pool, { sourceId, mode: 'FULL' });
  await pool.query("update drive_sync_jobs set status='COMPLETED', finished_at=now(), checkpoint=$2::jsonb where id=$1", [job.id, JSON.stringify({ scan: { done } })]);
  const rows = entries.map(e => ({ id: e.id ?? nid(), ...e }));
  for (const e of rows) {
    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
    await pool.query(
      `insert into drive_inventory(source_id,drive_file_id,parent_drive_id,path,filename,mime_type,is_folder,is_shortcut,size_bytes,md5_checksum,last_seen_job_id)
       values($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10)
       on conflict (source_id, drive_file_id) do update set parent_drive_id=excluded.parent_drive_id, path=excluded.path, filename=excluded.filename,
         is_shortcut=excluded.is_shortcut, size_bytes=excluded.size_bytes, md5_checksum=excluded.md5_checksum, last_seen_job_id=excluded.last_seen_job_id`,
      [sourceId, e.id, `dir:${dir}`, e.path, e.path.split('/').pop(), e.mime ?? 'application/octet-stream', e.shortcut ?? false, e.size ?? 100, e.md5 === undefined ? md5(e.path) : e.md5, job.id]);
  }
  return { jobId: job.id, rows };
}
const pair = (dir, stem, { ext = 'rar', archiveId, imageId, archiveMd5, archiveSize, imageMd5 } = {}) => [
  { id: imageId ?? nid(), path: `${dir}/${stem}.jpg`, md5: imageMd5 },
  { id: archiveId ?? nid(), path: `${dir}/${stem}.${ext}`, md5: archiveMd5, size: archiveSize },
];
const diff = jobId => computeDiff(pool, { sourceId, jobId });

test('preview plan retains each image resource key from the scanned inventory', { skip }, async () => {
  const imageId = nid();
  const { jobId } = await scanned(pair('Furniture/Desk', 'keyed', { imageId }));
  await pool.query('update drive_inventory set resource_key=$3 where source_id=$1 and drive_file_id=$2', [sourceId, imageId, 'resourceKey_abc']);
  const plan = await diff(jobId);
  assert.equal(plan.previews.length, 1);
  assert.equal(plan.previews[0].imageId, imageId);
  assert.equal(plan.previews[0].resourceKey, 'resourceKey_abc');
});

async function mkModel({ name = 'Model', category = 'Furniture / Desk', archiveId, filename = 'x.rar', md5: m = null, size = null, status = 'PUBLISHED',
  nameOverridden = false, missingScans = 0, previews = [] } = {}) {
  const parts = category.split(' / '); let parent = null, path = '';
  for (const p of parts) {
    path = path ? `${path} / ${p}` : p;
    parent = (await pool.query('insert into categories(parent_id,name,slug,full_path) values($1,$2,$2,$3) on conflict (full_path) do update set name=excluded.name returning id', [parent, p, path])).rows[0].id;
  }
  const id = (await pool.query('insert into models(category_id,name,status,price_vnd,name_overridden,missing_scans) values($1,$2,$3,15000,$4,$5) returning id', [parent, name, status, nameOverridden, missingScans])).rows[0].id;
  const fid = (await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes,md5_checksum) values($1,$2,$3,$4,'rar',$5,$6) returning id", [id, sourceId, archiveId, filename, size, m])).rows[0].id;
  await pool.query('update models set primary_file_id=$1 where id=$2', [fid, id]);
  let first = true;
  for (const p of previews) {
    await pool.query("insert into model_previews(model_id,source,source_drive_file_id,source_md5,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'DRIVE_IMAGE',$2,$3,$4,$5,1,1,1,'sm',$6)",
      [id, p.id, p.md5 ?? null, `${randomUUID()}.webp`, randomBytes(32).toString('hex'), first]);
    first = false;
  }
  return id;
}
const tableCounts = async () => Object.fromEntries(await Promise.all(['models', 'model_files', 'model_previews', 'review_items', 'categories', 'drive_inventory'].map(async t => [t, (await pool.query(`select count(*)::int n from ${t}`)).rows[0].n])));

test('refuses to compare before the scan finished: last_seen_job_id means nothing on a partial scan', { skip }, async () => {
  const { jobId } = await scanned(pair('A/B', 'x'), { done: false });
  await assert.rejects(diff(jobId), e => e.code === 'SCAN_NOT_COMPLETE');
});

test('empty catalog: pairs become NEW models (PUBLISHED), all their images are to be downloaded, orphans become reviews, counters add up', { skip }, async () => {
  const { jobId } = await scanned([...pair('Furniture/Desk', 'one'), ...pair('Furniture/Desk', 'two'), { path: 'Furniture/Desk/lonely.rar' }, { path: 'Furniture/Desk/readme.txt' }]);
  const plan = await diff(jobId);
  assert.deepEqual(plan.models.map(m => [m.action, m.name, m.categoryPath, m.status, m.modelId]), [['NEW', 'one', 'Furniture / Desk', 'PUBLISHED', null], ['NEW', 'two', 'Furniture / Desk', 'PUBLISHED', null]]);
  assert.equal(plan.previews.length, 2);
  assert.deepEqual(plan.reviews.map(r => r.kind), ['ORPHAN_MODEL']);
  assert.deepEqual(plan.counters, { newCount: 2, updatedCount: 0, unchangedCount: 0, missingCount: 0, reviewCount: 1, skippedCount: 1 });
});

test('a suggested pair is a NEW model held in NEEDS_REVIEW with its review; files in the root go to Uncategorized', { skip }, async () => {
  const { jobId } = await scanned([...pair('A', 'p'), ...pair('A', 'q'), { path: 'A/x.jpg' }, { path: 'A/y-zz.rar' }, ...pair('', 'rootfile')]);
  const plan = await diff(jobId);
  const sug = plan.models.find(m => m.suggested);
  assert.deepEqual([sug.status, sug.action], ['NEEDS_REVIEW', 'NEW']);
  assert.equal(plan.reviews.filter(r => r.kind === 'SUGGESTED_PAIR').length, 1);
  assert.equal(plan.models.find(m => m.name === 'rootfile').categoryPath, 'Uncategorized');
});

test('REAL legacy catalog: after seeding 360 models, the first scan matches every one by drive_file_id — 0 new, 0 duplicates, 0 missing', { skip }, async () => {
  const { items } = JSON.parse(readFileSync(new URL('../../../../library/public/catalog.json', import.meta.url), 'utf8'));
  await seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd: 15000 });
  const entries = items.flatMap((it, i) => {
    const dir = it.category.replace(/ \/ /g, '/'), stem = it.fileName.replace(/\.[^.]+$/, '');
    return [{ id: `IMG${String(i).padStart(9, '0')}`, path: `${dir}/${stem}.jpg`, md5: md5(`img${i}`) }, { id: it.driveFileId, path: `${dir}/${it.fileName}`, md5: md5(it.fileName), size: 1000 + i }];
  });
  const before = await tableCounts();
  const { jobId } = await scanned(entries);
  const plan = await diff(jobId);
  assert.deepEqual([plan.counters.newCount, plan.counters.missingCount, plan.counters.reviewCount], [0, 0, 0]);
  assert.equal(plan.models.length, 360);
  assert.ok(plan.models.every(m => m.modelId && m.action === 'MODIFIED'), 'models gain their previews');
  assert.ok(plan.models.every(m => m.changes.previews && m.changes.enrich && !m.changes.file && !m.changes.name && !m.changes.category && !m.changes.filename),
    'seeded NULL md5/size are only filled in; names, categories and files are NOT reported as changed');
  assert.equal(plan.previews.length, 360);
  assert.deepEqual(await tableCounts(), { ...before, drive_inventory: before.drive_inventory + 720 }, 'computeDiff writes nothing');

  // pretend publish ran: md5/size filled, previews stored. A second comparison must be completely quiet.
  for (const m of plan.models) {
    await pool.query('update model_files set md5_checksum=$2, size_bytes=$3 where drive_file_id=$1', [m.file.id, m.file.md5, m.file.size]);
    for (const img of m.images) {
      await pool.query("insert into model_previews(model_id,source,source_drive_file_id,source_md5,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'DRIVE_IMAGE',$2,$3,$4,$5,1,1,1,'sm',$6)",
        [m.modelId, img.id, img.md5, `${randomUUID()}.webp`, randomBytes(32).toString('hex'), img.primary]);
    }
  }
  const again = await diff((await scanned(entries)).jobId);
  assert.deepEqual(again.counters, { newCount: 0, updatedCount: 0, unchangedCount: 360, missingCount: 0, reviewCount: 0, skippedCount: 0 });
  assert.deepEqual(again.previews, []);
});

test('rename: same archive id with a new file name updates the model name; an admin-edited name is never overwritten', { skip }, async () => {
  const a = nid(), b = nid(), img = nid(), img2 = nid();
  const id1 = await mkModel({ name: 'Old', archiveId: a, filename: 'old.rar', previews: [{ id: img }] });
  const id2 = await mkModel({ name: 'Admin name', archiveId: b, filename: 'old2.rar', nameOverridden: true, previews: [{ id: img2 }] });
  const { jobId } = await scanned([{ id: img, path: 'Furniture/Desk/new.jpg' }, { id: a, path: 'Furniture/Desk/new.rar' }, { id: img2, path: 'Furniture/Desk/new2.jpg' }, { id: b, path: 'Furniture/Desk/new2.rar' }]);
  const plan = await diff(jobId);
  const m1 = plan.models.find(m => m.modelId === id1), m2 = plan.models.find(m => m.modelId === id2);
  assert.deepEqual([m1.action, m1.changes.name, m1.changes.filename], ['MODIFIED', 'new', true]);
  assert.deepEqual([m2.action, m2.changes.name, m2.changes.filename], ['MODIFIED', undefined, true]);
  assert.equal(plan.counters.newCount, 0, 'a rename is never a new model');
});

test('changed archive (md5 or size), moved folder and changed preview image are each reported as MODIFIED with the right part', { skip }, async () => {
  const a = nid(), b = nid(), c = nid(), ia = nid(), ib = nid(), ic = nid();
  const mA = await mkModel({ name: 'A', archiveId: a, filename: 'a.rar', md5: md5('old'), size: 5, previews: [{ id: ia, md5: md5('ia') }] });
  const mB = await mkModel({ name: 'B', archiveId: b, filename: 'b.rar', md5: md5('b'), size: 5, previews: [{ id: ib, md5: md5('ib') }] });
  const mC = await mkModel({ name: 'C', archiveId: c, filename: 'c.rar', md5: md5('c'), size: 5, previews: [{ id: ic, md5: md5('ic-old') }] });
  const { jobId } = await scanned([
    { id: ia, path: 'Furniture/Desk/a.jpg', md5: md5('ia') }, { id: a, path: 'Furniture/Desk/a.rar', md5: md5('new'), size: 5 },
    { id: ib, path: 'Lighting/Lamp/b.jpg', md5: md5('ib') }, { id: b, path: 'Lighting/Lamp/b.rar', md5: md5('b'), size: 5 },
    { id: ic, path: 'Furniture/Desk/c.jpg', md5: md5('ic-new') }, { id: c, path: 'Furniture/Desk/c.rar', md5: md5('c'), size: 5 },
  ]);
  const plan = await diff(jobId);
  const by = id => plan.models.find(m => m.modelId === id);
  assert.deepEqual([by(mA).changes.file, by(mA).changes.previews, by(mA).action], [true, undefined, 'MODIFIED']);
  assert.deepEqual([by(mB).changes.category, by(mB).changes.file], ['Lighting / Lamp', undefined]);
  assert.deepEqual([by(mC).changes.previews, by(mC).changes.file], [true, undefined]);
  assert.deepEqual(plan.previews.map(p => p.imageId), [ic], 'only the changed image is downloaded again');
});

test('a file extension change (x.rar -> x.zip) never renames a nicely named model; a seeded model with NULL md5/size and its previews is UNCHANGED (enrich only)', { skip }, async () => {
  const a = nid(), ia = nid(), b = nid(), ib = nid();
  const mA = await mkModel({ name: 'Bathroom furniture 01', archiveId: a, filename: 'x.rar', md5: md5('x'), size: 9, previews: [{ id: ia, md5: md5('ia') }] });
  const mB = await mkModel({ name: 'Seeded nice name', archiveId: b, filename: 'y.rar', previews: [{ id: ib, md5: md5('ib') }] }); // md5/size NULL like a seeded model
  const { jobId } = await scanned([{ id: ia, path: 'Furniture/Desk/x.jpg', md5: md5('ia') }, { id: a, path: 'Furniture/Desk/x.zip', md5: md5('x'), size: 9 },
    { id: ib, path: 'Furniture/Desk/y.jpg', md5: md5('ib') }, { id: b, path: 'Furniture/Desk/y.rar', md5: md5('y'), size: 11 }]);
  const plan = await diff(jobId);
  const by = id => plan.models.find(m => m.modelId === id);
  assert.deepEqual([by(mA).changes.name, by(mA).changes.filename, by(mA).action], [undefined, true, 'MODIFIED']);
  assert.deepEqual([by(mB).action, by(mB).changes.enrich, by(mB).changes.file, by(mB).changes.name], ['UNCHANGED', true, undefined, undefined]);
  assert.equal(plan.counters.unchangedCount, 1);
});

test('a change in size alone (same md5) is a changed file; a removed or re-ordered preview image is a preview change with nothing to download', { skip }, async () => {
  const a = nid(), ia = nid(), b = nid(), ib = nid(), ib2 = nid(), c = nid(), ic1 = nid(), ic2 = nid();
  const mA = await mkModel({ name: 'A', archiveId: a, filename: 'a.rar', md5: md5('a'), size: 5, previews: [{ id: ia, md5: md5('ia') }] });
  const mB = await mkModel({ name: 'B', archiveId: b, filename: 'b.rar', md5: md5('b'), size: 5, previews: [{ id: ib, md5: md5('ib') }, { id: ib2, md5: md5('ib2') }] });
  const mC = await mkModel({ name: 'C', archiveId: c, filename: 'c.rar', md5: md5('c'), size: 5, previews: [{ id: ic1, md5: md5('ic1') }, { id: ic2, md5: md5('ic2') }] });
  const { jobId } = await scanned([
    { id: ia, path: 'Furniture/Desk/a.jpg', md5: md5('ia') }, { id: a, path: 'Furniture/Desk/a.rar', md5: md5('a'), size: 6 },
    // model B: folder layout L2 with only ONE of its two preview images left
    { id: ib, path: 'Furniture/Desk/B/preview_1.jpg', md5: md5('ib') }, { id: b, path: 'Furniture/Desk/B/model.max', md5: md5('b'), size: 5 },
    // model C: both images still there but the primary changed (ic2 now sorts first)
    { id: ic2, path: 'Furniture/Desk/C/preview_a.jpg', md5: md5('ic2') }, { id: ic1, path: 'Furniture/Desk/C/preview_b.jpg', md5: md5('ic1') }, { id: c, path: 'Furniture/Desk/C/model.max', md5: md5('c'), size: 5 },
  ]);
  const plan = await diff(jobId);
  const by = id => plan.models.find(m => m.modelId === id);
  assert.equal(by(mA).changes.file, true, 'size-only change');
  assert.deepEqual([by(mB).changes.previews, by(mB).action], [true, 'MODIFIED']);
  assert.deepEqual([by(mC).changes.previews, by(mC).action], [true, 'MODIFIED']);
  assert.deepEqual(plan.previews, [], 'nothing new to download in any of these cases');
});

test('unchanged tree: UNCHANGED, nothing to download', { skip }, async () => {
  const a = nid(), ia = nid();
  const id = await mkModel({ name: 'A', archiveId: a, filename: 'a.rar', md5: md5('a'), size: 7, previews: [{ id: ia, md5: md5('ia') }] });
  const { jobId } = await scanned([{ id: ia, path: 'Furniture/Desk/a.jpg', md5: md5('ia') }, { id: a, path: 'Furniture/Desk/a.rar', md5: md5('a'), size: 7 }]);
  const plan = await diff(jobId);
  assert.deepEqual(plan.models.map(m => [m.action, m.modelId]), [['UNCHANGED', id]]);
  assert.deepEqual([plan.previews, plan.missing, plan.recovered], [[], [], []]);
});

test('missing: a file that vanished marks its model missing (never deleted); a model that reappears is reported as recovered', { skip }, async () => {
  const gone = nid(), back = nid(), here = nid(), ih = nid(), ib = nid();
  const mGone = await mkModel({ name: 'Gone', archiveId: gone, filename: 'gone.rar' });
  const mBack = await mkModel({ name: 'Back', archiveId: back, filename: 'back.rar', missingScans: 1, previews: [{ id: ib }] });
  await mkModel({ name: 'Here', archiveId: here, filename: 'here.rar', previews: [{ id: ih }] });
  const { jobId } = await scanned([{ id: ih, path: 'Furniture/Desk/here.jpg' }, { id: here, path: 'Furniture/Desk/here.rar' }, { id: ib, path: 'Furniture/Desk/back.jpg' }, { id: back, path: 'Furniture/Desk/back.rar' }]);
  const before = await tableCounts();
  const plan = await diff(jobId);
  assert.deepEqual([plan.missing, plan.recovered, plan.counters.missingCount], [[mGone], [mBack], 1]);
  assert.equal((await tableCounts()).models, before.models, 'nothing is deleted');
});

test('a file that is still on Drive but became ambiguous is NOT reported missing and does not become a new model', { skip }, async () => {
  const a = nid(), ia = nid();
  await mkModel({ name: 'A', archiveId: a, filename: 'a.rar', previews: [{ id: ia }] });
  const { jobId } = await scanned([{ id: ia, path: 'Furniture/Desk/a.jpg' }, { id: a, path: 'Furniture/Desk/a.rar' }, { path: 'Furniture/Desk/a.zip' }]);
  const plan = await diff(jobId);
  assert.deepEqual([plan.counters.missingCount, plan.counters.newCount, plan.models.length], [0, 0, 0]);
  assert.deepEqual(plan.reviews.map(r => r.kind), ['AMBIGUOUS_PAIR']);
});

test('remap candidate: a new file id with the SAME md5+size as a missing model becomes a NEEDS_REVIEW model plus a REMAP_CANDIDATE review; without md5/size no guess is made', { skip }, async () => {
  const old = nid();
  const oldModel = await mkModel({ name: 'Old model', archiveId: old, filename: 'old.rar', md5: md5('same'), size: 4242 });
  const { jobId } = await scanned([...pair('Lighting/Lamp', 'moved', { archiveMd5: md5('same'), archiveSize: 4242 })]);
  const plan = await diff(jobId);
  assert.deepEqual(plan.models.map(m => [m.action, m.status]), [['NEW', 'NEEDS_REVIEW']]);
  const r = plan.reviews.find(x => x.kind === 'REMAP_CANDIDATE');
  assert.deepEqual([r.payload.previousModelId, r.payload.previousModel], [oldModel, 'Old model']);
  assert.deepEqual(plan.missing, [oldModel]);

  await pool.query('update model_files set md5_checksum=null, size_bytes=null where drive_file_id=$1', [old]);
  const plain = await diff(jobId);
  assert.deepEqual(plain.models.map(m => m.status), ['PUBLISHED']);
  assert.equal(plain.reviews.filter(x => x.kind === 'REMAP_CANDIDATE').length, 0);
});

test('reviews expose names and paths only: no Drive id appears anywhere in review payloads; fingerprints are stable across runs', { skip }, async () => {
  const entries = [{ id: nid(), path: 'A/B/a.jpg' }, { id: nid(), path: 'A/B/a.rar' }, { id: nid(), path: 'A/B/a.zip' }, { id: nid(), path: 'A/B/c.jpg' }];
  const { jobId, rows } = await scanned(entries);
  const p1 = await diff(jobId), p2 = await diff(jobId);
  const text = JSON.stringify(p1.reviews);
  for (const r of rows) assert.ok(!text.includes(r.id), 'a review payload leaks a Drive id');
  assert.deepEqual(p1.reviews.map(r => r.payload.fingerprint), p2.reviews.map(r => r.payload.fingerprint));
  assert.equal(new Set(p1.reviews.map(r => r.payload.fingerprint)).size, p1.reviews.length, 'distinct reviews, distinct fingerprints');
  assert.ok(p1.reviews.every(r => /^[0-9a-f]{64}$/.test(r.payload.fingerprint)));
});

test('shortcut and folder rows in the inventory are never treated as model files', { skip }, async () => {
  const { jobId } = await scanned([...pair('A/B', 'x'), { path: 'A/B/link-to-file.rar', shortcut: true }]);
  const plan = await diff(jobId);
  assert.equal(plan.models.length, 1);
  assert.equal(plan.reviews.length, 0);
});
