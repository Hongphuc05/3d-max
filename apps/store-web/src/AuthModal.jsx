import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';

const MESSAGES = {
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  TOO_MANY_ATTEMPTS: 'Thử sai quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.',
  EMAIL_TAKEN: 'Email này đã được đăng ký.',
  INVALID_EMAIL: 'Email không hợp lệ.',
  PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 8 ký tự.',
  PASSWORD_TOO_LONG: 'Mật khẩu tối đa 128 ký tự.',
  BAD_ORIGIN: 'Yêu cầu bị từ chối (sai nguồn truy cập).',
};
const input = 'w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none focus:border-brand';

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
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6">
        <div className="flex rounded-xl bg-neutral-100 p-1 text-sm font-bold">
          {[['login', 'Đăng nhập'], ['register', 'Đăng ký']].map(([m, label]) => (
            <button type="button" key={m} onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded-lg py-2 ${mode === m ? 'bg-white shadow' : 'text-neutral-500'}`}>{label}</button>
          ))}
        </div>
        <input className={input} type="email" required autoFocus autoComplete="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={8} maxLength={128} placeholder="Mật khẩu (tối thiểu 8 ký tự)"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-brand py-3 font-bold text-white disabled:opacity-60">
          {busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </button>
      </form>
    </div>
  );
}
