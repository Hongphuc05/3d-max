// P5.4/P5.5: tin nhan Telegram gui cho chu khi khach bao da chuyen khoan. Client + service gia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramNotifier, orderText, CALLBACK_DATA } from './notifier.js';

const ORDER = '11111111-2222-4333-8444-555555555555';
const summary = (over = {}) => ({ orderId: ORDER, code: '3DMK7Q2XA', amountVnd: 35000, deviceName: 'PC-Khach', expiresAt: new Date('2026-11-03T10:00:00Z'),
  claimedPaidAt: new Date('2026-11-02T10:00:00Z'), models: [{ name: 'Sofa One', priceVnd: 15000 }, { name: 'Lamp Two', priceVnd: 20000 }], ...over });
function rig({ owners = ['111', '222'], failFor = new Set() } = {}) {
  const sent = [], saved = [];
  const client = { async sendMessage(m) { if (failFor.has(m.chatId)) throw Object.assign(new Error('x'), { code: 'TELEGRAM_API' }); sent.push(m); return { messageId: `m-${m.chatId}`, chatId: m.chatId }; } };
  const service = { async saveTelegramMessage(...args) { saved.push(args); } };
  return { sent, saved, notifier: createTelegramNotifier({ client, service, ownerChatIds: owners }) };
}

test('the message tells the owner code, amount, device and models, and nothing about the bank account', () => {
  const text = orderText(summary());
  for (const part of ['3DMK7Q2XA', '35.000', 'PC-Khach', 'Sofa One', 'Lamp Two', '15.000', '20.000']) assert.ok(text.includes(part), part);
  assert.ok(!/\b\d{9,}\b/.test(text), 'no long digit runs (account numbers)');
});

test('callback data fits Telegram\'s 64-byte limit and has the agreed shape o:<orderId>:ok|no', () => {
  assert.equal(CALLBACK_DATA.ok(ORDER), `o:${ORDER}:ok`); assert.equal(CALLBACK_DATA.no(ORDER), `o:${ORDER}:no`);
  assert.ok(Buffer.byteLength(CALLBACK_DATA.ok(ORDER)) <= 64);
});

test('orderClaimed sends one plain-text message with ✅ and ❌ to every owner and remembers the first message', async () => {
  const { notifier, sent, saved } = rig();
  await notifier.orderClaimed(summary());
  assert.deepEqual(sent.map((m) => m.chatId), ['111', '222']);
  const kb = sent[0].keyboard;
  assert.equal(kb.length, 1); assert.equal(kb[0].length, 2);
  assert.deepEqual(kb[0].map((b) => b.callback_data), [`o:${ORDER}:ok`, `o:${ORDER}:no`]);
  assert.match(kb[0][0].text, /✅/); assert.match(kb[0][1].text, /❌/);
  assert.equal(sent[0].parseMode, undefined, 'plain text: names from customers can never inject markup');
  assert.deepEqual(saved, [[ORDER, '111', 'm-111']], 'the first delivered message is stored so it can be edited later');
});

test('one owner unreachable is fine; all unreachable throws so the failure is recorded', async () => {
  const some = rig({ failFor: new Set(['111']) });
  await some.notifier.orderClaimed(summary());
  assert.deepEqual(some.sent.map((m) => m.chatId), ['222']); assert.deepEqual(some.saved, [[ORDER, '222', 'm-222']]);
  const none = rig({ failFor: new Set(['111', '222']) });
  await assert.rejects(none.notifier.orderClaimed(summary()), /Telegram/);
  assert.equal(none.saved.length, 0);
});

test('customer-controlled text is sanitised: control characters removed, long names and long basket lists truncated, size stays under 4096', () => {
  const text = orderText(summary({ deviceName: 'PC\n\u0007Evil\r' + 'x'.repeat(500), models: Array.from({ length: 40 }, (_, i) => ({ name: `Model ${i}\n${'y'.repeat(300)}`, priceVnd: 15000 })) }));
  assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text.replace(/\n/g, '')), 'no control characters except newlines we add ourselves');
  assert.ok(text.length < 4000);
  assert.ok(text.includes('…'), 'the list is cut with an ellipsis');
  assert.ok(!text.includes('Model 39'), 'only the first models are listed');
});
