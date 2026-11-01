// Ham dung chung cua router admin catalog (cai dat, model, can duyet).
import { apiError } from '../drive/errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const bad = () => apiError('INVALID_PARAMS');

export async function inTransaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

export const audit = (c, adminId, action, targetType, targetId, details) => c.query(
  `insert into audit_events (actor_kind, actor_ref, action, target_type, target_id, details) values ('ADMIN', $1, $2, $3, $4, $5)`,
  [String(adminId), action, targetType, targetId, JSON.stringify(details)]);
