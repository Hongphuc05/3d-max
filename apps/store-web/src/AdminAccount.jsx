import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { adminError, inputClass, panel, primary } from './AdminShared.jsx';

export default function AdminAccount() {
  const { user, changeAdminAccount } = useAuth();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [username, setUsername] = useState(user.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = async event => {
    event.preventDefault(); setError(''); setSaved(false);
    if (newPassword !== confirmPassword) { setError('Xác nhận mật khẩu chưa khớp.'); return; }
    setBusy(true);
    try {
      const result = await changeAdminAccount({ username: username.trim(), currentPassword, ...(newPassword ? { newPassword } : {}) });
      if (!mounted.current) return;
      setUsername(result.user.username || '');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setSaved(true);
    } catch (failure) { if (mounted.current) setError(adminError(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className={`${panel} max-w-xl space-y-5`}>
    <div><h2 className="text-xl font-bold">Tài khoản quản trị</h2><p className="mt-2 text-sm text-mute">Đổi tên đăng nhập hoặc mật khẩu. Những phiên đăng nhập cũ sẽ được kết thúc sau khi lưu.</p></div>
    {user.mustChangeCredentials && <p className="rounded-md border border-warn/30 bg-warn/5 p-3 text-sm text-warn">Đây là lần đăng nhập đầu tiên. Hãy đặt mật khẩu mới để mở các chức năng quản trị.</p>}
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-2 text-sm"><span>Tên đăng nhập</span><input className={inputClass} name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" pattern="[a-z0-9][a-z0-9_.\-]{2,63}" required minLength={3} maxLength={64} /></label>
      <label className="block space-y-2 text-sm"><span>Mật khẩu hiện tại</span><input className={inputClass} name="currentPassword" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required maxLength={128} /></label>
      <label className="block space-y-2 text-sm"><span>Mật khẩu mới{!user.mustChangeCredentials && ' (để trống nếu giữ nguyên)'}</span><input className={inputClass} name="newPassword" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" required={user.mustChangeCredentials} minLength={8} maxLength={128} /></label>
      <label className="block space-y-2 text-sm"><span>Xác nhận mật khẩu mới</span><input className={inputClass} name="confirmPassword" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required={Boolean(newPassword)} maxLength={128} /></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="text-sm text-brand">Đã lưu thông tin đăng nhập. Bạn đang dùng phiên đăng nhập mới.</p>}
      <button className={primary} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thông tin đăng nhập'}</button>
    </form>
  </section>;
}
