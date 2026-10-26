import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';

const MESSAGES = {
  INVALID_CREDENTIALS: 'Email, tên đăng nhập hoặc mật khẩu không đúng.',
  TOO_MANY_ATTEMPTS: 'Thử sai quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.',
  EMAIL_TAKEN: 'Email này đã được đăng ký.',
  INVALID_EMAIL: 'Email không hợp lệ.',
  PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 8 ký tự.',
  PASSWORD_TOO_LONG: 'Mật khẩu tối đa 128 ký tự.',
  BAD_ORIGIN: 'Yêu cầu bị từ chối (sai nguồn truy cập).',
};
const input = 'w-full rounded-md border border-line bg-base px-3 py-2.5 text-sm outline-none placeholder:text-mute focus:border-accent';

export default function AuthModal({ onClose }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await (mode === 'login' ? login : register)(email, password);
      onClose();
    } catch (err) {
      setError(MESSAGES[err.code] || 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-panel p-6">
        <div className="flex rounded-md bg-base p-1 font-mono text-xs font-bold">
          {[['login', 'Đăng nhập'], ['register', 'Đăng ký']].map(([m, label]) => (
            <button type="button" key={m} onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded py-2 ${mode === m ? 'bg-accent text-accent-ink' : 'text-mute'}`}>{label}</button>
          ))}
        </div>
        <input className={input} type={mode === 'login' ? 'text' : 'email'} required autoFocus
          autoComplete={mode === 'login' ? 'username' : 'email'} aria-label={mode === 'login' ? 'Email hoặc tên đăng nhập' : 'Email'}
          placeholder={mode === 'login' ? 'Email hoặc tên đăng nhập' : 'Email'} maxLength={254}
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={mode === 'login' ? 1 : 8} maxLength={128} placeholder={mode === 'login' ? 'Mật khẩu' : 'Mật khẩu (tối thiểu 8 ký tự)'}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-accent py-3 font-bold text-accent-ink disabled:opacity-60">
          {busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </button>
      </form>
    </div>
  );
}
