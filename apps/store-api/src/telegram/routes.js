// P5.5: webhook Telegram. Thu tu kiem: duong dan bi mat (sai -> 404, khong lo gi), header secret (sai -> 401), roi chi nhan callback_query
// tu chu trong allowlist (ca nguoi bam lan chat chua nut). Sau do LUON tra 200 de Telegram khong gui lai; loi Telegram khong duoc hoan tac quyet dinh.
import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';

const DATA = /^o:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(ok|no)$/;
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const isId = (v) => Number.isSafeInteger(v);

const REPLIES = {
  CONFIRMED: { answer: 'Đã xác nhận, đã cấp quyền cho khách.', mark: '✅ ĐÃ XÁC NHẬN — đã cấp quyền cho thiết bị.' },
  REJECTED: { answer: 'Đã từ chối đơn.', mark: '❌ ĐÃ TỪ CHỐI.' },
  EXPIRED: { answer: 'Đơn đã hết hạn, không cấp quyền.', mark: '⌛ Đơn đã hết hạn, không cấp quyền.' },
};

export function createTelegramRouter({ config, client, service }) {
  const router = express.Router();
  const owners = new Set(config.ownerChatIds.map(String));

  async function handle(cq) {
    if (!cq || typeof cq !== 'object' || typeof cq.id !== 'string' || !cq.id || cq.id.length > 200 || typeof cq.data !== 'string' || cq.data.length > 64) return;
    const chatId = cq.message?.chat?.id;
    if (!isId(cq.from?.id) || !isId(chatId) || !owners.has(String(cq.from.id)) || !owners.has(String(chatId))) return; // nguoi la: im lang
    const m = DATA.exec(cq.data);
    if (!m) return;
    const messageId = cq.message?.message_id;
    const result = await service.decide(m[1], m[2] === 'ok' ? 'CONFIRM' : 'REJECT', { kind: 'TELEGRAM_OWNER', ref: cq.from.id });
    const reply = REPLIES[result.outcome];
    const answer = reply?.answer ?? (result.outcome === 'NOT_FOUND' ? 'Không tìm thấy đơn.' : `Đơn đã được xử lý hoặc chưa ở trạng thái chờ xác nhận (${result.order?.status ?? '?'}).`);
    const mark = reply?.mark ?? (result.outcome === 'ALREADY_DECIDED' ? `ℹ️ Đơn đã được xử lý: ${result.order?.status}.` : null);
    await client.answerCallbackQuery(cq.id, answer).catch(() => {});
    if (mark && isId(messageId)) {
      const original = typeof cq.message?.text === 'string' ? cq.message.text.slice(0, 3500) : `Đơn ${result.order?.code ?? ''}`;
      await client.editMessageText({ chatId: String(chatId), messageId: String(messageId), text: `${original}\n\n${mark}` }).catch(() => {});
    }
  }

  router.post('/webhook/:path', requestId, async (req, res) => {
    if (!same(req.params.path, config.webhookPath)) return res.sendStatus(404);
    if (!same(req.get('x-telegram-bot-api-secret-token') ?? '', config.webhookSecret)) throw apiError('UNAUTHENTICATED');
    try { await handle(req.body?.callback_query); } catch (e) { console.error('[telegram] handler failed', e?.code ?? e?.name ?? 'INTERNAL'); }
    res.sendStatus(200);
  });

  router.use(v3ErrorHandler);
  return router;
}

