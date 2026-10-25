import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';
import { licenseError, uuid, objectBody } from './errors.js';
import { validatedPublicKey, validSignature } from './device-crypto.js';
import { inTransaction, getLicenseByAccount, requireActiveLicense, assertOwnership, audit, publicLicense, publicDevice } from './service.js';

export const DEVICE_SESSION_MS = 15 * 60_000;
const CHALLENGE_MS = 2 * 60_000;
export const tokenHash = token => createHash('sha256').update(token).digest();

function validateSessionId(sessionId) {
  if (!Buffer.isBuffer(sessionId) || sessionId.length !== 32) throw licenseError('UNAUTHENTICATED', 401);
  return sessionId;
}

function validateIdentity(input) {
  objectBody(input, ['purpose', 'deviceId', 'publicKey', 'keyProtection', 'deviceName']);
  if (!['ACTIVATE', 'VERIFY'].includes(input.purpose)) throw licenseError('INVALID_CHALLENGE_PURPOSE');
  if (!['TPM', 'SOFTWARE'].includes(input.keyProtection)) throw licenseError('INVALID_KEY_PROTECTION');
  if (typeof input.deviceName !== 'string' || !input.deviceName.trim()
    || input.deviceName.length > 120 || /[\x00-\x1f\x7f]/.test(input.deviceName)) throw licenseError('INVALID_DEVICE_NAME');
  return {
    ...input, deviceId: uuid(input.deviceId, 'INVALID_DEVICE_ID'),
    deviceName: input.deviceName.trim(), key: validatedPublicKey(input.publicKey),
  };
}

export async function createDeviceChallenge(userId, sessionId, input) {
  const owner = uuid(userId);
  validateSessionId(sessionId);
  const identity = validateIdentity(input);
  // Activating a new slot requires ownership. Restoring an existing machine
  // requires signed device proof and may use its owner's license across accounts.
  if (identity.purpose === 'ACTIVATE') requireActiveLicense(await getLicenseByAccount(owner));
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_MS);
  const message = ['3DM-DEVICE-V1', challengeId, randomBytes(32).toString('base64url'),
    owner, identity.deviceId, identity.purpose, identity.key.hash.toString('hex')].join('|');
  const result = await pool.query(`insert into device_challenges
    (id,user_id,auth_session_id,device_id,purpose,device_public_key,public_key_hash,device_name,key_protection,message,expires_at)
    select $1,$2,s.id,$4,$5,$6,$7,$8,$9,$10,$11 from sessions s
    where s.id=$3 and s.user_id=$2 and s.expires_at>now() returning id`,
  [challengeId, owner, sessionId, identity.deviceId, identity.purpose, identity.key.pem, identity.key.hash,
    identity.deviceName, identity.keyProtection, message, expiresAt]);
  if (!result.rows.length) throw licenseError('UNAUTHENTICATED', 401);
  return { challengeId, message, expiresAt };
}

// Consumption commits before signature checking/activation: even a failed proof
// burns its nonce. A rollback in activation cannot revive a captured challenge.
async function consumeProof(userId, sessionId, input, purpose) {
  objectBody(input, purpose === 'ACTIVATE' ? ['challengeId','signature','licenseKey'] : ['challengeId','signature']);
  const challengeId = uuid(input.challengeId, 'INVALID_CHALLENGE_ID');
  validateSessionId(sessionId);
  const row = (await pool.query(`update device_challenges c set consumed_at=now()
    where c.id=$1 and c.user_id=$2 and c.auth_session_id=$3 and c.purpose=$4 and c.consumed_at is null
    and exists (select 1 from sessions s where s.id=$3 and s.user_id=$2 and s.expires_at>now())
    returning c.*,c.expires_at>now() as unexpired`, [challengeId, uuid(userId), sessionId, purpose])).rows[0];
  if (!row) throw licenseError('INVALID_OR_USED_CHALLENGE', 403);
  if (!row.unexpired || !validSignature(row.message, row.device_public_key, input.signature)) {
    await audit(pool, userId, null, 'DEVICE_PROOF_REJECTED', { challengeId, expired: !row.unexpired });
    throw licenseError(row.unexpired ? 'INVALID_DEVICE_PROOF' : 'CHALLENGE_EXPIRED', 403);
  }
  return row;
}

