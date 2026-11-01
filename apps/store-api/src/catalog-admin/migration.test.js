// Migration 017 (chi app_settings, theo thoa thuan voi chu du an): mot dong duy nhat, tao khi luu lan dau; rollback tu choi khi da luu.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, migrate;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('catalog_admin_migration');
  ({ pool, migrate } = await import('../db.js'));
  await migrate();
});
after(async () => { if (dispose) await dispose(pool); });
const rollbackSql = readFileSync(new URL('../../migrations/rollback/017_app_settings.sql', import.meta.url), 'utf8');
const user = async () => (await pool.query("insert into users(email,password_hash) values($1,'x') returning id", [`${randomUUID()}@test.invalid`])).rows[0].id;
const rejects = (sql, params = []) => assert.rejects(pool.query(sql, params), (e) => ['23514', '23505', '23502', '23503'].includes(e.code), sql);

test('017: starts EMPTY (no row until the first save) so the worker keeps using the env price meanwhile', { skip }, async () => {
  assert.equal((await pool.query('select count(*)::int n from app_settings')).rows[0].n, 0);
});

test('017: defaults, singleton id=1, numeric ranges; text fields stay free-form (format is validated by the API)', { skip }, async () => {
  await pool.query('insert into app_settings(id) values (1)');
  const r = (await pool.query('select * from app_settings')).rows[0];
  assert.equal(r.default_model_price_vnd, 15000); assert.equal(r.order_ttl_minutes, 1440); assert.equal(r.max_pending_orders_per_device, 3);
  assert.equal(r.bank_name, null); assert.equal(r.account_no, null); assert.equal(r.updated_by, null);
  await rejects('insert into app_settings(id) values (2)');
  await rejects('insert into app_settings(id) values (1)');
  for (const set of ['default_model_price_vnd = -1', 'order_ttl_minutes = 0', 'max_pending_orders_per_device = 0', 'default_model_price_vnd = null'])
    await rejects(`update app_settings set ${set}`);
  await pool.query("update app_settings set default_model_price_vnd = 0, bank_bin = '970436', bank_name = 'Vietcombank'");
});

test('017: updated_by references a user and is cleared (not blocking) when that user is deleted', { skip }, async () => {
  const u = await user();
  await pool.query('update app_settings set updated_by = $1', [u]);
  await rejects('update app_settings set updated_by = $1', [randomUUID()]);
  await pool.query('delete from users where id = $1', [u]);
  assert.equal((await pool.query('select updated_by from app_settings')).rows[0].updated_by, null);
});

test('rollback 017 refuses once settings were saved, succeeds when empty, and the migration re-applies', { skip }, async () => {
  await assert.rejects(pool.query(rollbackSql), /Rollback refused/);
  assert.equal((await pool.query("select count(*)::int n from schema_migrations where name='017_app_settings.sql'")).rows[0].n, 1, 'refusal leaves the migration recorded');
  await pool.query('delete from app_settings');
  await pool.query(rollbackSql);
  assert.equal((await pool.query("select to_regclass('app_settings') as t")).rows[0].t, null);
  assert.equal((await pool.query("select count(*)::int n from schema_migrations where name='017_app_settings.sql'")).rows[0].n, 0);
  assert.deepEqual(await migrate(), ['017_app_settings.sql'], 're-applies cleanly');
  assert.equal((await pool.query('select count(*)::int n from app_settings')).rows[0].n, 0);
});
