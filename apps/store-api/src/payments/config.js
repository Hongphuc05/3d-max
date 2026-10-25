export const LIFETIME_PRICE_VND = 2000;

export function loadPaymentConfig(env = process.env) {
  const required = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY',
    'PAYOS_WEBHOOK_URL', 'PAYOS_RETURN_URL', 'PAYOS_CANCEL_URL'];
  const problems = required.filter((key) => !String(env[key] || '').trim());
  if (env.LICENSE_PRICE_VND !== undefined && Number(env.LICENSE_PRICE_VND) !== LIFETIME_PRICE_VND) problems.push('LICENSE_PRICE_VND');
  for (const key of ['PAYOS_RETURN_URL', 'PAYOS_CANCEL_URL', 'PAYOS_WEBHOOK_URL', ...(env.PUBLIC_BASE_URL ? ['PUBLIC_BASE_URL'] : [])]) {
    try {
      const url = new URL(env[key]);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.hash || url.search ||
        !(url.protocol === 'https:' || (key !== 'PAYOS_WEBHOOK_URL' && local && env.NODE_ENV !== 'production' && url.protocol === 'http:'))) problems.push(key);
    } catch { problems.push(key); }
  }
  return Object.freeze({ enabled: problems.length === 0, problems: Object.freeze([...new Set(problems)]),
    amountVnd: LIFETIME_PRICE_VND, returnUrl: env.PAYOS_RETURN_URL, cancelUrl: env.PAYOS_CANCEL_URL,
    webhookUrl: env.PAYOS_WEBHOOK_URL, clientId: env.PAYOS_CLIENT_ID,
    apiKey: env.PAYOS_API_KEY, checksumKey: env.PAYOS_CHECKSUM_KEY });
}
