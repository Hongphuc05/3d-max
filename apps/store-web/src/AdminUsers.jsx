import { useState } from 'react';
import { adminCreateUser, adminUpdateUser, adminUsers } from './api.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

export default function AdminUsers() {
  const [version, setVersion] = useState(0);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [busyId, setBusyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const resource = useAdminResource(adminUsers, [version]);

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await adminCreateUser({ username: username.trim().toLowerCase(), displayName: displayName.trim(), password });
      setUsername(''); setDisplayName(''); setPassword(''); setShowCreate(false);
      setNotice(`Tài khoản ${result.account.username} đã được tạo. Admin mới phải đổi mật khẩu ở lần đăng nhập đầu.`);
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

  const accounts = (resource.data?.accounts ?? []).filter((account) => showDisabled || !account.disabledAt);

  return <section className="space-y-5 border-t border-line pt-6" aria-labelledby="admin-users-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="admin-users-title" className="text-xl font-bold">Quản lý tài khoản</h2>
        <p className="mt-1 text-sm text-mute">Tạo và quản lý các tài khoản admin. Admin mới phải đổi mật khẩu ở lần đăng nhập đầu.</p>
      </div>
      <button type="button" className={primary} onClick={() => { setShowCreate((value) => !value); setError(''); }}>
        {showCreate ? 'Đóng biểu mẫu' : 'Tạo tài khoản mới'}
      </button>
    </div>

    {showCreate && <form onSubmit={create} className={`${panel} space-y-4`}>
      <h3 className="text-base font-bold">Tạo tài khoản admin</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm"><span>Tên đăng nhập</span><input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" pattern="[a-z0-9][a-z0-9_.-]{2,63}" minLength={3} maxLength={64} required /></label>
        <label className="space-y-1 text-sm"><span>Họ và tên</span><input className={inputClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" minLength={1} maxLength={120} required /></label>
        <label className="space-y-1 text-sm"><span>Mật khẩu ban đầu</span><input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
      </div>
      <button className={primary} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo admin'}</button>
    </form>}

    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-accent">{notice}</p>}
    <label className="flex items-center gap-2 text-sm text-mute">
      <input type="checkbox" checked={showDisabled} onChange={(event) => setShowDisabled(event.target.checked)} />
      Hiện cả tài khoản đã khóa
    </label>
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />

    {resource.data && <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm" aria-label="Danh sách tài khoản admin">
        <thead className="bg-raised text-xs uppercase tracking-wide text-mute"><tr>
          <th scope="col" className="px-4 py-3">Tên tài khoản</th><th scope="col" className="px-4 py-3">Họ và tên</th><th scope="col" className="px-4 py-3">Vai trò</th>
          <th scope="col" className="px-4 py-3">Trạng thái</th><th scope="col" className="px-4 py-3">Ngày tạo</th>
          <th scope="col" className="px-4 py-3 text-right">Hành động</th>
        </tr></thead>
        <tbody className="divide-y divide-line">
          {accounts.map((account) => <tr key={account.id}>
            <td className="px-4 py-3 font-semibold">{account.username}</td>
            <td className="px-4 py-3">{account.displayName || '—'}</td>
            <td className="px-4 py-3"><span className="rounded-md border border-accent/30 px-2 py-1 text-xs text-accent">ADMIN</span>{account.isOwner && <span className="ml-2 text-xs text-mute">Chủ quản</span>}</td>
            <td className={`px-4 py-3 ${account.disabledAt ? 'text-danger' : 'text-accent'}`}>{account.disabledAt ? 'Đã khóa' : account.mustChangeCredentials ? 'Chờ đổi mật khẩu' : 'Hoạt động'}</td>
            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-mute">{dateTime(account.createdAt)}</td>
            <td className="px-4 py-3">
              {account.isOwner ? <span className="block text-right text-xs text-mute">Tài khoản chủ quản</span> : <div className="flex justify-end gap-2">
                <button type="button" className={secondary} disabled={busyId === account.id} onClick={() => manage(account, account.disabledAt ? 'enable' : 'disable')}>{account.disabledAt ? 'Mở khóa' : 'Khóa'}</button>
                <button type="button" className={secondary} disabled={busyId === account.id} onClick={() => { setResetId(resetId === account.id ? '' : account.id); setResetPassword(''); }}>{resetId === account.id ? 'Đóng' : 'Đặt lại mật khẩu'}</button>
              </div>}
              {resetId === account.id && <form className="mt-3 flex min-w-64 justify-end gap-2" onSubmit={(event) => { event.preventDefault(); manage(account, 'reset_password', resetPassword); }}>
                <input aria-label={`Mật khẩu mới cho ${account.username}`} className={`${inputClass} max-w-56`} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
                <button className={primary} disabled={busyId === account.id}>{busyId === account.id ? 'Đang lưu…' : 'Lưu'}</button>
              </form>}
            </td>
          </tr>)}
          {accounts.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-mute">{resource.data.accounts.length ? 'Không có tài khoản nào trong bộ lọc này.' : 'Chưa có tài khoản admin.'}</td></tr>}
        </tbody>
      </table>
    </div>}
  </section>;
}
