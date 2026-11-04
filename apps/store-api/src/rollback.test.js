// P6 (plan §10.2 buoc 3): chay rollback/*.sql an toan - chi migration MOI NHAT, ten phai dung dang, file rollback tu tu choi khi co du lieu.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from './test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, rollbackMigration;
const tables = async () => (await pool.query("select table_name from information_schema.tables where table_schema = current_schema()")).rows.map((r) => r.table_name);
const applied = async () => (await pool.query('select name from schema_migrations order by name desc')).rows.map((r) => r.name);

before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('rollback');
  const db = await import('./db.js');
  pool = db.pool; await db.migrate();
  ({ rollbackMigration } = await import('./rollback.js'));
});
after(async () => { if (dispose) await dispose(pool); });
// 023 va 024 xoa bang/cot cu va khong the rollback: de cac test duoi day van thu rollback 022, ta tam coi chung la chua ap dung
// (chi xoa dong ghi nhan; KHONG chay lai migrate() vi 024 khong chay lai duoc tren schema da don).
const hideIrreversible = () => pool.query("delete from schema_migrations where name in ('023_drop_legacy_tables.sql', '024_library_license.sql')");

test('024 (library license) is irreversible: rollback refuses and stays applied; so does 023 once 024 is out of the way', { skip }, async () => {
  assert.equal((await applied())[0], '024_library_license.sql');
  await assert.rejects(rollbackMigration(pool, '024_library_license.sql'), (e) => e.code === 'ROLLBACK_REFUSED' && /irreversibly/.test(e.message));
  assert.equal((await applied())[0], '024_library_license.sql');
  await pool.query("delete from schema_migrations where name = '024_library_license.sql'");
  await assert.rejects(rollbackMigration(pool, '023_drop_legacy_tables.sql'), (e) => e.code === 'ROLLBACK_REFUSED' && /irreversibly/.test(e.message));
  await hideIrreversible();
});

test('bad names are refused before anything is read or run (path traversal, wrong shape, unknown)', { skip }, async () => {
  const latest = (await applied())[0];
  for (const name of ['', '../../etc/passwd', '022_model_downloads', '022_model_downloads.sql ', '022 model.sql', 'rollback/022_model_downloads.sql', '..\\022_model_downloads.sql', null, undefined, 5, ['022_model_downloads.sql'], { toString: () => '022_model_downloads.sql' }])
    await assert.rejects(rollbackMigration(pool, name), (e) => e.code === 'INVALID_MIGRATION_NAME', String(name));
  await assert.rejects(rollbackMigration(pool, '999_nothing.sql'), (e) => e.code === 'NO_ROLLBACK_FILE');
  assert.equal((await applied())[0], latest, 'nothing changed');
});

test('only the most recently applied migration can be rolled back', { skip }, async () => {
  const [latest, older] = await applied();
  assert.equal(latest, '022_model_downloads.sql');
  await assert.rejects(rollbackMigration(pool, older), (e) => e.code === 'NOT_LATEST');
  assert.ok((await tables()).includes('model_download_sessions'), 'older rollback did not run');
});

test('rolling back the latest migration drops its tables and forgets it; the next one becomes the latest; migrating again restores it', { skip }, async () => {
  await rollbackMigration(pool, '022_model_downloads.sql');
  assert.ok(!(await tables()).includes('model_download_sessions') && !(await tables()).includes('model_download_logs'));
  assert.equal((await applied())[0], '021_devices_entitlements_orders.sql');
  await assert.rejects(rollbackMigration(pool, '022_model_downloads.sql'), (e) => e.code === 'NOT_LATEST', 'already rolled back');
  await pool.query(readFileSync(new URL('../migrations/022_model_downloads.sql', import.meta.url), 'utf8')); // migrate() would re-run 023/024 too
  await pool.query("insert into schema_migrations(name) values ('022_model_downloads.sql')");
  assert.ok((await tables()).includes('model_download_logs'));
});

test('a rollback that would destroy data refuses, leaves everything in place, and says why', { skip }, async () => {
  const cat = (await pool.query("insert into categories(name,slug,full_path) values('Living','living','Living') returning id")).rows[0].id;
  const model = (await pool.query("insert into models(category_id,name,status,published_at) values ($1,'M','PUBLISHED',now()) returning id", [cat])).rows[0].id;
  const device = (await pool.query("insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'SOFTWARE',$3,'PC') returning id", [randomUUID(), createHash('sha256').update(randomUUID()).digest(), `MAX-${'CD'.repeat(32)}`])).rows[0].id;
  const session = (await pool.query("insert into model_download_sessions(token_hash,model_id,device_id,expires_at) values ($1,$2,$3,now()+interval '4 minutes') returning id", [createHash('sha256').update(randomUUID()).digest(), model, device])).rows[0].id;
  await pool.query("insert into model_download_logs(session_id,model_id,device_id,status,bytes_sent) values ($1,$2,$3,'COMPLETED',100)", [session, model, device]);
  await assert.rejects(rollbackMigration(pool, '022_model_downloads.sql'), (e) => e.code === 'ROLLBACK_REFUSED' && /download logs/.test(e.message));
  assert.equal((await applied())[0], '022_model_downloads.sql', 'still recorded as applied');
  assert.equal((await pool.query('select count(*)::int n from model_download_logs')).rows[0].n, 1, 'data intact');
  assert.ok(await pool.query('select 1').then(() => true), 'the pool is still usable (no half-open transaction)');
});
