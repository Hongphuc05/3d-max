// Migration 021 (P4.1): thiet bi, thu thach, token, quyen, don hang. Ten khac plan o 2 bang trung ten bang cu:
// device_challenges -> device_auth_challenges, orders -> purchase_orders (order_items -> purchase_order_items). PostgreSQL that.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, migrate, catId;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('devices_migration');
  ({ pool, migrate } = await import('../db.js'));
  await migrate();
  catId = (await pool.query("insert into categories(name,slug,full_path) values('Sofa','sofa','Living / Sofa') returning id")).rows[0].id;
});
after(async () => { if (dispose) await dispose(pool); });
const sha = (s) => createHash('sha256').update(String(s)).digest();
const machine = () => `MAX-${randomBytes(32).toString('hex').toUpperCase()}`;
const fails = (sql, params = []) => assert.rejects(pool.query(sql, params), (e) => ['23514', '23505', '23502', '23503', 'P0001'].includes(e.code), sql);
const device = async (over = {}) => (await pool.query(
  `insert into devices(device_uuid, public_key, public_key_hash, key_protection, machine_code, device_name, status)
   values ($1,$2,$3,$4,$5,$6,$7) returning *`,
  [over.uuid ?? randomUUID(), over.key ?? '{"kty":"RSA"}', over.hash ?? sha(randomUUID()), over.protection ?? 'TPM', over.machine ?? machine(), over.name ?? 'PC', over.status ?? 'ACTIVE'])).rows[0];
const model = async (name = 'm') => (await pool.query("insert into models(category_id,name,status) values($1,$2,'PUBLISHED') returning id", [catId, name])).rows[0].id;
const order = async (deviceId, over = {}) => (await pool.query(
  "insert into purchase_orders(code, device_id, amount_vnd, status, expires_at, bank_snapshot) values ($1,$2,$3,$4, now() + interval '1 day', '{}'::jsonb) returning *",
  [over.code ?? `3DM${randomBytes(3).toString('hex').toUpperCase()}`, deviceId, over.amount ?? 15000, over.status ?? 'PENDING_PAYMENT'])).rows[0];

test('021 devices: format and uniqueness rules; defaults to ACTIVE', { skip }, async () => {
  const d = await device();
  assert.equal(d.status, 'ACTIVE'); assert.ok(d.first_seen_at && d.last_seen_at);
  await fails('insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,$2,$3,$4,$5,$6)', [d.device_uuid, '{}', sha('x'), 'TPM', machine(), 'dup uuid']);
  await fails('insert into devices(device_uuid,public_key,public_key_hash,key_protection,machine_code,device_name) values ($1,$2,$3,$4,$5,$6)', [randomUUID(), '{}', d.public_key_hash, 'TPM', machine(), 'dup key']);
  for (const bad of [{ protection: 'USB' }, { machine: 'MAX-abc' }, { machine: `max-${'A'.repeat(64)}` }, { machine: `MAX-${'g'.repeat(64)}` }, { status: 'DELETED' }, { hash: Buffer.alloc(31) }])
    await assert.rejects(device(bad), (e) => e.code === '23514', JSON.stringify(Object.keys(bad)));
  await device({ machine: d.machine_code }); // machine_code la NHAN, khong duy nhat
});

test('021 devices: identity (uuid, key, key hash) can never be changed; name, machine label, status and last_seen can', { skip }, async () => {
  const d = await device();
  for (const set of ['device_uuid = gen_random_uuid()', "public_key = '{}'", "public_key_hash = decode(repeat('ab',32),'hex')"])
    await assert.rejects(pool.query(`update devices set ${set} where id = $1`, [d.id]), /immutable|identity/i, set);
  await pool.query("update devices set device_name='New', status='BLOCKED', last_seen_at=now(), machine_code=$2 where id=$1", [d.id, machine()]);
  assert.equal((await pool.query('select status from devices where id=$1', [d.id])).rows[0].status, 'BLOCKED');
});

