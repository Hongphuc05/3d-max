import { test, expect } from '@playwright/test';

const originalAdmin = { id: 'admin-fixture', email: 'internal@admin.invalid', username: 'fixture_owner', role: 'ADMIN', mustChangeCredentials: true };
const customer = { id: 'customer-fixture', email: 'buyer@example.test', createdAt: '2026-10-25T00:00:00Z', deviceCount: 1 };
async function fixture(page, { authenticated = false, firstLogin = true } = {}) {
  const state = { user: authenticated ? { ...originalAdmin, mustChangeCredentials: firstLogin } : null, license: null, changes: [], issues: 0, resumes: 0, revokes: [], searches: [] };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let json, status = 200;
    if (path === '/api/catalog/events') return route.fulfill({ status: 204, body: '' });
    if (path === '/api/auth/me') { json = state.user ? { user: state.user } : { error: 'UNAUTHENTICATED' }; if (!state.user) status = 401; }
    else if (path === '/api/auth/login') { const body = request.postDataJSON(); expect(body).toEqual({ email: 'fixture_owner', password: 'test-only-bootstrap-password' }); state.user = { ...originalAdmin }; json = { user: state.user }; }
    else if (path === '/api/auth/logout') { state.user = null; json = { ok: true }; }
    else if (path === '/api/admin/account') { const body = request.postDataJSON(); state.changes.push(body); state.user = { ...state.user, username: body.username, mustChangeCredentials: false }; json = { user: state.user }; }
    else if (path === '/api/admin/overview') json = { stats: { users: 12, activeLicenses: 8, paidOrders: 6, revenueVnd: 12000 }, catalog: { provider: 'r2', state: 'ready', syncing: false, lastSuccessfulSync: '2026-10-25T00:00:00Z', version: 2 } };
    else if (path === '/api/admin/catalog/sync/permission') json = { allowed: Boolean(state.user?.role === 'ADMIN' && !state.user?.mustChangeCredentials) };
    else if (path === '/api/admin/catalog/sync') { json = { accepted: true }; status = 202; }
    else if (path === '/api/admin/users') { state.searches.push(url.searchParams.get('q')); json = { items: [{ ...customer, license: state.license }], page: 1, total: 1, limit: 20 }; }
    else if (path === `/api/admin/users/${customer.id}`) json = { user: customer, license: state.license, devices: [{ id: 'slot-fixture', slotNumber: 1, deviceId: 'device-fixture', deviceName: 'Artist PC', keyProtection: 'TPM', activatedAt: customer.createdAt, lastSeenAt: customer.createdAt }], orders: [], audit: [] };
    else if (path === '/api/admin/licenses/issue') { expect(request.postDataJSON()).toEqual({ userId: customer.id }); state.issues++; state.license = { id: 'license-fixture', type: 'LIFETIME', status: 'ACTIVE', last4: 'ABCD' }; json = { license: state.license }; }
    else if (path === '/api/admin/licenses/revoke') { const body = request.postDataJSON(); state.revokes.push(body); state.license = { ...state.license, status: body.status }; json = { license: state.license }; }
    else if (path === '/api/admin/licenses/resume') { expect(request.postDataJSON()).toEqual({ userId: customer.id }); state.resumes++; state.license = { ...state.license, status: 'ACTIVE' }; json = { license: state.license }; }
    else if (path === '/api/admin/orders') json = { items: [{ id: 'order-fixture', email: customer.email, userId: customer.id, orderCode: 100000000001, status: 'PAID', amountVnd: 2000, createdAt: customer.createdAt, paidAt: customer.createdAt }], page: 1, limit: 20, total: 1 };
    else if (path === '/api/admin/audit') json = { items: [{ id: 'audit-fixture', eventType: 'LICENSE_REVOKED', actorEmail: originalAdmin.email, targetEmail: customer.email, createdAt: customer.createdAt, details: { reason: 'Đối chiếu vi phạm' } }], page: 1, limit: 20, total: 1 };
    else if (path === '/api/health') json = { ok: true };
    else if (path === '/api/categories') json = [];
    else if (path === '/api/catalog/version') json = { provider: 'r2', state: 'empty', version: 0 };
    else if (path === '/api/products') json = { items: [], total: 0 };
    else if (path === '/api/licenses/me') json = { license: null };
    else if (path === '/api/licenses/devices') json = { devices: [] };
    else throw new Error(`Unhandled admin E2E route ${path}`);
    await route.fulfill({ status, json });
  });
  return state;
}

