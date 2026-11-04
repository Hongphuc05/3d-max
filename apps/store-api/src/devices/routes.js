// P4.1: dang ky thiet bi bang chu ky RSA (challenge -> verify), token thiet bi 15 phut, quyen so huu (plan §2.2-2.3).
// Thiet bi chi duoc DANG KY sau khi ky dung thu thach (xin thu thach khong tao hang devices). Guard gan TUNG route (khong router.use)
// de duong dan khac roi xuong router phia sau.
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { bad, inTransaction, UUID } from '../catalog-admin/shared.js';
import { validatedPublicKey, validSignature } from './crypto.js';

const MACHINE = /^MAX-[A-F0-9]{64}$/;
const TOKEN = /^Device ([A-Za-z0-9_-]{43})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const PROTECTION = new Set(['TPM', 'SOFTWARE']);
const sha256 = (value) => createHash('sha256').update(value).digest();

function exactKeys(body, required, optional = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad();
  const keys = Object.keys(body);
  if (!required.every((k) => keys.includes(k)) || keys.some((k) => !required.includes(k) && !optional.includes(k))) throw bad();
  return body;
}

function parseChallenge(body) {
  exactKeys(body, ['deviceUuid', 'publicKey', 'keyProtection', 'machineCode', 'deviceName']);
  const { deviceUuid, publicKey, keyProtection, machineCode, deviceName } = body;
  if (typeof deviceUuid !== 'string' || !UUID.test(deviceUuid) || !PROTECTION.has(keyProtection)
    || typeof machineCode !== 'string' || !MACHINE.test(machineCode)) throw bad();
  const name = typeof deviceName === 'string' ? deviceName.trim() : '';
  if (!name || name.length > 120 || CONTROL.test(name)) throw bad();
  let key;
  try { key = validatedPublicKey(publicKey); } catch { throw bad(); }
  return { deviceUuid: deviceUuid.toLowerCase(), jwk: { kty: 'RSA', n: publicKey.n, e: publicKey.e }, key, keyProtection, machineCode, deviceName: name };
}

async function entitlementsOf(db, deviceId) {
  const owned = await db.query('select 1 from entitlements where device_id = $1 and revoked_at is null', [deviceId]);
  // D28.1: license ca thu vien. `modelIds` luon rong, chi giu de host C# (DeviceSessionService) con doc duoc dinh dang cu.
  return { allModels: owned.rowCount > 0, modelIds: [] };
}

/** Middleware: `Authorization: Device <token>`; gan req.device = { id, deviceUuid }. Moi truong hop sai -> UNAUTHENTICATED. */
export const requireDevice = (pool) => async (req, _res, next) => {
  const token = TOKEN.exec(req.get('authorization') ?? '')?.[1];
  if (!token) throw apiError('UNAUTHENTICATED');
  const row = (await pool.query(
    `select d.id, d.device_uuid from device_tokens t join devices d on d.id = t.device_id
      where t.id = $1 and t.revoked_at is null and t.expires_at > now() and d.status = 'ACTIVE'`, [sha256(token)])).rows[0];
  if (!row) throw apiError('UNAUTHENTICATED');
  req.device = { id: row.id, deviceUuid: row.device_uuid };
  next();
};

