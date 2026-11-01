import { useEffect, useState } from 'react';
import { categoryKey, categoryKeys } from './catalog-view.js';
import { mb } from './api.js';
import { useAuth } from './auth.jsx';
import { Icon } from './icons.jsx';
import { isMaxHost } from './integrations/3dsmax/bridge.js';
import { enqueue, useJob } from './queue.js';
import { useLicense } from './license.jsx';

export const rendererLabel = (r) => ({ vray: 'V-Ray', corona: 'Corona' }[r] || r);
export const subKey = (c, s) => `${c}/${s}`;

// Checkbox 3 trang thai (indeterminate dat qua ref vi khong co thuoc tinh HTML).
const Check = ({ checked, partial, onChange }) => (
  <input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 shrink-0 cursor-pointer"
    ref={(el) => el && (el.indeterminate = partial)} />
);

const toggle = (set, keys, on) => {
  const next = new Set(set);
  keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
  return next;
};

function FolderFilter({ folder, parent, ancestors = [], subs, setSubs, open, setOpen }) {
  const key = categoryKey(folder, parent);
  const keys = categoryKeys(folder, parent);
  const selected = keys.filter(value => subs.has(value)).length;
  const children = folder.children || [];
  const expanded = open.has(key);
  // Removing a child also removes broad ancestor selections; sibling selections
  // remain, so an ancestor filter cannot silently select that child again.
  const select = on => setSubs(toggle(subs, on ? keys : [...keys, ...ancestors], on));
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-raised">
        <Check checked={selected === keys.length} partial={selected > 0 && selected < keys.length}
          onChange={() => select(selected < keys.length)} />
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={children.length ? expanded : undefined}
          onClick={() => children.length ? setOpen(toggle(open, [key], !expanded)) : select(!subs.has(key))}>
          <Icon name="cube" className="size-4 shrink-0 text-mute" />
          <span className="flex-1 truncate" title={folder.path || folder.name}>{folder.name}</span>
          <span className="font-mono text-[10px] text-mute">{folder.count}</span>
          {children.length > 0 && <Icon name="chevron" className={`size-3.5 text-mute transition ${expanded ? 'rotate-90' : ''}`} />}
        </button>
      </div>
      {expanded && children.length > 0 && <ul className="mb-1 ml-3 border-l border-line pl-1">
        {children.map(child => <FolderFilter key={categoryKey(child, key)} folder={child} parent={key} ancestors={[...ancestors, key]}
          subs={subs} setSubs={setSubs} open={open} setOpen={setOpen} />)}
      </ul>}
    </li>
  );
}

export function Filters({ categories, subs, setSubs, renderers, setRenderers, rendererOptions = [] }) {
  const [open, setOpen] = useState(() => new Set());
  const active = subs.size + renderers.size;
  const head = 'mb-1.5 mt-4 font-mono text-[10px] tracking-widest text-mute';
  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <Icon name="filter" className="size-3.5 text-accent" />
        <span className="text-sm font-bold">Bộ lọc</span>
        {active > 0 && <span className="rounded border border-accent/40 px-1.5 font-mono text-[10px] text-accent">{active}</span>}
        {active > 0 && (
          <button onClick={() => { setSubs(new Set()); setRenderers(new Set()); }} className="ml-auto font-mono text-[11px] text-mute hover:text-fg">
            Xóa lọc
          </button>
        )}
      </div>

      <div className={head}>DANH MỤC</div>
      <ul className="space-y-px">
        {categories.map(folder => <FolderFilter key={categoryKey(folder)} folder={folder}
          subs={subs} setSubs={setSubs} open={open} setOpen={setOpen} />)}
      </ul>

      {rendererOptions.length > 0 && <div className={head}>RENDERER</div>}
      {rendererOptions.map(k => (
        <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-raised">
          <Check checked={renderers.has(k)} onChange={() => setRenderers(toggle(renderers, [k], !renderers.has(k)))} />
          {rendererLabel(k)}
        </label>
      ))}
    </div>
  );
}

// Nut Download trong 3ds Max: Download = tai goi ve may roi import vao scene (1 lan bam).
// Tren trinh duyet khong co Download (O7) -> component nay khong render.
export function DownloadButton({ p, onLogin, big }) {
  const { user } = useAuth();
  const { canImport, license, loading, setOpen } = useLicense();
  const job = useJob(p.slug);
  const base = `w-full rounded-md font-bold transition disabled:cursor-default ${big ? 'py-3 text-sm' : 'py-1.5 text-xs'}`;
  const solid = `${base} bg-accent text-accent-ink hover:brightness-110`;
  const ghost = `${base} border border-line text-mute`;
  const go = (e) => { e.stopPropagation(); if (canImport) enqueue(p); else setOpen(true); };

  if (p.downloadable === false || (p.status && p.status !== 'ready')) return <button disabled className={ghost}>Tạm không thể tải</button>;
  if (user === undefined) return <button disabled className={ghost}>…</button>;
  if (!user) return <button onClick={(e) => { e.stopPropagation(); onLogin(); }} className={ghost + ' hover:text-fg'}>Đăng nhập để tải</button>;
  if (job?.status === 'queued') return <button disabled className={ghost}>Trong hàng đợi</button>;
  if (job?.status === 'running') return <button disabled className={`${ghost} animate-pulse text-accent`}>Đang tải…</button>;
  if (!canImport) return <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={ghost + ' hover:text-fg'}>
    {loading ? 'Đang xác minh license…' : license?.status === 'ACTIVE' ? 'Kích hoạt license để tải' : license ? 'License không hoạt động' : 'Mua license để tải'}
  </button>;
  if (job?.status === 'failed') return <button onClick={go} className={`${base} border border-danger/50 text-danger hover:bg-danger/10`}>Lỗi · Thử lại</button>;
  if (job?.status === 'done') return <button onClick={go} className={`${base} border border-accent/50 text-accent hover:bg-accent/10`}>✓ Đã import · Lại</button>;
  return <button onClick={go} className={solid}>{big ? 'Download & import vào 3ds Max' : 'Download'}</button>;
}

