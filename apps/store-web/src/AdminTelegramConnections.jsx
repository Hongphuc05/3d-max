import { useEffect, useState } from 'react';
import { adminTelegramConnections, adminTelegramDisconnect } from './api.js';
import { adminError, dateTime, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

const resultMessages = {
  connected: ['Đã kết nối Telegram. Tài khoản này sẽ nhận thông báo và có thể duyệt đơn.', 'text-accent'],
  'already-linked': ['Tài khoản Telegram này đã được liên kết với một admin khác.', 'text-danger'],
  cancelled: ['Đã hủy kết nối Telegram.', 'text-mute'],
  failed: ['Không xác minh được Telegram. Hãy thử kết nối lại.', 'text-danger'],
};

function ConnectionPanel() {
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const resource = useAdminResource(adminTelegramConnections, [version]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('telegram');
    if (resultMessages[status]) setNotice(status);
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15_000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, []);

  const disconnect = async (account) => {
    if (!window.confirm(`Ngắt kết nối Telegram ${account.displayName}?`)) return;
    setBusyId(account.id); setActionError('');
    try { await adminTelegramDisconnect(account.id); setVersion((value) => value + 1); }
    catch (error) { setActionError(adminError(error)); }
    finally { setBusyId(''); }
  };

  const data = resource.data;
  return <section className={`${panel} space-y-4`} aria-labelledby="telegram-connections-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="telegram-connections-title" className="text-base font-bold">Kết nối Telegram bot</h3>
        <p className="mt-1 max-w-3xl text-sm text-mute">Mỗi admin có thể liên kết nhiều tài khoản Telegram. Tài khoản đã liên kết nhận thông báo đơn mới và có thể xác nhận hoặc từ chối đơn ngay trong Telegram.</p>
      </div>
      <form method="post" action="/api/admin/telegram/connections/authorize" target="_blank" rel="noopener noreferrer">
        <button type="submit" className={primary} disabled={!data?.loginConfigured || Boolean(busyId)}>
          {data?.accounts?.length ? 'Kết nối thêm tài khoản' : 'Kết nối Telegram bot'}
        </button>
      </form>
    </div>

    {notice && resultMessages[notice] && <p role="status" className={`text-sm ${resultMessages[notice][1]}`}>{resultMessages[notice][0]}</p>}
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />
    {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}

    {data && !data.loginConfigured && <div className="rounded-md border border-line bg-base p-3 text-sm text-mute">
      <p>Chưa bật Telegram Login trên máy chủ. Cần cấu hình Client ID và Client Secret do BotFather cấp, rồi cho phép callback:</p>
      <code className="mt-2 block break-all font-mono text-xs text-fg">https://3dsmood.io.vn/api/telegram/login/callback</code>
      {data.loginErrors?.length > 0 && <p className="mt-2">Cấu hình còn thiếu hoặc sai: <code className="font-mono">{data.loginErrors.join(', ')}</code></p>}
    </div>}

    {data && <>
      <p className="text-xs text-mute">Đã liên kết {data.accounts.length} tài khoản{data.ownerChatIdsCount ? ` · ${data.ownerChatIdsCount} chat ID cũ vẫn đang nhận thông báo` : ''}.</p>
      {data.accounts.length === 0 ? <p className="rounded-md border border-line bg-base p-3 text-sm text-mute">Chưa có tài khoản Telegram nào liên kết.</p> :
        <ul className="space-y-2">
          {data.accounts.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-base p-3">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{account.displayName}{account.username ? <span className="ml-2 font-normal text-mute">@{account.username}</span> : null}</p>
              <p className="mt-1 text-xs text-mute">Liên kết {dateTime(account.linkedAt)} · Thông báo gần nhất {dateTime(account.lastNotifiedAt)} · Telegram ID {account.telegramUserId}</p></div>
            <button type="button" className={secondary} disabled={busyId === account.id} onClick={() => disconnect(account)}>{busyId === account.id ? 'Đang ngắt…' : 'Ngắt kết nối'}</button>
          </li>)}
        </ul>}
    </>}
  </section>;
}

export default function AdminTelegramConnections() { return <ConnectionPanel />; }
