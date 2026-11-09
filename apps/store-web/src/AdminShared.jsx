import { useEffect, useState } from 'react';

export const primary = 'rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-40';
export const secondary = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-raised disabled:opacity-40';
export const inputClass = 'w-full rounded-md border border-line bg-base px-3 py-2 text-sm outline-none focus:border-brand';
export const panel = 'rounded-lg border border-line bg-panel p-4 md:p-5';
const messages = {
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Tài khoản này không có quyền quản trị.',
  ADMIN_CREDENTIALS_CHANGE_REQUIRED: 'Hãy đổi mật khẩu ban đầu trước khi sử dụng trang quản trị.',
  INVALID_USERNAME: 'Tên đăng nhập cần 3–64 ký tự, bắt đầu bằng chữ hoặc số và chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.',
  USERNAME_TAKEN: 'Tên đăng nhập này đã được sử dụng.',
  INVALID_CURRENT_PASSWORD: 'Mật khẩu hiện tại không đúng.',
  PASSWORD_TOO_SHORT: 'Mật khẩu mới cần ít nhất 8 ký tự.',
  PASSWORD_TOO_LONG: 'Mật khẩu mới tối đa 128 ký tự.',
  PASSWORD_CHANGE_REQUIRED: 'Hãy đặt mật khẩu mới khác mật khẩu ban đầu.',
  TOO_MANY_ATTEMPTS: 'Thao tác quá nhiều lần. Vui lòng thử lại sau.',
  TOO_MANY_REQUESTS: 'Thao tác quá nhanh. Vui lòng thử lại sau.',
  LICENSE_CONFIGURATION_REQUIRED: 'Máy chủ chưa cấu hình tính năng license.',
  LICENSE_NOT_FOUND: 'Thiết bị này chưa có license thư viện.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản này.',
  ORDER_STATE_INVALID: 'Đơn không ở trạng thái cho phép thao tác này (chưa được khách báo đã chuyển khoản, hoặc đã xử lý).',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  DEVICE_NOT_FOUND: 'Không tìm thấy thiết bị.',
  ALREADY_ENTITLED: 'Thiết bị đích đã có license thư viện.',
  TELEGRAM_BOT_NOT_READY: 'Bot Telegram chưa sẵn sàng. Hãy kiểm tra cấu hình bot và thử lại.',
  TELEGRAM_ADMIN_ALREADY_CONNECTED: 'Tài khoản admin này đã liên kết Telegram. Hãy ngắt kết nối cũ trước.',
  TELEGRAM_LINK_TOKEN_INVALID: 'Mã kết nối Telegram hết hạn. Hãy bấm kết nối lại.',
  TELEGRAM_ACCOUNT_ALREADY_LINKED: 'Tài khoản Telegram này đã được liên kết với một admin khác.',
  TELEGRAM_CONNECTION_NOT_FOUND: 'Không tìm thấy kết nối Telegram này.',
  ADMIN_OWNER_REQUIRED: 'Chỉ admin chủ quản mới được quản lí tài khoản admin.',
  ADMIN_USERNAME_INVALID: 'Tên đăng nhập cần 3–64 ký tự hợp lệ, viết thường.',
  ADMIN_DISPLAY_NAME_INVALID: 'Họ và tên cần từ 1 đến 120 ký tự.',
  ADMIN_PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 8 ký tự.',
  ADMIN_PASSWORD_TOO_LONG: 'Mật khẩu tối đa 128 ký tự.',
  ADMIN_USERNAME_TAKEN: 'Tên đăng nhập này đã được sử dụng.',
  ADMIN_ACCOUNT_NOT_FOUND: 'Không tìm thấy tài khoản admin.',
  ADMIN_ACCOUNT_PROTECTED: 'Không thể khóa hoặc đổi mật khẩu admin chủ quản.',
};
export const adminError = error => messages[error?.code] || error?.detail || 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
export const dateTime = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
const labels = { ACTIVE: 'Đang hoạt động', SUSPENDED: 'Tạm khóa', REVOKED: 'Đã thu hồi', PAID: 'Đã thanh toán', PENDING: 'Chờ thanh toán', CANCELLED: 'Đã hủy', FAILED: 'Thất bại', EXPIRED: 'Hết hạn' };
export function Status({ value }) {
  return <span className={`inline-flex whitespace-nowrap rounded border px-2 py-1 text-xs ${['ACTIVE', 'PAID'].includes(value) ? 'border-ok/30 text-ok' : ['REVOKED', 'FAILED'].includes(value) ? 'border-danger/30 text-danger' : 'border-line text-mute'}`}>{labels[value] || value || 'Chưa mua'}</span>;
}

export function useAdminResource(load, dependencies) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: '' });
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: '' });
    }, error => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: adminError(error) });
    });
    return () => controller.abort();
  }, dependencies);
  return state;
}

export function ResourceState({ loading, error, retry }) {
  if (loading) return <p role="status" className="py-6 text-sm text-mute">Đang tải dữ liệu…</p>;
  if (error) return <div role="alert" className="space-y-3 rounded-md border border-danger/30 p-4 text-sm text-danger"><p>{error}</p><button className={secondary} onClick={retry}>Thử lại</button></div>;
  return null;
}

export function Pagination({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="mt-4 flex items-center justify-between gap-3 text-xs text-mute">
    <span>{total} kết quả · Trang {page}/{pages}</span>
    <div className="flex gap-2"><button className={secondary} disabled={page <= 1} onClick={() => onPage(page - 1)}>Trước</button><button className={secondary} disabled={page >= pages} onClick={() => onPage(page + 1)}>Sau</button></div>
  </div>;
}
