import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebhookUrl, setWebhook } from './setup.js';

const env = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0', TELEGRAM_OWNER_CHAT_IDS: '111', TELEGRAM_WEBHOOK_SECRET: 'abcdefghijklmnopqrstuvwx',
  TELEGRAM_WEBHOOK_PATH: 'path_ABCDEFGHIJKLMNOPQR-12', TELEGRAM_WEBHOOK_BASE_URL: 'https://shop.example.com',
};

test('the webhook URL is the https origin + /api/telegram/webhook/<secret path>; anything else is refused', () => {
  assert.equal(buildWebhookUrl('https://shop.example.com', 'abc'), 'https://shop.example.com/api/telegram/webhook/abc');
  assert.equal(buildWebhookUrl('https://shop.example.com/', 'abc'), 'https://shop.example.com/api/telegram/webhook/abc');
  for (const bad of ['http://shop.example.com', 'https://shop.example.com/base', 'https://u:p@shop.example.com', 'https://shop.example.com/?x=1', 'ftp://x', 'nope', '', undefined])
    assert.throws(() => buildWebhookUrl(bad, 'abc'), /https origin/, String(bad));
});

test('setWebhook registers the URL with the secret token and prints only the host', async () => {
  const sent = [];
  const out = await setWebhook(env, { client: { setWebhook: async (a) => { sent.push(a); } } });
  assert.deepEqual(out, { host: 'shop.example.com' });
  assert.deepEqual(sent, [{ url: `https://shop.example.com/api/telegram/webhook/${env.TELEGRAM_WEBHOOK_PATH}`, secretToken: env.TELEGRAM_WEBHOOK_SECRET }]);
  await assert.rejects(setWebhook({}, {}), /not configured/);
  await assert.rejects(setWebhook({ ...env, TELEGRAM_WEBHOOK_SECRET: 'x' }, {}), (e) => /TELEGRAM_WEBHOOK_SECRET/.test(e.message) && !e.message.includes('x'.repeat(8)));
  await assert.rejects(setWebhook({ ...env, TELEGRAM_WEBHOOK_BASE_URL: 'http://shop.example.com' }, { client: { setWebhook: async () => {} } }), /https origin/);
});
