import { useState } from 'react';
import { adminCreateUser, adminUpdateUser, adminUsers } from './api.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

export default function AdminUsers() {
  const [version, setVersion] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [busyId, setBusyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const resource = useAdminResource(adminUsers, [version]);

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await adminCreateUser({ username: username.trim().toLowerCase(), password });
      setUsername(''); setPassword(''); setNotice(`Tài khoản ${result.account.username} đã được tạo. Admin mới phải đổi mật khẩu ở lần đăng nhập đầu.`);
      setVersion((value) => value + 1);
    } catch (failure) { setError(adminError(failure)); }
    finally { setBusy(false); }
  };

  const manage = async (account, action, nextPassword) => {
    if (action === 'disable' && !window.confirm(`Khóa tài khoản admin ${account.username}? Các phiên đăng nhập sẽ bị thu hồi.`)) return;
    setBusyId(account.id); setError(''); setNotice('');
    try {
      await adminUpdateUser(account.id, { action, ...(nextPassword ? { password: nextPassword } : {}) });
      setResetId(''); setResetPassword('');
      setNotice(action === 'reset_password' ? `Đã đặt lại mật khẩu cho ${account.username}; tài khoản sẽ yêu cầu đổi mật khẩu khi đăng nhập.` : `Đã ${action === 'disable' ? 'khóa' : 'mở khóa'} tài khoản ${account.username}.`);
      setVersion((value) => value + 1);
    } catch (failure) { setError(adminError(failure)); }
    finally { setBusyId(''); }
  };

  return <section className="space-y-5">
    <div><h2 className="text-xl font-bold">Quản lý admin</h2><p className="mt-1 text-sm text-mute">Admin chủ quản tạo, khóa/mở khóa và đặt lại mật khẩu cho các admin khác. Tài khoản mới phải đổi mật khẩu ở lần đăng nhập đầu.</p></div>
    <form onSubmit={create} className={`${panel} space-y-4`}>
      <h3 className="text-base font-bold">Tạo tài khoản admin</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Tên đăng nhập</span><input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" pattern="[a-z0-9][a-z0-9_.-]{2,63}" minLength={3} maxLength={64} required /></label>
        <label className="space-y-1 text-sm"><span>Mật khẩu ban đầu</span><input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      </div>
      <button className={primary} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo admin'}</button>
    </form>

    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />
    {resource.data && <section className={`${panel} space-y-3`} aria-label="Danh sách tài khoản admin">
      <h3 className="text-base font-bold">Tài khoản admin ({resource.data.accounts.length})</h3>
      <ul className="space-y-3">
        {resource.data.accounts.map((account) => <li key={account.id} className="rounded-md border border-line bg-base p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-semibold">{account.username}{account.isOwner && <span className="ml-2 rounded bg-accent/10 px-2 py-1 text-xs text-accent">Admin chủ quản</span>}</p>
              <p className="mt-1 text-xs text-mute">{account.isOwner ? 'Không thể khóa hoặc đặt lại từ danh sách này' : account.disabledAt ? 'Đã khóa' : 'Đang hoạt động'} · Tạo {dateTime(account.createdAt)}{account.mustChangeCredentials ? ' · Chờ đổi mật khẩu' : ''}</p></div>
            {!account.isOwner && <div className="flex flex-wrap gap-2">
              <button type="button" className={secondary} disabled={busyId === account.id} onClick={() => manage(account, account.disabledAt ? 'enable' : 'disable')}>{account.disabledAt ? 'Mở khóa' : 'Khóa admin'}</button>
              <button type="button" className={secondary} disabled={busyId === account.id} onClick={() => { setResetId(resetId === account.id ? '' : account.id); setResetPassword(''); }}>{resetId === account.id ? 'Đóng' : 'Đặt lại mật khẩu'}</button>
            </div>}
          </div>
          {resetId === account.id && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); manage(account, 'reset_password', resetPassword); }}>
            <input aria-label={`Mật khẩu mới cho ${account.username}`} className={`${inputClass} min-w-56 flex-1`} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
            <button className={primary} disabled={busyId === account.id}>{busyId === account.id ? 'Đang lưu…' : 'Lưu mật khẩu mới'}</button>
          </form>}
        </li>)}
      </ul>
    </section>}
  </section>;
}
