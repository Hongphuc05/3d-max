import test from 'node:test';
import assert from 'node:assert/strict';
import { apiError, ApiError, v3ErrorHandler } from './errors.js';

const run = err => {
  const out = { status: null, body: null, logged: [] };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  const orig = console.error; console.error = (...a) => out.logged.push(a.join(' '));
  try { v3ErrorHandler(err, { requestId: 'rid-1' }, res, () => {}); } finally { console.error = orig; }
  return out;
};

test('ApiError → its own status/code with a Vietnamese message', () => {
  const r = run(apiError('DRIVE_AUTH_REVOKED'));
  assert.equal(r.status, 409); assert.deepEqual(r.body, { error: { code: 'DRIVE_AUTH_REVOKED', message: 'Kết nối Google Drive đã hết hiệu lực. Hãy kết nối lại.', requestId: 'rid-1' } });
});

test('foreign guard error (requireAdmin style) with a clean 4xx is passed through', () => {
  const r = run(Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN', status: 403 }));
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'FORBIDDEN');
});

test('foreign errors that are 5xx, have odd codes, or no status are INTERNAL: nothing from them reaches the client', () => {
  for (const err of [
    Object.assign(new Error('boom password=hunter2'), { code: 'PG_CONNECTION_REFUSED', status: 503 }),
    Object.assign(new Error('x'), { code: 'lower_case', status: 400 }),
    Object.assign(new Error('x'), { code: 'OK_CODE', status: 302 }),
    Object.assign(new Error('x'), { code: "BAD'CODE", status: 400 }),
    new TypeError('Cannot read properties of undefined (reading refresh_token)'),
    'a string', null,
  ]) {
    const r = run(err);
    assert.equal(r.status, 500); assert.equal(r.body.error.code, 'INTERNAL');
    const wire = JSON.stringify(r.body);
    for (const leak of ['hunter2', 'PG_CONNECTION', 'refresh_token', 'lower_case', 'BAD']) assert.ok(!wire.includes(leak), leak);
  }
});

test('body-parser errors map to INVALID_PARAMS', () => {
  assert.equal(run({ type: 'entity.parse.failed' }).body.error.code, 'INVALID_PARAMS');
  assert.equal(run({ type: 'entity.too.large' }).body.error.code, 'INVALID_PARAMS');
});

test('ApiError reason is kept only if it is a plain token (cannot smuggle text)', () => {
  assert.equal(new ApiError('X', 400, { reason: 'downloadRestricted' }).reason, 'downloadRestricted');
  assert.equal(new ApiError('X', 400, { reason: 'has spaces and secrets' }).reason, undefined);
});
