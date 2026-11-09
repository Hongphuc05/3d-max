import { useEffect, useState } from 'react';
import { adminTelegramAuthorize, adminTelegramConnections, adminTelegramDisconnect } from './api.js';
import { adminError, dateTime, panel, primary, ResourceState, secondary, useAdminResource } from './AdminShared.jsx';

const resultMessages = {
  pending: ['Bot đã mở trong tab mới. Nhấn Start trong Telegram để hoàn tất liên kết.', 'text-mute'],
  connected: ['Đã kết nối Telegram. Tài khoản này sẽ nhận thông báo và có thể duyệt đơn.', 'text-ok'],
};

function ConnectionPanel() {
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const resource = useAdminResource(adminTelegramConnections, [version]);

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15_000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (notice === 'pending' && resource.data?.accounts?.length) setNotice('connected');
  }, [notice, resource.data]);

  const disconnect = async (account) => {
    if (!window.confirm(`Ngắt kết nối Telegram ${account.displayName}?`)) return;
    setBusyId(account.id); setActionError('');
    try { await adminTelegramDisconnect(account.id); setVersion((value) => value + 1); }
    catch (error) { setActionError(adminError(error)); }
    finally { setBusyId(''); }
  };

  const connect = async () => {
    let popup;
    try { popup = window.open('about:blank', '_blank'); }
    catch { popup = null; }
    if (!popup) {
      setActionError('Trình duyệt đang chặn tab mới. Cho phép mở pop-up rồi bấm kết nối lại.');
      return;
    }
    popup.opener = null;
    setConnecting(true); setActionError(''); setNotice('');
    try {
      const result = await adminTelegramAuthorize();
      const destination = new URL(result.url);
      if (destination.origin !== 'https://t.me') throw new Error('TELEGRAM_BOT_NOT_READY');
      popup.location.replace(destination.href);
      setNotice('pending');
    } catch (error) {
      popup.close();
      setActionError(adminError(error));
    } finally { setConnecting(false); }
  };

  const data = resource.data;
  return <section className={`${panel} space-y-4`} aria-labelledby="telegram-connections-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="telegram-connections-title" className="text-[1rem] font-bold">Kết nối Telegram bot</h3>
        <p className="mt-1 max-w-3xl text-sm text-mute">Mỗi admin liên kết một tài khoản Telegram. Tài khoản đã liên kết nhận thông báo đơn mới và có thể xác nhận hoặc từ chối đơn ngay trong Telegram.</p>
      </div>
      {!data?.accounts?.length && <button type="button" className={primary} disabled={!data?.canConnect || connecting || Boolean(busyId)} onClick={connect}>
          Kết nối Telegram bot
        </button>}
    </div>

    {notice && resultMessages[notice] && <p role="status" className={`text-sm ${resultMessages[notice][1]}`}>{resultMessages[notice][0]}</p>}
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />
    {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}

    {data && !data.canConnect && <div className="rounded-md border border-line bg-base p-3 text-sm text-mute">
      <p>Bot chưa sẵn sàng. Kiểm tra cấu hình Telegram bot và webhook trên máy chủ.</p>
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
