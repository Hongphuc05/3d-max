// P5.4: client Bot API cua Telegram bang fetch. Fetch gia; khong goi mang. Token khong bao gio duoc xuat hien trong loi/log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramClient, TelegramError } from './client.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function rig(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined }); return handler(calls.at(-1)); };
  return { calls, client: createTelegramClient({ token: TOKEN, fetchImpl, timeoutMs: 5000 }) };
}

test('sendMessage: POST /bot<token>/sendMessage with chat_id, plain text (no parse_mode) and an inline keyboard; returns the message ids', async () => {
  const { client, calls } = rig(() => reply({ ok: true, result: { message_id: 42, chat: { id: 777 } } }));
  const sent = await client.sendMessage({ chatId: '777', text: 'Xin chào', keyboard: [[{ text: '✅', callback_data: 'o:x:ok' }, { text: '❌', callback_data: 'o:x:no' }]] });
  assert.deepEqual(sent, { messageId: '42', chatId: '777' });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(calls[0].body, { chat_id: 777, text: 'Xin chào', reply_markup: { inline_keyboard: [[{ text: '✅', callback_data: 'o:x:ok' }, { text: '❌', callback_data: 'o:x:no' }]] } });
  assert.ok(calls[0].init.signal, 'a timeout signal is attached');
});

test('sendMessage also truncates text to the 4096-character limit', async () => {
  const { client, calls } = rig(() => reply({ ok: true, result: { message_id: 1, chat: { id: 1 } } }));
  await client.sendMessage({ chatId: '1', text: 'z'.repeat(6000) });
  assert.equal(calls[0].body.text.length, 4096);
});

test('editMessageText removes the keyboard explicitly; answerCallbackQuery sends only id + short text; text limits are enforced', async () => {
  const { client, calls } = rig(() => reply({ ok: true, result: true }));
  await client.editMessageText({ chatId: '777', messageId: '42', text: 'x'.repeat(5000) });
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['chat_id', 'message_id', 'reply_markup', 'text']);
  assert.deepEqual(calls[0].body.reply_markup, { inline_keyboard: [] });
  assert.equal(calls[0].body.text.length, 4096, 'longer than the 4096 limit is truncated, not rejected');
  assert.equal(calls[0].body.message_id, 42);
  await client.answerCallbackQuery('cbq-1', 'y'.repeat(300));
  assert.equal(calls[1].url.endsWith('/answerCallbackQuery'), true);
  assert.equal(calls[1].body.callback_query_id, 'cbq-1'); assert.equal(calls[1].body.text.length, 200);
});

test('setWebhook subscribes to private messages and order callback updates', async () => {
  const { client, calls } = rig(() => reply({ ok: true, result: true }));
  await client.setWebhook({ url: 'https://example.com/api/telegram/webhook/abc', secretToken: 'S3cret_token-OK-123456' });
  assert.deepEqual(calls[0].body, { url: 'https://example.com/api/telegram/webhook/abc', secret_token: 'S3cret_token-OK-123456', allowed_updates: ['message', 'callback_query'] });
  for (const bad of [{ url: 'http://example.com/x', secretToken: 'S3cret_token-OK-123456' }, { url: 'https://example.com/x', secretToken: 'short' }, { url: 'https://example.com/x', secretToken: 'has space in it 123456' }])
    await assert.rejects(client.setWebhook(bad), (e) => e instanceof TelegramError && e.code === 'TELEGRAM_BAD_REQUEST');
});

test('API errors surface as TelegramError with the API code and description; the token never appears in any error', async () => {
  const { client } = rig(() => reply({ ok: false, error_code: 403, description: `Forbidden: bot was blocked by the user (${TOKEN})` }, 403));
  await assert.rejects(client.sendMessage({ chatId: '1', text: 'x' }), (e) => {
    assert.ok(e instanceof TelegramError); assert.equal(e.code, 'TELEGRAM_API'); assert.equal(e.status, 403);
    assert.ok(!JSON.stringify([e.message, e.description, e.stack]).includes(TOKEN), 'token scrubbed from description, message and stack');
    return /blocked/.test(e.description);
  });
  const down = rig(() => { throw new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage ECONNRESET`); });
  await assert.rejects(down.client.sendMessage({ chatId: '1', text: 'x' }), (e) => e.code === 'TELEGRAM_UNREACHABLE' && !JSON.stringify([e.message, e.stack, e.cause]).includes(TOKEN));
  const html = rig(() => new Response('<html>502</html>', { status: 502 }));
  await assert.rejects(html.client.sendMessage({ chatId: '1', text: 'x' }), (e) => e.code === 'TELEGRAM_API' && e.status === 502);
  const odd = rig(() => reply({ result: 1 }));
  await assert.rejects(odd.client.sendMessage({ chatId: '1', text: 'x' }), (e) => e.code === 'TELEGRAM_API');
});

test('arguments are validated before any request: chat ids, message ids, empty text, bad token', async () => {
  const { client, calls } = rig(() => reply({ ok: true, result: { message_id: 1, chat: { id: 1 } } }));
  for (const bad of [{ chatId: 'abc', text: 'x' }, { chatId: '1.5', text: 'x' }, { chatId: '', text: 'x' }, { chatId: '1', text: '' }, { chatId: '1', text: 5 }])
    await assert.rejects(client.sendMessage(bad), (e) => e.code === 'TELEGRAM_BAD_REQUEST', JSON.stringify(bad));
  await assert.rejects(client.editMessageText({ chatId: '1', messageId: 'x', text: 'y' }), (e) => e.code === 'TELEGRAM_BAD_REQUEST');
  await assert.rejects(client.answerCallbackQuery('', 'x'), (e) => e.code === 'TELEGRAM_BAD_REQUEST');
  assert.equal(calls.length, 0);
  for (const token of ['', 'abc', '123:short', undefined]) assert.throws(() => createTelegramClient({ token, fetchImpl: async () => {} }), (e) => e.code === 'TELEGRAM_BAD_REQUEST');
});
