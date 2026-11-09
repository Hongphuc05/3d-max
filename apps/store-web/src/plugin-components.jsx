// P4.4: the model grid card, detail panel and action button of the plugin (UI-1 layout, v3 data). No account, no licence screen:
// what a device may download is decided by the server (entitlements); the button only reflects it.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { mb } from './api.js';
import { importDownloaded, useImports } from './local-imports.js';
import { Preview, rendererLabel } from './components.jsx';
import { Icon } from './icons.jsx';
import { enqueue, useJob } from './queue.js';
import { actionState, owns } from './v3-catalog.js';

const styles = {
  base: 'w-full rounded-md font-bold transition disabled:cursor-default',
  solid: 'bg-accent text-accent-ink hover:brightness-110',
  ghost: 'border border-line text-mute',
  // Nut tren the model: den, vien trang bo tron (thiet ke thuong hieu). Nut hanh dong chinh khac van dung solid (do).
  outline: 'border border-white/80 bg-black text-fg hover:bg-white/10 disabled:opacity-50',
};

export function ModelAction({ p, ctx, big }) {
  const job = useJob(p.slug);
  const localImport = useImports().find(item => item.modelId === p.id);
  const importing = ['loading-options', 'choosing', 'running'].includes(localImport?.status);
  const importLabel = localImport?.status === 'loading-options' ? 'Đang đọc file…' : localImport?.status === 'choosing' ? 'Đang chọn file…' : 'Đang import…';
  const importError = localImport?.error;
  const state = actionState({ max: ctx.max, entitlements: ctx.entitlements, owned: owns(ctx.entitlements), offline: ctx.offline, job });
  const size = `${styles.base} ${big ? 'py-3 text-sm' : 'rounded-lg py-1.5 text-xs'}`;
  const solid = big ? styles.solid : styles.outline;
  const click = (e) => { e.stopPropagation(); enqueue(p); };
  const downloaded = ctx.downloadedIds?.has(p.id);
  if (ctx.local) {
    const blocked = ctx.entitlements?.allModels === false;
    const runImport = e => { e.stopPropagation(); importDownloaded(p.id); };
    return <div className="space-y-1"><button disabled={importing || blocked} onClick={runImport} className={`${size} ${solid}`}>{importing ? importLabel : blocked ? 'Cần license thư viện' : 'Import'}</button>{importError && <p role="alert" className="text-xs text-danger">{importError}</p>}</div>;
  }
  if (downloaded || state.kind === 'done') return <button onClick={e => { e.stopPropagation(); ctx.onDownloaded?.(); }} className={`${size} border border-brand/50 text-brand hover:bg-accent/10`}>Đã tải · Xem</button>;
  if (state.kind === 'view') return <div className="font-mono text-xs text-mute">{state.label}</div>;
  if (state.disabled) return <button disabled className={`${size} ${styles.ghost} ${state.kind === 'running' ? 'animate-pulse text-brand' : ''}`}>{state.label}</button>;
  if (state.kind === 'failed') return <button onClick={click} className={`${size} border border-danger/50 text-danger hover:bg-danger/10`}>{state.label}</button>;
  return <button onClick={click} className={`${size} ${solid}`}>{big ? 'Download model' : state.label}</button>;
}

/** Nut mua duy nhat (D28.1): license ca thu vien, khong co nut mua theo tung model. */
export function BuyLibrary({ ctx, className = '' }) {
  return <button onClick={() => ctx.onBuy()} className={`${styles.base} ${styles.solid} py-2 text-sm ${className}`}>Mua thư viện</button>;
}

/** Trai tim yeu thich: chi hien trong plugin 3ds Max (ctx.onFavorite), luu o native tren may khach.
 *  reveal: tren the, tim chua chon chi hien khi re chuot (khong che anh); da chon thi luon hien. */
