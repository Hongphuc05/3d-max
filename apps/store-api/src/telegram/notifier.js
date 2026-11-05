// P5.4: tin nhan gui chu (nhieu chu duoc). Van ban thuan (khong parse_mode): ten thiet bi/model do khach/may khach dat nen khong duoc chen dinh dang.
// KHONG chua thong tin ngan hang. callback_data = o:<orderId>:ok|no (<= 64 byte).
import { decisionMessage } from '../orders/decision-message.js';
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const CALLBACK_DATA = { ok: (orderId) => `o:${orderId}:ok`, no: (orderId) => `o:${orderId}:no` };

const when = (date) => new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });

export function orderText(s) {
  return [
    '🧾 Đơn mới chờ xác nhận',
    `Mã đơn: ${clean(s.code, 32)}`,
    `Số tiền: ${vnd(s.amountVnd)}`,
    `Thiết bị: ${clean(s.deviceName, 60)}`,
    'Nội dung: license thư viện (toàn bộ model, vĩnh viễn, 1 máy).',
    `Khách báo đã chuyển khoản lúc ${when(s.claimedPaidAt)}. Hạn đơn: ${when(s.expiresAt)} (hết hạn vẫn xác nhận được).`,
    'Kiểm tra app ngân hàng rồi bấm một nút bên dưới.',
  ].join('\n');
}

export function createTelegramNotifier({ client, service, ownerChatIds = [], listRecipients, accounts }) {
  return {
    async orderClaimed(summary) {
      const keyboard = [[{ text: '✅ Đã nhận tiền', callback_data: CALLBACK_DATA.ok(summary.orderId) }, { text: '❌ Từ chối', callback_data: CALLBACK_DATA.no(summary.orderId) }]];
      const text = orderText(summary);
      let linked = [];
      try { linked = listRecipients ? await listRecipients() : []; } catch { /* still attempt legacy recipients */ }
      const recipients = new Map();
      for (const chatId of ownerChatIds) recipients.set(String(chatId), { chatId: String(chatId), accountId: null });
      for (const item of linked) recipients.set(String(item.chatId), { chatId: String(item.chatId), accountId: item.accountId });
      const list = [...recipients.values()];
      const results = new Array(list.length);
      const delivered = [];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(5, list.length) }, async () => {
        while (next < list.length) {
          const index = next++;
          const recipient = list[index];
          try {
            const sent = await client.sendMessage({ chatId: recipient.chatId, text, keyboard });
            delivered.push(sent);
            await service.saveTelegramMessage(summary.orderId, sent.chatId, sent.messageId);
            if (recipient.accountId && accounts?.markNotified) await accounts.markNotified(recipient.accountId);
            results[index] = { status: 'fulfilled', value: sent };
          } catch (reason) { results[index] = { status: 'rejected', reason }; }
        }
      }));
      if (delivered.length && service.decisionForOrder && client.editMessageText) {
        try {
          const decision = await service.decisionForOrder(summary.orderId);
          if (decision) {
            const copies = await service.telegramMessagesForOrder(summary.orderId).catch(() => []);
            for (const sent of delivered) if (!copies.some((copy) => copy.chatId === sent.chatId && copy.messageId === sent.messageId)) copies.push(sent);
            const mark = decisionMessage(decision.outcome, decision.decidedByName);
            await Promise.allSettled(copies.map((copy) => client.editMessageText({
              chatId: String(copy.chatId), messageId: String(copy.messageId), text: `Đơn ${summary.code}\n\n${mark}`,
            })));
          }
        } catch { /* the decision callback already reconciles messages it can see */ }
      }
      if (!results.some((result) => result.status === 'fulfilled')) throw new Error('Telegram: no admin could be notified');
    },
  };
}
