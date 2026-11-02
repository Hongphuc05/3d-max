// P5.7: node --env-file-if-exists=.env scripts/telegram-set-webhook.js   (can TELEGRAM_* va TELEGRAM_WEBHOOK_BASE_URL=https://domain-cua-ban)
import { setWebhook } from '../src/telegram/setup.js';

try {
  const { host } = await setWebhook(process.env);
  console.log(`Webhook set for ${host} (path and secret are not printed).`);
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exitCode = 1;
}
