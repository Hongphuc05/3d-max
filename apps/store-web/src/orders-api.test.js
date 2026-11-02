// P5.8: orders-api — dung dung duong dan/body, loi co ma may chu giu nguyen, loi khong co body thanh SERVER_UNAVAILABLE.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cancelOrder, claimPaid, createOrder, getOrder, orderErrorText, ORDER_ERRORS } from './orders-api.js';

const original = globalThis.fetch;
after(() => { globalThis.fetch = original; });
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const calls = [];
const stub = (handler) => { calls.length = 0; globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', body: init.body }); return handler(); }; };

test('each call hits the right path and method; the id is URL-encoded; create sends only model ids', async () => {
  stub(() => json({ ok: 1 }));
  await createOrder(['a', 'b']); await getOrder('x/../y'); await claimPaid('o1'); await cancelOrder('o1');
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [['POST', '/api/v1/orders'], ['GET', '/api/v1/orders/x%2F..%2Fy'], ['POST', '/api/v1/orders/o1/claim-paid'], ['POST', '/api/v1/orders/o1/cancel']]);
  assert.deepEqual(JSON.parse(calls[0].body), { items: [{ modelId: 'a' }, { modelId: 'b' }] });
  assert.equal(calls[1].body, undefined);
});

test('server error codes are kept with the status; a failure without an error body is SERVER_UNAVAILABLE', async () => {
  stub(() => json({ error: { code: 'TOO_MANY_PENDING_ORDERS', message: 'x', requestId: 'r' } }, 429));
  await assert.rejects(createOrder(['a']), (e) => e.code === 'TOO_MANY_PENDING_ORDERS' && e.status === 429);
  stub(() => new Response('<html>502</html>', { status: 502 }));
  await assert.rejects(getOrder('o1'), (e) => e.code === 'SERVER_UNAVAILABLE' && e.status === 502);
  assert.equal(orderErrorText({ code: 'SERVER_UNAVAILABLE' }), ORDER_ERRORS.SERVER_UNAVAILABLE);
  assert.equal(orderErrorText({ code: 'NOPE' }), 'Có lỗi xảy ra. Thử lại sau.');
  assert.equal(orderErrorText(undefined), 'Có lỗi xảy ra. Thử lại sau.');
});

test('every order error shown to the customer is Vietnamese text of its own (no code leaks)', () => {
  for (const [code, text] of Object.entries(ORDER_ERRORS)) assert.ok(text.length > 10 && !text.includes(code), code);
  assert.match(ORDER_ERRORS.ORDER_STATE_INVALID, /không còn ở trạng thái/);
});
