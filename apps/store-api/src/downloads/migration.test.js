// Migration 022 (P4.2): phien tai model + nhat ky tai (v3-database.md §3.5). PostgreSQL that.
// Lech so voi plan: plan ghi 018, nhung 018 da dung cho audit_events nen la 022 (sau 021 thiet bi/quyen).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, migrate, catId;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('downloads_migration');
  ({ pool, migrate } = await import('../db.js'));
  await migrate();
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Sofa','sofa','Living / Sofa') returning id")).rows[0].id;
});
after(async () => { if (dispose) await dispose(pool); });
const rollbackSql = readFileSync(new URL('../../migrations/rollback/022_model_downloads.sql', import.meta.url), 'utf8');
const sha = (s) => createHash('sha256').update(String(s)).digest();
const machine = () => `MAX-${randomBytes(32).toString('hex').toUpperCase()}`;
const device = async () => (await pool.query(
  "insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,'{}',$2,'TPM',$3,'PC') returning id",
  [randomUUID(), sha(randomUUID()), machine()])).rows[0].id;
const model = async () => (await pool.query("insert into models(category_id,name,status) values($1,$2,'PUBLISHED') returning id", [catId, `m-${randomUUID()}`])).rows[0].id;
const session = async (deviceId, modelId, over = {}) => (await pool.query(
  `insert into model_download_sessions(token_hash, model_id, device_id, entitlement_id, status, expires_at, started_at, finished_at)
   values ($1,$2,$3,$4,$5, now() + ($6 * interval '1 second'), $7, $8) returning *`,
  [over.hash ?? sha(randomUUID()), modelId, deviceId, over.entitlement ?? null, over.status ?? 'CREATED', over.seconds ?? 300,
    over.started ?? null, over.finished ?? null])).rows[0];
const code = (e) => e.code;

test('022 sessions: token hash unique and 32 bytes; status set; expiry within 5 minutes; started/finished consistent with status', { skip }, async () => {
  const d = await device(), m = await model();
  const s = await session(d, m);
  assert.equal(s.status, 'CREATED'); assert.ok(s.created_at);
  await assert.rejects(session(d, m, { hash: s.token_hash }), (e) => code(e) === '23505', 'token hash unique');
  await assert.rejects(session(d, m, { hash: Buffer.alloc(31) }), (e) => code(e) === '23514');
  await assert.rejects(session(d, m, { status: 'DONE' }), (e) => code(e) === '23514');
  await assert.rejects(session(d, m, { seconds: 301 }), (e) => code(e) === '23514', 'a session may wait at most 5 minutes to start');
  await assert.rejects(session(d, m, { status: 'STREAMING' }), (e) => code(e) === '23514', 'STREAMING needs started_at');
  await assert.rejects(session(d, m, { status: 'COMPLETED', started: new Date() }), (e) => code(e) === '23514', 'COMPLETED needs finished_at');
  await assert.rejects(session(d, m, { status: 'FAILED' }), (e) => code(e) === '23514', 'FAILED needs finished_at');
  await session(d, m, { status: 'STREAMING', started: new Date() });
  await session(d, m, { status: 'COMPLETED', started: new Date(), finished: new Date() });
  await session(d, m, { status: 'EXPIRED' });
});

test('022 sessions: references are enforced; a model with sessions cannot be deleted; deleting a device removes its sessions; entitlement may go (set null)', { skip }, async () => {
  const d = await device(), m = await model();
  await assert.rejects(session(randomUUID(), m), (e) => code(e) === '23503');
  await assert.rejects(session(d, randomUUID()), (e) => code(e) === '23503');
  const ent = (await pool.query("insert into entitlements(device_id,source) values ($1,'ADMIN') returning id", [d])).rows[0].id;
  const s = await session(d, m, { entitlement: ent });
  await pool.query('delete from entitlements where id=$1', [ent]);
  assert.equal((await pool.query('select entitlement_id from model_download_sessions where id=$1', [s.id])).rows[0].entitlement_id, null);
  await assert.rejects(pool.query('delete from models where id=$1', [m]), (e) => code(e) === '23503');
  await pool.query('delete from devices where id=$1', [d]);
  assert.equal((await pool.query('select count(*)::int n from model_download_sessions where id=$1', [s.id])).rows[0].n, 0);
});

test('022 logs: bytes >= 0, status and error code constrained, cascade from session, per-device index exists for the rate limit', { skip }, async () => {
  const d = await device(), m = await model(), s = await session(d, m);
  const log = (over = {}) => pool.query(
    'insert into model_download_logs(session_id, model_id, device_id, bytes_sent, status, error_code) values ($1,$2,$3,$4,$5,$6) returning *',
    [over.session ?? s.id, m, d, over.bytes ?? 0, over.status ?? 'COMPLETED', over.error ?? null]);
  const row = (await log({ bytes: 5_000_000_000 })).rows[0];
  assert.equal(row.bytes_sent, '5000000000'); assert.ok(row.created_at);
  await log({ status: 'FAILED', error: 'STORAGE_DOWNLOAD_FAILED' });
  await assert.rejects(log({ bytes: -1 }), (e) => code(e) === '23514');
  await assert.rejects(log({ status: 'OK' }), (e) => code(e) === '23514');
  await assert.rejects(log({ error: 'free text with spaces' }), (e) => code(e) === '23514', 'error codes only, never provider text');
  await assert.rejects(log({ session: randomUUID() }), (e) => code(e) === '23503');
  const idx = (await pool.query("select indexdef from pg_indexes where tablename='model_download_logs'")).rows.map((r) => r.indexdef).join('\n');
  assert.match(idx, /\(device_id, created_at\)/);
  await pool.query('delete from model_download_sessions where id=$1', [s.id]);
  assert.equal((await pool.query('select count(*)::int n from model_download_logs where session_id=$1', [s.id])).rows[0].n, 0);
});

test('022 rollback refuses while download logs exist, succeeds when empty, and the migration re-applies', { skip }, async () => {
  await pool.query('delete from model_download_logs'); await pool.query('delete from model_download_sessions');
  const d = await device(), m = await model(), s = await session(d, m);
  await pool.query("insert into model_download_logs(session_id, model_id, device_id, status) values ($1,$2,$3,'COMPLETED')", [s.id, m, d]);
  const client = await pool.connect();
  try {
    await assert.rejects(client.query(rollbackSql), /Rollback refused/);
    await client.query('rollback');
    assert.equal((await client.query('select count(*)::int n from model_download_logs')).rows[0].n, 1);
    await client.query('delete from model_download_logs');
    await client.query(rollbackSql);
    assert.equal((await client.query("select to_regclass('model_download_sessions') is null as gone")).rows[0].gone, true);
    assert.equal((await client.query("select to_regclass('devices') is not null as kept")).rows[0].kept, true);
  } finally { client.release(); }
  assert.deepEqual(await migrate(), ['022_model_downloads.sql']);
});
