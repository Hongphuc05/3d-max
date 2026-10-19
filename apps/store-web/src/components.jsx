import { useState } from 'react';
import { mb, vnd } from './api.js';
import { useAuth } from './auth.jsx';
import { Icon } from './icons.jsx';
import { isMaxHost } from './integrations/3dsmax/bridge.js';
import { enqueue, useJob } from './queue.js';

const ICONS = {
  Architecture: 'home', Bathroom: 'bathroom', Childroom: 'children-park', Decoration: 'decoration',
  Furniture: 'Furniture', Kitchen: 'Kitchen', Lighting: 'Lighting', Material: 'Material',
  'Other models': 'othermodel', Plants: 'plant', Technology: 'tech',
};
const RENDERERS = [['vray', 'V-Ray'], ['corona', 'Corona']];
export const rendererLabel = (r) => (r === 'vray' ? 'V-Ray' : 'Corona');
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

export function Filters({ categories, subs, setSubs, renderers, setRenderers }) {
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
        {categories.map((c) => {
          const keys = c.children.map((s) => subKey(c.name, s.name));
          const n = keys.filter((k) => subs.has(k)).length;
          const isOpen = open.has(c.name);
          return (
            <li key={c.name}>
              <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-raised">
                <Check checked={n === keys.length} partial={n > 0 && n < keys.length} onChange={() => setSubs(toggle(subs, keys, n < keys.length))} />
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(toggle(open, [c.name], !isOpen))}>
                  {ICONS[c.name] && <img src={`/categories/${ICONS[c.name]}.svg`} alt="" className="size-4 opacity-60 invert" />}
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="font-mono text-[10px] text-mute">{c.count}</span>
                  <Icon name="chevron" className={`size-3.5 text-mute transition ${isOpen ? 'rotate-90' : ''}`} />
                </button>
              </div>
              {isOpen && (
                <ul className="mb-1 ml-5 border-l border-line pl-2">
                  {c.children.map((s) => {
                    const k = subKey(c.name, s.name);
                    return (
                      <li key={k}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-mute hover:bg-raised hover:text-fg">
                          <Check checked={subs.has(k)} onChange={() => setSubs(toggle(subs, [k], !subs.has(k)))} />
                          <span className="flex-1 truncate">{s.name}</span>
                          <span className="font-mono text-[10px]">{s.count}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className={head}>RENDERER</div>
      {RENDERERS.map(([k, label]) => (
        <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-raised">
          <Check checked={renderers.has(k)} onChange={() => setRenderers(toggle(renderers, [k], !renderers.has(k)))} />
          {label}
        </label>
      ))}
    </div>
  );
}

// Nut Download trong 3ds Max: Download = tai goi ve may roi import vao scene (1 lan bam).
// Tren trinh duyet khong co Download (O7) -> component nay khong render.
export function DownloadButton({ p, onLogin, big }) {
  const { user } = useAuth();
  const job = useJob(p.slug);
  const base = `w-full rounded-md font-bold transition disabled:cursor-default ${big ? 'py-3 text-sm' : 'py-1.5 text-xs'}`;
  const solid = `${base} bg-accent text-accent-ink hover:brightness-110`;
  const ghost = `${base} border border-line text-mute`;
  const go = (e) => { e.stopPropagation(); enqueue(p); };

  if (user === undefined) return <button disabled className={ghost}>…</button>;
  if (!user) return <button onClick={(e) => { e.stopPropagation(); onLogin(); }} className={ghost + ' hover:text-fg'}>Đăng nhập để tải</button>;
  if (job?.status === 'queued') return <button disabled className={ghost}>Trong hàng đợi</button>;
  if (job?.status === 'running') return <button disabled className={`${ghost} animate-pulse text-accent`}>Đang tải…</button>;
  if (job?.status === 'failed') return <button onClick={go} className={`${base} border border-danger/50 text-danger hover:bg-danger/10`}>Lỗi · Thử lại</button>;
  if (job?.status === 'done') return <button onClick={go} className={`${base} border border-accent/50 text-accent hover:bg-accent/10`}>✓ Đã import · Lại</button>;
  return <button onClick={go} className={solid}>{big ? 'Download & import vào 3ds Max' : 'Download'}</button>;
}

export function Card({ p, active, onOpen, onLogin }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`group flex flex-col overflow-hidden rounded-lg border bg-panel transition ${active ? 'border-accent' : 'border-line hover:border-mute/60'}`}>
      <button onClick={() => onOpen(p)} className="relative aspect-square overflow-hidden bg-white">
        <img src={p.thumb} alt={p.name} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)}
          className={`size-full object-contain transition duration-300 group-hover:scale-105 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
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
        {isMaxHost() ? <DownloadButton p={p} onLogin={onLogin} /> : <div className="font-mono text-xs font-bold text-accent">{vnd(p.price)}</div>}
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
          <img src={p.image} alt={p.name} className="aspect-square w-full object-contain" />
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
            <div className="font-mono text-[11px] text-mute">{p.category} › {p.subcategory}</div>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <Row k="GIÁ" v={<span className="font-mono font-bold text-accent">{vnd(p.price)}</span>} />
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
                <button disabled title="Thanh toán chưa làm (A4)" className="w-full cursor-not-allowed rounded-md border border-line py-3 text-sm font-bold text-mute">
                  Mua license — sắp có
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
