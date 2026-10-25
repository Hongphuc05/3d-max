import { APIError, PayOS } from '@payos/node';

export function createPaymentProvider(config) {
  if (!config.enabled) return null;
  const sdk = new PayOS({ clientId: config.clientId, apiKey: config.apiKey,
    checksumKey: config.checksumKey, baseURL: 'https://api-merchant.payos.vn',
    timeout: 15000, maxRetries: 0, logLevel: 'off' });
  return {
    create: (input) => sdk.paymentRequests.create(input),
    get: (orderCode) => sdk.paymentRequests.get(orderCode),
    verifyWebhook: (body) => sdk.webhooks.verify(body),
    // Merchant API reports a missing order as HTTP200/code101 as well as HTTP404.
    isNotFound: (error) => error?.status === 404 ||
      (error instanceof APIError && error.status === 200 && error.code === '101'),
  };
}
