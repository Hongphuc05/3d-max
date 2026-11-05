// P4.4: the model grid card, detail panel and action button of the plugin (UI-1 layout, v3 data). No account, no licence screen:
// what a device may download is decided by the server (entitlements); the button only reflects it.
import { mb } from './api.js';
import { Preview, rendererLabel } from './components.jsx';
import { Icon } from './icons.jsx';
import { enqueue, useDownloaded, useJob } from './queue.js';
import { actionState, owns } from './v3-catalog.js';

const styles = {
  base: 'w-full rounded-md font-bold transition disabled:cursor-default',
  solid: 'bg-accent text-accent-ink hover:brightness-110',
  ghost: 'border border-line text-mute',
};

export function ModelAction({ p, ctx, big }) {
  const job = useJob(p.slug);
  const downloaded = useDownloaded().has(p.slug);
  const state = actionState({ max: ctx.max, entitlements: ctx.entitlements, owned: owns(ctx.entitlements), offline: ctx.offline, job, downloaded });
  const size = `${styles.base} ${big ? 'py-3 text-sm' : 'py-1.5 text-xs'}`;
  const click = (e) => { e.stopPropagation(); enqueue(p); };
  if (state.kind === 'view') return <div className="font-mono text-xs text-mute">{state.label}</div>;
  if (state.disabled) return <button disabled className={`${size} ${styles.ghost} ${state.kind === 'running' ? 'animate-pulse text-accent' : ''}`}>{state.label}</button>;
  if (state.kind === 'failed') return <button onClick={click} className={`${size} border border-danger/50 text-danger hover:bg-danger/10`}>{state.label}</button>;
  if (state.kind === 'done' || state.kind === 'cached') return <button onClick={click} className={`${size} border border-accent/50 text-accent hover:bg-accent/10`}>{state.label}</button>;
  return <button onClick={click} className={`${size} ${styles.solid}`}>{big ? 'Download & import vào 3ds Max' : state.label}</button>;
}

/** Nut mua duy nhat (D28.1): license ca thu vien, khong co nut mua theo tung model. */
export function BuyLibrary({ ctx, className = '' }) {
  return <button onClick={() => ctx.onBuy()} className={`${styles.base} ${styles.solid} py-2 text-sm ${className}`}>Mua thư viện</button>;
}

export function PluginCard({ p, active, onOpen, ctx }) {
  return (
    <div className={`group flex flex-col overflow-hidden rounded-lg border bg-panel transition ${active ? 'border-accent' : 'border-line hover:border-mute/60'}`}>
      <button onClick={() => onOpen(p)} className="relative aspect-square overflow-hidden bg-white">
        <Preview source={p.thumb} name={p.name} lazy />
      </button>
      <button onClick={() => onOpen(p)} className="flex flex-1 flex-col px-2 pt-2 text-left">
        <div className="truncate text-[13px] font-bold" title={p.name}>{p.name}</div>
        <div className="mt-0.5 flex justify-between gap-2 font-mono text-[10px] text-mute">
          <span className="truncate">{p.subcategory}</span><span className="shrink-0">{mb(p.info.sizeMB)}</span>
        </div>
      </button>
      <div className="p-2"><ModelAction p={p} ctx={ctx} /></div>
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="border-b border-line py-2">
    <div className="font-mono text-[10px] tracking-wider text-mute">{k}</div>
    <div className="mt-0.5 text-sm">{v}</div>
  </div>
);

export function PluginDetail({ p, onClose, ctx }) {
  if (!p) {
    return (
      <aside className="hidden w-[340px] shrink-0 place-items-center border-l border-line bg-panel p-6 text-center font-mono text-xs text-mute xl:grid">
        Chọn một model để xem chi tiết
      </aside>
    );
  }
  const owned = owns(ctx.entitlements);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60 xl:static xl:z-auto xl:bg-transparent" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[380px] flex-col overflow-auto border-l border-line bg-panel xl:w-[340px]" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-white">
          <Preview source={p.image} name={p.name} />
          <button onClick={onClose} aria-label="Đóng" className="absolute top-2 right-2 rounded-md bg-black/70 p-1.5 text-fg hover:bg-black"><Icon name="close" /></button>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase">
            {p.info.renderers.map((r) => <span key={r} className="rounded border border-warn/40 px-1.5 py-0.5 text-warn">{rendererLabel(r)}</span>)}
            {p.info.formats.map((f) => <span key={f} className="rounded border border-line px-1.5 py-0.5 text-mute">.{f}</span>)}
          </div>
          <div>
            <h2 className="text-lg leading-snug font-bold">{p.name}</h2>
            <div className="font-mono text-[11px] text-mute">{p.folderPath || `${p.category} › ${p.subcategory}`}</div>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <Row k="QUYỀN DÙNG" v={ctx.entitlements ? (owned ? <span className="font-mono font-bold text-accent">License thư viện</span> : <span className="font-mono">Chưa có license</span>) : <span className="font-mono text-mute">—</span>} />
            <Row k="DUNG LƯỢNG" v={<span className="font-mono">{mb(p.info.sizeMB)}</span>} />
            <Row k="ĐỊNH DẠNG" v={p.info.formats.map((f) => '.' + f).join(' ') || '—'} />
          </div>
          <div className="mt-auto space-y-2 pt-2">
            <ModelAction p={p} ctx={ctx} big />
            {ctx.max && ctx.entitlements && !owned && <BuyLibrary ctx={ctx} />}
            {ctx.max
              ? <p className="font-mono text-[10px] text-mute">Plugin tải gói về máy rồi import vào scene hiện tại. Xem tiến trình ở Hàng đợi.</p>
              : <p className="font-mono text-[10px] text-mute">Download &amp; import chỉ có trong plugin 3ds Max. Trên trình duyệt chỉ xem catalog.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
