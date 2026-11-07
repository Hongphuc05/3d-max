// Danh muc cong khai (trinh duyet thuong): chi xem model, khong mua/gia/license. Tai ve thu vien = MZP installer cua plugin.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Filters, Preview } from './components.jsx';
import { Icon } from './icons.jsx';
import { matchesCategory } from './catalog-view.js';
import { usePluginCatalog } from './usePluginCatalog.js';

const MZP = '/download/3dsmood-library.mzp';
const STEP = 48;

function DownloadButton({ className = '' }) {
  const [ready, setReady] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeDownload = useRef(null);
  useEffect(() => {
    const c = new AbortController();
    fetch(MZP, { method: 'HEAD', signal: c.signal }).then(r => { if (!c.signal.aborted) setReady(r.status === 200); }, () => { if (!c.signal.aborted) setReady(false); });
    return () => { c.abort(); activeDownload.current?.abort(); };
  }, []);

  async function download(event) {
    event.preventDefault();
    if (activeDownload.current) return;
    const c = new AbortController();
    activeDownload.current = c;
    setBusy(true); setError('');
    try {
      const response = await fetch(MZP, { method: 'GET', cache: 'no-store', signal: c.signal });
      if (!response.ok) throw new Error('Download unavailable');
      const payload = await response.blob();
      const signature = new Uint8Array(await payload.slice(0, 4).arrayBuffer());
      if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) throw new Error('Invalid installer response');
      if (c.signal.aborted) return;
      // The live server can still send filename=.zip. A local Blob URL has no
      // Content-Disposition header, so save the verified response bytes as .mzp.
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url; link.download = '3dsmood-library.mzp'; link.hidden = true;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      if (!c.signal.aborted) setError('Không tải được bộ cài hợp lệ. Kiểm tra kết nối rồi bấm tải lại.');
    } finally {
      if (activeDownload.current === c) activeDownload.current = null;
      if (!c.signal.aborted) setBusy(false);
    }
  }

  const cls = `inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-bold ${className}`;
  return <>
    {ready === false
      ? <button type="button" disabled className={`${cls} cursor-not-allowed border border-line text-mute`}>Bản cài đặt sắp có</button>
      : <a href={MZP} download="3dsmood-library.mzp" onClick={download} aria-disabled={busy} aria-busy={busy} className={`${cls} bg-accent text-accent-ink hover:brightness-110 ${busy ? 'pointer-events-none opacity-60' : ''}`}>{busy ? 'Đang tải bộ cài…' : 'Tải xuống thư viện'}</a>}
    {error && <p role="alert" className="max-w-sm text-xs text-danger">{error}</p>}
  </>;
}

function Lightbox({ p, onClose }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={p.name} className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 flex-1 overflow-auto bg-white"><Preview source={p.image || p.thumb} name={p.name} /></div>
        <div className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{p.name}</div>
            <div className="truncate font-mono text-xs text-mute">{p.folderPath || p.category}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg">Đóng</button>
        </div>
      </div>
    </div>
  );
}

export default function PublicCatalog() {
  const [reloadKey, setReloadKey] = useState(0);
  const { products: allProducts, tree: allTree, state, error } = usePluginCatalog(reloadKey);
  const products = useMemo(() => allProducts.filter(p => (p.contentDomain || "3dmodels") === "3dmodels"), [allProducts]);
  const tree = useMemo(() => allTree.filter(c => (c.contentDomain || "3dmodels") === "3dmodels"), [allTree]);
  const [subs, setSubs] = useState(() => new Set());
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(STEP);
  const [active, setActive] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return products.filter((p) => matchesCategory(p, subs) && (!needle || p.name.toLowerCase().includes(needle)));
  }, [products, subs, text]);
  useEffect(() => setLimit(STEP), [subs, text]);

  return (
    <div className="flex min-h-screen flex-col bg-base text-fg">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-panel px-4 py-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="font-mono text-lg font-bold tracking-widest text-accent">3DS MOOD</div>
          <p className="text-sm text-mute">Thư viện 3D model cho 3ds Max. Xem toàn bộ model, cài plugin để dùng trực tiếp trong Max.</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <DownloadButton className="w-full sm:w-auto sm:px-8 sm:py-3 sm:text-base" />
          <p className="text-xs text-mute">Trong 3ds Max: Scripting → Run Script → chọn file .mzp.</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className={`${drawer ? 'fixed inset-0 z-30 bg-black/60' : 'hidden'} lg:static lg:z-auto lg:block lg:bg-transparent`} onClick={() => setDrawer(false)}>
          <aside className="h-full w-72 overflow-auto border-r border-line bg-panel lg:w-64" onClick={(e) => e.stopPropagation()}>
            <Filters categories={tree} subs={subs} setSubs={setSubs} renderers={new Set()} setRenderers={() => {}} rendererOptions={[]} />
          </aside>
        </div>

        <main className="min-w-0 flex-1 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDrawer(true)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-mute hover:text-fg lg:hidden">
              <Icon name="filter" className="size-3.5" />Danh mục{subs.size ? ` (${subs.size})` : ''}
            </button>
            <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-3 focus-within:border-accent">
              <Icon name="search" className="size-3.5 text-mute" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm model…" aria-label="Tìm model" className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-mute" />
            </label>
            <span className="font-mono text-xs text-mute">{state === 'ready' ? `${rows.length} model` : ''}</span>
          </div>

          {state === 'loading' && <p role="status" className="py-16 text-center font-mono text-xs text-mute">Đang tải danh mục…</p>}
          {state === 'error' && (
            <div role="alert" className="mx-auto mt-16 max-w-md rounded-md border border-danger/40 bg-danger/10 p-4 text-center font-mono text-xs text-danger">
              {error}
              <div><button type="button" onClick={() => setReloadKey((k) => k + 1)} className="mt-3 rounded-md border border-danger/40 px-3 py-1">Thử lại</button></div>
            </div>
          )}
          {state === 'ready' && rows.length === 0 && <p className="py-16 text-center text-sm text-mute">Không có model nào khớp.</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {rows.slice(0, limit).map((p) => (
              <button type="button" key={p.id} onClick={() => setActive(p)} className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel text-left transition hover:border-mute/60">
                <div className="aspect-square w-full overflow-hidden bg-white"><Preview source={p.thumb} name={p.name} lazy /></div>
                <div className="px-2 py-2">
                  <div className="truncate text-[13px] font-bold" title={p.name}>{p.name}</div>
                  <div className="truncate font-mono text-[10px] text-mute">{p.subcategory}</div>
                </div>
              </button>
            ))}
          </div>
          {rows.length > limit && (
            <div className="py-5 text-center"><button type="button" onClick={() => setLimit((n) => n + STEP)} className="rounded-md border border-line px-5 py-2 text-sm text-mute hover:text-fg">Xem thêm</button></div>
          )}
        </main>
      </div>
      {active && <Lightbox p={active} onClose={() => setActive(null)} />}
    </div>
  );
}
