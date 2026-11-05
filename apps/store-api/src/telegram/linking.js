import { createHash, randomBytes } from 'node:crypto';
import { apiError } from '../drive/errors.js';
import { inTransaction } from '../catalog-admin/shared.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = (token) => createHash('sha256').update(token).digest();

export function createTelegramLinkService({ pool }) {
  async function createAttempt(adminId) {
    const token = randomBytes(32).toString('base64url');
    await inTransaction(pool, async (db) => {
      const admin = await db.query("select 1 from users where id=$1 and role='ADMIN' and admin_disabled_at is null for update", [adminId]);
      if (!admin.rowCount) throw apiError('FORBIDDEN');
      const linked = await db.query('select 1 from telegram_admin_accounts where admin_user_id=$1 and revoked_at is null limit 1', [adminId]);
      if (linked.rowCount) throw apiError('TELEGRAM_ADMIN_ALREADY_CONNECTED');
      await db.query('delete from telegram_link_attempts where expires_at <= now() or admin_user_id=$1', [adminId]);
      await db.query(`insert into telegram_link_attempts (token_hash, admin_user_id, expires_at)
        values ($1,$2,now() + interval '10 minutes')`, [hash(token), adminId]);
    });
    return token;
  }

  async function complete(token, telegramUser) {
    if (typeof token !== 'string' || !TOKEN.test(token)) throw apiError('TELEGRAM_LINK_TOKEN_INVALID');
    const result = await pool.query(`delete from telegram_link_attempts where token_hash=$1 and expires_at > now()
      returning admin_user_id`, [hash(token)]);
    if (!result.rowCount) throw apiError('TELEGRAM_LINK_TOKEN_INVALID');
    const id = String(telegramUser.id);
    const username = typeof telegramUser.username === 'string'
      ? telegramUser.username.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || null : null;
    const rawName = [telegramUser.first_name, telegramUser.last_name].filter((part) => typeof part === 'string').join(' ');
    const displayName = rawName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128)
      || (username ? `@${username}` : `Telegram ${id}`);
    return { adminId: result.rows[0].admin_user_id,
      profile: { telegramUserId: id, subject: `telegram:${id}`, username, displayName } };
  }

  return { createAttempt, complete };
}
