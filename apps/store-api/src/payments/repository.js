import { paymentError } from './validation.js';

export async function withPaymentLock(pool, userId, work, { wait = true } = {}) {
  const client = await pool.connect();
  let locked = false;
  let releaseError;
  const connectionError = error => { releaseError = error; };
  client.on('error', connectionError);
  try {
    // Session lock spans the durable insert and remote call, including across API instances.
    if (wait) await client.query("select pg_advisory_lock(hashtextextended('payment:' || $1, 0))", [userId]);
    else {
      const result = await client.query("select pg_try_advisory_lock(hashtextextended('payment:' || $1, 0)) as locked", [userId]);
      if (!result.rows[0].locked) return;
    }
    locked = true;
    return await work(client);
  } finally {
    if (locked) {
      try { await client.query("select pg_advisory_unlock(hashtextextended('payment:' || $1, 0))", [userId]); }
      catch (error) { releaseError = error; }
    }
    client.release(releaseError);
    client.removeListener('error', connectionError);
  }
}

export async function transaction(client, work) {
  await client.query('begin');
  try {
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    try { await client.query('rollback'); } catch { /* Broken connection is discarded by pg. */ }
    throw error;
  }
}

export async function ownedOrder(client, userId, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) {
    throw paymentError('ORDER_NOT_FOUND', 404);
  }
  const order = (await client.query('select * from orders where id=$1 and user_id=$2', [id, userId])).rows[0];
  if (!order) throw paymentError('ORDER_NOT_FOUND', 404);
  return order;
}

export function publicOrder(order) {
  return { id: order.id, orderCode: Number(order.order_code), amountVnd: Number(order.amount_vnd),
    currency: order.currency, status: order.status, checkoutUrl: order.checkout_url,
    qrCode: order.qr_code, createdAt: order.created_at, paidAt: order.paid_at,
    productCode: order.product_code, expiresAt: order.expires_at, bankBin: order.bank_bin,
    accountNumber: order.account_number, accountName: order.account_name, description: order.description,
    fulfillmentResult: order.fulfillment_result };
}
