// Shared flow used by the UI and tested with a native bridge/API fixture.
export async function proveDevice({ api, native, licenseKey, identity: knownIdentity }) {
  const identity = knownIdentity || await native.getDeviceIdentity();
  const purpose = licenseKey === undefined ? 'VERIFY' : 'ACTIVATE';
  const challenge = await api.deviceChallenge({ ...identity, purpose });
  const { signature } = await native.signDeviceChallenge(challenge.challengeId, challenge.message);
  const proof = { challengeId: challenge.challengeId, signature };
  const session = purpose === 'ACTIVATE'
    ? await api.activateLicense({ ...proof, licenseKey })
    : await api.verifyDevice(proof);
  return { ...session, identity };
}

export function safeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'pay.payos.vn'
      && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

export function orderIdFromLocation(search) {
  const id = new URLSearchParams(search).get('orderId');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '') ? id : null;
}

const messages = {
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  LICENSE_NOT_FOUND: 'Tài khoản chưa có license Lifetime.',
  INVALID_LICENSE_KEY: 'Mã license không hợp lệ.',
  LICENSE_NOT_OWNED: 'License này không thuộc tài khoản đang đăng nhập.',
  LICENSE_OWNERSHIP_MISMATCH: 'License này không thuộc tài khoản đang đăng nhập.',
  LICENSE_REVOKED: 'License đã bị thu hồi. Liên hệ hỗ trợ để biết thêm thông tin.',
  LICENSE_INACTIVE: 'License đang bị tạm ngưng hoặc đã thu hồi.',
  DEVICE_LIMIT_REACHED: 'License đã gắn đủ 2 thiết bị. Không thể xóa, đổi hoặc chuyển slot.',
  DEVICE_NOT_ACTIVATED: 'Thiết bị này chưa kích hoạt. Nhập mã license bên dưới.',
  DEVICE_NOT_REGISTERED: 'Thiết bị này chưa kích hoạt. Nhập mã license bên dưới.',
  DEVICE_KEY_MISMATCH: 'Khóa thiết bị không khớp với slot đã đăng ký.',
  DEVICE_IDENTITY_ALREADY_BOUND: 'Danh tính hoặc khóa này đã gắn với slot khác. Không thể đổi hoặc chuyển slot.',
  DEVICE_SESSION_REQUIRED: 'Cần xác minh thiết bị trước khi tải model.',
  DEVICE_SESSION_INVALID: 'Phiên thiết bị đã hết hạn hoặc license không còn hiệu lực. Hãy xác minh lại.',
  INVALID_DEVICE_PROOF: 'Không xác minh được chữ ký của thiết bị.',
  INVALID_OR_USED_CHALLENGE: 'Yêu cầu xác minh không hợp lệ hoặc đã dùng. Vui lòng thử lại.',
  DEVICE_IDENTITY_LOST: 'Danh tính hoặc khóa thiết bị đã mất. Slot đã dùng vẫn được giữ cố định; không thể tự reset.',
  DEVICE_IDENTITY_UNAVAILABLE: 'Không thể mở khóa bảo mật Windows. Kiểm tra quyền truy cập hoặc liên hệ hỗ trợ.',
  HOST_UNSUPPORTED: 'Kích hoạt thiết bị trong plugin 3ds Max.',
  UNKNOWN_METHOD: 'Plugin này chưa hỗ trợ license. Hãy cập nhật plugin rồi mở lại 3ds Max.',
  INVALID_SIGNATURE: 'Không xác minh được chữ ký của thiết bị.',
  CHALLENGE_EXPIRED: 'Yêu cầu xác minh đã hết hạn. Vui lòng thử lại.',
  CHALLENGE_USED: 'Yêu cầu xác minh đã được dùng. Vui lòng thử lại.',
  PAYMENTS_UNAVAILABLE: 'Thanh toán chưa được cấu hình hoặc tạm thời không khả dụng.',
  ALREADY_LICENSED: 'Tài khoản đã có license. Mở My License để xem.',
  PAYMENT_CREATION_PENDING: 'Đơn đang được kiểm tra với payOS. Thử lại để tiếp tục cùng đơn, không tạo khoản mua mới.',
  PAYMENT_REQUEST_TIMEOUT: 'Kết nối thanh toán quá thời gian chờ. Thử lại để tiếp tục cùng đơn; máy chủ vẫn tự xác minh thanh toán.',
  TOO_MANY_REQUESTS: 'Đã gửi quá nhiều yêu cầu. Vui lòng đợi rồi thử lại.',
  TOO_MANY_ATTEMPTS: 'Đã gửi quá nhiều yêu cầu. Vui lòng đợi một phút rồi thử lại.',
};
export const licenseError = (error) => messages[error?.code] || 'Không thể hoàn tất yêu cầu. Vui lòng kiểm tra kết nối rồi thử lại.';
