export function paymentError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}
export const safePositive = (value) => Number.isSafeInteger(value) && value > 0;
export const referenceValid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

export function validateIdentity(order, data, id) {
  if (!data || !safePositive(data.orderCode) || data.orderCode !== Number(order.order_code) ||
    !safePositive(data.amount) || data.amount !== Number(order.amount_vnd) || !referenceValid(id) ||
    (order.payos_payment_link_id && id !== order.payos_payment_link_id) ||
    (data.currency !== undefined && data.currency !== 'VND')) throw paymentError('PAYMENT_DATA_MISMATCH', 409);
}

export function validateCheckout(order, data) {
  validateIdentity(order, data, data?.paymentLinkId);
  let url;
  try { url = new URL(data.checkoutUrl); } catch { throw paymentError('INVALID_PROVIDER_RESPONSE', 502); }
  if (data.currency !== 'VND' || url.protocol !== 'https:' || url.username || url.password ||
    !(url.hostname === 'payos.vn' || url.hostname.endsWith('.payos.vn')) ||
    typeof data.qrCode !== 'string' || !data.qrCode || data.qrCode.length > 8192) {
    throw paymentError('INVALID_PROVIDER_RESPONSE', 502);
  }
}

export function validatePaidLink(order, data) {
  validateIdentity(order, data, data?.id);
  if (data.status !== 'PAID' || data.amountPaid !== Number(order.amount_vnd) || data.amountRemaining !== 0 ||
    !Array.isArray(data.transactions) || data.transactions.length === 0 || data.transactions.length > 1000) {
    throw paymentError('PAYMENT_DATA_MISMATCH', 409);
  }
  const references = new Set();
  let sum = 0;
  for (const transaction of data.transactions) {
    if (!referenceValid(transaction.reference) || references.has(transaction.reference) || !safePositive(transaction.amount)) {
      throw paymentError('PAYMENT_DATA_MISMATCH', 409);
    }
    references.add(transaction.reference);
    sum += transaction.amount;
  }
  if (!Number.isSafeInteger(sum) || sum !== Number(order.amount_vnd)) throw paymentError('PAYMENT_DATA_MISMATCH', 409);
  return [...references];
}
