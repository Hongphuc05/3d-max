// Telegram webhook: kiem tra duong dan bi mat va secret header; xu ly link qua /start payload va callback cua admin.
// Sau do LUON tra 200 de Telegram khong gui lai; loi Telegram khong duoc hoan tac quyet dinh.
import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { alreadyDecidedMessage, decisionMessage } from '../orders/decision-message.js';

const DATA = /^o:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(ok|no)$/;
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const isId = (v) => Number.isSafeInteger(v);

const REPLIES = {
  CONFIRMED: { answer: 'Đã xác nhận, đã cấp license thư viện cho khách.' },
  REJECTED: { answer: 'Đã từ chối đơn.' },
  EXPIRED: { answer: 'Đơn đã hết hạn, không cấp quyền.' },
};
function decisionMark(result, fallbackName) {
  if (result.outcome === 'CONFIRMED' || result.outcome === 'REJECTED') return decisionMessage(result.outcome, result.decidedByName || fallbackName);
  if (result.outcome === 'ALREADY_DECIDED') return alreadyDecidedMessage(result.order, result.decidedByName);
  if (result.outcome === 'EXPIRED') return '⌛ Đơn đã hết hạn, không cấp quyền.';
  return null;
}

export function createTelegramRouter({ config, client, service, accounts, linking }) {
  const router = express.Router();
  const owners = new Set((config.ownerChatIds ?? []).map(String));

  async function handleStart(message) {
    if (message?.chat?.type !== 'private' || !isId(message.chat.id) || !isId(message.from?.id)
      || String(message.chat.id) !== String(message.from.id) || typeof message.text !== 'string') return;
    const command = /^\/start(?:@[A-Za-z0-9_]{5,32})?(?:\s+([A-Za-z0-9_-]{1,64}))?$/.exec(message.text.trim());
    if (!command?.[1]) return;
    let response = 'Mã kết nối không hợp lệ hoặc đã hết hạn. Hãy quay lại trang admin và bấm Kết nối Telegram lần nữa.';
    try {
      const link = await linking.complete(command[1], message.from);
      await accounts.link(link.adminId, link.profile);
      response = '✅ Đã kết nối Telegram với tài khoản admin. Tài khoản này sẽ nhận thông báo đơn hàng.';
    } catch (error) {
      if (error?.code === 'TELEGRAM_ACCOUNT_ALREADY_LINKED') response = 'Tài khoản Telegram này đã được liên kết với một admin khác.';
      else if (error?.code === 'TELEGRAM_ADMIN_ALREADY_CONNECTED') response = 'Tài khoản admin đã có Telegram liên kết. Hãy ngắt kết nối cũ trong trang quản trị.';
    }
    await client.sendMessage({ chatId: String(message.chat.id), text: response });
  }

  async function handle(cq) {
    if (!cq || typeof cq !== 'object' || typeof cq.id !== 'string' || !cq.id || cq.id.length > 200 || typeof cq.data !== 'string' || cq.data.length > 64) return;
    const chatId = cq.message?.chat?.id;
    if (!isId(cq.from?.id) || !isId(chatId)) return;
    const legacyOwner = owners.has(String(cq.from.id)) && owners.has(String(chatId));
    const identity = accounts?.adminIdentity ? await accounts.adminIdentity(cq.from.id, chatId) : null;
    const linkedAdmin = Boolean(identity) || (!legacyOwner && accounts ? await accounts.isAuthorized(cq.from.id, chatId) : false);
    if (!legacyOwner && !linkedAdmin) return; // nguoi la: im lang
    const m = DATA.exec(cq.data);
    if (!m) return;
    const messageId = cq.message?.message_id;
    const actorName = identity?.displayName || `Telegram ID ${cq.from.id}`;
    const result = await service.decide(m[1], m[2] === 'ok' ? 'CONFIRM' : 'REJECT',
      { kind: 'TELEGRAM_OWNER', ref: cq.from.id, displayName: actorName });
    const reply = REPLIES[result.outcome];
    const answer = result.outcome === 'ALREADY_DECIDED' && result.decidedByName
      ? alreadyDecidedMessage(result.order, result.decidedByName)
      : reply?.answer ?? (result.outcome === 'NOT_FOUND' ? 'Không tìm thấy đơn.' : `Đơn đã được xử lý hoặc chưa ở trạng thái chờ xác nhận (${result.order?.status ?? '?'}).`);
    const mark = decisionMark(result, actorName);
    await client.answerCallbackQuery(cq.id, answer).catch(() => {});
    if (mark && isId(messageId)) {
      const original = typeof cq.message?.text === 'string' ? cq.message.text.slice(0, 3500) : `Đơn ${result.order?.code ?? ''}`;
      let copies = [];
      try { copies = service.telegramMessagesForOrder ? await service.telegramMessagesForOrder(m[1]) : []; } catch { /* decision already committed */ }
      if (!copies.length) copies = [{ chatId: String(chatId), messageId: String(messageId) }];
      await Promise.allSettled(copies.map((copy) => {
        const isClicked = String(copy.chatId) === String(chatId) && String(copy.messageId) === String(messageId);
        const text = isClicked ? `${original}\n\n${mark}` : `Đơn ${result.order?.code ?? ''}\n\n${mark}`;
        return client.editMessageText({ chatId: String(copy.chatId), messageId: String(copy.messageId), text });
      }));
    }
  }

  router.post('/webhook/:path', requestId, async (req, res) => {
    if (!same(req.params.path, config.webhookPath)) return res.sendStatus(404);
    if (!same(req.get('x-telegram-bot-api-secret-token') ?? '', config.webhookSecret)) throw apiError('UNAUTHENTICATED');
    try {
      await handleStart(req.body?.message);
      await handle(req.body?.callback_query);
    } catch (e) { console.error('[telegram] handler failed', e?.code ?? e?.name ?? 'INTERNAL'); }
    res.sendStatus(200);
  });

  router.use(v3ErrorHandler);
  return router;
}

