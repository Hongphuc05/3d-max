const RATE_LIMIT_ID = 'admin-session-login';

async function vercelCheckRateLimit(id, options) {
  const { checkRateLimit } = await import('@vercel/firewall');
  return checkRateLimit(id, options);
}

export async function enforceAdminLoginRateLimit(request, {
  production = process.env.VERCEL_ENV === 'production',
  checkRateLimit = vercelCheckRateLimit
} = {}) {
  if (!production) return { allowed: true, rateLimited: false };

  try {
    const result = await checkRateLimit(RATE_LIMIT_ID, { request, timeout: 1000 });
    if (typeof result?.rateLimited !== 'boolean') throw new Error('Invalid rate-limit response.');
    if (result.rateLimited) return { allowed: false, rateLimited: true };
    if (result.error) throw new Error('Invalid rate-limit response.');
    return { allowed: true, rateLimited: false };
  } catch {
    return { allowed: false, rateLimited: false, unavailable: true };
  }
}
