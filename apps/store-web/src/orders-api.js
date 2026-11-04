// P5.8: goi API don hang cua khach (plan §2.6). Trong 3ds Max, host chuyen cac yeu cau nay toi may chu va TU GAN token thiet bi (JS khong co token).
async function call(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error?.code || `HTTP ${r.status}`), { code: data?.error?.code || 'SERVER_UNAVAILABLE', status: r.status });
  return data;
}
// Don la cua ca thu vien (D28.1): khong gui gi, gia do may chu tinh.
export const createOrder = () => call('/api/v1/orders', { method: 'POST', body: {} });
export const getOrder = (orderId) => call(`/api/v1/orders/${encodeURIComponent(orderId)}`);
export const claimPaid = (orderId) => call(`/api/v1/orders/${encodeURIComponent(orderId)}/claim-paid`, { method: 'POST', body: {} });
export const cancelOrder = (orderId) => call(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: {} });

export const ORDER_ERRORS = {
  ALREADY_ENTITLED: 'Thiết bị này đã có license thư viện. Danh sách sẽ được làm mới.',
  TOO_MANY_PENDING_ORDERS: 'Bạn đang có quá nhiều đơn chờ thanh toán. Hãy đợi đơn cũ hết hạn rồi thử lại.',
  PAYMENT_NOT_CONFIGURED: 'Thanh toán chưa được cấu hình trên máy chủ. Vui lòng quay lại sau.',
  ORDER_STATE_INVALID: 'Đơn không còn ở trạng thái cho phép thao tác này (có thể đã hết hạn).',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  RATE_LIMITED: 'Thao tác quá nhanh. Thử lại sau ít phút.',
  UNAUTHENTICATED: 'Thiết bị chưa được xác thực. Hãy mở lại panel rồi thử lại.',
  SERVER_UNAVAILABLE: 'Không kết nối được máy chủ. Kiểm tra Internet rồi thử lại.',
};
export const orderErrorText = (e) => ORDER_ERRORS[e?.code] || 'Có lỗi xảy ra. Thử lại sau.';
