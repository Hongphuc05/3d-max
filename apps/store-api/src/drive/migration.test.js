import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, migrate;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('drive_migration');
  ({ pool, migrate } = await import('../db.js'));
  await migrate();
});
after(async () => { if (dispose) await dispose(pool); });
const rollback = () => readFileSync(new URL('../../migrations/rollback/014_drive_connections.sql', import.meta.url), 'utf8');
const conn = (over = {}) => ({ email: `${randomUUID()}@test.invalid`, kind: 'OAUTH_USER', status: 'CONNECTED', ct: randomBytes(40), iv: randomBytes(12), tag: randomBytes(16), ...over });
const insert = c => pool.query(
  'insert into drive_connections(google_account_email,auth_kind,status,encrypted_refresh_token,token_iv,token_auth_tag) values($1,$2,$3,$4,$5,$6) returning id',
  [c.email, c.kind, c.status, c.ct, c.iv, c.tag]);

test('schema constraints: token triple is all-or-nothing, IV/tag sizes, OAuth needs a token, valid status, one row per account', { skip }, async () => {
  const good = conn(); await insert(good);
  await assert.rejects(insert(conn({ iv: randomBytes(11) })), /check/i);
  await assert.rejects(insert(conn({ tag: randomBytes(15) })), /check/i);
  await assert.rejects(insert(conn({ ct: null, iv: null, tag: null })), /check/i, 'OAUTH_USER without a token');
  await assert.rejects(insert(conn({ ct: randomBytes(8), iv: null })), /check/i, 'ciphertext without IV');
  await assert.rejects(insert(conn({ status: 'WHATEVER' })), /check/i);
  await assert.rejects(insert(conn({ email: good.email.toUpperCase() })), /unique|duplicate/i, 'same account, different case');
  await insert(conn({ kind: 'SERVICE_ACCOUNT', ct: null, iv: null, tag: null })); // service accounts need no refresh token
  await assert.rejects(pool.query("update drive_connections set last_error_code='free text with spaces and a token' where id=(select id from drive_connections limit 1)"), /check/i,
    'error column accepts classification codes only, never provider text');
});

test('drive_sources: folder id charset enforced; deleting a connection cascades to its sources', { skip }, async () => {
  const id = (await insert(conn())).rows[0].id;
  const src = f => pool.query("insert into drive_sources(connection_id,root_folder_id,root_folder_name,source_type) values($1,$2,'n','MY_DRIVE')", [id, f]);
  await assert.rejects(src("x' or '1'='1"), /check/i);
  await assert.rejects(src('short'), /check/i);
  await src('validFolderId01');
  await assert.rejects(src('validFolderId01'), /unique|duplicate/i);
  await pool.query('delete from drive_connections where id=$1', [id]);
  assert.equal((await pool.query('select count(*)::int n from drive_sources')).rows[0].n, 0);
});

test('rollback 014 refuses while connections exist, succeeds when empty, and the migration re-applies', { skip }, async () => {
  await pool.query('delete from drive_connections');
  await insert(conn());
  const client = await pool.connect();
  try {
    await assert.rejects(client.query(rollback()), /Rollback refused/);
    await client.query('rollback');
    assert.equal((await client.query('select count(*)::int n from drive_connections')).rows[0].n, 1);
    await client.query('delete from drive_connections');
    // later migrations (021, 020, 019, 018, 016, 015) depend on 014 (021 on models from 016) and must go first; they are empty here
    for (const n of ['022_model_downloads', '021_devices_entitlements_orders', '020_preview_shared_files', '019_drive_source_api_key', '018_download_audit', '016_catalog', '015_drive_sync_jobs']) {
      await client.query(readFileSync(new URL(`../../migrations/rollback/${n}.sql`, import.meta.url), 'utf8'));
    }
    await client.query(rollback());
    assert.equal((await client.query("select to_regclass('drive_connections') is null as gone")).rows[0].gone, true);
    assert.equal((await client.query("select to_regclass('users') is not null as kept")).rows[0].kept, true);
  } finally { client.release(); }
  assert.deepEqual(await migrate(), ['014_drive_connections.sql', '015_drive_sync_jobs.sql', '016_catalog.sql', '018_download_audit.sql', '019_drive_source_api_key.sql', '020_preview_shared_files.sql', '021_devices_entitlements_orders.sql', '022_model_downloads.sql']);
});
