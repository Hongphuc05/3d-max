// P5.1: cau hinh bot Telegram tu bien moi truong. Khong dat gi = tat (khach van mua duoc, admin xac nhan tren web).
// Dat mot phan = loi, chi neu TEN bien (khong bao gio in gia tri: token/secret).
const PATTERNS = {
  TELEGRAM_BOT_TOKEN: /^\d{5,}:[A-Za-z0-9_-]{30,}$/,
  TELEGRAM_WEBHOOK_SECRET: /^[A-Za-z0-9_-]{16,256}$/,   // header X-Telegram-Bot-Api-Secret-Token: 1-256 ky tu A-Za-z0-9_-
  TELEGRAM_WEBHOOK_PATH: /^[A-Za-z0-9_-]{16,128}$/,
};
const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_WEBHOOK_PATH'];
const OPTIONAL = ['TELEGRAM_OWNER_CHAT_IDS', 'TELEGRAM_LOGIN_CLIENT_ID', 'TELEGRAM_LOGIN_CLIENT_SECRET', 'TELEGRAM_LOGIN_REDIRECT_URI'];
const configured = (env, name) => typeof env[name] === 'string' && env[name] !== '';

function loginSettings(env) {
  const hasId = configured(env, 'TELEGRAM_LOGIN_CLIENT_ID');
  const hasSecret = configured(env, 'TELEGRAM_LOGIN_CLIENT_SECRET');
  const loginErrors = [];
  if (hasId !== hasSecret) loginErrors.push(hasId ? 'TELEGRAM_LOGIN_CLIENT_SECRET' : 'TELEGRAM_LOGIN_CLIENT_ID');
  if (hasId && !/^\d{1,20}$/.test(env.TELEGRAM_LOGIN_CLIENT_ID)) loginErrors.push('TELEGRAM_LOGIN_CLIENT_ID');
  if (hasSecret && (env.TELEGRAM_LOGIN_CLIENT_SECRET.length > 1024 || /[\u0000-\u001f\u007f]/.test(env.TELEGRAM_LOGIN_CLIENT_SECRET))) loginErrors.push('TELEGRAM_LOGIN_CLIENT_SECRET');

  let redirectUri = configured(env, 'TELEGRAM_LOGIN_REDIRECT_URI') ? env.TELEGRAM_LOGIN_REDIRECT_URI : null;
  if (!redirectUri && configured(env, 'TELEGRAM_WEBHOOK_BASE_URL')) {
    try { redirectUri = new URL('/api/telegram/login/callback', env.TELEGRAM_WEBHOOK_BASE_URL).href; } catch { /* report login setup below */ }
  }
  if (redirectUri) {
    try {
      const url = new URL(redirectUri);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/telegram/login/callback') {
        loginErrors.push('TELEGRAM_LOGIN_REDIRECT_URI');
      }
    } catch { loginErrors.push('TELEGRAM_LOGIN_REDIRECT_URI'); }
  } else if (hasId && hasSecret) loginErrors.push('TELEGRAM_LOGIN_REDIRECT_URI');

  return { loginConfigured: hasId && hasSecret && Boolean(redirectUri) && loginErrors.length === 0,
    loginErrors: [...new Set(loginErrors)], loginClientId: hasId ? env.TELEGRAM_LOGIN_CLIENT_ID : null,
    loginClientSecret: hasSecret ? env.TELEGRAM_LOGIN_CLIENT_SECRET : null, loginRedirectUri: redirectUri };
}

export function loadTelegramConfig(env = process.env) {
  const names = [...REQUIRED, ...OPTIONAL];
  const set = names.filter((n) => configured(env, n));
  if (!set.length) return { enabled: false, errors: [], loginConfigured: false, loginErrors: [] };
  const errors = REQUIRED.filter((n) => !set.includes(n));
  for (const name of Object.keys(PATTERNS)) if (set.includes(name) && !PATTERNS[name].test(env[name])) errors.push(name);
  let ownerChatIds = [];
  if (configured(env, 'TELEGRAM_OWNER_CHAT_IDS')) {
    const parts = env.TELEGRAM_OWNER_CHAT_IDS.split(',').map((p) => p.trim());
    if (parts.every((p) => /^-?\d{1,15}$/.test(p))) ownerChatIds = parts; else errors.push('TELEGRAM_OWNER_CHAT_IDS');
  }
  if (set.includes('TELEGRAM_WEBHOOK_PATH') && env.TELEGRAM_WEBHOOK_PATH === env.TELEGRAM_WEBHOOK_SECRET) errors.push('TELEGRAM_WEBHOOK_PATH');
  const unique = [...new Set(errors)];
  const login = loginSettings(env);
  if (unique.length) return { enabled: false, errors: unique, loginConfigured: false, loginErrors: login.loginErrors };
  return { enabled: true, errors: [], ownerChatIds, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    webhookPath: env.TELEGRAM_WEBHOOK_PATH, botToken: env.TELEGRAM_BOT_TOKEN, ...login };
}
