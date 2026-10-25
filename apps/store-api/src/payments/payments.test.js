import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { APIError } from '@payos/node';
import { loadPaymentConfig } from './config.js';
import { createPaymentProvider } from './provider.js';
import { createPaymentService } from './service.js';
import { createPaymentRouter } from './routes.js';
import { validateCheckout, validateIdentity, validatePaidLink } from './validation.js';

export const testConfig = Object.freeze({ enabled: true, amountVnd: 2000,
  publicBaseUrl: 'https://store.example', returnUrl: 'https://store.example/return', cancelUrl: 'https://store.example/cancel', checksumKey: 'fixture-checksum-secret', clientId: 'fixture-client', apiKey: 'fixture-api' });

export function signedWebhook(data, changes = {}) {
  const canonical = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&');
  return { code: '00', success: true, data,
    signature: createHmac('sha256', testConfig.checksumKey).update(canonical).digest('hex'), ...changes };
}

test('payment configuration fails closed for missing secrets, malformed URLs and unsafe VND prices', () => {
  assert.equal(loadPaymentConfig({}).enabled, false);
  const env = { PAYOS_CLIENT_ID: 'c', PAYOS_API_KEY: 'a', PAYOS_CHECKSUM_KEY: 's',
    PAYOS_WEBHOOK_URL: 'https://api.example/api/webhooks/payos', PUBLIC_BASE_URL: 'https://store.example', LICENSE_PRICE_VND: '2000', PAYOS_RETURN_URL: 'https://store.example/return', PAYOS_CANCEL_URL: 'https://store.example/cancel' };
  assert.equal(loadPaymentConfig(env).enabled, true);
  for (const amount of ['0', '-1', '1.1', '1', '500000', '9007199254740992', 'NaN']) {
    assert.equal(loadPaymentConfig({ ...env, LICENSE_PRICE_VND: amount }).enabled, false);
  }
  assert.equal(loadPaymentConfig({ ...env, PAYOS_WEBHOOK_URL: 'http://localhost/webhook' }).enabled, false);
  assert.equal(loadPaymentConfig({ ...env, PUBLIC_BASE_URL: 'https://user:pass@store.example' }).enabled, false);
  assert.equal(loadPaymentConfig({ ...env, NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://localhost:5173' }).enabled, false);
});

test('official SDK verifies a locally signed fixture and rejects tampering without network access', async () => {
  const provider = createPaymentProvider(testConfig);
  const data = { orderCode: 123, amount: 500000, currency: 'VND', paymentLinkId: 'fixture-link', reference: 'fixture-ref', code: '00' };
  assert.deepEqual(await provider.verifyWebhook(signedWebhook(data)), data);
  await assert.rejects(provider.verifyWebhook({ ...signedWebhook(data), data: { ...data, amount: 1 } }));
  await assert.rejects(provider.verifyWebhook({ ...signedWebhook(data), signature: 'forged' }));
});

test('provider responses must match amount, code, currency, link, total and unique references', () => {
  const order = { order_code: '123', amount_vnd: '500000', payos_payment_link_id: 'link' };
  const link = { id: 'link', orderCode: 123, amount: 500000, amountPaid: 500000, amountRemaining: 0,
    status: 'PAID', transactions: [{ amount: 500000, reference: 'ref' }] };
  assert.deepEqual(validatePaidLink(order, link), ['ref']);
  for (const change of [{ orderCode: 1 }, { amount: 1 }, { currency: 'USD' }, { id: 'other' },
    { amountPaid: 1 }, { amountRemaining: 1 }, { status: 'PENDING' }, { transactions: [] },
    { transactions: [{ amount: 250000, reference: 'ref' }, { amount: 250000, reference: 'ref' }] }]) {
    assert.throws(() => validatePaidLink(order, { ...link, ...change }));
  }
  assert.throws(() => validateIdentity(order, { orderCode: '123', amount: 500000 }, 'link'));
  const checkout = { orderCode: 123, amount: 500000, currency: 'VND', paymentLinkId: 'link', checkoutUrl: 'https://pay.payos.vn/web/link', qrCode: 'qr' };
  validateCheckout(order, checkout);
  assert.throws(() => validateCheckout(order, { ...checkout, checkoutUrl: 'https://payos.vn.attacker.example/link' }));
});

test('disabled payment service never contacts provider or database', async () => {
  const service = createPaymentService({ config: { enabled: false }, provider: null, pool: null });
  assert.equal(service.product().available, false);
  await assert.rejects(service.create({ id: 'x' }), { code: 'PAYMENTS_UNAVAILABLE', status: 503 });
  await assert.rejects(service.webhook({}), { code: 'PAYMENTS_UNAVAILABLE' });
});

test('HTTP routes reject client prices, require ownership identity and ignore return query payment claims', async () => {
  const calls = [];
  const service = { product: () => ({ available: true }), create: async (u) => { calls.push(u); return { status: 'PENDING' }; },
    get: async (u, id) => { calls.push([u, id]); return { status: 'PENDING' }; } };
  const app = express();
  app.use(express.json());
  app.use('/api/payments', createPaymentRouter({ service, requireUser: (req, _res, next) => {
    if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] };
    next();
  } }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.code }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/payments`;
  try {
    assert.equal((await fetch(`${base}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'owner' }, body: '{"amount":1}' })).status, 400);
    const response = await fetch(`${base}/order?status=PAID&success=true`, { headers: { 'x-test-user': 'owner' } });
    assert.equal((await response.json()).order.status, 'PENDING');
    assert.deepEqual(calls, [['owner', 'order']]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('fixed product price stays visible while credentials are missing', () => { assert.equal(loadPaymentConfig({}).amountVnd, 2000); });

test('provider recognizes PayOS missing-order API code 101 even with HTTP 200', () => {
  const provider = createPaymentProvider(testConfig);
  const missing = new APIError(200, { code: '101', desc: 'Missing payment' }, undefined, new Headers());
  assert.equal(provider.isNotFound(missing), true);
  assert.equal(provider.isNotFound({ status: 404 }), true);
  assert.equal(provider.isNotFound(new APIError(200, { code: '102' }, undefined, new Headers())), false);
  assert.equal(provider.isNotFound(new Error('101')), false);
  assert.equal(provider.isNotFound({ status: 200, code: '101' }), false);
});