test('admin username login opens separate UI, initial password change unlocks management and persists on reload', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email hoặc tên đăng nhập' }).fill('fixture_owner');
  await page.getByPlaceholder('Mật khẩu', { exact: true }).fill('test-only-bootstrap-password');
  await page.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Quản trị 3DsMood' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tài khoản & license' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'My License · Lifetime' })).toHaveCount(0);
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('mood_owner');
  await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill('test-only-bootstrap-password');
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('owner-new-password');
  await page.getByLabel('Xác nhận mật khẩu mới', { exact: true }).fill('owner-new-password');
  await page.getByRole('button', { name: 'Lưu thông tin đăng nhập' }).click();
  await expect(page.getByRole('status')).toContainText('Đã lưu thông tin đăng nhập');
  expect(state.changes).toEqual([{ username: 'mood_owner', currentPassword: 'test-only-bootstrap-password', newPassword: 'owner-new-password' }]);
  await expect(page.getByRole('button', { name: 'Tài khoản & license' })).toBeEnabled();
  await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await expect(page.getByText('12.000 ₫', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('mood_owner', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tổng quan hoạt động' })).toBeVisible();
  await page.getByRole('button', { name: 'Thông tin đăng nhập', exact: true }).click();
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill('mood_operator');
  await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill('owner-new-password');
  await page.getByRole('button', { name: 'Lưu thông tin đăng nhập' }).click();
  await expect(page.getByText('mood_operator', { exact: true })).toBeVisible();
  expect(state.changes[1]).toEqual({ username: 'mood_operator', currentPassword: 'owner-new-password' });
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.getByRole('button', { name: 'My License · Lifetime' })).toBeVisible();
});

test('admin searches accounts, issues license, confirms permanent revoke and reads payments/audit', async ({ page }) => {
  const state = await fixture(page, { authenticated: true, firstLogin: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tài khoản & license' }).click();
  await page.getByRole('textbox', { name: 'Tìm tài khoản', exact: true }).fill(customer.email);
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  await page.getByRole('button', { name: 'Xem chi tiết', exact: true }).click();
  await expect(page.getByText('Slot 1 · Artist PC')).toBeVisible();
  await page.getByRole('button', { name: 'Cấp license Lifetime', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.issues).toBe(0);
  await page.getByRole('button', { name: 'Xác nhận cấp license', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Thu hồi vĩnh viễn', exact: true })).toBeVisible();
  expect(state.issues).toBe(1);
  expect(state.searches).toContain(customer.email);
  await page.getByRole('button', { name: 'Tạm khóa license', exact: true }).click();
  await page.getByLabel('Lý do', { exact: true }).fill('Đối chiếu tài khoản');
  await page.getByRole('button', { name: 'Xác nhận tạm khóa', exact: true }).click();
  await page.getByRole('button', { name: 'Mở khóa license', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận mở khóa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạm khóa license', exact: true })).toBeVisible();
  expect(state.resumes).toBe(1);
  await page.getByRole('button', { name: 'Thu hồi vĩnh viễn', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Thao tác này không thể hoàn tác');
  expect(state.revokes).toHaveLength(1);
  await page.getByLabel('Lý do', { exact: true }).fill('Đối chiếu vi phạm');
  await page.getByRole('button', { name: 'Xác nhận thu hồi', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.revokes).toEqual([{ userId: customer.id, status: 'SUSPENDED', reason: 'Đối chiếu tài khoản' }, { userId: customer.id, status: 'REVOKED', reason: 'Đối chiếu vi phạm' }]);
  await page.getByRole('button', { name: 'Thanh toán', exact: true }).click();
  await expect(page.getByText('Đã thanh toán', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Lịch sử thao tác', exact: true }).click();
  await expect(page.getByText('Đối chiếu vi phạm', { exact: true })).toBeVisible();
});

test('admin settings reject mismatched password confirmation without sending changes', async ({ page }) => {
  const state = await fixture(page, { authenticated: true });
  await page.goto('/');
  await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill('test-only-bootstrap-password');
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('first-new-password');
  await page.getByLabel('Xác nhận mật khẩu mới', { exact: true }).fill('second-new-password');
  await page.getByRole('button', { name: 'Lưu thông tin đăng nhập' }).click();
  await expect(page.getByRole('alert')).toHaveText('Xác nhận mật khẩu chưa khớp.');
  expect(state.changes).toHaveLength(0);
});
