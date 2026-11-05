import { apiError } from '../drive/errors.js';
import { inTransaction } from '../catalog-admin/shared.js';

const accountView = (row) => ({ id: row.id, telegramUserId: String(row.telegram_user_id), username: row.telegram_username,
  displayName: row.display_name, linkedAt: row.linked_at, lastNotifiedAt: row.last_notified_at });

export function createTelegramAccountStore({ pool }) {
  async function listForAdmin(adminId) {
    const rows = await pool.query(`select id, telegram_user_id, telegram_username, display_name, linked_at, last_notified_at
      from telegram_admin_accounts where admin_user_id = $1 and revoked_at is null order by linked_at`, [adminId]);
    return rows.rows.map(accountView);
  }

  async function listRecipients() {
    const rows = await pool.query(`select a.telegram_user_id as chat_id, a.id as account_id
      from telegram_admin_accounts a join users u on u.id = a.admin_user_id
      where a.revoked_at is null and u.role = 'ADMIN' and u.admin_disabled_at is null order by a.linked_at`);
    return rows.rows.map((row) => ({ chatId: String(row.chat_id), accountId: row.account_id }));
  }

  async function isAuthorized(telegramUserId, chatId) {
    if (String(telegramUserId) !== String(chatId)) return false;
    const result = await pool.query(`select 1 from telegram_admin_accounts a join users u on u.id = a.admin_user_id
      where a.telegram_user_id = $1 and a.revoked_at is null and u.role = 'ADMIN' and u.admin_disabled_at is null limit 1`, [String(telegramUserId)]);
    return result.rowCount > 0;
  }

  async function adminIdentity(telegramUserId, chatId) {
    if (String(telegramUserId) !== String(chatId)) return null;
    const result = await pool.query(`select u.username, u.display_name as admin_display_name, a.display_name as telegram_display_name
      from telegram_admin_accounts a join users u on u.id=a.admin_user_id
      where a.telegram_user_id=$1 and a.revoked_at is null and u.role='ADMIN' and u.admin_disabled_at is null limit 1`, [String(telegramUserId)]);
    const row = result.rows[0];
    if (!row) return null;
    return { displayName: row.admin_display_name || row.username || row.telegram_display_name || `Telegram ${telegramUserId}` };
  }

  async function link(adminId, profile) {
    try {
      return await inTransaction(pool, async (db) => {
        const admin = await db.query("select 1 from users where id = $1 and role = 'ADMIN' and admin_disabled_at is null for update", [adminId]);
        if (!admin.rowCount) throw apiError('FORBIDDEN');
        const existing = await db.query(`select id, admin_user_id from telegram_admin_accounts
          where revoked_at is null and (telegram_user_id = $1 or telegram_subject = $2) for update`, [profile.telegramUserId, profile.subject]);
        if (existing.rows.some((row) => row.admin_user_id !== adminId)) throw apiError('TELEGRAM_ACCOUNT_ALREADY_LINKED');
        const same = existing.rows.find((row) => row.admin_user_id === adminId);
        if (same) {
          const updated = await db.query(`update telegram_admin_accounts set telegram_user_id=$2, telegram_subject=$3,
            telegram_username=$4, display_name=$5 where id=$1
            returning id, telegram_user_id, telegram_username, display_name, linked_at, last_notified_at`,
          [same.id, profile.telegramUserId, profile.subject, profile.username, profile.displayName]);
          return accountView(updated.rows[0]);
        }
        const current = await db.query(`select id from telegram_admin_accounts
          where admin_user_id=$1 and revoked_at is null for update`, [adminId]);
        if (current.rowCount) throw apiError('TELEGRAM_ADMIN_ALREADY_CONNECTED');
        const inserted = await db.query(`insert into telegram_admin_accounts
          (admin_user_id, telegram_subject, telegram_user_id, telegram_username, display_name)
          values ($1,$2,$3,$4,$5)
          returning id, telegram_user_id, telegram_username, display_name, linked_at, last_notified_at`,
        [adminId, profile.subject, profile.telegramUserId, profile.username, profile.displayName]);
        return accountView(inserted.rows[0]);
      });
    } catch (error) {
      if (error?.code === '23505') {
        const current = await pool.query('select 1 from telegram_admin_accounts where admin_user_id=$1 and revoked_at is null limit 1', [adminId]);
        throw apiError(current.rowCount ? 'TELEGRAM_ADMIN_ALREADY_CONNECTED' : 'TELEGRAM_ACCOUNT_ALREADY_LINKED');
      }
      throw error;
    }
  }

  async function revoke(adminId, accountId) {
    const result = await pool.query(`update telegram_admin_accounts set revoked_at=now()
      where id=$1 and admin_user_id=$2 and revoked_at is null returning id`, [accountId, adminId]);
    if (!result.rowCount) throw apiError('TELEGRAM_CONNECTION_NOT_FOUND');
    return { disconnected: true };
  }

  async function markNotified(accountId) {
    await pool.query('update telegram_admin_accounts set last_notified_at=now() where id=$1 and revoked_at is null', [accountId]);
  }

  return { listForAdmin, listRecipients, isAuthorized, adminIdentity, link, revoke, markNotified };
}