export function createDeviceRouter({ pool, rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : [])];

  router.post('/device/challenge', ...pre, async (req, res) => {
    const c = parseChallenge(req.body);
    const hash = c.key.hash;
    const same = (await pool.query('select device_uuid, public_key_hash, status from devices where device_uuid = $1 or public_key_hash = $2', [c.deviceUuid, hash])).rows;
    // Mot uuid chi di voi mot khoa va nguoc lai; khong dua vao tin nhan cua may khach.
    if (same.some((r) => r.device_uuid !== c.deviceUuid || !r.public_key_hash.equals(hash))) throw apiError('DEVICE_KEY_MISMATCH');
    if (same.some((r) => r.status === 'BLOCKED')) throw apiError('DEVICE_BLOCKED');
    const id = randomUUID();
    const message = ['3DM-DEVICE-V2', id, randomBytes(32).toString('base64url'), c.deviceUuid, hash.toString('hex')].join('|');
    const { expires_at: expiresAt } = (await pool.query(
      `insert into device_auth_challenges (id, device_uuid, public_key, public_key_hash, key_protection, machine_code, device_name, message, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '2 minutes') returning expires_at`,
      [id, c.deviceUuid, JSON.stringify(c.jwk), hash, c.keyProtection, c.machineCode, c.deviceName, message])).rows[0];
    await pool.query("delete from device_auth_challenges where expires_at < now() - interval '1 hour'");
    res.json({ challengeId: id, message, expiresAt });
  });

  router.post('/device/verify', ...pre, async (req, res) => {
    const { challengeId, signature } = exactKeys(req.body, ['challengeId', 'signature']);
    if (typeof challengeId !== 'string' || !UUID.test(challengeId) || typeof signature !== 'string') throw bad();
    // Tieu thu thu thach TRUOC khi kiem chu ky: ky sai cung dot thu thach (khong thu lai tren cung thu thach).
    const ch = (await pool.query(
      `update device_auth_challenges set consumed_at = now() where id = $1 and consumed_at is null and expires_at > now() returning *`, [challengeId.toLowerCase()])).rows[0];
    if (!ch) throw apiError('CHALLENGE_INVALID');
    if (!validSignature(ch.message, validatedPublicKey(JSON.parse(ch.public_key)).pem, signature)) throw apiError('SIGNATURE_INVALID');

    const out = await inTransaction(pool, async (db) => {
      let deviceId, registered = false;
      try {
        const ins = await db.query(
          `insert into devices (device_uuid, public_key, public_key_hash, key_protection, machine_code, device_name)
           values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning id`,
          [ch.device_uuid, ch.public_key, ch.public_key_hash, ch.key_protection, ch.machine_code, ch.device_name]);
        registered = ins.rowCount === 1;
        deviceId = ins.rows[0]?.id;
      } catch (e) { if (e.code === '23505') throw apiError('DEVICE_KEY_MISMATCH'); throw e; }
      if (!registered) {
        const dev = (await db.query('select id, public_key_hash, status from devices where device_uuid = $1 for update', [ch.device_uuid])).rows[0];
        // `on conflict do nothing` (ca uuid lan khoa): hai lan dang ky song song cung may khong con va nhau; khoa da thuoc uuid khac -> khong co dong theo uuid.
        if (!dev || !dev.public_key_hash.equals(ch.public_key_hash)) throw apiError('DEVICE_KEY_MISMATCH');
        if (dev.status === 'BLOCKED') throw apiError('DEVICE_BLOCKED');
        deviceId = dev.id;
        await db.query('update devices set last_seen_at = now(), device_name = $2, machine_code = $3, key_protection = $4 where id = $1',
          [deviceId, ch.device_name, ch.machine_code, ch.key_protection]);
      }
      if (registered) await db.query(
        "insert into audit_events (actor_kind, action, target_type, target_id, details) values ('SYSTEM', 'DEVICE_REGISTERED', 'device', $1, $2)",
        [ch.device_uuid, JSON.stringify({ keyProtection: ch.key_protection })]);

      const token = randomBytes(32).toString('base64url');
      await db.query("delete from device_tokens where device_id = $1 and expires_at < now()", [deviceId]);
      const { expires_at: expiresAt } = (await db.query(
        "insert into device_tokens (id, device_id, expires_at) values ($1, $2, now() + interval '15 minutes') returning expires_at", [sha256(token), deviceId])).rows[0];
      return { deviceToken: token, expiresAt, entitlements: await entitlementsOf(db, deviceId) };
    });
    res.json(out);
  });

  router.get('/me/entitlements', ...pre, requireDevice(pool), async (req, res) => {
    res.json(await entitlementsOf(pool, req.device.id));
  });

  router.use(v3ErrorHandler);
  return router;
}
