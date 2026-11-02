// P5.4: Telegram Bot API qua fetch (khong them thu vien). Chi dung 4 method plan can: sendMessage, editMessageText, answerCallbackQuery, setWebhook.
// [Doi chieu tai lieu Bot API hien hanh: setWebhook.secret_token 1-256 ky tu A-Za-z0-9_-, header X-Telegram-Bot-Api-Secret-Token,
//  editMessageText.text 1-4096, answerCallbackQuery.text 0-200 da kiem; cau truc InlineKeyboardMarkup/callback_data<=64 byte dua tren hieu biet, chua doi chieu voi bot that.]
// Token nam trong URL nen moi loi duoc lam sach: khong bao gio dua token vao message/stack/log.
const TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const ID = /^-?\d{1,18}$/;

export class TelegramError extends Error {
  constructor(code, status, description) { super(code); this.code = code; this.status = status; this.description = description; }
}
const bad = (what) => new TelegramError('TELEGRAM_BAD_REQUEST', 400, what);

export function createTelegramClient({ token, fetchImpl = fetch, timeoutMs = 8000, base = 'https://api.telegram.org' }) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw bad('invalid bot token');
  const scrub = (text) => String(text ?? '').split(token).join('<token>').slice(0, 300);

  async function call(method, payload) {
    let response, data;
    try {
      response = await fetchImpl(`${base}/bot${token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
      });
      data = await response.json().catch(() => null);
    } catch { throw new TelegramError('TELEGRAM_UNREACHABLE', 0, 'cannot reach Telegram'); } // khong giu loi goc: URL trong do co token
    if (!response.ok || !data || data.ok !== true) throw new TelegramError('TELEGRAM_API', response.status, scrub(data?.description ?? `HTTP ${response.status}`));
    return data.result;
  }
  const chat = (chatId) => { if (!ID.test(String(chatId ?? ''))) throw bad('chat id'); return Number(chatId); };
  const text = (value, max) => { if (typeof value !== 'string' || value.length < 1) throw bad('text'); return value.slice(0, max); };

  return {
    async sendMessage({ chatId, text: body, keyboard }) {
      const payload = { chat_id: chat(chatId), text: text(body, 4096) };
      if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
      const sent = await call('sendMessage', payload);
      return { messageId: String(sent?.message_id), chatId: String(sent?.chat?.id ?? chatId) };
    },
    // reply_markup rong de go ban phim (xong viec thi het nut bam).
    async editMessageText({ chatId, messageId, text: body }) {
      if (!ID.test(String(messageId ?? ''))) throw bad('message id');
      await call('editMessageText', { chat_id: chat(chatId), message_id: Number(messageId), text: text(body, 4096), reply_markup: { inline_keyboard: [] } });
    },
    async answerCallbackQuery(callbackQueryId, body) {
      if (typeof callbackQueryId !== 'string' || !callbackQueryId || callbackQueryId.length > 200) throw bad('callback query id');
      await call('answerCallbackQuery', { callback_query_id: callbackQueryId, text: String(body ?? '').slice(0, 200) });
    },
    async setWebhook({ url, secretToken }) {
      if (typeof url !== 'string' || !url.startsWith('https://')) throw bad('webhook url must be https');
      if (typeof secretToken !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(secretToken)) throw bad('secret token');
      await call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['callback_query'] });
    },
  };
}