export function FavoriteHeart({ p, ctx, className = '', reveal = false }) {
  if (!ctx.onFavorite) return null;
  const on = ctx.isFavorite(p.id);
  const label = on ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích';
  const hidden = reveal && !on ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : '';
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); ctx.onFavorite(p.id); }}
      className={`grid size-7 place-items-center rounded-md bg-black/60 transition hover:bg-black/80 ${on ? 'text-danger' : 'text-white'} ${hidden} ${className}`}>
      <Icon name="heart" className="size-4" filled={on} />
    </button>
  );
}

// Popup anh lon khi re chuot vao anh the: chi co anh, dat canh the (lat trai/phai cho vua cua so), khong chan chuot.
const POPUP = 440;
function HoverPreview({ p, anchor }) {
  const [failed, setFailed] = useState(false);
  const src = p.image || p.thumb;
  if (!anchor || !src || failed) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const size = Math.max(120, Math.min(POPUP, vw - 16, vh - 16));
  const left = anchor.right + 8 + size <= vw - 8 ? anchor.right + 8 : Math.max(8, anchor.left - 8 - size);
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - size / 2), Math.max(8, vh - size - 8));
  return createPortal(
    <div data-testid="hover-preview" className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-brand/60 bg-white shadow-2xl" style={{ left, top, width: size, height: size }}>
      <img src={src} alt="" onError={() => setFailed(true)} className="size-full object-contain" />
    </div>, document.body);
}

export function PluginCard({ p, active, onOpen, ctx }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-lg border bg-card transition ${active ? 'border-brand' : 'border-line hover:border-mute/60'}`}>
      <button onClick={() => onOpen(p)} onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setAnchor(null)}
        className="relative aspect-square overflow-hidden bg-white">
        <Preview source={p.thumb} name={p.name} lazy fit={p.contentDomain === '3dscenes' ? 'cover' : 'contain'} />
      </button>
      <HoverPreview p={p} anchor={anchor} />
      <button onClick={() => onOpen(p)} className="flex flex-1 flex-col px-2 pt-2 text-left">
        <div className="truncate text-[13px] font-bold" title={p.name}>{p.name}</div>
        <div className="mt-0.5 flex justify-between gap-2 font-mono text-[10px] text-mute">
          <span className="truncate">{p.subcategory}</span><span className="shrink-0">{mb(p.info.sizeMB)}</span>
        </div>
      </button>
      <div className="p-2"><ModelAction p={p} ctx={ctx} /></div>
      <FavoriteHeart p={p} ctx={ctx} reveal className="absolute top-1.5 right-1.5" />
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
          <Preview source={p.image} name={p.name} natural={p.contentDomain === '3dscenes'} />
          <FavoriteHeart p={p} ctx={ctx} className="absolute top-2 left-2" />
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
            <Row k="QUYỀN DÙNG" v={ctx.entitlements ? (owned ? <span className="font-mono font-bold text-brand">License thư viện</span> : <span className="font-mono">Chưa có license</span>) : <span className="font-mono text-mute">—</span>} />
            <Row k="DUNG LƯỢNG" v={<span className="font-mono">{mb(p.info.sizeMB)}</span>} />
            <Row k="ĐỊNH DẠNG" v={p.info.formats.map((f) => '.' + f).join(' ') || '—'} />
          </div>
          <div className="mt-auto space-y-2 pt-2">
            <ModelAction p={p} ctx={ctx} big />
            {ctx.max && ctx.entitlements && !owned && <BuyLibrary ctx={ctx} />}
            {ctx.max
              ? <p className="font-mono text-[10px] text-mute">{ctx.local ? 'Import trực tiếp từ model đã lưu trên máy. Không tải hoặc giải nén lại.' : 'Download lưu model trên máy. Vào Đã tải để chọn model và import khi cần.'}</p>
              : <p className="font-mono text-[10px] text-mute">Download và import chỉ có trong plugin 3ds Max. Trên trình duyệt chỉ xem catalog.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
