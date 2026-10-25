import test from 'node:test';
import assert from 'node:assert/strict';
import { pollPayment } from './payment-poll.js';

test('polling is sequential, stops on PAID and aborts on cleanup', async () => {
  let scheduled, activeSignal, calls = 0;
  const orders = [];
  const stop = pollPayment({ fetchOrder: async signal => {
    activeSignal = signal;
    return { order: { status: ++calls === 2 ? 'PAID' : 'PENDING' } };
  }, onOrder: order => orders.push(order.status), onError: assert.fail, onTimeout: assert.fail,
  schedule: fn => { scheduled = fn; return 1; }, unschedule: () => { scheduled = null; } });
  await scheduled();
  await scheduled();
  assert.deepEqual(orders, ['PENDING', 'PAID']);
  assert.equal(calls, 2);
  stop();
  assert.equal(activeSignal.aborted, true);
  assert.equal(scheduled, null);
});

test('polling has finite attempts and ignores late response after unmount', async () => {
  let scheduled, resolve;
  let timedOut = false;
  const values = [];
  const schedule = fn => { scheduled = fn; return 1; };
  const stop = pollPayment({ fetchOrder: () => new Promise(done => { resolve = done; }),
    onOrder: order => values.push(order), onError: assert.fail, onTimeout: () => { timedOut = true; },
    schedule, unschedule: () => {}, maxAttempts: 1 });
  const pending = scheduled();
  stop(); resolve({ order: { status: 'PAID' } }); await pending;
  assert.equal(values.length, 0);
  assert.equal(timedOut, false);
  pollPayment({ fetchOrder: async () => ({ order: { status: 'PENDING' } }),
    onOrder: () => {}, onError: assert.fail, onTimeout: () => { timedOut = true; },
    schedule, unschedule: () => {}, maxAttempts: 1 });
  await scheduled();
  await scheduled();
  assert.equal(timedOut, true);
});
