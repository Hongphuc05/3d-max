// P5.8: hop thoai mua license thu vien (D28.1): tao don -> QR VietQR + thong tin chuyen khoan + dem nguoc -> "Toi da chuyen khoan" -> cho chu xac nhan (poll 4 giay) -> ket qua.
// Gia/so tien/ngan hang deu do may chu tra ve; dialog khong tu tinh gi. Dong khi chua bao chuyen khoan thi huy don de nha cho don cho.
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { vnd } from './api.js';
import { cancelOrder, claimPaid, createOrder, getOrder, orderErrorText } from './orders-api.js';

const secondary = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-raised disabled:opacity-50';
const primary = 'rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink disabled:opacity-50';

const FINAL = {
  CONFIRMED: { tone: 'text-brand', text: 'Đã xác nhận thanh toán! License thư viện đã được cấp cho thiết bị này, toàn bộ model đã mở khóa.' },
  REJECTED: { tone: 'text-danger', text: 'Chủ cửa hàng chưa nhận được tiền hoặc đã từ chối đơn này. Liên hệ nhà cung cấp nếu bạn đã chuyển khoản.' },
  EXPIRED: { tone: 'text-warn', text: 'Đơn đã hết hạn. Nếu bạn đã chuyển khoản, hãy liên hệ nhà cung cấp kèm mã đơn.' },
  CANCELLED: { tone: 'text-mute', text: 'Đơn đã hủy.' },
};

export default function OrderDialog({ onClose, onConfirmed, pollMs = 4000 }) {
  const [phase, setPhase] = useState('creating'); // creating | ready | claiming | waiting | final | error
  const [order, setOrder] = useState(null);
  const [final, setFinal] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState('');
  const orderRef = useRef(null), phaseRef = useRef('creating'), confirmedRef = useRef(false), liveRef = useRef(true);
  const go = (next) => { phaseRef.current = next; setPhase(next); };

  useEffect(() => {
    liveRef.current = true;
    createOrder().then((created) => { if (!liveRef.current) return; orderRef.current = created; setOrder(created); go('ready'); },
      (e) => { if (!liveRef.current) return; setError(orderErrorText(e)); go('error'); if (e.code === 'ALREADY_ENTITLED') onConfirmed?.(); });
    return () => { liveRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'waiting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = setInterval(async () => {
      try {
        const state = await getOrder(orderRef.current.orderId);
        if (!liveRef.current || state.status === 'AWAITING_OWNER' || state.status === 'PENDING_PAYMENT') { setError(''); return; }
        setFinal(state.status); go('final');
        if (state.status === 'CONFIRMED' && !confirmedRef.current) { confirmedRef.current = true; onConfirmed?.(); }
      } catch (e) { if (liveRef.current) setError(orderErrorText(e)); } // mat mang: tiep tuc thu lai, khong bo don
    }, pollMs);
    return () => clearInterval(t);
  }, [phase, pollMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = async () => {
    // Chua bao da chuyen khoan -> giai phong cho don cho. Da bao roi thi giu don (chu van co the xac nhan sau).
    if (phaseRef.current === 'ready' && orderRef.current) await cancelOrder(orderRef.current.orderId).catch(() => {});
    onClose();
  };
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  });

  const claim = async () => {
    go('claiming'); setError('');
    try { await claimPaid(orderRef.current.orderId); go('waiting'); }
    catch (e) { setError(orderErrorText(e)); go('ready'); }
  };
  const copy = async (label, value) => {
    try { await navigator.clipboard.writeText(value); setCopied(`Đã sao chép ${label}.`); } catch { setCopied('Không sao chép được. Hãy chọn và sao chép thủ công.'); }
  };

  const seconds = order ? Math.max(0, Math.ceil((Date.parse(order.expiresAt) - now) / 1000)) : 0;
  const hhmm = `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const pay = order?.payment;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" onClick={close}>
      <section role="dialog" aria-modal="true" aria-labelledby="order-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md space-y-3 overflow-auto rounded-lg border border-line bg-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="order-title" className="text-lg font-bold">Mua thư viện</h2>
          <button className={secondary} onClick={close}>Đóng</button>
        </div>
        <p className="text-sm text-mute">License toàn bộ thư viện 3DS Mood, vĩnh viễn, gồm cả model thêm sau. Dùng cho 1 thiết bị.</p>
        {phase === 'creating' && <p role="status" className="text-sm text-mute">Đang tạo đơn…</p>}
        {phase === 'error' && <p role="alert" className="text-sm text-danger">{error}</p>}
        {order && <>
          <p className="font-mono text-2xl text-brand">{vnd(order.amountVnd)}</p>
          <p className="text-xs text-mute">Mã đơn <span className="select-text font-mono">{order.code}</span></p>
        </>}
        {(phase === 'ready' || phase === 'claiming' || phase === 'waiting') && pay && <>
          <div className="mx-auto w-fit rounded-lg bg-white p-2">
            <QRCodeSVG value={pay.qrPayload} size={220} level="M" marginSize={4} role="img" aria-label="Mã VietQR thanh toán" />
          </div>
          <dl className="space-y-2 rounded-md bg-base p-3 text-sm">
            <div><dt className="text-mute">Ngân hàng</dt><dd>{pay.bankName}</dd></div>
            <div><dt className="text-mute">Chủ tài khoản</dt><dd>{pay.accountName}</dd></div>
            <div><dt className="text-mute">Số tài khoản</dt><dd className="flex items-center gap-2"><span className="select-text font-mono">{pay.accountNo}</span>
              <button className="text-xs text-brand" onClick={() => copy('số tài khoản', pay.accountNo)}>Sao chép</button></dd></div>
            <div><dt className="text-mute">Nội dung chuyển khoản (bắt buộc đúng)</dt><dd className="flex items-center gap-2"><span className="select-text font-mono font-bold">{pay.transferContent}</span>
              <button className="text-xs text-brand" onClick={() => copy('nội dung', pay.transferContent)}>Sao chép</button></dd></div>
          </dl>
          <p className="text-center font-mono text-sm" role="timer">{seconds > 0 ? `Đơn hết hạn sau ${hhmm}` : 'Đơn đã hết hạn.'}</p>
          {copied && <p className="text-xs text-mute" role="status">{copied}</p>}
        </>}
        {phase === 'ready' && <div className="flex gap-2">
          <button className={`${primary} flex-1`} onClick={claim} disabled={seconds === 0}>Tôi đã chuyển khoản</button>
        </div>}
        {phase === 'claiming' && <p role="status" className="text-sm text-mute">Đang gửi xác nhận…</p>}
        {phase === 'waiting' && <p role="status" className="text-sm">Đã báo cho chủ cửa hàng. Đang chờ xác nhận tiền về… (tự kiểm tra mỗi {Math.round(pollMs / 1000)} giây; bạn có thể đóng, thư viện sẽ mở khóa khi được xác nhận)</p>}
        {phase === 'final' && final && <p role="status" className={`text-sm font-bold ${FINAL[final].tone}`}>{FINAL[final].text}</p>}
        {error && phase !== 'error' && <p role="alert" className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-mute">Thanh toán do máy chủ xác minh và cấp quyền; giao diện này không tự cấp quyền.</p>
      </section>
    </div>
  );
}
