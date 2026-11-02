// P5.1: cau hinh bot Telegram tu bien moi truong. Khong dat gi = tat (khach van mua duoc, admin xac nhan tren web).
// Dat mot phan = loi, chi neu TEN bien (khong bao gio in gia tri: token/secret).
const PATTERNS = {
  TELEGRAM_BOT_TOKEN: /^\d{5,}:[A-Za-z0-9_-]{30,}$/,
  TELEGRAM_WEBHOOK_SECRET: /^[A-Za-z0-9_-]{16,256}$/,   // header X-Telegram-Bot-Api-Secret-Token: 1-256 ky tu A-Za-z0-9_-
  TELEGRAM_WEBHOOK_PATH: /^[A-Za-z0-9_-]{16,128}$/,
};
const NAMES = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_CHAT_IDS', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_WEBHOOK_PATH'];

export function loadTelegramConfig(env = process.env) {
  const set = NAMES.filter((n) => (env[n] ?? '') !== '');
  if (!set.length) return { enabled: false, errors: [] }; // khong dat gi, hoac tat ca de trong (mau .env) = tat bot
  const errors = NAMES.filter((n) => !set.includes(n));
  for (const name of Object.keys(PATTERNS)) if (set.includes(name) && !PATTERNS[name].test(env[name])) errors.push(name);
  let ownerChatIds = [];
  if (set.includes('TELEGRAM_OWNER_CHAT_IDS')) {
    const parts = env.TELEGRAM_OWNER_CHAT_IDS.split(',').map((p) => p.trim());
    if (parts.every((p) => /^-?\d{1,15}$/.test(p))) ownerChatIds = parts; else errors.push('TELEGRAM_OWNER_CHAT_IDS');
  }
  if (set.includes('TELEGRAM_WEBHOOK_PATH') && env.TELEGRAM_WEBHOOK_PATH === env.TELEGRAM_WEBHOOK_SECRET) errors.push('TELEGRAM_WEBHOOK_PATH');
  const unique = [...new Set(errors)];
  if (unique.length) return { enabled: false, errors: unique };
  return { enabled: true, errors: [], botToken: env.TELEGRAM_BOT_TOKEN, ownerChatIds, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET, webhookPath: env.TELEGRAM_WEBHOOK_PATH };
}
