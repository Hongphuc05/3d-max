import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { useAuth } from './auth.jsx';
import { useLicense } from './license.jsx';
import { licenseError, orderIdFromLocation } from './license-flow.js';
import PaymentDialog, { paymentButton } from './PaymentDialog.jsx';
import { pollPayment } from './payment-poll.js';
import { paymentRequest } from './payment-request.js';

export default function Purchase() {
  const { user } = useAuth();
  const { license, loading, refresh, canImport, error: licenseLoadError } = useLicense();
  const [product, setProduct] = useState(null);
  const [order, setOrder] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const activeRequest = useRef(null);
  const generation = useRef(0);
  const userId = user?.id;

  useEffect(() => () => activeRequest.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    api.lifetimeProduct().then(d => { if (!cancelled) setProduct(d.product); }, e => { if (!cancelled) setError(licenseError(e)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    setOrder(null); setOpen(false); setError('');
    if (!userId) return;
    const id = orderIdFromLocation(location.search) || sessionStorage.getItem(`3dm-order:${userId}`);
    if (id) api.paymentOrder(id).then(d => {
      if (generation.current === current) { setOrder(d.order); setOpen(true); }
    }, e => {
      if (generation.current !== current) return;
      if (e.status === 404) sessionStorage.removeItem(`3dm-order:${userId}`);
      else setError(licenseError(e));
    });
    return () => { generation.current++; };
  }, [userId]);

  const paid = order?.status === 'PAID';
  useEffect(() => { if (paid) refresh(); }, [paid, refresh]);
  const keyReady = Boolean(license?.key);
  useEffect(() => {
    if (!paid || !keyReady) return;
    setOpen(false);
    sessionStorage.removeItem(`3dm-order:${userId}`);
    if (orderIdFromLocation(location.search) === order.id) {
      const url = new URL(location.href);
      url.pathname = '/license';
      for (const name of ['orderId', 'orderCode', 'id', 'status', 'cancel', 'success', 'code']) url.searchParams.delete(name);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, [paid, keyReady, order?.id, userId]);
  useEffect(() => {
    if (!open || order?.status !== 'PENDING') return;
    return pollPayment({
      fetchOrder: signal => api.paymentOrder(order.id, signal),
      onOrder: next => { setOrder(next); setError(''); },
      onError: e => setError(licenseError(e)),
      onTimeout: () => setError('Đã tạm dừng tự kiểm tra. Nhấn Kiểm tra thanh toán để đối soát đơn.'),
    });
  }, [open, order?.id, order?.status]);

  const run = async action => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      activeRequest.current = new AbortController();
      const { order: next } = await paymentRequest(action, activeRequest.current);
      if (current !== generation.current) return;
      setOrder(next); setOpen(true);
      sessionStorage.setItem(`3dm-order:${userId}`, next.id);
    } catch (e) { if (current === generation.current) setError(licenseError(e)); }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false); }
  };
  return <section className="space-y-3 rounded-lg border border-line bg-base p-4">
    <h3 className="font-bold">3DsMood Lifetime</h3>
    <p className="text-sm text-mute">Sử dụng thư viện model trong plugin 3ds Max với 2 thiết bị cố định.</p>
    <p className="font-mono text-xl text-accent">{api.vnd(product?.amountVnd ?? 2000)}</p>
    {paid && keyReady && <p role="status" className="text-sm text-accent">Thanh toán thành công. Key license của bạn đã sẵn sàng trong My License.</p>}
    {paid && order.fulfillmentResult === 'ALREADY_LICENSED' && <p className="text-sm text-warn">Tài khoản đã có license trước đơn này. Liên hệ hỗ trợ để xử lý khoản thanh toán trùng.</p>}
    {paid && !keyReady && <div className="space-y-2 text-sm">
      <p>Đã thanh toán. Đang tải key license từ máy chủ…</p>
      {licenseLoadError && <><p role="alert" className="text-danger">{licenseLoadError}</p><button className={paymentButton} disabled={loading} onClick={() => refresh()}>Thử tải lại license</button></>}
    </div>}
    {license ? <p className="text-sm text-accent">Bạn đã sở hữu 3DsMood Lifetime.</p> : canImport ? <p className="text-sm text-accent">Máy này đã có quyền sử dụng Lifetime. Key chỉ hiển thị trong tài khoản sở hữu.</p> : <button className={paymentButton}
      disabled={!userId || !product?.available || loading || busy}
      onClick={() => order?.status === 'PENDING' ? setOpen(true) : run(api.createPayment)}>
      {busy ? 'Đang xử lý…' : order?.status === 'PENDING' ? 'Tiếp tục đơn thanh toán' : 'Mua Lifetime'}
    </button>}
    {product && !product.available && <p className="text-sm text-warn">Thanh toán tạm thời chưa khả dụng. Vui lòng thử lại sau.</p>}
    {error && !open && <p role="alert" className="text-sm text-danger">{error}</p>}
    {open && order && <PaymentDialog order={order} busy={busy || (paid && loading)} error={error || (paid ? licenseLoadError : '')} onClose={() => setOpen(false)}
      onCheck={() => paid ? refresh() : run(signal => api.reconcilePayment(order.id, signal))} />}
  </section>;
}
