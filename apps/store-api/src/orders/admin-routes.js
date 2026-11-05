// P5 (plan §2.7): admin xu ly don tu web, GET/POST /api/admin/orders.
// Giong Telegram, chi quyet duoc don AWAITING_OWNER (plan P5.6). Guard gan tung route.
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { decisionMessage } from './decision-message.js';

export function createOrderAdminRouter({ service, client, guards = [], rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];

  router.get('/orders', ...pre, async (req, res) => {
    res.json({ items: await service.listOrders({ status: typeof req.query.status === 'string' ? req.query.status : undefined }) });
  });

  const decide = (action) => async (req, res) => {
    const result = await service.decide(req.params.id, action,
      { kind: 'ADMIN', ref: req.user.id, displayName: req.user.displayName || req.user.username });
    if (result.outcome === 'NOT_FOUND') throw apiError('ORDER_NOT_FOUND');
    if (result.outcome !== 'CONFIRMED' && result.outcome !== 'REJECTED') throw apiError('ORDER_STATE_INVALID'); // da xu ly / het han
    const { telegramChatId, telegramMessageId, code } = result.order;
    if (client) {
      // Tat ca ban sao gui cho cac admin deu duoc dong nut sau khi web xu ly.
      const copies = service.telegramMessagesForOrder ? await service.telegramMessagesForOrder(req.params.id).catch(() => []) : [];
      if (!copies.length && telegramChatId && telegramMessageId) copies.push({ chatId: telegramChatId, messageId: telegramMessageId });
      const text = decisionMessage(result.outcome, result.decidedByName || req.user.displayName || req.user.username, 'web');
      await Promise.allSettled(copies.map(({ chatId, messageId }) => client.editMessageText({
        chatId: String(chatId), messageId: String(messageId), text: `Đơn ${code}\n\n${text}` } )));
    }
    res.json({ status: result.outcome });
  };
  router.post('/orders/:id/confirm', ...pre, decide('CONFIRM'));
  router.post('/orders/:id/reject', ...pre, decide('REJECT'));

  router.use(v3ErrorHandler);
  return router;
}
