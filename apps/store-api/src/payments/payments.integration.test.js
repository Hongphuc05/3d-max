import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { createPaymentService } from './service.js';
import { createPaymentProvider } from './provider.js';
import { issueLifetimeLicense } from '../licensing/service.js';

// Never fall back to DATABASE_URL: caller explicitly opts into a dedicated test DB.
const testUrl = process.env.TEST_DATABASE_URL;
const config = { enabled: true, amountVnd: 2000, publicBaseUrl: 'https://store.example', returnUrl: 'https://store.example/return', cancelUrl: 'https://store.example/cancel',
  checksumKey: 'fixture-checksum-secret', clientId: 'fixture-client', apiKey: 'fixture-api' };
const sdk = createPaymentProvider(config);
function webhook(order, changes = {}) {
  const data = { orderCode: order.orderCode, amount: order.amountVnd, currency: 'VND',
    paymentLinkId: `link_${order.orderCode}`, reference: `ref_${order.orderCode}`, code: '00', ...changes };
  const canonical = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&');
  return { code: '00', success: true, data, signature: createHmac('sha256', config.checksumKey).update(canonical).digest('hex') };
}

test('real PostgreSQL payment transactions with mock payOS (isolated schema)', { skip: !testUrl }, async (t) => {
  const schema = `payments_test_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: testUrl });
  await admin.query(`create schema ${schema}`);
  const pool = new pg.Pool({ connectionString: testUrl, options: `-c search_path=${schema},public` });
  const priorHmac = process.env.LICENSE_HMAC_SECRET;
  const priorEncryption = process.env.LICENSE_ENCRYPTION_KEY;
  process.env.LICENSE_HMAC_SECRET = randomBytes(32).toString('base64');
  process.env.LICENSE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    const dir = new URL('../../migrations/', import.meta.url);
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await pool.query(readFileSync(new URL(file, dir), 'utf8'));
    }
    let creates = [];
    const remote = new Map();
    const provider = { verifyWebhook: sdk.verifyWebhook, isNotFound: e => e.status === 404,
      create: async input => {
        creates = [...creates, input];
        const link = { orderCode: input.orderCode, amount: input.amount, currency: 'VND',
          paymentLinkId: `link_${input.orderCode}`, checkoutUrl: `https://pay.payos.vn/web/link_${input.orderCode}`, qrCode: 'fixture-qr', status: 'PENDING', bin: '970422', accountNumber: '123456', accountName: 'FIXTURE', description: input.description };
        remote.set(input.orderCode, { ...link, id: link.paymentLinkId, amountPaid: 0, amountRemaining: input.amount, transactions: [] });
        return link;
      }, get: async code => { if (!remote.has(code)) throw Object.assign(new Error(), { status: 404 }); return remote.get(code); } };
    const licenseService = { issueLifetimeLicense };
    const service = createPaymentService({ pool, licenseService, provider, config });
    const user = async () => (await pool.query('insert into users(email,password_hash) values($1,$2) returning id,email', [`${randomUUID()}@test.example`, 'not-a-real-password'])).rows[0];
    const countLicenses = async id => Number((await pool.query('select count(*) from licenses where user_id=$1', [id])).rows[0].count);

    await t.test('server amount; concurrent creation reuses one durable order and one remote call', async () => {
      const owner = await user(); const before = creates.length;
      const [a, b] = await Promise.all([service.create(owner), service.create({ ...owner, amount: 1 })]);
      assert.equal(a.id, b.id); assert.equal(a.amountVnd, config.amountVnd); assert.equal(creates.length, before + 1);
      assert.equal(creates.at(-1).amount, 2000);
      assert.ok(creates.at(-1).expiredAt > Date.now()/1000 + 880);
      assert.match(creates.at(-1).returnUrl, /^https:\/\/store.example\/return\?orderId=/);
      assert.equal(a.accountNumber, '123456'); assert.ok(a.expiresAt);
      assert.equal(a.productCode, '3DSMOOD_LIFETIME');
      await assert.rejects(service.get((await user()).id, a.id), { code: 'ORDER_NOT_FOUND' });
    });
    await t.test('old pending price cannot override the new fixed 2000 VND purchase', async () => {
      const owner = await user();
      const legacy = (await pool.query('insert into orders(user_id,amount_vnd) values($1,500000) returning id,order_code', [owner.id])).rows[0];
      await pool.query('update orders set payos_payment_link_id=$2 where id=$1', [legacy.id, `link_${legacy.order_code}`]);
      const current = await service.create(owner);
      assert.equal(current.amountVnd, 2000); assert.notEqual(current.id, legacy.id);
      assert.equal((await service.get(owner.id, legacy.id)).status, 'EXPIRED');
      await service.webhook(webhook({ orderCode: Number(legacy.order_code), amountVnd: 500000 }));
      assert.equal((await service.get(owner.id, legacy.id)).status, 'PAID');
      assert.equal(await countLicenses(owner.id), 1);
    });
    await t.test('signed successful webhook + concurrent duplicate fulfills exactly one license', async () => {
      const owner = await user(); const order = await service.create(owner);
      await Promise.all([service.webhook(webhook(order)), service.webhook(webhook(order))]);
      assert.equal(await countLicenses(owner.id), 1);
      assert.equal((await service.get(owner.id, order.id)).status, 'PAID');
      assert.equal((await service.get(owner.id, order.id)).entitlement.deviceLimit, 2);
      assert.equal(Number((await pool.query('select count(*) from payment_events where order_id=$1', [order.id])).rows[0].count), 1);
      await assert.rejects(service.create(owner), { code: 'ALREADY_LICENSED' });
    });
    await t.test('bad signature, signed wrong amount/currency/link/order, and registration sample never fulfill', async () => {
      const owner = await user(); const order = await service.create(owner);
      await assert.rejects(service.webhook({ ...webhook(order), signature: 'invalid' }), { code: 'INVALID_WEBHOOK_SIGNATURE' });
      for (const change of [{ amount: 1 }, { currency: 'USD' }, { paymentLinkId: 'wrong' }, { reference: '' }]) {
        await assert.rejects(service.webhook(webhook(order, change)), { code: 'PAYMENT_DATA_MISMATCH' });
      }
      assert.equal((await service.webhook(webhook(order, { orderCode: 123 }))).result, 'IGNORED_UNKNOWN_ORDER');
      assert.equal((await service.webhook({ ...webhook(order), success: false })).result, 'IGNORED_NON_SUCCESS');
      assert.equal(await countLicenses(owner.id), 0); assert.equal((await service.get(owner.id, order.id)).status, 'PENDING');
    });
    await t.test('license insert failure rolls back paid state, event, and inserted license', async () => {
      const owner = await user(); const order = await service.create(owner);
      const broken = createPaymentService({ pool, provider, config, licenseService: { issueLifetimeLicense: async (...args) => {
        await issueLifetimeLicense(...args); throw new Error('simulated connection loss before commit');
      } } });
      await assert.rejects(broken.webhook(webhook(order)));
      assert.equal(await countLicenses(owner.id), 0); assert.equal((await service.get(owner.id, order.id)).status, 'PENDING');
      assert.equal(Number((await pool.query('select count(*) from payment_events where order_id=$1', [order.id])).rows[0].count), 0);
      await service.webhook(webhook(order)); assert.equal(await countLicenses(owner.id), 1);
    });
    await t.test('terminated PostgreSQL connection rolls back fulfillment and retry succeeds', async () => {
      const owner = await user(); const order = await service.create(owner);
      const disconnected = createPaymentService({ pool, provider, config, licenseService: { issueLifetimeLicense: async (...args) => {
        await issueLifetimeLicense(...args);
        const client = args[2];
        const pid = (await client.query('select pg_backend_pid() as pid')).rows[0].pid;
        await pool.query('select pg_terminate_backend($1)', [pid]);
        await client.query('select 1');
      } } });
      await assert.rejects(disconnected.webhook(webhook(order)));
      assert.equal(await countLicenses(owner.id), 0);
      assert.equal((await service.get(owner.id, order.id)).status, 'PENDING');
      assert.equal(Number((await pool.query('select count(*) from payment_events where order_id=$1', [order.id])).rows[0].count), 0);
      await service.webhook(webhook(order));
      assert.equal(await countLicenses(owner.id), 1);
      assert.equal((await service.get(owner.id, order.id)).status, 'PAID');
    });
    await t.test('account licensed during payment records ALREADY_LICENSED disposition', async () => {
      const owner = await user(); const order = await service.create(owner);
      const client = await pool.connect();
      try { await client.query('begin'); await issueLifetimeLicense(owner.id, null, client); await client.query('commit'); }
      finally { client.release(); }
      await service.webhook(webhook(order));
      assert.equal(await countLicenses(owner.id), 1);
      assert.equal((await service.get(owner.id, order.id)).fulfillmentResult, 'ALREADY_LICENSED');
    });
    await t.test('timeout after upstream creation recovers same code/link without creating a second charge', async () => {
      const owner = await user(); const before = creates.length;
      const uncertain = createPaymentService({ pool, config, licenseService, provider: { ...provider, create: async input => {
        await provider.create(input); throw new Error('network timeout');
      } } });
      await assert.rejects(uncertain.create(owner), { code: 'PAYMENT_CREATION_PENDING' });
      const recovered = await service.create(owner);
      assert.equal(creates.length, before + 1); assert.ok(recovered.checkoutUrl); assert.equal(recovered.status, 'PENDING');
      assert.equal(Number((await pool.query('select count(*) from orders where user_id=$1', [owner.id])).rows[0].count), 1);
    });
    await t.test('reconciliation validates authoritative transactions then fulfills; forged data does not', async () => {
      const owner = await user(); const order = await service.create(owner);
      const pending = remote.get(order.orderCode);
      remote.set(order.orderCode, { ...pending, status: 'PAID', amountPaid: config.amountVnd, amountRemaining: 0,
        transactions: [{ reference: `reconcile_${order.orderCode}`, amount: 1 }] });
      await assert.rejects(service.reconcile(owner.id, order.id), { code: 'PAYMENT_DATA_MISMATCH' });
      assert.equal(await countLicenses(owner.id), 0);
      remote.set(order.orderCode, { ...remote.get(order.orderCode), transactions: [{ reference: `reconcile_${order.orderCode}`, amount: config.amountVnd }] });
      assert.equal((await service.reconcile(owner.id, order.id)).status, 'PAID');
      assert.equal(await countLicenses(owner.id), 1);
    });
    await t.test('expiry survives restart, permits new checkout, and late valid payment still fulfills', async () => {
      const owner = await user(); const order = await service.create(owner);
      await pool.query("update orders set expires_at=now()-interval '1 second' where id=$1", [order.id]);
      const restarted = createPaymentService({ pool, provider, config, licenseService });
      assert.equal((await restarted.get(owner.id, order.id)).status, 'EXPIRED');
      const next = await restarted.create(owner); assert.notEqual(next.id, order.id);
      await restarted.webhook(webhook(order));
      assert.equal((await restarted.get(owner.id, order.id)).status, 'PAID');
      assert.equal(await countLicenses(owner.id), 1);
    });
    await t.test('offline reconciliation sweep recovers missing webhook and preserves paid against stale cancellation', async () => {
      const owner = await user(); const order = await service.create(owner);
      remote.set(order.orderCode, { ...remote.get(order.orderCode), status: 'PAID', amountPaid: 2000, amountRemaining: 0,
        transactions: [{ reference: `offline_${order.orderCode}`, amount: 2000 }] });
      assert.ok((await service.reconcilePending({ limit: 100 })).reconciled > 0);
      assert.equal(await countLicenses(owner.id), 1);
      remote.set(order.orderCode, { ...remote.get(order.orderCode), status: 'CANCELLED' });
      assert.equal((await service.reconcile(owner.id, order.id)).status, 'PAID');
      assert.equal((await service.get(owner.id, order.id)).entitlement.deviceCount, 0);
      const event = (await pool.query('select event_payload,received_at from payment_events where order_id=$1', [order.id])).rows[0];
      assert.ok(event.received_at);
      assert.equal(JSON.stringify(event.event_payload).includes(config.checksumKey), false);
      await assert.rejects(service.reconcilePending({ limit: 1000 }), { code: 'INVALID_REQUEST' });
    });
    await t.test('authoritative reconciliation repairs a PAID ledger missing its entitlement', async () => {
      const owner = await user(); const order = await service.create(owner);
      await pool.query("update orders set status='PAID',paid_at=now(),fulfillment_result='LICENSE_ISSUED' where id=$1", [order.id]);
      remote.set(order.orderCode, { ...remote.get(order.orderCode), status: 'PAID', amountPaid: 2000, amountRemaining: 0,
        transactions: [{ reference: `repair_${order.orderCode}`, amount: 2000 }] });
      assert.equal(await countLicenses(owner.id), 0);
      assert.ok((await service.reconcilePending({ limit: 100 })).reconciled > 0);
      assert.equal(await countLicenses(owner.id), 1);
      assert.equal((await service.get(owner.id, order.id)).entitlement.status, 'ACTIVE');
      const other = await user();
      await assert.rejects(pool.query(`insert into licenses(user_id,order_id,key_hash,key_ciphertext,key_iv,key_auth_tag,key_last4)
        select $1,order_id,$2,key_ciphertext,key_iv,key_auth_tag,key_last4 from licenses where user_id=$3`,
        [other.id, randomBytes(32), owner.id]), { constraint: 'licenses_order_id_unique' });
    });
    await t.test('provider cancellation updates status; delayed verified payment remains fulfilled once', async () => {
      const owner = await user(); const order = await service.create(owner);
      remote.set(order.orderCode, { ...remote.get(order.orderCode), status: 'CANCELLED' });
      assert.equal((await service.reconcile(owner.id, order.id)).status, 'CANCELLED');
      await service.webhook(webhook(order));
      assert.equal((await service.get(owner.id, order.id)).status, 'PAID'); assert.equal(await countLicenses(owner.id), 1);
    });
  } finally {
    if (priorHmac === undefined) delete process.env.LICENSE_HMAC_SECRET; else process.env.LICENSE_HMAC_SECRET = priorHmac;
    if (priorEncryption === undefined) delete process.env.LICENSE_ENCRYPTION_KEY; else process.env.LICENSE_ENCRYPTION_KEY = priorEncryption;
    await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
});