export function Preview({ source, name, lazy = false }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [source]);
  if (!source || failed) return <div className="grid aspect-square w-full place-items-center bg-raised font-mono text-xs text-mute">Chưa có ảnh preview</div>;
  return <img src={source} alt={name} loading={lazy ? 'lazy' : undefined}
    onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
    className={`aspect-square size-full object-contain transition duration-300 group-hover:scale-105 ${loaded ? 'opacity-100' : 'opacity-0'}`} />;
}

const availabilityLabels = {
  missing_preview: 'Thiếu ảnh preview',
  missing_archive: 'Thiếu file archive',
  conflict: 'Cần kiểm tra file trùng',
};

export function Card({ p, active, onOpen, onLogin }) {
  const unavailable = p.downloadable === false || Boolean(p.status && p.status !== 'ready');
  const availability = availabilityLabels[p.status] || (unavailable ? 'Model chưa thể tải' : null);
  return (
    <div className={`group flex flex-col overflow-hidden rounded-lg border bg-panel transition ${active ? 'border-accent' : 'border-line hover:border-mute/60'}`}>
      <button onClick={() => onOpen(p)} className="relative aspect-square overflow-hidden bg-white">
        <Preview source={p.thumb} name={p.name} lazy />
        {p.info.renderers.length > 0 && (
          <span className="absolute top-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-warn">
            {p.info.renderers.map(rendererLabel).join('+')}
          </span>
        )}
      </button>
      <button onClick={() => onOpen(p)} className="flex flex-1 flex-col px-2 pt-2 text-left">
        <div className="truncate text-[13px] font-bold" title={p.name}>{p.name}</div>
        <div className="mt-0.5 flex justify-between gap-2 font-mono text-[10px] text-mute">
          <span className="truncate">{p.subcategory}</span><span className="shrink-0">{mb(p.info.sizeMB)}</span>
        </div>
      </button>
      <div className="p-2">
        {availability && <div role="status" className="mb-2 rounded border border-warn/30 bg-warn/10 px-2 py-1 font-mono text-[11px] font-bold text-warn">{availability}</div>}
        {isMaxHost() ? <DownloadButton p={p} onLogin={onLogin} /> : !unavailable && <div className="font-mono text-xs font-bold text-accent">Trong license Lifetime</div>}
      </div>
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="border-b border-line py-2">
    <div className="font-mono text-[10px] tracking-wider text-mute">{k}</div>
    <div className="mt-0.5 text-sm">{v}</div>
  </div>
);

// Panel chi tiet: man rong (xl) nam co dinh ben phai; man hep thi phu len tren.
export function DetailPanel({ p, onClose, onLogin }) {
  const { setOpen } = useLicense();
  if (!p) {
    return (
      <aside className="hidden w-[340px] shrink-0 place-items-center border-l border-line bg-panel p-6 text-center font-mono text-xs text-mute xl:grid">
        Chọn một model để xem chi tiết
      </aside>
    );
  }
  const { info } = p;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 xl:static xl:z-auto xl:bg-transparent" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[380px] flex-col overflow-auto border-l border-line bg-panel xl:w-[340px]" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-white">
          <Preview source={p.image} name={p.name} />
          <button onClick={onClose} aria-label="Đóng" className="absolute top-2 right-2 rounded-md bg-black/70 p-1.5 text-fg hover:bg-black">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase">
            {info.renderers.map((r) => <span key={r} className="rounded border border-warn/40 px-1.5 py-0.5 text-warn">{rendererLabel(r)}</span>)}
            {info.formats.map((f) => <span key={f} className="rounded border border-line px-1.5 py-0.5 text-mute">.{f}</span>)}
          </div>
          <div>
            <h2 className="text-lg leading-snug font-bold">{p.name}</h2>
            <div className="font-mono text-[11px] text-mute">{p.folderPath || `${p.category} › ${p.subcategory}`}</div>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <Row k="QUYỀN DÙNG" v={<span className="font-mono font-bold text-accent">License Lifetime</span>} />
            <Row k="DUNG LƯỢNG" v={<span className="font-mono">{mb(info.sizeMB)}</span>} />
            <Row k="RENDERER" v={info.renderers.map(rendererLabel).join(', ') || '—'} />
            <Row k="ĐỊNH DẠNG" v={info.formats.map((f) => '.' + f).join(' ') || '—'} />
            <Row k="TEXTURE" v={info.hasTextures ? 'Có' : '—'} />
            <Row k="MÃ" v={<span className="font-mono text-xs">{p.id}</span>} />
          </div>
          <div className="mt-auto space-y-2 pt-2">
            {isMaxHost() ? (
              <>
                <DownloadButton p={p} onLogin={onLogin} big />
                <p className="font-mono text-[10px] text-mute">Plugin tải gói về máy rồi import vào scene hiện tại. Xem tiến trình ở Hàng đợi.</p>
              </>
            ) : (
              <>
                <button onClick={() => setOpen(true)} className="w-full rounded-md border border-accent/50 py-3 text-sm font-bold text-accent">
                  Xem license Lifetime
                </button>
                <p className="font-mono text-[10px] text-mute">Download &amp; import chỉ có trong plugin 3ds Max. Trên trình duyệt chỉ xem catalog.</p>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
