// Moi call toi backend di qua day. Sau nay them auth header o 1 cho nay.
async function get(path, params, signal) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)) : '';
  const r = await fetch(`/api${path}${qs}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const getCategories = (signal) => get('/categories', null, signal);
export const getProducts = (params, signal) => get('/products', params, signal);

export const vnd = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
