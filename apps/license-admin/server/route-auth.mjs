import { getCookie, hasValidCsrf, readSession, validSecurityConfig } from './security.mjs';

export function authorizeMutation(request, env = process.env) {
  if (!validSecurityConfig(env)) return { ok: false, status: 503, message: 'Admin authentication is not configured.' };
  const session = readSession(getCookie(request), { secret: env.ADMIN_SESSION_SECRET });
  if (!session) return { ok: false, status: 401, message: 'Please sign in again.' };
  if (!hasValidCsrf(request, session)) return { ok: false, status: 403, message: 'Request could not be verified.' };
  return { ok: true, session };
}

export function authorizeRead(request, env = process.env) {
  if (!validSecurityConfig(env)) return { ok: false, status: 503, message: 'Admin authentication is not configured.' };
  const session = readSession(getCookie(request), { secret: env.ADMIN_SESSION_SECRET });
  if (!session) return { ok: false, status: 401, message: 'Please sign in.' };
  return { ok: true, session };
}
