// P5.2 + P5.6: may trang thai don hang, gia tinh o server, xac nhan/tu choi/het han. Moi buoc doi trang thai la mot cau UPDATE co dieu kien
// trang thai (`where status = ...`) nen hai lan bam cung luc chi mot lan thang; cap quyen + audit nam CUNG transaction voi viec doi trang thai.
import { randomBytes } from 'node:crypto';
import { apiError } from '../drive/errors.js';
import { bad, inTransaction, UUID } from '../catalog-admin/shared.js';
import { buildVietQr } from './qr.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 ky tu, bo I/O/0/1 de khong nham khi go noi dung chuyen khoan
const newCode = () => `3DM${Array.from(randomBytes(6), (b) => ALPHABET[b & 31]).join('')}`;
export const STATUSES = ['PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'];
const OPEN = ['PENDING_PAYMENT', 'AWAITING_OWNER'];
const ORDER_COLUMNS = 'id, code, device_id, amount_vnd, status, expires_at, decided_at, telegram_chat_id, telegram_message_id';
const view = (r) => ({ id: r.id, code: r.code, deviceId: r.device_id, amountVnd: r.amount_vnd, status: r.status, expiresAt: r.expires_at, decidedAt: r.decided_at,
  telegramChatId: r.telegram_chat_id, telegramMessageId: r.telegram_message_id });
const audit = (db, actor, action, orderId, details) => db.query(
  "insert into audit_events (actor_kind, actor_ref, action, target_type, target_id, details) values ($1, $2, $3, 'order', $4, $5)",
  [actor.kind, actor.ref == null ? null : String(actor.ref), action, orderId, JSON.stringify(details)]);

