import { useEffect, useState } from 'react';
import { catalogSyncPermission, syncCatalogNow } from './api.js';
import { useAuth } from './auth.jsx';

export function CatalogSyncButton() {
  const { user } = useAuth();
  const [permission, setPermission] = useState({ userId: null, allowed: false });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setPermission({ userId: null, allowed: false });
    setMessage('');
    if (!user?.id) return undefined;
    const controller = new AbortController();
    let current = true;
    catalogSyncPermission(controller.signal).then(result => {
      if (current) setPermission({ userId: user.id, allowed: Boolean(result.allowed) });
    }).catch(() => {
      if (current) setPermission({ userId: user.id, allowed: false });
    });
    return () => { current = false; controller.abort(); };
  }, [user?.id]);

  if (!user?.id || permission.userId !== user.id || !permission.allowed) return null;

  const sync = async () => {
    setPending(true);
    setMessage('');
    try {
      await syncCatalogNow();
      setMessage('Đã yêu cầu quét R2; catalog sẽ tự cập nhật khi có thay đổi.');
    } catch (error) {
      setMessage(error.status === 409
        ? 'Một lượt đồng bộ R2 đang chạy.'
        : error.status === 403 ? 'Tài khoản này không có quyền đồng bộ R2.' : 'Không thể bắt đầu đồng bộ R2.');
    } finally { setPending(false); }
  };

  return <div className="flex items-center gap-2">
    <button type="button" onClick={sync} disabled={pending}
      className="rounded-md border border-accent/50 px-3 py-1.5 text-xs font-bold text-accent disabled:opacity-50">
      {pending ? 'Đang gửi yêu cầu…' : 'Sync R2 Now'}
    </button>
    {message && <span role="status" className="max-w-64 text-[11px] text-mute">{message}</span>}
  </div>;
}
