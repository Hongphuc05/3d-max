import { test, expect } from '@playwright/test';

test('offline activation, bundled catalog, reload and import use the native bridge only', async ({ page }) => {
  const apiCalls = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
  await page.addInitScript(() => {
    const listeners = [];
    window.nativeCalls = [];
    window.chrome = { webview: {
      addEventListener: (_event, listener) => listeners.push(listener),
      postMessage: message => {
        window.nativeCalls.push(message);
        const reply = value => listeners.forEach(listener => listener({ data: { id: message.id, ...value } }));
        let result;
        if (message.method === 'library.status') result = { machineCode: 'MACHINE-E2E', licensed: false };
        if (message.method === 'library.activate') {
          if (message.params.license !== 'valid-license') return reply({ ok: false, error: { message: 'License không khớp máy.' } });
          result = { machineCode: 'MACHINE-E2E', licensed: true };
        }
        if (message.method === 'library.refresh') result = { offline: false, message: 'Thư viện có sẵn trong bộ cài.', items: [
          { id: 'chair', name: 'Ghế gỗ', category: 'Ghế' },
        ] };
        if (message.method === 'asset.import') result = { imported: 1 };
        reply({ ok: true, result });
      },
    } };
  });
  await page.goto('/');
  await expect(page.getByLabel('Mã máy', { exact: true })).toHaveValue('MACHINE-E2E');
  await expect(page.getByText('Thư viện có sẵn trong bộ cài.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'License', exact: true }).fill('wrong-license');
  await page.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('License không khớp máy.');
  await page.getByRole('textbox', { name: 'License', exact: true }).fill('valid-license');
  await page.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
  await expect(page.getByText('Đã kích hoạt · Vĩnh viễn')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Ghế gỗ: Đã import vào scene.')).toBeVisible();
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ghế gỗ' })).toBeVisible();
  await page.getByLabel('Tìm model', { exact: true }).fill('không tồn tại');
  await expect(page.getByRole('heading', { name: 'Ghế gỗ' })).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeCalls.find(call => call.method === 'asset.import').params)).toEqual({ assetId: 'chair' });
  expect(apiCalls).toEqual([]);
});

test('ordinary browser explains host requirement without calling a backend', async ({ page }) => {
  const apiCalls = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Mở plugin trong 3ds Max');
  expect(apiCalls).toEqual([]);
});