export function createOrderService({ pool }) {
  const own = async (db, deviceId, orderId) => {
    if (!UUID.test(orderId ?? '')) throw apiError('ORDER_NOT_FOUND');
    const r = (await db.query(`select ${ORDER_COLUMNS} from purchase_orders where id = $1 and device_id = $2`, [orderId, deviceId])).rows[0];
    if (!r) throw apiError('ORDER_NOT_FOUND');
    return r;
  };

  async function createOrder(deviceId) {
    return inTransaction(pool, async (db) => {
      await db.query('select 1 from devices where id = $1 for update', [deviceId]); // tuan tu hoa don cua mot thiet bi (gioi han don cho)
      const s = (await db.query('select bank_name, bank_bin, account_no, account_name, order_ttl_minutes, max_pending_orders_per_device, library_price_vnd from app_settings where id = 1')).rows[0];
      if (!s || !s.bank_name || !s.bank_bin || !s.account_no || !s.account_name) throw apiError('PAYMENT_NOT_CONFIGURED');
      const amount = s.library_price_vnd; // GIA THU VIEN lay tu DB (D28.1)
      if (amount < 1) throw apiError('PAYMENT_NOT_CONFIGURED');
      const owned = await db.query("select 1 from entitlements where device_id = $1 and revoked_at is null", [deviceId]);
      if (owned.rowCount) throw apiError('ALREADY_ENTITLED'); // 1 license = 1 may (D28.2)
      const pending = (await db.query(
        "select count(*)::int n from purchase_orders where device_id = $1 and status = any($2) and expires_at > now()", [deviceId, OPEN])).rows[0].n;
      if (pending >= s.max_pending_orders_per_device) throw apiError('TOO_MANY_PENDING_ORDERS');

      const snapshot = { bankName: s.bank_name, bankBin: s.bank_bin, accountNo: s.account_no, accountName: s.account_name };
      let order;
      for (let attempt = 0; attempt < 6 && !order; attempt++) {
        const code = newCode();
        order = (await db.query(
          `insert into purchase_orders (code, device_id, amount_vnd, expires_at, bank_snapshot)
           values ($1, $2, $3, now() + make_interval(mins => $4), $5) on conflict (code) do nothing returning id, code, expires_at`,
          [code, deviceId, amount, s.order_ttl_minutes, JSON.stringify(snapshot)])).rows[0];
      }
      if (!order) throw new Error('could not allocate an order code');
      let qrPayload;
      try { qrPayload = buildVietQr({ bankBin: snapshot.bankBin, accountNo: snapshot.accountNo, amountVnd: amount, content: order.code }); }
      catch (e) { if (e.code === 'VIETQR_INVALID') throw apiError('PAYMENT_NOT_CONFIGURED'); throw e; } // cai dat ngan hang sai dinh dang: khong tao don
      return { orderId: order.id, code: order.code, amountVnd: amount, status: 'PENDING_PAYMENT', expiresAt: order.expires_at,
        payment: { bankName: snapshot.bankName, accountNo: snapshot.accountNo, accountName: snapshot.accountName, transferContent: order.code, qrPayload } };
    });
  }

  async function getOrder(deviceId, orderId) {
    if (!UUID.test(orderId ?? '')) throw apiError('ORDER_NOT_FOUND');
    const r = (await pool.query(
      `select id, code, amount_vnd, decided_at, expires_at,
              case when status = any($3) and expires_at <= now() then 'EXPIRED' else status end as status
         from purchase_orders where id = $1 and device_id = $2`, [orderId, deviceId, OPEN])).rows[0];
    if (!r) throw apiError('ORDER_NOT_FOUND');
    return { orderId: r.id, code: r.code, amountVnd: r.amount_vnd, status: r.status, expiresAt: r.expires_at, decidedAt: r.decided_at };
  }

  async function transition(deviceId, orderId, to, setSql) {
    await own(pool, deviceId, orderId);
    const r = await pool.query(
      `update purchase_orders set status = $3${setSql} where id = $1 and device_id = $2 and status = 'PENDING_PAYMENT' and expires_at > now() returning id`, [orderId, deviceId, to]);
    if (!r.rowCount) throw apiError('ORDER_STATE_INVALID');
  }
  const claimPaid = (deviceId, orderId) => transition(deviceId, orderId, 'AWAITING_OWNER', ', claimed_paid_at = now()');
  const cancelOrder = (deviceId, orderId) => transition(deviceId, orderId, 'CANCELLED', '');

  /** Noi dung thong bao cho chu: KHONG co thong tin ngan hang. */
  async function summary(orderId) {
    const o = (await pool.query(
      `select o.id, o.code, o.amount_vnd, o.expires_at, o.claimed_paid_at, d.device_name
         from purchase_orders o join devices d on d.id = o.device_id where o.id = $1`, [orderId])).rows[0];
    return o && { orderId: o.id, code: o.code, amountVnd: o.amount_vnd, deviceName: o.device_name, expiresAt: o.expires_at, claimedPaidAt: o.claimed_paid_at };
  }

  async function saveTelegramMessage(orderId, chatId, messageId) {
    return inTransaction(pool, async (db) => {
      await db.query(`insert into purchase_order_telegram_messages (order_id, chat_id, message_id)
        values ($1,$2,$3) on conflict do nothing`, [orderId, chatId, messageId]);
      await db.query(`update purchase_orders set telegram_chat_id=coalesce(telegram_chat_id,$2),
        telegram_message_id=coalesce(telegram_message_id,$3) where id=$1`, [orderId, chatId, messageId]);
    });
  }

  async function telegramMessagesForOrder(orderId) {
    const rows = await pool.query(`select chat_id, message_id from purchase_order_telegram_messages where order_id=$1
      union select telegram_chat_id, telegram_message_id from purchase_orders where id=$1
        and telegram_chat_id is not null and telegram_message_id is not null`, [orderId]);
    return rows.rows.map((row) => ({ chatId: String(row.chat_id), messageId: String(row.message_id) }));
  }
  const recordNotifyFailure = (orderId, reason) => audit(pool, { kind: 'SYSTEM', ref: null }, 'OWNER_NOTIFY_FAILED', orderId, { reason: String(reason).slice(0, 200) });

  /** @returns {{outcome:'CONFIRMED'|'REJECTED'|'EXPIRED'|'ALREADY_DECIDED'|'NOT_FOUND', order?}} */
  async function decide(orderId, action, actor) {
    if (!UUID.test(orderId ?? '')) return { outcome: 'NOT_FOUND' };
    // Chi don khach DA bao chuyen khoan (claimed_paid_at); don da het han van xac nhan duoc vi tien da chuyen that (quyet dinh chu, 2026-11-04).
    const tgUser = actor.kind === 'TELEGRAM_OWNER' && /^\d{1,18}$/.test(String(actor.ref)) ? String(actor.ref) : null;
    const confirm = action === 'CONFIRM';
    return inTransaction(pool, async (db) => {
      const done = (await db.query(
        `update purchase_orders set status = $2, decided_at = now(), decided_by_telegram_user = $3
          where id = $1 and claimed_paid_at is not null and status in ('AWAITING_OWNER', 'EXPIRED') returning ${ORDER_COLUMNS}`,
        [orderId, confirm ? 'CONFIRMED' : 'REJECTED', tgUser])).rows[0];
      if (!done) {
        const cur = (await db.query(`select ${ORDER_COLUMNS} from purchase_orders where id = $1`, [orderId])).rows[0];
        if (!cur) return { outcome: 'NOT_FOUND' };
        return { outcome: 'ALREADY_DECIDED', order: view(cur) };
      }
      if (confirm) {
        await db.query(
          `insert into entitlements (device_id, source, order_id) values ($1, 'ORDER', $2) on conflict do nothing`, [done.device_id, orderId]);
      }
      await audit(db, actor, confirm ? 'ORDER_CONFIRMED' : 'ORDER_REJECTED', orderId, { code: done.code, amountVnd: done.amount_vnd });
      return { outcome: confirm ? 'CONFIRMED' : 'REJECTED', order: view(done) };
    });
  }

  async function expireDue() {
    const r = await pool.query(
      `update purchase_orders set status = 'EXPIRED' where status = any($1) and expires_at <= now()
       returning id, code, telegram_chat_id, telegram_message_id`, [OPEN]);
    return r.rows.map((x) => ({ id: x.id, code: x.code, telegramChatId: x.telegram_chat_id, telegramMessageId: x.telegram_message_id }));
  }

  async function listOrders({ status, limit = 100 } = {}) {
    if (status !== undefined && !STATUSES.includes(status)) throw apiError('INVALID_PARAMS');
    const rows = (await pool.query(
      `select o.id, o.code, o.amount_vnd, o.status, o.created_at, o.expires_at, o.claimed_paid_at, o.decided_at, d.device_name, o.device_id
         from purchase_orders o join devices d on d.id = o.device_id
        where ($1::text is null or o.status = $1) order by o.created_at desc limit $2`, [status ?? null, Math.min(Math.max(Number(limit) || 100, 1), 500)])).rows;
    return rows.map((o) => ({ orderId: o.id, code: o.code, amountVnd: o.amount_vnd, status: o.status, createdAt: o.created_at, expiresAt: o.expires_at,
      claimedPaidAt: o.claimed_paid_at, decidedAt: o.decided_at, deviceName: o.device_name, deviceId: o.device_id }));
  }

  return { createOrder, getOrder, claimPaid, cancelOrder, summary, saveTelegramMessage, telegramMessagesForOrder, recordNotifyFailure, decide, expireDue, listOrders };
}
