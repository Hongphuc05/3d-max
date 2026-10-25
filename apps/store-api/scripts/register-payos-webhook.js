// Explicit operator command only; never imported by API startup.
import { PayOS } from '@payos/node';
import { loadPaymentConfig } from '../src/payments/config.js';
const config = loadPaymentConfig();
if (!config.enabled) {
  console.error('Configure PayOS credentials, callback URLs and public HTTPS webhook before registration.');
  process.exitCode = 1;
} else {
  try {
    const sdk = new PayOS({ clientId: config.clientId, apiKey: config.apiKey,
      checksumKey: config.checksumKey, timeout: 15000, maxRetries: 0, logLevel: 'off' });
    await sdk.webhooks.confirm(config.webhookUrl);
    console.log('PayOS webhook registered successfully.');
  } catch { console.error('Webhook registration failed; check HTTPS endpoint reachability and merchant configuration.'); process.exitCode = 1; }
}
