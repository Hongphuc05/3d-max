import { useState } from 'react';
import { useAuth } from './auth.jsx';
import * as api from './api.js';
import { CatalogSyncButton } from './CatalogSyncButton.jsx';
import AdminAccount from './AdminAccount.jsx';
import AdminUsers from './AdminUsers.jsx';
import AdminDrive from './AdminDrive.jsx';
import AdminSync from './AdminSync.jsx';
import AdminReview from './AdminReview.jsx';
import AdminSettings from './AdminSettings.jsx';
import { AdminOrders, AdminAudit } from './AdminRecords.jsx';
import { dateTime, panel, secondary, useAdminResource, ResourceState } from './AdminShared.jsx';

const sections = [['overview', 'Tổng quan'], ['drive', 'Kết nối Drive'], ['sync', 'Quét đồng bộ'], ['review', 'Cần duyệt'], ['settings', 'Cài đặt'], ['users', 'Tài khoản & license'], ['orders', 'Thanh toán'], ['audit', 'Lịch sử thao tác'], ['account', 'Thông tin đăng nhập']];
const catalogStates = { ready: 'Đã đồng bộ', empty: 'Catalog trống', configuration_required: 'Cần cấu hình', not_synced: 'Chưa đồng bộ', syncing: 'Đang đồng bộ', error: 'Đồng bộ gặp lỗi' };
function Overview() {
  const [version, setVersion] = useState(0);
  const resource = useAdminResource(api.adminOverview, [version]);
  const stats = resource.data?.stats, catalog = resource.data?.catalog;
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Tổng quan hoạt động</h2><button className={secondary} onClick={() => setVersion(value => value + 1)}>Làm mới</button></div>
    <ResourceState {...resource} retry={() => setVersion(value => value + 1)} />
    {stats && <>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line xl:grid-cols-4">
        {[['Tài khoản', stats.users], ['License hoạt động', stats.activeLicenses], ['Đơn đã thanh toán', stats.paidOrders], ['Doanh thu', api.vnd(stats.revenueVnd)]].map(([label, value]) => <div key={label} className="bg-panel px-5 py-6"><dt className="text-xs text-mute">{label}</dt><dd className="mt-3 break-words text-2xl font-bold tabular-nums md:text-3xl">{value}</dd></div>)}
      </dl>
      <section className={`${panel} space-y-4`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">Catalog Cloudflare R2</h3><p className="mt-1 text-sm text-mute">Quét lại nguồn dữ liệu khi cần cập nhật catalog ngay.</p></div><CatalogSyncButton /></div>
        <dl className="grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-mute">Trạng thái</dt><dd className="mt-1 text-accent">{catalog?.syncing ? 'Đang đồng bộ' : catalogStates[catalog?.state] || catalog?.state || 'Chưa có dữ liệu'}</dd></div><div><dt className="text-xs text-mute">Lần đồng bộ thành công</dt><dd className="mt-1">{dateTime(catalog?.lastSuccessfulSync)}</dd></div><div><dt className="text-xs text-mute">Phiên bản catalog</dt><dd className="mt-1">{catalog?.version ?? '—'}</dd></div></dl>
      </section>
    </>}
  </div>;
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [section, setSection] = useState(user.mustChangeCredentials ? 'account' : 'overview');
  const locked = Boolean(user.mustChangeCredentials);
  const active = locked ? 'account' : section;
  return <div className="flex h-screen min-h-0 flex-col bg-base text-fg">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-4 md:px-6">
      <div><p className="font-mono text-[10px] tracking-[0.2em] text-accent">3DS MOOD / ADMIN</p><h1 className="mt-1 text-lg font-bold">Quản trị 3DsMood</h1></div>
      <div className="flex items-center gap-3"><span className="max-w-40 truncate font-mono text-xs text-mute">{user.username || user.email}</span><button className={secondary} onClick={logout}>Đăng xuất</button></div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Quản trị" className="flex shrink-0 flex-wrap gap-1 border-b border-line bg-panel p-3 md:w-56 md:flex-col md:border-r md:border-b-0">
        {sections.map(([key, label]) => <button key={key} disabled={locked && key !== 'account'} aria-current={active === key ? 'page' : undefined} onClick={() => setSection(key)} className={`rounded-md px-3 py-2.5 text-left text-sm disabled:opacity-35 ${active === key ? 'bg-accent/10 font-bold text-accent' : 'text-mute hover:bg-raised hover:text-fg'}`}>{label}</button>)}
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6"><div className="mx-auto max-w-6xl">
        {active === 'overview' && <Overview />}
        {active === 'drive' && <AdminDrive />}
        {active === 'sync' && <AdminSync />}
        {active === 'review' && <AdminReview />}
        {active === 'settings' && <AdminSettings />}
        {active === 'users' && <AdminUsers />}
        {active === 'orders' && <AdminOrders />}
        {active === 'audit' && <AdminAudit />}
        {active === 'account' && <AdminAccount />}
      </div></main>
    </div>
  </div>;
}
