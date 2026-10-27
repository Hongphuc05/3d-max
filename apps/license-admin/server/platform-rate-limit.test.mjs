import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceAdminLoginRateLimit } from './platform-rate-limit.mjs';

test('uses Vercel shared rate limiting for production logins', async () => {
  const request = new Request('https://admin.example.test/api/session', { method: 'POST' });
  let call;
  const result = await enforceAdminLoginRateLimit(request, {
    production: true,
    checkRateLimit: async (...args) => {
      call = args;
      return { rateLimited: true };
    }
  });

  assert.deepEqual(result, { allowed: false, rateLimited: true });
  assert.equal(call[0], 'admin-session-login');
  assert.equal(call[1].request, request);
  assert.equal(call[1].timeout, 1000);
});

test('does not call Vercel Firewall outside production', async () => {
  const result = await enforceAdminLoginRateLimit(new Request('http://localhost/api/session'), {
    production: false,
    checkRateLimit: async () => { throw new Error('must not be called'); }
  });

  assert.deepEqual(result, { allowed: true, rateLimited: false });
});

test('fails closed when the production rate-limit service is unavailable', async () => {
  const result = await enforceAdminLoginRateLimit(new Request('https://admin.example.test/api/session'), {
    production: true,
    checkRateLimit: async () => { throw new Error('service unavailable'); }
  });

  assert.deepEqual(result, { allowed: false, rateLimited: false, unavailable: true });
});

test('fails closed when the Vercel rate-limit ID is not configured', async () => {
  const result = await enforceAdminLoginRateLimit(new Request('https://admin.example.test/api/session'), {
    production: true,
    checkRateLimit: async () => ({ rateLimited: false, error: 'not-found' })
  });

  assert.deepEqual(result, { allowed: false, rateLimited: false, unavailable: true });
});

test('reports an active Vercel block as a normal rate limit', async () => {
  const result = await enforceAdminLoginRateLimit(new Request('https://admin.example.test/api/session'), {
    production: true,
    checkRateLimit: async () => ({ rateLimited: true, error: 'blocked' })
  });

  assert.deepEqual(result, { allowed: false, rateLimited: true });
});
