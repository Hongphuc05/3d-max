import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentRequest } from './payment-request.js';

test('checkout timeout aborts network and releases stalled action', async () => {
  const controller = new AbortController();
  await assert.rejects(paymentRequest(() => new Promise(() => {}), controller, 5), { code: 'PAYMENT_REQUEST_TIMEOUT' });
  assert.equal(controller.signal.aborted, true);
});

test('unmount cancellation rejects request even if transport never completes', async () => {
  const controller = new AbortController();
  const request = paymentRequest(() => new Promise(() => {}), controller);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});
