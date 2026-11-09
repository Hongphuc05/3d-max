// Diem vao cua route /admin: dang nhap admin (tai khoan tao bang scripts/create-admin.js) -> AdminDashboard.
import { useState } from 'react';
import AdminDashboard from './AdminDashboard.jsx';
import { Logo } from './components.jsx';
import { AuthProvider, useAuth } from './auth.jsx';

const MESSAGES = {
  INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không đúng.',
  TOO_MANY_ATTEMPTS: 'Thử sai quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.',
  BAD_ORIGIN: 'Yêu cầu bị từ chối (sai nguồn truy cập).',
};
const input = 'w-full rounded-md border border-line bg-base px-3 py-2.5 text-sm outline-none placeholder:text-mute focus:border-brand';

function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(username, password); }
    catch (err) { setError(MESSAGES[err.code] || 'Có lỗi xảy ra, vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  return <div className="grid min-h-screen place-items-center bg-base p-4 text-fg">
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-panel p-6">
      <Logo className="mx-auto h-12" />
      <h1 className="text-center text-lg font-bold">Quản trị 3DsMood</h1>
      <input className={input} type="text" required autoFocus autoComplete="username" aria-label="Tên đăng nhập" placeholder="Tên đăng nhập" maxLength={254}
        value={username} onChange={(e) => setUsername(e.target.value)} />
      <input className={input} type="password" required maxLength={128} autoComplete="current-password" placeholder="Mật khẩu"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button disabled={busy} className="w-full rounded-md bg-accent py-3 font-bold text-accent-ink disabled:opacity-60">{busy ? 'Đang xử lý…' : 'Đăng nhập'}</button>
    </form>
  </div>;
}

export function Gate() {
  const { user, restoreError, retrySession } = useAuth();
  if (user === undefined && restoreError) return <div className="grid h-screen place-items-center bg-base p-6 text-center">
    <div role="alert" className="max-w-sm space-y-4"><p className="text-sm text-fg">{restoreError}</p>
      <button onClick={retrySession} className="rounded-md bg-accent px-4 py-2.5 font-bold text-accent-ink">Thử lại</button></div></div>;
  if (user === undefined) return <div role="status" className="grid h-screen place-items-center text-sm text-mute">Đang kiểm tra đăng nhập…</div>;
  return user?.role === 'ADMIN' ? <AdminDashboard key={user.id} /> : <LoginForm />;
}

export default function AdminEntry() {
  return <AuthProvider><Gate /></AuthProvider>;
}
