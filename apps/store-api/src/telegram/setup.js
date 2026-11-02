// P5.7: dat webhook cho bot (operator chay tay sau khi co domain HTTPS): node scripts/telegram-set-webhook.js
// Tach logic ra day de test duoc; script chi doc moi truong va in ket qua (khong in token / secret / duong dan bi mat).
import { loadTelegramConfig } from './config.js';
import { createTelegramClient } from './client.js';

export function buildWebhookUrl(baseUrl, path) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('TELEGRAM_WEBHOOK_BASE_URL must be an https origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('TELEGRAM_WEBHOOK_BASE_URL must be an https origin');
  return `${url.origin}/api/telegram/webhook/${path}`;
}

export async function setWebhook(env = process.env, { client } = {}) {
  const config = loadTelegramConfig(env);
  if (!config.enabled) throw new Error(config.errors.length ? `Invalid Telegram configuration: ${config.errors.join(', ')}` : 'Telegram is not configured (TELEGRAM_* variables)');
  const url = buildWebhookUrl(env.TELEGRAM_WEBHOOK_BASE_URL, config.webhookPath);
  await (client ?? createTelegramClient({ token: config.botToken })).setWebhook({ url, secretToken: config.webhookSecret });
  return { host: new URL(url).host };
}
