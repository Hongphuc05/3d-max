import { useEffect, useState } from 'react';

export const primary = 'rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-40';
export const secondary = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-raised disabled:opacity-40';
export const inputClass = 'w-full rounded-md border border-line bg-base px-3 py-2 text-sm outline-none focus:border-accent';
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
  LICENSE_NOT_FOUND: 'Tài khoản này chưa có license.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản này.',
};
export const adminError = error => messages[error?.code] || error?.detail || 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
export const dateTime = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
const labels = { ACTIVE: 'Đang hoạt động', SUSPENDED: 'Tạm khóa', REVOKED: 'Đã thu hồi', PAID: 'Đã thanh toán', PENDING: 'Chờ thanh toán', CANCELLED: 'Đã hủy', FAILED: 'Thất bại', EXPIRED: 'Hết hạn' };
export function Status({ value }) {
  return <span className={`inline-flex whitespace-nowrap rounded border px-2 py-1 text-xs ${['ACTIVE', 'PAID'].includes(value) ? 'border-accent/30 text-accent' : ['REVOKED', 'FAILED'].includes(value) ? 'border-danger/30 text-danger' : 'border-line text-mute'}`}>{labels[value] || value || 'Chưa mua'}</span>;
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
