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

export const health = () => get('/health');
export const me = () => request('GET', '/auth/me');
export const login = (email, password) => request('POST', '/auth/login', { body: { email, password } });
export const logout = () => request('POST', '/auth/logout', { body: {} });

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
export const adminOrders = (params, signal) => get('/admin/orders', params, signal);
export const adminDecideOrder = (id, action) => request('POST', `/admin/orders/${encodeURIComponent(id)}/${action}`, { body: {} });
export const adminDevices = (signal) => get('/admin/devices', null, signal);
export const adminRevokeLicense = (id) => request('POST', `/admin/devices/${encodeURIComponent(id)}/license/revoke`, { body: {} });
export const adminTransferLicense = (id, toDeviceId) => request('POST', `/admin/devices/${encodeURIComponent(id)}/license/transfer`, { body: { toDeviceId } });
export const updateAdminAccount = (body) => request('PATCH', '/admin/account', { body });


export const mb = (n) => n == null ? 'Chưa rõ dung lượng' : `${n} MB`;
export const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
