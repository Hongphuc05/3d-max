import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, migrate;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_migration');
  ({ pool, migrate } = await import('../db.js'));
  await migrate();
});
after(async () => { if (dispose) await dispose(pool); });

const rollbackSql = n => readFileSync(new URL(`../../migrations/rollback/${n}.sql`, import.meta.url), 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');

async function source() {
  const c = (await pool.query(
    "insert into drive_connections(google_account_email,auth_kind,status,encrypted_refresh_token,token_iv,token_auth_tag) values($1,'OAUTH_USER','CONNECTED',$2,$3,$4) returning id",
    [`${randomUUID()}@test.invalid`, randomBytes(40), randomBytes(12), randomBytes(16)])).rows[0].id;
  return (await pool.query(
    "insert into drive_sources(connection_id,root_folder_id,root_folder_name,source_type) values($1,$2,'root','MY_DRIVE') returning id",
    [c, `root${randomBytes(8).toString('hex')}`])).rows[0].id;
}
const job = (sourceId, status = 'QUEUED', extra = '') =>
  pool.query(`insert into drive_sync_jobs(source_id,mode,status${extra ? ',' + extra.split('=')[0] : ''}) values($1,'FULL',$2${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [sourceId, status]);

test('015 jobs: status/stage/mode/counters are constrained, error_code is a classification only', { skip }, async () => {
  const s = await source();
  const bad = (sql, params) => assert.rejects(pool.query(sql, params), /check/i);
  await bad("insert into drive_sync_jobs(source_id,mode,status) values($1,'FULL','WHATEVER')", [s]);
  await bad("insert into drive_sync_jobs(source_id,mode,status) values($1,'SOMETIMES','QUEUED')", [s]);
  await bad("insert into drive_sync_jobs(source_id,mode,status,stage) values($1,'FULL','RUNNING','DANCING')", [s]);
  await bad("insert into drive_sync_jobs(source_id,mode,status,new_count) values($1,'FULL','COMPLETED',-1)", [s]);
  await bad("insert into drive_sync_jobs(source_id,mode,status,error_code) values($1,'FULL','FAILED','free text with a token')", [s]);
  const ok = (await job(s, 'COMPLETED')).rows[0].id;
  const row = (await pool.query('select scanned_files, bytes_downloaded, checkpoint, attempt, cancel_requested from drive_sync_jobs where id=$1', [ok])).rows[0];
  assert.deepEqual([row.scanned_files, Number(row.bytes_downloaded), row.attempt, row.cancel_requested], [0, 0, 0, false]);
  assert.deepEqual(row.checkpoint, {});
});

test('015 jobs: only ONE active job per source (QUEUED/RUNNING/CANCELLING), a finished job frees the slot', { skip }, async () => {
  const s = await source(), other = await source();
  const first = (await job(s, 'QUEUED')).rows[0].id;
  for (const st of ['QUEUED', 'RUNNING', 'CANCELLING']) await assert.rejects(job(s, st), /unique|duplicate/i, `second ${st} job`);
  await job(other, 'RUNNING'); // another source is independent
  await job(s, 'COMPLETED'); // history rows are unlimited
  await job(s, 'FAILED');
  await pool.query("update drive_sync_jobs set status='CANCELLED' where id=$1", [first]);
  await job(s, 'QUEUED'); // slot is free again
});

test('015 inventory + items: unique per source/file and per job/file/action; deleting a source cascades', { skip }, async () => {
  const s = await source();
  const j = (await job(s, 'RUNNING')).rows[0].id;
  const inv = (id, over = '') => pool.query(
    `insert into drive_inventory(source_id,drive_file_id,parent_drive_id,path,filename,mime_type,is_folder,last_seen_job_id) values($1,$2,'p','A/B','x.jpg','image/jpeg',false,$3)${over}`, [s, id, j]);
  await inv('file00000001');
  await assert.rejects(inv('file00000001'), /unique|duplicate/i);
  await pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status) values($1,'f1','SCAN','PENDING')", [j]);
  await assert.rejects(pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status) values($1,'f1','SCAN','DONE')", [j]), /unique|duplicate/i);
  await pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status) values($1,'f1','PREVIEW','PENDING')", [j]); // other action is fine
  await assert.rejects(pool.query("insert into drive_sync_job_items(job_id,drive_file_id,action,status) values($1,'f2','DANCE','PENDING')", [j]), /check/i);
  await pool.query('delete from drive_sources where id=$1', [s]);
  const count = (table, col, id) => pool.query(`select count(*)::int n from ${table} where ${col}=$1`, [id]).then(r => r.rows[0].n);
  assert.equal(await count('drive_sync_jobs', 'id', j), 0);
  assert.equal(await count('drive_inventory', 'source_id', s), 0);
  assert.equal(await count('drive_sync_job_items', 'job_id', j), 0);
});

const category = (path, parent = null) => pool.query(
  'insert into categories(parent_id,name,slug,full_path) values($1,$2,$3,$4) returning id', [parent, path.split(' / ').pop(), path.toLowerCase().replace(/\W+/g, '-'), path]);
const model = (cat, over = {}) => pool.query(
  'insert into models(category_id,name,status,price_vnd,legacy_id) values($1,$2,$3,$4,$5) returning id',
  [cat, over.name ?? 'Model', over.status ?? 'DRAFT', over.price ?? 15000, over.legacy ?? null]);

test('016 catalog: category path unique, model status/price/legacy_id constrained, singleton catalog_state exists', { skip }, async () => {
  const parent = (await category('Furniture')).rows[0].id;
  const child = (await category('Furniture / Desk', parent)).rows[0].id;
  await assert.rejects(category('Furniture / Desk', parent), /unique|duplicate/i);
  await assert.rejects(model(child, { status: 'LIVE' }), /check/i);
  await assert.rejects(model(child, { price: -1 }), /check/i);
  await assert.rejects(model(child, { name: '' }), /check/i);
  await model(child, { legacy: '036-bbq' });
  await assert.rejects(model(child, { legacy: '036-bbq' }), /unique|duplicate/i);
  await assert.rejects(model(randomUUID()), /foreign key/i, 'category must exist');
  const st = (await pool.query('select id, active_version, manifest_checksum from catalog_state')).rows;
  assert.deepEqual(st.map(r => [r.id, Number(r.active_version), r.manifest_checksum]), [[1, 0, null]]);
  await assert.rejects(pool.query('insert into catalog_state(id,active_version) values(2,1)'), /check/i);
});

test('016 files/previews: hash format, one primary preview per model+variant, primary_file_id may be set in the same transaction', { skip }, async () => {
  const s = await source();
  const m = (await model((await category('Lighting')).rows[0].id)).rows[0].id;
  const file = (id, over = {}) => pool.query(
    "insert into model_files(model_id,source_id,drive_file_id,filename,file_type,size_bytes,md5_checksum,sha256) values($1,$2,$3,'a.rar',$4,10,$5,$6) returning id",
    [m, s, id, over.type ?? 'rar', over.md5 ?? null, over.sha ?? null]);
  const f = (await file('driveFile0001')).rows[0].id;
  await assert.rejects(file('driveFile0001'), /unique|duplicate/i);
  await assert.rejects(file('driveFile0002', { type: 'exe' }), /check/i);
  await assert.rejects(file('driveFile0003', { sha: 'NOT-A-HASH' }), /check/i);
  await assert.rejects(file('driveFile0004', { md5: 'zz' }), /check/i);
  await file('driveFile0005', { sha: sha('x'), md5: 'a'.repeat(32) });

  const prev = (variant, primary, h = sha(randomUUID())) => pool.query(
    "insert into model_previews(model_id,source,source_drive_file_id,local_path,sha256,file_size,width,height,variant,is_primary) values($1,'DRIVE_IMAGE','img1',$2,$3,100,480,320,$4,$5)",
    [m, `${h}.webp`, h, variant, primary]);
  await prev('sm', true);
  await assert.rejects(prev('sm', true), /unique|duplicate/i, 'two primary sm');
  await prev('sm', false);
  await prev('lg', true); // other variant has its own primary
  await assert.rejects(prev('xl', false), /check/i);
  await assert.rejects(pool.query("insert into model_previews(model_id,source,local_path,sha256,file_size,width,height,variant) values($1,'DRIVE_IMAGE','same.webp','ab',1,1,1,'sm')", [m]), /check/i, 'sha256 format');

  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('update models set primary_file_id=$1 where id=$2', [f, m]);
    await c.query('commit');
  } finally { c.release(); }
  await assert.rejects(pool.query('update models set primary_file_id=$1 where id=$2', [randomUUID(), m]), /foreign key/i);

  // publish writes both rows in one transaction: the model points at a file that does not exist yet
  const cat = (await category('Decoration')).rows[0].id;
  const [newModel, newFile] = [randomUUID(), randomUUID()];
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    await tx.query("insert into models(id,category_id,name,status,price_vnd,primary_file_id) values($1,$2,'Both','DRAFT',1,$3)", [newModel, cat, newFile]);
    await tx.query("insert into model_files(id,model_id,source_id,drive_file_id,filename,file_type) values($1,$2,$3,'driveFile0099','b.zip','zip')", [newFile, newModel, s]);
    await tx.query('commit');
  } catch (e) { await tx.query('rollback'); throw e; } finally { tx.release(); }
  assert.equal((await pool.query('select primary_file_id from models where id=$1', [newModel])).rows[0].primary_file_id, newFile);
});

test('016 review_items: kind/status constrained', { skip }, async () => {
  const s = await source();
  const ins = (kind, status = 'OPEN') => pool.query("insert into review_items(source_id,kind,payload,status) values($1,$2,'{\"path\":\"A/B\"}',$3)", [s, kind, status]);
  for (const k of ['AMBIGUOUS_PAIR', 'ORPHAN_IMAGE', 'ORPHAN_MODEL', 'SUGGESTED_PAIR', 'REMAP_CANDIDATE', 'PREVIEW_IN_ARCHIVE']) await ins(k);
  await assert.rejects(ins('SOMETHING'), /check/i);
  await assert.rejects(ins('ORPHAN_IMAGE', 'MAYBE'), /check/i);
});

test('018 audit_events: actor kind constrained, details defaults to an object', { skip }, async () => {
  const ins = kind => pool.query("insert into audit_events(actor_kind,action,target_type) values($1,'SYNC_STARTED','drive_sync_job') returning details", [kind]);
  for (const k of ['ADMIN', 'TELEGRAM_OWNER', 'SYSTEM']) assert.deepEqual((await ins(k)).rows[0].details, {});
  await assert.rejects(ins('ROBOT'), /check/i);
});

test('rollbacks 018 -> 016 -> 015: refuse while data exists, succeed (in dependency order) when empty, migrations re-apply', { skip }, async () => {
  const c = await pool.connect();
  const refuses = async name => {
    await assert.rejects(c.query(rollbackSql(name)), /Rollback refused/, name);
    await c.query('rollback');
  };
  try {
    // data exists in every table from the tests above
    await refuses('018_download_audit');
    await refuses('016_catalog');
    await refuses('015_drive_sync_jobs');

    // wrong order is impossible: 015 cannot go while 016 still references jobs
    await c.query('delete from audit_events');
    await c.query(rollbackSql('018_download_audit'));
    await assert.rejects(c.query(rollbackSql('015_drive_sync_jobs')), /./);
    await c.query('rollback');

    for (const t of ['review_items', 'model_previews', 'model_files', 'models', 'categories']) await c.query(`delete from ${t}`);
    await c.query(rollbackSql('016_catalog'));
    for (const t of ['drive_sync_job_items', 'drive_inventory', 'drive_sync_jobs']) await c.query(`delete from ${t}`);
    await c.query(rollbackSql('015_drive_sync_jobs'));
    for (const t of ['catalog_state', 'models', 'drive_sync_jobs', 'audit_events']) {
      assert.equal((await c.query('select to_regclass($1) is null as gone', [t])).rows[0].gone, true, t);
    }
    assert.equal((await c.query("select to_regclass('drive_sources') is not null as kept")).rows[0].kept, true, '014 untouched');
  } finally { c.release(); }
  assert.deepEqual(await migrate(), ['015_drive_sync_jobs.sql', '016_catalog.sql', '018_download_audit.sql']);
});
