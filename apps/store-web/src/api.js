// Moi call toi backend di qua day. Sau nay them auth header o 1 cho nay.
export class ApiError extends Error {
  constructor(status, code) { super(code || `HTTP ${status}`); this.status = status; this.code = code; }
}

async function request(method, path, { params, body, signal } = {}) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)) : '';
  const r = await fetch(`/api${path}${qs}`, {
    method, signal, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, data?.error);
  return data;
}
const get = (path, params, signal) => request('GET', path, { params, signal });

export const getCategories = (signal) => get('/categories', null, signal);
export const getProducts = (params, signal) => get('/products', params, signal);
export const health = () => get('/health');

// ponytail: tai het catalog ve client (360 san pham ~100 KB) roi loc nhieu category / sap xep / phan trang tai cho.
// Tran: vai nghin san pham. Lon hon thi backend phai ho tro cac bo loc nay (STATUS: no FE-1).
export async function getAllProducts(signal) {
  const first = await getProducts({ limit: 100 }, signal);
  const rest = await Promise.all(Array.from({ length: Math.ceil(first.total / 100) - 1 },
    (_, i) => getProducts({ limit: 100, page: i + 2 }, signal)));
  return [first, ...rest].flatMap((d) => d.items);
}

export const me = () => request('GET', '/auth/me');
export const register = (email, password) => request('POST', '/auth/register', { body: { email, password } });
export const login = (email, password) => request('POST', '/auth/login', { body: { email, password } });
export const logout = () => request('POST', '/auth/logout', { body: {} });

// Khong co Download tren trinh duyet (O7). Trong 3ds Max: xin ticket 1 lan roi giao cho host tai + import.
export const importTicket = (slug) => request('POST', `/products/${encodeURIComponent(slug)}/import-ticket`, { body: {} });

export const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
export const mb = (n) => `${n} MB`;
