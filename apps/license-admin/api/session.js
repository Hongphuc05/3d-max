import {
  clearSessionCookie,
  clientRateLimitKey,
  consumeLoginAttempt,
  createSession,
  getCookie,
  hasSameOrigin,
  hasValidCsrf,
  jsonResponse,
  readJsonObject,
  resetLoginAttempts,
  SESSION_COOKIE,
  sessionCookie,
  validSecurityConfig,
  constantTimeEqual,
  readSession
} from '../server/security.mjs';
import { enforceAdminLoginRateLimit } from '../server/platform-rate-limit.mjs';

async function handle(request) {
  if (request.method === 'GET') {
    if (!validSecurityConfig()) return jsonResponse(503, { authenticated: false, error: 'Admin authentication is not configured.' });
    const session = readSession(getCookie(request, SESSION_COOKIE), { secret: process.env.ADMIN_SESSION_SECRET });
    return session
      ? jsonResponse(200, { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt })
      : jsonResponse(200, { authenticated: false });
  }

  if (request.method === 'POST') {
    if (!hasSameOrigin(request)) return jsonResponse(403, { error: 'Request could not be verified.' });
    if (!validSecurityConfig()) return jsonResponse(503, { error: 'Admin authentication is not configured.' });
    const platformRate = await enforceAdminLoginRateLimit(request);
    if (!platformRate.allowed) {
      if (platformRate.unavailable) return jsonResponse(503, { error: 'Admin sign-in is temporarily unavailable.' });
      return jsonResponse(429, { error: 'Too many login attempts. Try again later.' }, { 'Retry-After': '60' });
    }
    const rate = consumeLoginAttempt(clientRateLimitKey(request));
    if (!rate.allowed) return jsonResponse(429, { error: 'Too many login attempts. Try again later.' }, { 'Retry-After': String(rate.retryAfterSeconds) });

    let body;
    try {
      body = await readJsonObject(request);
    } catch (error) {
      return jsonResponse(error.status ?? 400, { error: error.message });
    }
    if (Object.keys(body).some(key => key !== 'password') || typeof body.password !== 'string'
        || Buffer.byteLength(body.password, 'utf8') > 256) {
      return jsonResponse(400, { error: 'Enter the admin password.' });
    }
    if (!constantTimeEqual(body.password, process.env.ADMIN_PASSWORD)) {
      return jsonResponse(401, { error: 'Password is incorrect.' });
    }

    resetLoginAttempts(clientRateLimitKey(request));
    const session = createSession({ secret: process.env.ADMIN_SESSION_SECRET });
    return jsonResponse(200, { authenticated: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, {
      'Set-Cookie': sessionCookie(session.token, request)
    });
  }

  if (request.method === 'DELETE') {
    if (!validSecurityConfig()) return jsonResponse(503, { error: 'Admin authentication is not configured.' });
    const session = readSession(getCookie(request, SESSION_COOKIE), { secret: process.env.ADMIN_SESSION_SECRET });
    if (!session) return jsonResponse(401, { error: 'Please sign in again.' }, { 'Set-Cookie': clearSessionCookie(request) });
    if (!hasValidCsrf(request, session)) return jsonResponse(403, { error: 'Request could not be verified.' });
    return jsonResponse(200, { authenticated: false }, { 'Set-Cookie': clearSessionCookie(request) });
  }

  return jsonResponse(405, { error: 'Method not allowed.' }, { Allow: 'GET, POST, DELETE' });
}

export default { fetch: handle };
