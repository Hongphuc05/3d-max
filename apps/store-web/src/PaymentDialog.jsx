import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import * as api from './api.js';
import { safeCheckoutUrl } from './license-flow.js';

export const paymentButton = 'rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50';
const secondary = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-raised disabled:opacity-50';
const labels = { PENDING: 'Đang chờ thanh toán...', PAID: 'Thanh toán thành công!', CANCELLED: 'Đơn thanh toán đã hủy.', EXPIRED: 'Mã QR đã hết hạn.', FAILED: 'Thanh toán thất bại.' };

export default function PaymentDialog({ order, busy, error, onCheck, onClose }) {
  const [now, setNow] = useState(Date.now());
  const [copyMessage, setCopyMessage] = useState('');
  const deadline = Date.parse(order.expiresAt);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const pending = order.status === 'PENDING';
  const expired = Number.isFinite(deadline) && seconds === 0;
  const checkout = safeCheckoutUrl(order.checkoutUrl);
  useEffect(() => {
    if (!pending || expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending, expired]);
  useEffect(() => {
    const escape = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [onClose]);
  const copy = async () => {
    const text = [order.bankBin && `Ngân hàng (BIN): ${order.bankBin}`, order.accountName,
      order.accountNumber, api.vnd(order.amountVnd), order.description].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopyMessage('Đã sao chép thông tin thanh toán.'); }
    catch { setCopyMessage('Không thể sao chép. Hãy chọn thông tin bên dưới để sao chép thủ công.'); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={e => e.stopPropagation()}
      className="max-h-[90vh] w-full max-w-md space-y-4 overflow-auto rounded-lg border border-line bg-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="payment-title" className="text-lg font-bold">Thanh toán 3DsMood Lifetime</h2>
        <button className={secondary} onClick={onClose}>Đóng thanh toán</button>
      </div>
      <p className="font-mono text-2xl text-accent">{api.vnd(order.amountVnd)}</p>
      <p className="text-xs text-mute">Đơn {order.orderCode}</p>
      {pending && !expired && order.qrCode && <div className="mx-auto w-fit rounded-lg bg-white p-2">
        <QRCodeSVG value={order.qrCode} size={240} level="M" marginSize={4} aria-label="Mã VietQR thanh toán" role="img" />
      </div>}
      {pending && !expired && !order.qrCode && <p className="text-sm text-warn">Đang khôi phục đơn. Bạn có thể mở trang payOS để tiếp tục thanh toán.</p>}
      {pending && Number.isFinite(deadline) && <p className="text-center font-mono text-sm">
        {expired ? 'Mã QR đã hết hạn. Kiểm tra trạng thái trước khi tạo đơn mới.' : `QR hết hạn sau ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
      </p>}
      <p role="status" className={order.status === 'PAID' ? 'text-accent' : 'text-sm'}>{labels[order.status]}</p>
      {order.status === 'PAID' && <p className="text-sm text-accent">Máy chủ đã xác nhận thanh toán. License được hiển thị trong My License.</p>}
      {pending && !expired && <>
        <dl className="space-y-2 rounded-md bg-base p-3 text-sm">
          {order.bankBin && <div><dt className="text-mute">Ngân hàng (BIN)</dt><dd>{order.bankBin}</dd></div>}
          {order.accountName && <div><dt className="text-mute">Chủ tài khoản</dt><dd>{order.accountName}</dd></div>}
          {order.accountNumber && <div><dt className="text-mute">Số tài khoản</dt><dd className="select-text font-mono">{order.accountNumber}</dd></div>}
          {order.description && <div><dt className="text-mute">Nội dung chuyển khoản</dt><dd className="select-text font-mono">{order.description}</dd></div>}
        </dl>
        <button className={secondary} onClick={copy}>Sao chép thông tin thanh toán</button>
        {checkout && <a className={`${paymentButton} inline-block`} href={checkout} target="_blank" rel="noopener noreferrer">Mở thanh toán payOS</a>}
      </>}
      {order.status !== 'PAID' && <button className={secondary} disabled={busy} onClick={onCheck}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra thanh toán'}</button>}
      {order.status === 'PAID' && <button className={secondary} disabled={busy} onClick={onCheck}>{busy ? 'Đang tải key license…' : 'Tải lại key license'}</button>}
      {copyMessage && <p className="text-xs text-mute" role="status">{copyMessage}</p>}
      {order.fulfillmentResult === 'ALREADY_LICENSED' && <p className="text-sm text-warn">Tài khoản đã có license trước đơn này. Liên hệ hỗ trợ để xử lý khoản thanh toán trùng.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-mute">Chỉ máy chủ xác minh thanh toán và cấp license. Bạn có thể đóng cửa sổ; đơn và quyền lợi được lưu trên máy chủ.</p>
    </section>
  </div>;
}
