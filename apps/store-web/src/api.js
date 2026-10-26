// Moi call toi backend di qua day. Sau nay them auth header o 1 cho nay.
export class ApiError extends Error {
  constructor(status, code) { super(code || `HTTP ${status}`); this.status = status; this.code = code; }
}

async function request(method, path, { params, body, signal } = {}) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)) : '';
  const r = await fetch(`/api${path}${qs}`, {
    method, signal, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, data?.error);
  return data;
}
const get = (path, params, signal) => request('GET', path, { params, signal });

export const getCategories = (signal) => get('/categories', null, signal);
export const getCatalogVersion = (signal) => get('/catalog/version', null, signal);
export const catalogSyncPermission = (signal) => get('/admin/catalog/sync/permission', null, signal);
export const syncCatalogNow = (signal) => request('POST', '/admin/catalog/sync', { body: {}, signal });
export const getProducts = (params, signal) => get('/products', params, signal);
export const health = () => get('/health');

// Fetch a consistent revision across paginated responses for local multi-category filtering.
export async function getAllProducts(signal) {
  const first = await getProducts({ limit: 100 }, signal);
  const pages = [first];
  for (let page = 2; page <= Math.ceil(first.total / 100); page += 4) {
    const batch = await Promise.all(Array.from({ length: Math.min(4,Math.ceil(first.total/100)-page+1) },
      (_, i) => getProducts({ limit:100,page:page+i },signal)));
    if(batch.some(result => result.version !== first.version)) throw new ApiError(409,'CATALOG_CHANGED');
    pages.push(...batch);
  }
  return pages.flatMap(result => result.items);
}

export const me = () => request('GET', '/auth/me');
export const register = (email, password) => request('POST', '/auth/register', { body: { email, password } });
export const login = (email, password) => request('POST', '/auth/login', { body: { email, password } });
export const logout = () => request('POST', '/auth/logout', { body: {} });

export const adminOverview = (signal) => get('/admin/overview', null, signal);
export const adminUsers = (params, signal) => get('/admin/users', params, signal);
export const adminUser = (id, signal) => get(`/admin/users/${encodeURIComponent(id)}`, null, signal);
export const adminOrders = (params, signal) => get('/admin/orders', params, signal);
export const adminAudit = (params, signal) => get('/admin/audit', params, signal);
export const updateAdminAccount = (body) => request('PATCH', '/admin/account', { body });
export const issueAdminLicense = (userId) => request('POST', '/admin/licenses/issue', { body: { userId } });
export const resumeAdminLicense = (userId) => request('POST', '/admin/licenses/resume', { body: { userId } });
export const revokeAdminLicense = (userId, status, reason) => request('POST', '/admin/licenses/revoke', { body: { userId, status, reason } });

export const myLicense = () => get('/licenses/me');
export const licenseDevices = () => get('/licenses/devices');
export const deviceChallenge = (body) => request('POST', '/devices/challenge', { body });
export const activateLicense = (body) => request('POST', '/licenses/activate', { body });
export const verifyDevice = (body) => request('POST', '/devices/verify', { body });
export const lifetimeProduct = () => get('/payments/product');
export const createPayment = (signal) => request('POST', '/payments/create', { body: {}, signal });
export const paymentOrder = (id, signal) => get(`/payments/${encodeURIComponent(id)}`, null, signal);
export const activePaymentOrder = (id, signal) => get(`/payments/${encodeURIComponent(id)}/status`, null, signal);
export const reconcilePayment = (id, signal) => request('POST', `/payments/${encodeURIComponent(id)}/reconcile`, { body: {}, signal });

// Khong co Download tren trinh duyet (O7). Trong 3ds Max: xin ticket 1 lan roi giao cho host tai + import.
export const importTicket = (slug) => request('POST', `/products/${encodeURIComponent(slug)}/import-ticket`, { body: {} });

export const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
export const mb = (n) => n == null ? 'Chưa rõ dung lượng' : `${n} MB`;
