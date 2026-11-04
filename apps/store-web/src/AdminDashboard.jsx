import { useState } from 'react';
import { useAuth } from './auth.jsx';
import AdminAccount from './AdminAccount.jsx';
import AdminDrive from './AdminDrive.jsx';
import AdminSync from './AdminSync.jsx';
import AdminDevices from './AdminDevices.jsx';
import AdminOrders from './AdminOrders.jsx';
import AdminReview from './AdminReview.jsx';
import AdminSettings from './AdminSettings.jsx';
import { secondary } from './AdminShared.jsx';

const sections = [['drive', 'Kết nối Drive'], ['sync', 'Quét đồng bộ'], ['review', 'Cần duyệt'], ['orders', 'Đơn hàng'], ['devices', 'Thiết bị & license'], ['settings', 'Cài đặt'], ['account', 'Thông tin đăng nhập']];
export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [section, setSection] = useState(user.mustChangeCredentials ? 'account' : 'drive');
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
        {active === 'drive' && <AdminDrive />}
        {active === 'sync' && <AdminSync />}
        {active === 'review' && <AdminReview />}
        {active === 'orders' && <AdminOrders />}
        {active === 'devices' && <AdminDevices />}
        {active === 'settings' && <AdminSettings />}
        {active === 'account' && <AdminAccount />}
      </div></main>
    </div>
  </div>;
}
