import { paymentError, referenceValid, safePositive, validateIdentity, validateCheckout, validatePaidLink } from './validation.js';
import { LIFETIME_PRICE_VND } from './config.js';
import { ownedOrder, publicOrder, transaction, withPaymentLock } from './repository.js';

export function createPaymentService({ pool, licenseService, config, provider }) {
  function requireEnabled() {
    if (!config.enabled || !provider) throw paymentError('PAYMENTS_UNAVAILABLE', 503);
  }

  async function fulfill(client, order, references, eventType, payload = {}) {
    return transaction(client, async () => {
      await client.query('select id from users where id=$1 for update', [order.user_id]);
      const current = (await client.query('select * from orders where id=$1 for update', [order.id])).rows[0];
      const prior = (await client.query('select id from licenses where user_id=$1', [order.user_id])).rows[0];
      const result = current.status === 'PAID' ? 'ALREADY_PAID' : prior ? 'ALREADY_LICENSED' : 'LICENSE_ISSUED';
      for (const reference of references) {
        const inserted = await client.query(`insert into payment_events(order_id,provider_reference,event_type,result,event_payload)
          values($1,$2,$3,$4,$5) on conflict(provider_reference) do nothing returning id`, [order.id, reference, eventType, result, JSON.stringify(payload)]);
        if (!inserted.rowCount) {
          const event = (await client.query('select order_id from payment_events where provider_reference=$1', [reference])).rows[0];
          if (event.order_id !== order.id) throw paymentError('PAYMENT_REFERENCE_REUSED', 409);
        }
      }
      if (current.status === 'PAID') {
        if (!prior) await licenseService.issueLifetimeLicense(order.user_id, order.id, client);
        return current;
      }
      await licenseService.issueLifetimeLicense(order.user_id, order.id, client);
      return (await client.query(`update orders set status='PAID', paid_at=now(), updated_at=now(),
        fulfillment_result=$2 where id=$1 returning *`, [order.id, result])).rows[0];
    });
  }

  async function reconcileOrder(client, order, expectedLinkId = null) {
    let link;
    try { link = await provider.get(Number(order.order_code)); }
    catch (error) {
      if (provider.isNotFound?.(error)) return null;
      throw paymentError('PAYMENT_PROVIDER_UNAVAILABLE', 503);
    }
    validateIdentity(order, link, link?.id);
    if (expectedLinkId && link.id !== expectedLinkId) throw paymentError('PAYMENT_DATA_MISMATCH', 409);
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(link.id)) throw paymentError('INVALID_PROVIDER_RESPONSE', 502);
    const linked = (await client.query(`update orders set payos_payment_link_id=$2,
      checkout_url=coalesce(checkout_url,$3),updated_at=now() where id=$1 returning *`,
    [order.id, link.id, `https://pay.payos.vn/web/${encodeURIComponent(link.id)}`])).rows[0];
    if (link.status === 'PAID') return fulfill(client, linked, validatePaidLink(linked, link), 'RECONCILIATION',
      { orderCode: link.orderCode, amount: link.amount, paymentLinkId: link.id, status: link.status });
    if (linked.status === 'PAID') return linked;
    const status = { CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', FAILED: 'FAILED' }[link.status];
    if (status) return (await client.query('update orders set status=$2,updated_at=now() where id=$1 returning *', [order.id, status])).rows[0];
    if (!['PENDING', 'UNDERPAID', 'PROCESSING'].includes(link.status)) throw paymentError('INVALID_PROVIDER_RESPONSE', 502);
    return expireOrder(client, linked);
  }

  async function expireOrder(client, order) {
    if (order.status !== 'PENDING' || new Date(order.expires_at).getTime() > Date.now()) return order;
    return (await client.query("update orders set status='EXPIRED',updated_at=now() where id=$1 and status='PENDING' returning *", [order.id])).rows[0]
      || (await client.query('select * from orders where id=$1', [order.id])).rows[0];
  }

  async function prepareOrder(client, userId) {
    return transaction(client, async () => {
      const user = (await client.query('select id from users where id=$1 for update', [userId])).rows[0];
      if (!user) throw paymentError('UNAUTHENTICATED', 401);
      if ((await client.query('select id from licenses where user_id=$1', [userId])).rowCount) {
        throw paymentError('ALREADY_LICENSED', 409);
      }
      await client.query("update orders set status='EXPIRED',updated_at=now() where user_id=$1 and status='PENDING' and (expires_at <= now() or amount_vnd <> $2)", [userId, LIFETIME_PRICE_VND]);
      const existing = (await client.query("select * from orders where user_id=$1 and status='PENDING'", [userId])).rows[0];
      return existing || (await client.query('insert into orders(user_id,amount_vnd) values($1,$2) returning *',
        [userId, LIFETIME_PRICE_VND])).rows[0];
    });
  }

  async function create(user) {
    requireEnabled();
    return withPaymentLock(pool, user.id, async (client) => {
      const order = await prepareOrder(client, user.id);
      if (order.payos_payment_link_id && order.checkout_url) return publicOrder(order);
      if (order.creation_attempted) {
        const recovered = await reconcileOrder(client, order);
        if (recovered) return publicOrder(recovered);
      }
      // Commit this marker before contacting payOS: timeout/restart retries reuse this order code.
      await client.query('update orders set creation_attempted=true,updated_at=now() where id=$1', [order.id]);
      const callback = value => { const url = new URL(value); url.searchParams.set('orderId', order.id); return url.href; };
      let link;
      try {
        link = await provider.create({ orderCode: Number(order.order_code), amount: Number(order.amount_vnd),
          description: '3DsMood', items: [{ name: '3DsMood Lifetime', quantity: 1, price: Number(order.amount_vnd) }],
          buyerEmail: user.email, returnUrl: callback(config.returnUrl), cancelUrl: callback(config.cancelUrl),
          expiredAt: Math.floor(new Date(order.expires_at).getTime()/1000) });
      } catch {
        // A rejected response may still have created the remote link. Never invent a new order code.
        throw paymentError('PAYMENT_CREATION_PENDING', 503);
      }
      validateCheckout(order, link);
      const saved = (await client.query(`update orders set payos_payment_link_id=$2,checkout_url=$3,qr_code=$4,
        bank_bin=$5,account_number=$6,account_name=$7,description=$8,
        updated_at=now() where id=$1 returning *`, [order.id, link.paymentLinkId, link.checkoutUrl, link.qrCode,
        bankField(link.bin), bankField(link.accountNumber), bankField(link.accountName), bankField(link.description)])).rows[0];
      // Creation/return URLs are never fulfillment evidence; only webhook or authoritative get is.
      return publicOrder(saved);
    });
  }

  async function webhook(body) {
    requireEnabled();
    let data;
    try { data = await provider.verifyWebhook(body); }
    catch { throw paymentError('INVALID_WEBHOOK_SIGNATURE', 400); }
    if (body?.success !== true || body.code !== '00' || data?.code !== '00') return { received: true, result: 'IGNORED_NON_SUCCESS' };
    if (!safePositive(data.orderCode)) throw paymentError('INVALID_WEBHOOK_DATA', 400);
    const order = (await pool.query('select * from orders where order_code=$1', [data.orderCode])).rows[0];
    // payOS registration sends a signed sample: acknowledge unknown orders without issuing anything.
    if (!order) return { received: true, result: 'IGNORED_UNKNOWN_ORDER' };
    validateIdentity(order, data, data.paymentLinkId);
    if (data.currency !== 'VND' || !referenceValid(data.reference)) throw paymentError('PAYMENT_DATA_MISMATCH', 409);
    return withPaymentLock(pool, order.user_id, async (client) => {
      const latest = (await client.query('select * from orders where id=$1', [order.id])).rows[0];
      validateIdentity(latest, data, data.paymentLinkId);
      if (!latest.payos_payment_link_id) {
        // Create may have timed out before persisting the link ID. Confirm the remote order first.
        const recovered = await reconcileOrder(client, latest, data.paymentLinkId);
        if (!recovered || recovered.payos_payment_link_id !== data.paymentLinkId) throw paymentError('PAYMENT_DATA_MISMATCH', 409);
      }
      // Store a strict audit whitelist, excluding signatures, credentials and personal bank data.
      await fulfill(client, latest, [data.reference], 'WEBHOOK', { orderCode: data.orderCode, amount: data.amount,
        currency: data.currency, paymentLinkId: data.paymentLinkId, reference: data.reference, code: data.code });
      return { received: true, result: 'PROCESSED' };
    });
  }

  const bankField = value => typeof value === 'string' ? value.slice(0, 200) : null;
  async function get(userId, orderId) {
    const order = await expireOrder(pool, await ownedOrder(pool, userId, orderId));
    const license = order.status === 'PAID' ? (await pool.query(
      `select l.id,l.license_type,l.status,count(d.id)::int as device_count from licenses l
       left join license_devices d on d.license_id=l.id where l.user_id=$1 group by l.id`, [userId])).rows[0] : null;
    return { ...publicOrder(order), entitlement: license ? { id: license.id, type: license.license_type,
      status: license.status, deviceLimit: 2, deviceCount: license.device_count } : null };
  }

  async function reconcilePending({ limit = 20 } = {}) {
    requireEnabled();
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw paymentError('INVALID_REQUEST');
    const needsRecovery = `creation_attempted and (status <> 'PAID' or not exists(select 1 from licenses l where l.user_id=orders.user_id))`;
    const orders = (await pool.query(`select id,user_id from orders where ${needsRecovery}
      and (reconciled_at is null or reconciled_at < now()-interval '60 seconds')
      order by reconciled_at nulls first,created_at limit $1`, [limit])).rows;
    let reconciled = 0, failed = 0;
    for (const order of orders) {
      try {
        await withPaymentLock(pool, order.user_id, async client => {
          // Claim under the same lock used by checkout/webhook, across all API processes.
          const claimed = (await client.query(`update orders set reconciled_at=now() where id=$1 and ${needsRecovery}
            and (reconciled_at is null or reconciled_at < now()-interval '60 seconds') returning *`, [order.id])).rows[0];
          if (claimed) { await reconcileOrder(client, claimed); reconciled += 1; }
        });
      } catch { failed += 1; }
    }
    return { scanned: orders.length, reconciled, failed };
  }

  return {
    product: () => ({ name: '3DsMood Lifetime', licenseType: 'LIFETIME', amountVnd: LIFETIME_PRICE_VND,
      currency: 'VND', available: Boolean(config.enabled && provider) }),
    create, webhook, get, reconcilePending,
    reconcile: async (userId, orderId) => {
      requireEnabled();
      return withPaymentLock(pool, userId, async (client) => {
        const order = await ownedOrder(client, userId, orderId);
        if (order.status === 'PAID' && (await client.query('select id from licenses where user_id=$1', [userId])).rowCount) return publicOrder(order);
        return publicOrder(await reconcileOrder(client, order) || order);
      });
    },
  };
}