test('021 challenges: expiry within 2 minutes, one-time (consumed_at), format-checked', { skip }, async () => {
  const ins = (over = {}) => pool.query(
    `insert into device_auth_challenges(id, device_uuid, public_key, public_key_hash, key_protection, machine_code, device_name, message, expires_at)
     values ($1,$2,'{}',$3,$4,$5,'PC','msg', now() + ($6 * interval '1 second')) returning *`,
    [randomUUID(), randomUUID(), sha('k'), over.protection ?? 'TPM', over.machine ?? machine(), over.seconds ?? 120]);
  const c = (await ins()).rows[0];
  assert.equal(c.consumed_at, null);
  await assert.rejects(ins({ seconds: 600 }), (e) => e.code === '23514', 'a challenge may not live longer than 2 minutes');
  await assert.rejects(ins({ protection: 'X' }), (e) => e.code === '23514');
  await assert.rejects(ins({ machine: 'nope' }), (e) => e.code === '23514');
});

test('021 tokens: stored as a 32-byte hash, 15-minute cap, cascade with the device', { skip }, async () => {
  const d = await device();
  const ins = (hash, minutes) => pool.query("insert into device_tokens(id, device_id, expires_at) values ($1,$2, now() + ($3 * interval '1 minute'))", [hash, d.id, minutes]);
  await ins(sha('t1'), 15);
  await assert.rejects(ins(sha('t2'), 16), (e) => e.code === '23514', 'TTL cap');
  await assert.rejects(ins(Buffer.alloc(31), 5), (e) => e.code === '23514', 'must be a sha256 digest');
  await assert.rejects(ins(sha('t1'), 5), (e) => e.code === '23505');
  await pool.query('delete from devices where id = $1', [d.id]);
  assert.equal((await pool.query('select count(*)::int n from device_tokens')).rows[0].n, 0);
});

test('024 entitlements: one license per device (library-wide); source ORDER/ADMIN; a revoked license can be granted again', { skip }, async () => {
  const d = await device();
  const grant = (source) => pool.query('insert into entitlements(device_id, source) values ($1,$2) returning *', [d.id, source]);
  await grant('ORDER');
  await fails("insert into entitlements(device_id,source) values ($1,'ADMIN')", [d.id]);        // 1 license = 1 may
  await fails("insert into entitlements(device_id,source) values ($1,'GIFT')", [(await device()).id]);
  await fails("insert into entitlements(device_id,source) values ($1,'MXL1')", [(await device()).id]);
  await pool.query('update entitlements set revoked_at = now() where device_id=$1', [d.id]);
  await grant('ADMIN');
  assert.equal((await pool.query('select count(*)::int n from entitlements where device_id=$1', [d.id])).rows[0].n, 2);
});

test('021 purchase orders: status/code rules, snapshot required', { skip }, async () => {
  const d = await device();
  const o = await order(d.id, { code: '3DMAAA111' });
  await fails("insert into purchase_orders(code,device_id,amount_vnd,status,expires_at,bank_snapshot) values ('3DMAAA111',$1,1,'PENDING_PAYMENT',now(),'{}')", [d.id]);
  await fails("insert into purchase_orders(code,device_id,amount_vnd,status,expires_at,bank_snapshot) values ('ORD-PAID',$1,1,'PAID',now(),'{}')", [d.id]);
  await fails("insert into purchase_orders(code,device_id,amount_vnd,status,expires_at,bank_snapshot) values ('ORD-NEG',$1,-1,'PENDING_PAYMENT',now(),'{}')", [d.id]);
  await fails("insert into purchase_orders(code,device_id,amount_vnd,status,expires_at) values ('ORD-NOSNAP',$1,1,'PENDING_PAYMENT',now())", [d.id]);
  await fails("insert into purchase_orders(code,device_id,amount_vnd,status,expires_at,bank_snapshot) values ('AB',$1,1,'PENDING_PAYMENT',now(),'{}')", [d.id]);   // ma qua ngan
  for (const status of ['PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED']) await order(d.id, { status });
  await pool.query('delete from purchase_orders where id=$1', [o.id]);
});
