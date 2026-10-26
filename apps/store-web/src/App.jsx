import { useEffect, useMemo, useState } from 'react';
import AuthModal from './AuthModal.jsx';
import { useAuth } from './auth.jsx';
import { Card, DetailPanel, Filters } from './components.jsx';
import { catalogMessage, downloadedProducts, matchesCategory } from './catalog-view.js';
import { useCatalog } from './useCatalog.js';
import { HostBar } from './HostBar.jsx';
import { Icon } from './icons.jsx';
import { isMaxHost } from './integrations/3dsmax/bridge.js';
import { Queue } from './Queue.jsx';
import { useJobs } from './queue.js';
import { useLicense } from './license.jsx';
import LicensePanel from './LicensePanel.jsx';
import { CatalogSyncButton } from './CatalogSyncButton.jsx';
import AdminDashboard from './AdminDashboard.jsx';

const PAGE = 30;
const SORTS = {
  name: ['Tên A → Z', (a, b) => a.name.localeCompare(b.name)],
  small: ['Nhẹ → nặng', (a, b) => a.info.sizeMB - b.info.sizeMB],
  big: ['Nặng → nhẹ', (a, b) => b.info.sizeMB - a.info.sizeMB],
};

function Account({ onLogin }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (user === undefined) return null;
  if (!user) {
    return (
      <button onClick={onLogin} title="Đăng nhập" className="flex flex-col items-center gap-1 rounded-md p-2 text-[10px] text-mute hover:bg-raised hover:text-fg">
        <Icon name="user" className="size-5" />Đăng nhập
      </button>
    );
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} title={user.email}
        className="grid size-9 place-items-center rounded-full bg-accent font-bold text-accent-ink uppercase">{user.email[0]}</button>
      {open && (
        <div className="absolute bottom-0 left-12 z-50 w-56 rounded-md border border-line bg-raised p-3 text-sm shadow-xl">
          <div className="truncate font-mono text-xs text-mute">{user.email}</div>
          <button onClick={() => { setOpen(false); logout(); }} className="mt-2 w-full rounded-md border border-line py-1.5 hover:bg-line">Đăng xuất</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { user, restoreError, retrySession } = useAuth();
  if (user === undefined && restoreError) return <div className="grid h-screen place-items-center bg-base p-6 text-center">
    <div className="max-w-md space-y-4">
      <p role="alert" className="text-sm text-warn">{restoreError}</p>
      <button onClick={retrySession} className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink">Thử lại</button>
    </div>
  </div>;
  if (user === undefined) return <div role="status" className="grid h-screen place-items-center text-sm text-mute">Đang kiểm tra đăng nhập…</div>;
  return user?.role === 'ADMIN' ? <AdminDashboard key={user.id} /> : <StoreApp />;
}

function StoreApp() {
  const [subs, setSubs] = useState(() => new Set());
  const [renderers, setRenderers] = useState(() => new Set());
  const [text, setText] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('online');
  const [active, setActive] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { categories, products, state, status, error: loadError } = useCatalog(reloadKey);
  const { user } = useAuth();
  const licenseState = useLicense();
  const jobs = useJobs();
  const max = isMaxHost();

  const doneSlugs = useMemo(() => new Set(jobs.filter((j) => j.status === 'done').map((j) => j.slug)), [jobs]);
  const downloaded = useMemo(() => downloadedProducts(products, jobs), [products, jobs]);
  const rendererOptions = useMemo(() => [...new Set(products.flatMap(p => p.info.renderers))].sort(), [products]);
  const catalogNotice = catalogMessage(status);
  useEffect(() => {
    setActive(previous => previous && (products.find(product => product.id === previous.id)
      || downloaded.find(product => product.id === previous.id) || null));
  }, [products, downloaded]);
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return (tab === 'online' ? products : downloaded)
      .filter((p) => matchesCategory(p, subs)
        && (renderers.size === 0 || p.info.renderers.some((r) => renderers.has(r)))
        && (!needle || p.name.toLowerCase().includes(needle)))
      .sort(SORTS[sort][1]);
  }, [products, downloaded, tab, subs, renderers, text, sort]);

  useEffect(() => setPage(1), [tab, subs, renderers, text, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => setPage(previous => Math.min(previous, pages)), [pages]);
  const view = rows.slice((page - 1) * PAGE, page * PAGE);
  const login = () => setAuthOpen(true);

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)}
      className={`rounded-md px-4 py-1.5 font-mono text-xs font-bold ${tab === k ? 'bg-accent text-accent-ink' : 'border border-line text-mute hover:text-fg'}`}>
      {label}
    </button>
  );

  return (
    <div className="flex h-screen flex-col">
      <HostBar reloadKey={reloadKey} onRefresh={() => setReloadKey((k) => k + 1)} />

      <div className="flex min-h-0 flex-1">
        {/* cot icon */}
        <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel py-3">
          <div className="flex flex-col items-center gap-1 rounded-md bg-raised p-2 text-[10px] text-accent" title="Models">
            <Icon name="cube" className="size-5" />Models
          </div>
          <div className="mt-auto"><Account onLogin={login} /></div>
        </nav>

        {/* bo loc + hang doi: man rong co dinh, man hep la ngan keo */}
        <div className={`${drawer ? 'fixed inset-0 z-30 bg-black/60' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent`} onClick={() => setDrawer(false)}>
          <aside className="flex h-full w-72 flex-col border-r border-line bg-panel lg:w-64" onClick={(e) => e.stopPropagation()}>
            <div className="min-h-0 flex-1 overflow-auto">
              <Filters categories={categories} subs={subs} setSubs={setSubs} renderers={renderers} setRenderers={setRenderers} rendererOptions={rendererOptions} />
            </div>
            {max && <Queue />}
          </aside>
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <button onClick={() => licenseState.setOpen(true)} className="rounded-md border border-accent/50 px-3 py-1.5 text-xs font-bold text-accent">My License · Lifetime</button>
            <CatalogSyncButton />
            {tabBtn('online', 'Online')}
            {tabBtn('done', `Đã tải${doneSlugs.size ? ` (${doneSlugs.size})` : ''}`)}
            <button onClick={() => setDrawer(true)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg lg:hidden">
              <Icon name="filter" className="size-3.5" />Lọc{subs.size + renderers.size ? ` (${subs.size + renderers.size})` : ''}
              {max && activeJobs > 0 && <span className="text-accent">· {activeJobs} đang tải</span>}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="mr-2 leading-tight">
              <div className="font-mono text-[10px] tracking-widest text-accent">3DS MOOD MODELS</div>
              <div className="font-mono text-xs text-mute">{state === 'ready' ? `${rows.length} model` : '…'}</div>
            </div>
            <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-3 focus-within:border-accent">
              <Icon name="search" className="size-3.5 text-mute" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm model…"
                className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-mute" />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}
              className="rounded-md border border-line bg-panel px-2 py-1.5 font-mono text-xs outline-none focus:border-accent">
              {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            {tab === 'online' && (loadError || catalogNotice) && (
              <p className="rounded-md border border-danger/40 bg-danger/10 p-4 font-mono text-xs text-danger">
                {loadError || catalogNotice}
              </p>
            )}
            {state === 'ready' && rows.length === 0 && (tab === 'done' || products.length > 0 || (!loadError && !catalogNotice)) && (
              <p className="py-16 text-center font-mono text-xs text-mute">
                {tab === 'done'
                  ? 'Chưa có model nào được tải trong phiên này.'
                  : products.length ? 'Không có model nào khớp bộ lọc.' : catalogNotice || 'Catalog đã tải thành công và hiện đang trống.'}
              </p>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
              {state === 'loading'
                ? Array.from({ length: 18 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-lg bg-panel" />)
                : view.map((p) => <Card key={p.id} p={p} active={active?.id === p.id} onOpen={setActive} onLogin={login} />)}
            </div>
          </div>

          {state === 'ready' && rows.length > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-3 py-2 font-mono text-xs">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-30">‹ Trước</button>
              <span className="text-mute">Trang {page} / {pages} · {rows.length} model</span>
              <button disabled={page === pages} onClick={() => setPage(page + 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-30">Sau ›</button>
            </div>
          )}
        </main>

        <DetailPanel p={active} onClose={() => setActive(null)} onLogin={login} />
      </div>

      {licenseState.open && <LicensePanel onLogin={login} />}
      {authOpen && !user && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
