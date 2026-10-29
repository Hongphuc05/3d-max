import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, withRetry } from './backoff.js';
import { apiError } from './errors.js';

const transient = () => apiError('DRIVE_UPSTREAM_ERROR', { retryable: true });

test('delay grows exponentially, stays within [cap/2, cap], and is bounded by maxMs', () => {
  for (let a = 0; a < 12; a++) {
    const cap = Math.min(300_000, 1000 * 2 ** a);
    for (const r of [0, 0.5, 0.999]) {
      const d = backoffDelay(a, { random: () => r });
      assert.ok(d >= cap / 2 - 1 && d <= cap, `attempt ${a} r=${r} d=${d}`);
    }
  }
});

test('retries transient errors then succeeds, sleeping between attempts', async () => {
  const waits = []; let n = 0;
  const out = await withRetry(async () => { if (++n < 3) throw transient(); return 'ok'; },
    { sleep: async ms => waits.push(ms), random: () => 0 });
  assert.equal(out, 'ok'); assert.equal(n, 3); assert.deepEqual(waits, [500, 1000]);
});

test('permission / not-found are NEVER retried', async () => {
  for (const code of ['DRIVE_PERMISSION_DENIED', 'DRIVE_NOT_FOUND', 'DRIVE_AUTH_REVOKED']) {
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; throw apiError(code); }, { sleep: async () => {} }), { code });
    assert.equal(n, 1, code);
  }
});

test('gives up after the retry budget and surfaces the last error', async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw transient(); }, { retries: 3, sleep: async () => {} }), { code: 'DRIVE_UPSTREAM_ERROR' });
  assert.equal(n, 4);
});

test('Retry-After wins over computed backoff but is capped by maxMs', async () => {
  const waits = []; let n = 0;
  await withRetry(async () => { if (++n < 3) throw apiError('DRIVE_QUOTA_EXCEEDED', { retryable: true, retryAfterMs: n === 1 ? 7000 : 999_999 }); },
    { maxMs: 60_000, sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [7000, 60_000]);
});

test('an aborted caller stops retrying immediately', async () => {
  const ac = new AbortController(); let n = 0;
  await assert.rejects(withRetry(async () => { n++; ac.abort(); throw transient(); }, { signal: ac.signal, sleep: async () => {} }));
  assert.equal(n, 1);
});
