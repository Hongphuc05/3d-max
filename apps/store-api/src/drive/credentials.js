import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { apiError } from './errors.js';

const SLOT = /^[1-5]$/;
const API_KEY = /^[A-Za-z0-9_-]{20,256}$/;
const PROJECT_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const LOCK_ID = 727004;

export function deriveDriveKeyEncryptionKey(jwtSecret, { allowEphemeral = false } = {}) {
  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32) {
    if (allowEphemeral) return randomBytes(32);
    throw new Error('JWT_SECRET is required to encrypt Drive API keys');
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from(jwtSecret), Buffer.from('3dsmood-drive-key-encryption-v1'), Buffer.from('drive-api-keys'), 32));
}

export function encryptDriveApiKey(apiKey, encryptionKey) {
  if (!API_KEY.test(apiKey ?? '')) throw apiError('INVALID_PARAMS');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${ciphertext.toString('hex')}`;
}

export function decryptDriveApiKey(value, encryptionKey) {
  const [ivHex, tagHex, ciphertextHex, extra] = String(value ?? '').split('.');
  if (!ivHex || !tagHex || !ciphertextHex || extra || !/^[a-f0-9]{24}$/i.test(ivHex) || !/^[a-f0-9]{32}$/i.test(tagHex)) {
    throw new Error('Stored Drive credential is malformed');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
  if (!API_KEY.test(plaintext)) throw new Error('Stored Drive credential is invalid');
  return plaintext;
}

const publicSlot = row => ({
  slot: Number(row.slot), projectId: row.project_id, configured: true, active: row.is_active,
  lastCheckedAt: row.last_checked_at, status: row.last_check_status ?? 'UNKNOWN',
  reason: row.last_check_reason ?? null, cooldownUntil: row.cooldown_until,
});

export function createDriveCredentialStore({ pool, encryptionKey, legacyApiKey = null, now = () => Date.now() }) {
  async function acquire() {
    const client = await pool.connect();
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [LOCK_ID]);
    return client;
  }

  async function listSlots() {
    const rows = (await pool.query(`select slot, project_id, is_active, last_checked_at, last_check_status,
      last_check_reason, cooldown_until from drive_api_key_slots order by slot`)).rows;
    return Array.from({ length: 5 }, (_, index) => {
      const row = rows.find(item => Number(item.slot) === index + 1);
      return row ? publicSlot(row) : { slot: index + 1, projectId: '', configured: false, active: false,
        lastCheckedAt: null, status: 'EMPTY', reason: null, cooldownUntil: null };
    });
  }

  async function getActiveCredential({ excludeProjectIds = [] } = {}) {
    let row = (await pool.query(`select slot, project_id, encrypted_key, is_active
      from drive_api_key_slots
      where enabled and (cooldown_until is null or cooldown_until <= now())
        and not (project_id = any($1::text[]))
      order by is_active desc, slot asc limit 1`, [excludeProjectIds])).rows[0];
    if (row && !row.is_active) {
      const c = await acquire();
      try {
        row = (await c.query(`select slot, project_id, encrypted_key, is_active from drive_api_key_slots
          where enabled and (cooldown_until is null or cooldown_until <= now())
            and not (project_id = any($1::text[]))
          order by is_active desc, slot asc limit 1 for update`, [excludeProjectIds])).rows[0];
        if (row && !row.is_active) {
          await c.query('update drive_api_key_slots set is_active=false where is_active');
          await c.query('update drive_api_key_slots set is_active=true where slot=$1', [row.slot]);
        }
        await c.query('commit');
      } catch (error) { await c.query('rollback').catch(() => {}); throw error; }
      finally { c.release(); }
    }
    if (row) return { slot: Number(row.slot), projectId: row.project_id, apiKey: decryptDriveApiKey(row.encrypted_key, encryptionKey) };

    const waiting = (await pool.query(`select min(cooldown_until) as next_at from drive_api_key_slots
      where enabled and cooldown_until > now()`)).rows[0]?.next_at;
    const configured = (await pool.query('select exists(select 1 from drive_api_key_slots where enabled) as present')).rows[0].present;
    if (!waiting && legacyApiKey && !excludeProjectIds.includes('legacy-env')) {
      return { slot: 0, projectId: 'legacy-env', apiKey: legacyApiKey, legacy: true };
    }
    return { notConfigured: !configured && !legacyApiKey, retryAfterMs: waiting ? Math.max(1000, new Date(waiting).getTime() - now()) : undefined };
  }

  async function saveSlot(slot, { projectId, apiKey }) {
    if (!SLOT.test(String(slot)) || typeof projectId !== 'string' || !PROJECT_ID.test(projectId.trim())) throw apiError('INVALID_PARAMS');
    if (typeof apiKey !== 'string' || !API_KEY.test(apiKey)) throw apiError('INVALID_PARAMS');
    const c = await acquire();
    try {
      const active = (await c.query('select exists(select 1 from drive_api_key_slots where is_active) as active')).rows[0].active;
      await c.query(`insert into drive_api_key_slots (slot, project_id, encrypted_key, is_active, last_check_status, last_check_reason, cooldown_until, rate_limit_count, updated_at)
        values ($1,$2,$3,$4,null,null,null,0,now())
        on conflict (slot) do update set project_id=excluded.project_id, encrypted_key=excluded.encrypted_key,
          enabled=true, last_check_status=null, last_check_reason=null, cooldown_until=null, rate_limit_count=0, updated_at=now()`,
      [Number(slot), projectId.trim(), encryptDriveApiKey(apiKey, encryptionKey), !active]);
      if (!active) {
        await c.query('update drive_api_key_slots set is_active=false where is_active');
        await c.query('update drive_api_key_slots set is_active=true where slot=$1', [Number(slot)]);
      }
      await c.query('commit');
      return (await listSlots())[Number(slot) - 1];
    } catch (error) { await c.query('rollback').catch(() => {}); throw error; }
    finally { c.release(); }
  }

  async function clearSlot(slot) {
    if (!SLOT.test(String(slot))) throw apiError('INVALID_PARAMS');
    const c = await acquire();
    try {
      const wasActive = (await c.query('select is_active from drive_api_key_slots where slot=$1 for update', [Number(slot)])).rows[0]?.is_active;
      await c.query('delete from drive_api_key_slots where slot=$1', [Number(slot)]);
      if (wasActive) {
        const next = (await c.query('select slot from drive_api_key_slots where enabled order by slot limit 1')).rows[0];
        if (next) await c.query('update drive_api_key_slots set is_active=(slot=$1)', [next.slot]);
      }
      await c.query('commit');
    } catch (error) { await c.query('rollback').catch(() => {}); throw error; }
    finally { c.release(); }
  }

  async function credentialForSlot(slot) {
    const row = (await pool.query('select slot, project_id, encrypted_key from drive_api_key_slots where slot=$1 and enabled', [Number(slot)])).rows[0];
    return row ? { slot: Number(row.slot), projectId: row.project_id, apiKey: decryptDriveApiKey(row.encrypted_key, encryptionKey) } : null;
  }

  async function markHealthy(credential) {
    if (!credential || credential.legacy) return;
    await pool.query(`update drive_api_key_slots set cooldown_until=null, rate_limit_count=0,
      last_check_status=null, last_check_reason=null, updated_at=now()
      where project_id=$1 and last_check_status='RATE_LIMITED'`, [credential.projectId]);
    await pool.query(`update drive_api_key_slots set last_checked_at=now(), last_check_status='HEALTHY',
      last_check_reason=null, cooldown_until=null, rate_limit_count=0, updated_at=now() where slot=$1`, [credential.slot]);
  }

  async function markFailed(credential, reason) {
    if (!credential || credential.legacy) return;
    await pool.query(`update drive_api_key_slots set last_checked_at=now(), last_check_status='FAILED',
      last_check_reason=$2, updated_at=now() where slot=$1`, [credential.slot, /^[A-Za-z0-9_]{1,60}$/.test(reason ?? '') ? reason : 'DRIVE_ERROR']);
  }

  async function markRateLimited(credential, error) {
    if (!credential || credential.legacy) return;
    const c = await acquire();
    try {
      const count = (await c.query('select rate_limit_count from drive_api_key_slots where slot=$1 for update', [credential.slot])).rows[0]?.rate_limit_count ?? 0;
      const fallbackMs = Math.min(300_000, 30_000 * (2 ** Math.min(Number(count), 4)));
      const cooldownMs = Math.max(1000, Math.min(300_000, Number(error?.retryAfterMs) || fallbackMs));
      await c.query(`update drive_api_key_slots set cooldown_until=now()+($2::text || ' milliseconds')::interval,
        last_checked_at=now(), last_check_status='RATE_LIMITED', last_check_reason=$3,
        rate_limit_count=rate_limit_count+1, updated_at=now() where project_id=$1`,
      [credential.projectId, cooldownMs, /^[A-Za-z0-9_]{1,60}$/.test(error?.reason ?? '') ? error.reason : 'rateLimitExceeded']);
      const next = (await c.query(`select slot from drive_api_key_slots where enabled
        and (cooldown_until is null or cooldown_until <= now()) and project_id <> $1 order by slot limit 1`, [credential.projectId])).rows[0];
      if (next) {
        await c.query('update drive_api_key_slots set is_active=false where is_active');
        await c.query('update drive_api_key_slots set is_active=true where slot=$1', [next.slot]);
      } else await c.query('update drive_api_key_slots set is_active=false where is_active');
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
    finally { c.release(); }
  }

  async function hasConfiguredKeys() {
    return (await pool.query('select exists(select 1 from drive_api_key_slots where enabled) as configured')).rows[0].configured || Boolean(legacyApiKey);
  }

  async function legacyKeyActive() {
    const hasSlots = (await pool.query('select exists(select 1 from drive_api_key_slots where enabled) as configured')).rows[0].configured;
    return Boolean(legacyApiKey) && !hasSlots;
  }

  return { listSlots, getActiveCredential, saveSlot, clearSlot, credentialForSlot, markHealthy, markFailed,
    markRateLimited, hasConfiguredKeys, legacyKeyActive };
}
