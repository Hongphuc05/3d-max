// P5.4: tin nhan gui chu (nhieu chu duoc). Van ban thuan (khong parse_mode): ten thiet bi/model do khach/may khach dat nen khong duoc chen dinh dang.
// KHONG chua thong tin ngan hang. callback_data = o:<orderId>:ok|no (<= 64 byte).
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)} ₫`;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const MAX_LISTED = 10;

export const CALLBACK_DATA = { ok: (orderId) => `o:${orderId}:ok`, no: (orderId) => `o:${orderId}:no` };

const when = (date) => new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });

export function orderText(s) {
  const listed = s.models.slice(0, MAX_LISTED).map((m) => `• ${clean(m.name, 80)} — ${vnd(m.priceVnd)}`);
  if (s.models.length > MAX_LISTED) listed.push(`… và ${s.models.length - MAX_LISTED} model khác`);
  return [
    '🧾 Đơn mới chờ xác nhận',
    `Mã đơn: ${clean(s.code, 32)}`,
    `Số tiền: ${vnd(s.amountVnd)}`,
    `Thiết bị: ${clean(s.deviceName, 60)}`,
    `Model (${s.models.length}):`,
    ...listed,
    `Khách báo đã chuyển khoản lúc ${when(s.claimedPaidAt)}. Hạn đơn: ${when(s.expiresAt)}.`,
    'Kiểm tra app ngân hàng rồi bấm một nút bên dưới.',
  ].join('\n');
}

export function createTelegramNotifier({ client, service, ownerChatIds }) {
  return {
    async orderClaimed(summary) {
      const keyboard = [[{ text: '✅ Đã nhận tiền', callback_data: CALLBACK_DATA.ok(summary.orderId) }, { text: '❌ Từ chối', callback_data: CALLBACK_DATA.no(summary.orderId) }]];
      const text = orderText(summary);
      const results = await Promise.allSettled(ownerChatIds.map((chatId) => client.sendMessage({ chatId, text, keyboard })));
      const first = results.find((r) => r.status === 'fulfilled');
      if (!first) throw new Error('Telegram: no owner could be notified');
      await service.saveTelegramMessage(summary.orderId, first.value.chatId, first.value.messageId);
    },
  };
}
