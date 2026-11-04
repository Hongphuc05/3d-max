// P3.6 — man "Don hang": danh sach, loc theo trang thai, xac nhan / tu choi. Chi don khach DA bao chuyen khoan (claimedPaidAt) moi quyet duoc;
// don da het han van xac nhan duoc (chu da nhan tien that). Moi quyet dinh qua 2 buoc (bam -> xac nhan lai) de khong bam nham.
import { useState } from 'react';
import * as api from './api.js';
import { adminError, dateTime, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

export const ORDER_STATUS = { PENDING_PAYMENT: 'Chờ chuyển khoản', AWAITING_OWNER: 'Chờ chủ xác nhận', CONFIRMED: 'Đã xác nhận', REJECTED: 'Đã từ chối', EXPIRED: 'Hết hạn', CANCELLED: 'Đã hủy' };
const th = 'px-3 py-3 text-left text-xs font-medium text-mute';
const td = 'border-t border-line px-3 py-3 align-top text-sm';
const decidable = (o) => Boolean(o.claimedPaidAt) && (o.status === 'AWAITING_OWNER' || o.status === 'EXPIRED');

function Actions({ order, onDone }) {
  const [asking, setAsking] = useState(null); // 'confirm' | 'reject'
  const [state, setState] = useState({ busy: false, error: '' });
  if (!decidable(order)) return null;
  async function run(action) {
    setState({ busy: true, error: '' });
    try { await api.adminDecideOrder(order.orderId, action); onDone(); }
    catch (e) { setState({ busy: false, error: adminError(e) }); setAsking(null); }
  }
  const label = { confirm: 'Đã nhận tiền, cấp license', reject: 'Từ chối đơn' };
  return <div className="space-y-2">
    {asking
      ? <div className="flex flex-wrap items-center gap-2"><span className="text-xs">{label[asking]}?</span>
        <button className={primary} disabled={state.busy} onClick={() => run(asking)}>Chắc chắn</button>
        <button className={secondary} disabled={state.busy} onClick={() => setAsking(null)}>Hủy</button></div>
      : <div className="flex flex-wrap gap-2"><button className={primary} onClick={() => setAsking('confirm')}>Xác nhận</button>
        <button className={secondary} onClick={() => setAsking('reject')}>Từ chối</button></div>}
    {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
  </div>;
}

export default function AdminOrders() {
  const [status, setStatus] = useState(''), [version, setVersion] = useState(0);
  const resource = useAdminResource((signal) => api.adminOrders({ status }, signal), [status, version]);
  const items = resource.data?.items;
  return <section className="space-y-5">
    <h2 className="text-xl font-bold">Đơn hàng</h2>
    <div className={`${panel} space-y-4`}>
      <div className="flex flex-wrap gap-2">
        <select className="rounded-md border border-line bg-base px-3 py-2 text-sm" name="statusFilter" aria-label="Lọc theo trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tất cả trạng thái</option>{Object.entries(ORDER_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className={secondary} onClick={() => setVersion((v) => v + 1)}>Làm mới</button>
      </div>
      <ResourceState loading={resource.loading} error={resource.error} retry={() => setVersion((v) => v + 1)} />
      {items && items.length === 0 && <p className="py-4 text-sm text-mute">Chưa có đơn nào.</p>}
      {items && items.length > 0 && <div className="overflow-x-auto"><table className="w-full">
        <thead><tr><th className={th}>Mã đơn</th><th className={th}>Trạng thái</th><th className={th}>Số tiền</th><th className={th}>Thiết bị</th><th className={th}>Tạo lúc</th><th className={th}>Báo đã chuyển lúc</th><th className={th}>Thao tác</th></tr></thead>
        <tbody>{items.map((o) => <tr key={o.orderId} data-order={o.orderId}>
          <td className={`${td} font-mono`}>{o.code}</td>
          <td className={td}>{ORDER_STATUS[o.status] || o.status}</td>
          <td className={`${td} whitespace-nowrap`}>{api.vnd(o.amountVnd)}</td>
          <td className={td}>{o.deviceName}<div className="font-mono text-[10px] text-mute">{String(o.deviceId).slice(0, 8)}</div></td>
          <td className={`${td} whitespace-nowrap`}>{dateTime(o.createdAt)}</td>
          <td className={`${td} whitespace-nowrap`}>{dateTime(o.claimedPaidAt)}</td>
          <td className={td}><Actions order={o} onDone={() => setVersion((v) => v + 1)} /></td>
        </tr>)}</tbody></table></div>}
    </div>
  </section>;
}
