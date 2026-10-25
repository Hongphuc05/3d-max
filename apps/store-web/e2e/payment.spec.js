import { test, expect } from '@playwright/test';

const id = 'a050d4c7-3898-4a0a-9bd2-10902797b937';
const user = { id: 'fixture-account', email: 'buyer@example.test' };
// All merchant/bank operations are mocked. This exercises the shipped React UI in Chromium.
async function fixture(page, { expired = false, activatedHost = false } = {}) {
  const state = { paid: false, creates: 0, reads: 0, user };
  if (activatedHost) await page.addInitScript(() => {
    const listeners = [];
    const identity = { deviceId: '10c638cf-63d6-492f-8f03-d6d9868b72aa',
      publicKey: { kty: 'RSA', n: 'fixture', e: 'AQAB' }, deviceName: 'Activated PC', keyProtection: 'TPM' };
    window.chrome = { webview: {
      addEventListener: (_event, callback) => listeners.push(callback),
      postMessage: message => {
        const result = message.method === 'device.getIdentity' ? identity
          : message.method === 'device.signChallenge' ? { signature: 'fixture-native-proof' }
            : message.method === 'host.getInfo' ? { hostVersion: '3ds Max fixture' } : { objects: 0, renderer: 'fixture' };
        queueMicrotask(() => listeners.forEach(callback => callback({ data: { id: message.id, ok: true, result } })));
      },
    } };
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const license = state.paid ? { id: 'license', type: 'LIFETIME', status: 'ACTIVE', key: 'fixture-key' } : null;
    let json;
    if (path === '/api/auth/me') json = { user: state.user };
    else if (path === '/api/health') json = { ok: true };
    else if (path === '/api/categories') json = [];
    else if (path === '/api/catalog/version') json = {provider:'google_drive',version:0,state:'empty'};
    else if (path === '/api/products') json = { items: [], total: 0 };
    else if (path === '/api/licenses/me') json = { license };
    else if (path === '/api/licenses/devices') json = { devices: [] };
    else if (path === '/api/devices/challenge' && activatedHost) json = { challengeId: 'challenge', message: 'fixture-challenge' };
    else if (path === '/api/devices/verify' && activatedHost) json = { license: { id: 'owner-license', type: 'LIFETIME', status: 'ACTIVE' },
      device: { deviceId: '10c638cf-63d6-492f-8f03-d6d9868b72aa' }, expiresAt: new Date(Date.now() + 900000).toISOString() };
    else if (path === '/api/payments/product') json = { product: { amountVnd: 2000, available: true } };
    else if (path.startsWith('/api/payments/')) {
      if (path.endsWith('/create')) state.creates++;
      else state.reads++;
      json = { order: { id, orderCode: 1000000000001, amountVnd: 2000, currency: 'VND',
        status: state.paid ? 'PAID' : expired ? 'EXPIRED' : 'PENDING',
        qrCode: '0002010102125303704540420005802VN6304ABCD',
        checkoutUrl: 'https://pay.payos.vn/web/fixture', accountNumber: '123456789',
        accountName: '3DSMOOD', bankBin: '970422', description: '3DsMood',
        expiresAt: new Date(Date.now() + (expired ? -1000 : 900000)).toISOString() } };
    } else throw new Error(`Unmocked API ${path}`);
    await route.fulfill({ json });
  });
  return state;
}

test('buy, local QR, reload pending, polling confirms license and stops after close', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'My License · Lifetime' }).click();
  await expect(page.getByText('2.000 ₫', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mua Lifetime', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanh toán 3DsMood Lifetime' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mã VietQR thanh toán' })).toBeVisible();
  await expect(page.getByText('123456789', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'My License · Lifetime' }).click();
  await expect(page.getByRole('img', { name: 'Mã VietQR thanh toán' })).toBeVisible();
  expect(state.creates).toBe(1);
  await page.getByRole('button', { name: 'Đóng thanh toán' }).click();
  const reads = state.reads;
  await page.waitForTimeout(4500);
  expect(state.reads).toBe(reads);
  await page.getByRole('button', { name: 'Tiếp tục đơn thanh toán' }).click();
  state.paid = true;
  await expect(page.getByRole('heading', { name: 'Thanh toán 3DsMood Lifetime' })).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByText('fixture-key', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3DsMood Lifetime - Active' })).toBeVisible();
  await expect(page.getByText('Thiết bị đã gắn (0/2)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mua Lifetime', exact: true })).toHaveCount(0);
});

test('forged return flags cannot grant a license, expired QR is hidden', async ({ page }) => {
  await fixture(page, { expired: true });
  await page.goto(`/payment/cancel?orderId=${id}&status=PAID&success=true&cancel=false`);
  await expect(page.getByText('Mã QR đã hết hạn.', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mã VietQR thanh toán' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '3DsMood Lifetime - Active' })).toHaveCount(0);
});

test('activated plugin machine stays entitled for another account without owner key', async ({ page }) => {
  const state = await fixture(page, { activatedHost: true });
  await page.goto('/license');
  await expect(page.getByRole('heading', { name: 'Máy này đã được kích hoạt', exact: true })).toBeVisible();
  await expect(page.getByText('Thiết bị đã được xác minh. Có thể Download & import.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sao chép mã license', exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('3DM-…')).toHaveCount(0);
  state.user = { id: 'another-account', email: 'another@example.test' };
  await page.reload();
  await expect(page.getByText('another@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Máy này đã được kích hoạt', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sao chép mã license', exact: true })).toHaveCount(0);
  expect(state.creates).toBe(0);
});
