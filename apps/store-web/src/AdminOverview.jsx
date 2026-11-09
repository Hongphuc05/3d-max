import { useState } from 'react';
import { adminHealth, adminOverview, adminTelegramTest } from './api.js';
import { ResourceState, adminError, dateTime, panel, primary, secondary, useAdminResource } from './AdminShared.jsx';

const vnd = (n) => `${Number(n ?? 0).toLocaleString('vi-VN')} ₫`;
const size = (n) => n == null ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;

function Tile({ label, value, hint, onClick }) {
  const body = <><p className="text-xs text-mute">{label}</p><p className="mt-1 font-mono text-xl font-bold">{value}</p>{hint && <p className="mt-1 text-xs text-mute">{hint}</p>}</>;
  return onClick
    ? <button type="button" onClick={onClick} className={`${panel} text-left hover:border-brand`}>{body}</button>
    : <div className={panel}>{body}</div>;
}

function Chart({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.amountVnd));
  const w = 12, gap = 4;
  return <svg role="img" aria-label="Doanh thu 30 ngày" viewBox={`0 0 ${daily.length * (w + gap)} 100`} className="h-40 w-full">
    {daily.map((d, i) => {
      const h = (d.amountVnd / max) * 90;
      return <rect key={d.date} x={i * (w + gap)} y={100 - h} width={w} height={Math.max(h, d.amountVnd ? 1 : 0)} rx="2" className="fill-accent"><title>{`${d.date}: ${vnd(d.amountVnd)}`}</title></rect>;
    })}
  </svg>;
}

const Dot = ({ ok }) => <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-accent' : 'bg-danger'}`} />;
function Row({ ok, label, detail }) {
  return <li className="flex items-center gap-3 py-2 text-sm" data-ok={ok ? 'true' : 'false'}><Dot ok={ok} /><span className="w-40 shrink-0">{label}</span><span className="min-w-0 truncate text-mute">{detail}</span></li>;
}

function Health({ data }) {
  const t = data.telegram;
  return <ul className="divide-y divide-line">
    <Row ok={data.db.ok} label="Cơ sở dữ liệu" detail={data.db.ok ? 'Kết nối tốt' : 'Không kết nối được'} />
    <Row ok={t.botOk} label="Telegram bot" detail={t.botOk ? `@${t.botUsername}` : t.configured ? `Lỗi (${t.error ?? 'không rõ'})` : 'Chưa cấu hình'} />
    <Row ok={t.botOk && t.webhookMatches} label="Webhook Telegram" detail={!t.botOk ? '—' : t.webhookMatches ? `Đúng · ${t.pendingUpdates ?? 0} chờ xử lý` : `Không khớp (${t.webhookUrl ?? 'chưa đặt'})`} />
    {t.lastErrorMessage && <Row ok={false} label="Lỗi webhook gần nhất" detail={`${t.lastErrorMessage} · ${dateTime(t.lastErrorDate)}`} />}
    <Row ok={data.disk.totalBytes != null && data.disk.freeBytes / data.disk.totalBytes > 0.1} label="Ổ đĩa" detail={`Trống ${size(data.disk.freeBytes)} / ${size(data.disk.totalBytes)}`} />
    <Row ok={data.modelCache.bytes <= data.modelCache.limitBytes} label="Cache model" detail={`${size(data.modelCache.bytes)} / ${size(data.modelCache.limitBytes)}`} />
    <Row ok={Boolean(data.backup.lastAt)} label="Sao lưu gần nhất" detail={data.backup.lastAt ? dateTime(data.backup.lastAt) : 'Chưa có / chưa cấu hình BACKUP_DIR'} />
  </ul>;
}

export default function AdminOverview({ onOpenOrders }) {
  const [tick, setTick] = useState(0);
  const o = useAdminResource((signal) => adminOverview(signal), [tick]);
  const h = useAdminResource((signal) => adminHealth(signal), [tick]);
  const [test, setTest] = useState('');
  async function sendTest() {
    setTest('Đang gửi…');
    try { const r = await adminTelegramTest(); setTest(r.ok ? 'Đã gửi tin thử.' : 'Gửi thất bại. Kiểm tra cấu hình bot.'); } catch (e) { setTest(adminError(e)); }
  }
  const d = o.data;
  return <section className="space-y-6">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Tổng quan</h2><button className={secondary} onClick={() => setTick(tick + 1)}>Làm mới</button></div>
    <ResourceState loading={o.loading} error={o.error} retry={() => setTick(tick + 1)} />
    {d && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Doanh thu hôm nay" value={vnd(d.revenue.today)} />
        <Tile label="Doanh thu tháng này" value={vnd(d.revenue.month)} />
        <Tile label="Tổng doanh thu" value={vnd(d.revenue.total)} />
        <Tile label="Đơn chờ duyệt" value={d.orders.awaitingConfirm} hint={`${d.orders.pending} đơn chờ thanh toán`} onClick={onOpenOrders} />
      </div>
      <div className={panel}><h3 className="mb-2 text-sm font-bold">Doanh thu 30 ngày</h3><Chart daily={d.revenue.daily} /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Thiết bị có license" value={d.licenses.activeDevices} />
        <Tile label="Thiết bị mới (7 ngày)" value={d.licenses.newDevices7d} />
        <Tile label="Model đã đăng" value={d.catalog.models} />
        <Tile label="Lần đồng bộ cuối" value={d.catalog.lastSync ? d.catalog.lastSync.status : '—'} hint={d.catalog.lastSync ? `${dateTime(d.catalog.lastSync.finishedAt)}${d.catalog.lastSync.errorCode ? ` · ${d.catalog.lastSync.errorCode}` : ''}` : 'Chưa đồng bộ'} />
      </div>
    </>}
    <div className={panel}>
      <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-bold">Tình trạng hệ thống</h3>
        <button className={primary} onClick={sendTest}>Gửi tin thử</button></div>
      {test && <p role="status" className="mb-2 text-xs text-mute">{test}</p>}
      <ResourceState loading={h.loading} error={h.error} retry={() => setTick(tick + 1)} />
      {h.data && <Health data={h.data} />}
    </div>
  </section>;
}
