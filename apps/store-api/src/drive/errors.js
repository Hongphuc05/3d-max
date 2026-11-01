// v3 API error: { error: { code, message, requestId } } (docs/v3-implementation-plan.md §2.1).
// Messages are Vietnamese, user-facing, and never carry provider payloads or credentials.
const MESSAGES = {
  DRIVE_OAUTH_NOT_CONFIGURED: 'Chưa cấu hình kết nối Google Drive trên máy chủ.',
  OAUTH_STATE_INVALID: 'Phiên kết nối Google không hợp lệ hoặc đã hết hạn. Hãy bấm Kết nối lại.',
  OAUTH_NO_REFRESH_TOKEN: 'Google không cấp refresh token. Hãy thu hồi quyền của ứng dụng tại tài khoản Google rồi kết nối lại.',
  DRIVE_SCOPE_MISSING: 'Chưa cấp đủ quyền đọc Google Drive. Hãy kết nối lại và đồng ý quyền đọc Drive.',
  DRIVE_NOT_CONNECTED: 'Chưa kết nối Google Drive.',
  DRIVE_AUTH_REVOKED: 'Kết nối Google Drive đã hết hiệu lực. Hãy kết nối lại.',
  DRIVE_PERMISSION_DENIED: 'Google từ chối quyền truy cập thư mục hoặc file. Kiểm tra Gmail đã được chia sẻ quyền Viewer.',
  DRIVE_NOT_FOUND: 'Không tìm thấy thư mục hoặc file trên Google Drive.',
  DRIVE_QUOTA_EXCEEDED: 'Google Drive đang giới hạn lượt truy cập hoặc hạn mức. Thử lại sau.',
  DRIVE_UPSTREAM_ERROR: 'Không kết nối ổn định được tới Google Drive. Thử lại sau.',
  DRIVE_BAD_REQUEST: 'Yêu cầu gửi tới Google Drive không hợp lệ.',
  DRIVE_NOT_A_FOLDER: 'Địa chỉ này không phải thư mục Google Drive.',
  INVALID_PARAMS: 'Dữ liệu gửi lên không hợp lệ.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  UNAUTHENTICATED: 'Cần đăng nhập.',
  RATE_LIMITED: 'Thao tác quá nhanh. Thử lại sau.',
  CATALOG_EVENTS_BUSY: 'Máy chủ đang phục vụ quá nhiều kết nối cập nhật. Thử lại sau ít phút.',
  DISK_SPACE_LOW: 'Ổ đĩa máy chủ gần đầy nên không tải thêm ảnh xem trước. Giải phóng dung lượng rồi chạy lại.',
  SCAN_LIMIT_EXCEEDED: 'Thư viện Drive vượt giới hạn số file/thư mục cho phép quét một lần.',
  PLAN_STALE: 'Dữ liệu catalog đã thay đổi trong lúc đồng bộ. Hãy chạy lại đồng bộ.',
  JOB_HANDLER_ERROR: 'Đồng bộ thất bại do lỗi hệ thống. Xem nhật ký máy chủ rồi chạy lại.',
  JOB_NOT_FOUND: 'Không tìm thấy lượt đồng bộ này.',
  MODEL_NOT_FOUND: 'Không tìm thấy model này.',
  REVIEW_NOT_FOUND: 'Không tìm thấy mục cần duyệt này.',
  REVIEW_ALREADY_RESOLVED: 'Mục này đã được xử lý trước đó.',
  REVIEW_NOT_APPLICABLE: 'Mục này không còn áp dụng được vì dữ liệu liên quan đã thay đổi. Hãy bỏ qua hoặc chạy đồng bộ lại.',
  JOB_NOT_CANCELLABLE: 'Lượt đồng bộ đã kết thúc nên không hủy được.',
  SYNC_ALREADY_RUNNING: 'Đang có một lượt đồng bộ chạy hoặc chờ chạy cho nguồn này.',
  INTERNAL: 'Lỗi hệ thống. Thử lại sau.',
};

export class ApiError extends Error {
  constructor(code, status, { retryable = false, retryAfterMs, reason } = {}) {
    super(code);
    this.code = code; this.status = status;
    this.retryable = retryable; this.retryAfterMs = retryAfterMs;
    this.reason = typeof reason === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(reason) ? reason : undefined;
  }
}

// HTTP status per code. Upstream/user-input problems avoid 401/403/404 so they are never mistaken
// for "not logged in / not admin / no such route".
const STATUS = {
  DRIVE_OAUTH_NOT_CONFIGURED: 503, OAUTH_STATE_INVALID: 400, OAUTH_NO_REFRESH_TOKEN: 400, DRIVE_SCOPE_MISSING: 400,
  DRIVE_NOT_CONNECTED: 409, DRIVE_AUTH_REVOKED: 409, DRIVE_PERMISSION_DENIED: 422, DRIVE_NOT_FOUND: 422,
  DRIVE_QUOTA_EXCEEDED: 429, DRIVE_UPSTREAM_ERROR: 502, DRIVE_BAD_REQUEST: 502, DRIVE_NOT_A_FOLDER: 422,
  INVALID_PARAMS: 400, FORBIDDEN: 403, UNAUTHENTICATED: 401, RATE_LIMITED: 429, CATALOG_EVENTS_BUSY: 503, DISK_SPACE_LOW: 409, PLAN_STALE: 409, JOB_NOT_FOUND: 422, MODEL_NOT_FOUND: 422, REVIEW_NOT_FOUND: 422, REVIEW_ALREADY_RESOLVED: 409, REVIEW_NOT_APPLICABLE: 409, JOB_NOT_CANCELLABLE: 409, SYNC_ALREADY_RUNNING: 409, SCAN_LIMIT_EXCEEDED: 422,
};
export const apiError = (code, opts) => new ApiError(code, STATUS[code] ?? 400, opts);
export const messageFor = (code) => MESSAGES[code];

import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  req.requestId = randomUUID();
  res.set('X-Request-Id', req.requestId);
  next();
}

// Mount LAST on a v3 router. Unknown errors are classified only; no message/stack leaves the process.
// eslint-disable-next-line no-unused-vars
export function v3ErrorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') err = apiError('INVALID_PARAMS');
  if (err?.type === 'entity.too.large') err = apiError('INVALID_PARAMS');
  // Guards from the existing codebase (requireAdmin, …) throw { code, status } errors that are not ApiError.
  // Accept those only when they are a clean 4xx with an upper-snake code; everything else is INTERNAL.
  const foreign = !(err instanceof ApiError) && Number.isInteger(err?.status) && err.status >= 400 && err.status < 500
    && /^[A-Z][A-Z0-9_]{1,60}$/.test(err?.code || '');
  const known = err instanceof ApiError || foreign;
  if (!known) console.error('[v3]', req.requestId, /^[A-Z][A-Z0-9_]{1,40}$/.test(err?.code || '') ? err.code : 'INTERNAL');
  const code = known ? err.code : 'INTERNAL';
  res.status(known ? err.status : 500).json({ error: { code, message: MESSAGES[code] || (known ? 'Yêu cầu không hợp lệ.' : MESSAGES.INTERNAL), requestId: req.requestId } });
}