async function bindDevice(db, license, proof, allowNew) {
  const devices = (await db.query('select * from license_devices where license_id=$1 order by slot_number', [license.id])).rows;
  const existing = devices.find(row => row.device_id === proof.device_id);
  if (existing) {
    if (!timingSafeEqual(existing.public_key_hash, proof.public_key_hash)) throw licenseError('DEVICE_KEY_MISMATCH', 403);
    return (await db.query('update license_devices set last_seen_at=now() where id=$1 returning *', [existing.id])).rows[0];
  }
  if (!allowNew) throw licenseError('DEVICE_NOT_ACTIVATED', 403);
  if (devices.length >= 2) throw licenseError('DEVICE_LIMIT_REACHED', 409);
  const slot = devices.some(row => row.slot_number === 1) ? 2 : 1;
  const row = (await db.query(`insert into license_devices
    (license_id,slot_number,device_id,device_public_key,public_key_hash,device_name,key_protection)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning *`,
  [license.id, slot, proof.device_id, proof.device_public_key, proof.public_key_hash, proof.device_name, proof.key_protection])).rows[0];
  if (!row) throw licenseError('DEVICE_IDENTITY_ALREADY_BOUND', 409);
  await audit(db, proof.user_id, license.id, 'DEVICE_ACTIVATED', { deviceId: row.device_id, slot });
  return row;
}

function sessionLicense(license, userId) {
  const result = publicLicense(license);
  if (license.user_id === userId) return result;
  const { last4: _last4, ...entitlement } = result;
  return entitlement;
}

async function startDeviceSession(db, license, device, sessionId, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DEVICE_SESSION_MS);
  // Lock auth session while creating device session: concurrent logout either
  // prevents issuance or cascades this new device session before logout returns.
  const auth = await db.query('select id from sessions where id=$1 and user_id=$2 and expires_at>now() for key share',
    [sessionId, userId]);
  if (!auth.rows.length) throw licenseError('UNAUTHENTICATED', 401);
  await db.query(`insert into device_sessions (id,auth_session_id,user_id,license_id,device_id,expires_at)
    values ($1,$2,$3,$4,$5,$6) on conflict (auth_session_id,device_id)
    do update set id=excluded.id,expires_at=excluded.expires_at,created_at=now()`,
  [tokenHash(token), sessionId, userId, license.id, device.id, expiresAt]);
  return { token, expiresAt, license: sessionLicense(license, userId), device: publicDevice(device) };
}

async function existingMachineLicense(db, userId, proof) {
  // The pair must match: possession of a UUID alone, or a key with a new UUID,
  // cannot claim a fixed slot. Lock the selected license against revocation.
  const row = (await db.query(`select l.* from licenses l join license_devices d on d.license_id=l.id
    where d.device_id=$1 and d.public_key_hash=$2 and l.status='ACTIVE'
    order by (l.user_id=$3) desc,d.activated_at,d.id limit 1 for update of l`,
  [proof.device_id, proof.public_key_hash, userId])).rows[0];
  if (row) return row;
  const previous = (await db.query(`select l.* from licenses l join license_devices d on d.license_id=l.id
    where d.device_id=$1 and d.public_key_hash=$2
    order by (l.user_id=$3) desc,d.activated_at,d.id limit 1 for update of l`,
  [proof.device_id, proof.public_key_hash, userId])).rows[0];
  if (previous) requireActiveLicense(previous);
  throw licenseError('DEVICE_NOT_ACTIVATED', 403);
}

async function authenticateDevice(userId, sessionId, input, purpose) {
  const proof = await consumeProof(userId, sessionId, input, purpose);
  return inTransaction(async db => {
    const license = purpose === 'VERIFY' ? await existingMachineLicense(db, userId, proof)
      : (await db.query('select * from licenses where user_id=$1 for update', [userId])).rows[0];
    requireActiveLicense(license);
    if (purpose === 'ACTIVATE') assertOwnership(license, input.licenseKey);
    const device = await bindDevice(db, license, proof, purpose === 'ACTIVATE');
    const result = await startDeviceSession(db, license, device, sessionId, userId);
    await audit(db, userId, license.id, 'DEVICE_SESSION_CREATED', { deviceId: device.device_id });
    return result;
  });
}

export const activateDevice = (userId, sessionId, input) => authenticateDevice(userId, sessionId, input, 'ACTIVATE');
export const verifyDevice = (userId, sessionId, input) => authenticateDevice(userId, sessionId, input, 'VERIFY');

export async function getDeviceSession(userId, sessionId, token) {
  validateSessionId(sessionId);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw licenseError('DEVICE_SESSION_REQUIRED', 403);
  const row = (await pool.query(`select ds.expires_at as session_expires_at,
    row_to_json(l) as license, row_to_json(d) as device from device_sessions ds
    join sessions s on s.id=ds.auth_session_id and s.user_id=ds.user_id
    join licenses l on l.id=ds.license_id
    join license_devices d on d.id=ds.device_id and d.license_id=l.id
    where ds.id=$1 and ds.user_id=$2 and ds.auth_session_id=$3
    and ds.expires_at>now() and s.expires_at>now() and l.status='ACTIVE'`,
  [tokenHash(token), uuid(userId), sessionId])).rows[0];
  if (!row) throw licenseError('DEVICE_SESSION_INVALID', 403);
  return { license: sessionLicense(row.license, userId), device: publicDevice(row.device), expiresAt: row.session_expires_at };
}
