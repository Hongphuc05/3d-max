import { timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';
import { generateLicenseKey, hashLicenseKey, encryptLicenseKey, decryptLicenseKey } from './crypto.js';
import { licenseError, uuid } from './errors.js';

export async function inTransaction(operation, existingClient = null) {
  if (existingClient) return operation(existingClient);
  const client = await pool.connect();
  let connectionFailure;
  const onConnectionError = error => { connectionFailure = error; };
  client.on('error', onConnectionError);
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release(connectionFailure);
    client.removeListener('error', onConnectionError);
  }
}

export async function audit(client, actorUserId, licenseId, event, details = {}) {
  await client.query(`insert into license_audit_logs (actor_user_id,license_id,event_type,details)
    values ($1,$2,$3,$4)`, [actorUserId, licenseId, event, JSON.stringify(details)]);
}

// Caller-supplied client MUST already have an open transaction. Lock users before
// orders/licenses in payment flows. Return a raw DB row, including an existing row.
export async function issueLifetimeLicense(userId, orderId = null, client = null) {
  const owner = uuid(userId, 'INVALID_USER_ID');
  const order = orderId === null ? null : uuid(orderId, 'INVALID_ORDER_ID');
  return inTransaction(async db => {
    const user = await db.query('select id from users where id=$1 for update', [owner]);
    if (!user.rows.length) throw licenseError('USER_NOT_FOUND', 404);
    const existing = await getLicenseByAccount(owner, db);
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const key = generateLicenseKey();
      const encrypted = encryptLicenseKey(key, owner);
      // ON CONFLICT avoids poisoning a caller's payment transaction on key collision.
      const result = await db.query(`insert into licenses
        (user_id,order_id,key_hash,key_ciphertext,key_iv,key_auth_tag,key_last4)
        values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning *`,
      [owner, order, hashLicenseKey(key), encrypted.key_ciphertext, encrypted.key_iv, encrypted.key_auth_tag, key.slice(-4)]);
      if (result.rows[0]) {
        await audit(db, owner, result.rows[0].id, 'LICENSE_ISSUED', { orderId: order });
        return result.rows[0];
      }
      const raced = await getLicenseByAccount(owner, db);
      if (raced) return raced;
    }
    throw licenseError('LICENSE_ISSUANCE_FAILED', 503);
  }, client);
}

export async function getLicenseByAccount(userId, db = pool) {
  return (await db.query('select * from licenses where user_id=$1', [uuid(userId, 'INVALID_USER_ID')])).rows[0] || null;
}

export function requireActiveLicense(row) {
  if (!row) throw licenseError('LICENSE_REQUIRED', 403);
  if (row.status !== 'ACTIVE') throw licenseError(`LICENSE_${row.status}`, 403);
  return row;
}

export function assertOwnership(row, licenseKey) {
  const wanted = hashLicenseKey(licenseKey);
  if (!row || !timingSafeEqual(row.key_hash, wanted)) throw licenseError('INVALID_LICENSE_KEY', 403);
  return requireActiveLicense(row);
}

export async function verifyLicenseOwnership(userId, licenseKey, db = pool) {
  return assertOwnership(await getLicenseByAccount(userId, db), licenseKey);
}

export function publicLicense(row, { includeKey = false } = {}) {
  if (!row) return null;
  return {
    id: row.id, type: row.license_type, status: row.status,
    ...(includeKey ? { key: decryptLicenseKey(row, row.user_id) } : {}),
    last4: row.key_last4, issuedAt: row.issued_at,
  };
}

export function publicDevice(row) {
  return {
    id: row.id, deviceId: row.device_id, slotNumber: row.slot_number,
    deviceName: row.device_name, keyProtection: row.key_protection,
    activatedAt: row.activated_at, lastSeenAt: row.last_seen_at,
  };
}

export async function getActivatedDevices(userId) {
  const { rows } = await pool.query(`select d.* from license_devices d join licenses l on l.id=d.license_id
    where l.user_id=$1 order by d.slot_number`, [uuid(userId, 'INVALID_USER_ID')]);
  return rows.map(publicDevice);
}

export async function revokeLicense(userId, actorUserId, status = 'REVOKED', reason = '') {
  if (!['REVOKED', 'SUSPENDED'].includes(status)) throw licenseError('INVALID_LICENSE_STATUS');
  if (typeof reason !== 'string' || reason.length > 500) throw licenseError('INVALID_REASON');
  return inTransaction(async db => {
    const row = (await db.query('select * from licenses where user_id=$1 for update', [uuid(userId)])).rows[0];
    if (!row) throw licenseError('LICENSE_NOT_FOUND', 404);
    if (row.status === 'REVOKED') return row;
    const result = (await db.query(`update licenses set status=$2,
      revoked_at=case when $2='REVOKED' then now() else null end where id=$1 returning *`, [row.id, status])).rows[0];
    await db.query('delete from device_sessions where license_id=$1', [row.id]);
    await audit(db, uuid(actorUserId), row.id, `LICENSE_${status}`, { reason });
    return result;
  });
}
