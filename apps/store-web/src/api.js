// Moi call toi backend di qua day. Sau nay them auth header o 1 cho nay.
export class ApiError extends Error {
  // `detail` = thong diep tieng Viet cua may chu (envelope v3 {error:{code,message,requestId}}); khong chua token/payload nha cung cap.
  constructor(status, code, detail) { super(code || `HTTP ${status}`); this.status = status; this.code = code; this.detail = detail; }
}

async function request(method, path, { params, body, signal } = {}) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)) : '';
  const r = await fetch(`/api${path}${qs}`, {
    method, signal, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const e = data?.error; // API cu: chuoi ma loi; API v3: { code, message, requestId }
    throw typeof e === 'object' && e ? new ApiError(r.status, e.code, typeof e.message === 'string' ? e.message : undefined) : new ApiError(r.status, e);
  }
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
export const adminOrders = (params, signal) => get('/admin/legacy-orders', params, signal);
export const adminAudit = (params, signal) => get('/admin/audit', params, signal);
export const adminDriveStatus = (signal) => get('/admin/drive/status', null, signal);
export const adminDriveAddSource = (body) => request('POST', '/admin/drive/sources', { body });
export const adminDriveTestAccess = (sourceId, signal) => request('POST', '/admin/drive/test-access', { body: { sourceId }, signal });
// P3.2 (plan §2.2): luot dong bo. Huy/Thu lai tra 202; huy khong co noi dung.
export const adminSyncJobs = (params, signal) => get('/admin/drive/sync-jobs', params, signal);
export const adminSyncJob = (id, signal) => get(`/admin/drive/sync-jobs/${encodeURIComponent(id)}`, null, signal);
export const adminSyncItems = (id, status = 'FAILED', signal) => get(`/admin/drive/sync-jobs/${encodeURIComponent(id)}/items`, { status }, signal);
export const adminStartSync = ({ sourceId, mode }) => request('POST', '/admin/drive/sync-jobs', { body: { sourceId, mode } });
export const adminCancelSync = (id) => request('POST', `/admin/drive/sync-jobs/${encodeURIComponent(id)}/cancel`, { body: {} });
export const adminRetrySync = (id) => request('POST', `/admin/drive/sync-jobs/${encodeURIComponent(id)}/retry`, { body: {} });
export const syncEventsUrl = (id) => `/api/admin/drive/sync-jobs/${encodeURIComponent(id)}/events`;
// P3.7 (plan §2.7): cai dat + bang model. PUT cai dat gui du 7 truong; PATCH model chi gui truong doi.
// P3.4 (plan §2.2): can duyet. POST tra 200 khong noi dung.
export const adminReviewItems = (signal) => get('/admin/catalog/review', null, signal);
export const adminReviewAction = (id, action) => request('POST', `/admin/catalog/review/${encodeURIComponent(id)}`, { body: { action } });
export const adminSettings = (signal) => get('/admin/settings', null, signal);
export const adminSaveSettings = (body) => request('PUT', '/admin/settings', { body });
export const adminModels = (params, signal) => get('/admin/models', params, signal);
export const adminPatchModel = (id, body) => request('PATCH', `/admin/models/${encodeURIComponent(id)}`, { body });
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
