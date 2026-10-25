import test from 'node:test';
import assert from 'node:assert/strict';
import { startPaymentMaintenance } from './maintenance.js';

test('payment maintenance is disabled without credentials', () => {
  const stop = startPaymentMaintenance(null, false); stop();
});

test('bounded maintenance avoids overlap and stops its timer', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0, finish;
  const service = { reconcilePending: async options => {
    assert.deepEqual(options, { limit: 20 }); calls += 1;
    if (calls === 1) await new Promise(resolve => { finish = resolve; });
    return { failed: 0 };
  } };
  const stop = startPaymentMaintenance(service, true);
  t.mock.timers.tick(60000); await Promise.resolve(); assert.equal(calls, 1);
  t.mock.timers.tick(60000); await Promise.resolve(); assert.equal(calls, 1);
  finish(); await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(60000); await Promise.resolve(); assert.equal(calls, 2);
  stop(); t.mock.timers.tick(120000); assert.equal(calls, 2);
});

test('maintenance records sanitized failure counts and retries provider failure', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const log = t.mock.method(console, 'error', () => {});
  let calls = 0;
  const stop = startPaymentMaintenance({ reconcilePending: async () => {
    calls += 1; if (calls === 1) throw new Error('secret provider payload');
    return { failed: 2 };
  } }, true);
  t.mock.timers.tick(60000); await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(60000); await Promise.resolve(); await Promise.resolve();
  stop(); assert.equal(calls, 2); assert.equal(log.mock.callCount(), 2);
  assert.equal(JSON.stringify(log.mock.calls).includes('secret provider payload'), false);
});
