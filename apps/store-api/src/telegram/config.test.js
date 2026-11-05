import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTelegramConfig } from './config.js';

const good = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0', TELEGRAM_OWNER_CHAT_IDS: '111222333, -1001234567890',
  TELEGRAM_WEBHOOK_SECRET: 'abcdefghijklmnopqrstuvwx', TELEGRAM_WEBHOOK_PATH: 'path_ABCDEFGHIJKLMNOPQR-12',
};

test('nothing set: Telegram is simply off; owner IDs are optional and can be replaced by linked admin accounts', () => {
  assert.deepEqual(loadTelegramConfig({}), { enabled: false, errors: [], loginConfigured: false, loginErrors: [] });
  assert.deepEqual(loadTelegramConfig({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_OWNER_CHAT_IDS: '', TELEGRAM_WEBHOOK_SECRET: '', TELEGRAM_WEBHOOK_PATH: '' }), { enabled: false, errors: [], loginConfigured: false, loginErrors: [] }, 'an empty .env template means off');
  const c = loadTelegramConfig(good);
  assert.equal(c.enabled, true); assert.deepEqual(c.errors, []);
  assert.deepEqual(c.ownerChatIds, ['111222333', '-1001234567890']);
  assert.equal(c.loginConfigured, false); assert.deepEqual(c.loginErrors, []);
  assert.equal(c.botToken, good.TELEGRAM_BOT_TOKEN); assert.equal(c.webhookPath, good.TELEGRAM_WEBHOOK_PATH); assert.equal(c.webhookSecret, good.TELEGRAM_WEBHOOK_SECRET);
  const linkedOnly = loadTelegramConfig({ TELEGRAM_BOT_TOKEN: good.TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: good.TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_WEBHOOK_PATH: good.TELEGRAM_WEBHOOK_PATH, TELEGRAM_LOGIN_CLIENT_ID: '123456789', TELEGRAM_LOGIN_CLIENT_SECRET: 'secret-from-botfather',
    TELEGRAM_WEBHOOK_BASE_URL: 'https://3dsmood.io.vn' });
  assert.equal(linkedOnly.enabled, true); assert.deepEqual(linkedOnly.ownerChatIds, []);
  assert.equal(linkedOnly.loginConfigured, true); assert.equal(linkedOnly.loginRedirectUri, 'https://3dsmood.io.vn/api/telegram/login/callback');
});

test('a partly configured bot is an error that names required missing variables; partial login config does not break the bot', () => {
  for (const missing of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_WEBHOOK_PATH']) {
    const env = { ...good }; delete env[missing];
    const c = loadTelegramConfig(env);
    assert.equal(c.enabled, false); assert.deepEqual(c.errors, [missing]);
  }
  const blank = loadTelegramConfig({ ...good, TELEGRAM_WEBHOOK_SECRET: '' });
  assert.deepEqual(blank.errors, ['TELEGRAM_WEBHOOK_SECRET']);
  const partialLogin = loadTelegramConfig({ ...good, TELEGRAM_LOGIN_CLIENT_ID: '123456789' });
  assert.equal(partialLogin.enabled, true); assert.equal(partialLogin.loginConfigured, false);
  assert.deepEqual(partialLogin.loginErrors, ['TELEGRAM_LOGIN_CLIENT_SECRET']);
});

test('malformed values are rejected by name only', () => {
  const cases = { TELEGRAM_BOT_TOKEN: ['abc', '123:short', 'x'.repeat(10)], TELEGRAM_OWNER_CHAT_IDS: ['abc', '1,,2', '1;2', '12345678901234567890123', ' '],
    TELEGRAM_WEBHOOK_SECRET: ['short', 'has space in it 123456', 'x'.repeat(257)], TELEGRAM_WEBHOOK_PATH: ['short', 'bad/slash/abcdefghijk', 'x'.repeat(129)] };
  for (const [name, values] of Object.entries(cases)) for (const value of values) {
    const c = loadTelegramConfig({ ...good, [name]: value });
    assert.deepEqual(c.errors, [name], `${name}=${value}`);
    assert.ok(!JSON.stringify(c).includes(value.trim()) || value.trim() === '', 'the value is not echoed');
  }
});

test('the webhook secret and the path must differ (a leaked URL must not leak the header secret)', () => {
  const c = loadTelegramConfig({ ...good, TELEGRAM_WEBHOOK_PATH: good.TELEGRAM_WEBHOOK_SECRET });
  assert.deepEqual(c.errors, ['TELEGRAM_WEBHOOK_PATH']);
});

test('invalid Telegram Login credentials or non-HTTPS callback disable only the connection flow', () => {
  const base = { ...good, TELEGRAM_LOGIN_CLIENT_ID: 'bad id', TELEGRAM_LOGIN_CLIENT_SECRET: 'secret', TELEGRAM_LOGIN_REDIRECT_URI: 'http://example.com/api/telegram/login/callback' };
  const c = loadTelegramConfig(base);
  assert.equal(c.enabled, true); assert.equal(c.loginConfigured, false);
  assert.deepEqual(c.loginErrors, ['TELEGRAM_LOGIN_CLIENT_ID', 'TELEGRAM_LOGIN_REDIRECT_URI']);
  assert.ok(!JSON.stringify([c.errors, c.loginErrors]).includes('secret'), 'diagnostics expose variable names only');
});
