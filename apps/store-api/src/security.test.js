import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, errorHandler } from './security.js';

test('ingress limiter isolates IP buckets and emits retry-after', () => {
  const limiter = rateLimit({ limit: 2 });
  let next = 0;
  const res = { set(name, value) { this[name] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  for (let i = 0; i < 3; i++) limiter({ ip: '127.0.0.1' }, res, () => next++);
  assert.equal(next, 2); assert.equal(res.code, 429); assert.equal(res['Retry-After'], '60');
  limiter({ ip: '127.0.0.2' }, res, () => next++);
  assert.equal(next, 3);
});

test('expected errors expose only bounded public codes', () => {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  errorHandler({ status: 409, code: 'DEVICE_LIMIT_REACHED', message: 'private detail' }, {}, res, () => {});
  assert.equal(res.code, 409); assert.deepEqual(res.body, { error: 'DEVICE_LIMIT_REACHED' });
});
