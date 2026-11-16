// P4.4: the model grid card, detail panel and action button of the plugin (UI-1 layout, v3 data). No account, no licence screen:
// what a device may download is decided by the server (entitlements); the button only reflects it.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { mb } from './api.js';
import { importDownloaded, useImports } from './local-imports.js';
import { Preview, rendererLabel } from './components.jsx';
import { Icon } from './icons.jsx';
import { beginDragModel } from './integrations/3dsmax/bridge.js';
import { enqueue, useJob } from './queue.js';
import { actionState, owns } from './v3-catalog.js';

const styles = {
  base: 'w-full rounded-md font-bold transition disabled:cursor-default',
  solid: 'bg-accent text-accent-ink hover:brightness-110',
  ghost: 'border border-line text-mute',
  // Nut tren the model: den, vien trang bo tron (thiet ke thuong hieu). Nut hanh dong chinh khac van dung solid (do).
  outline: 'border border-white/40 bg-black text-white/80 hover:border-white/70 hover:text-white disabled:opacity-50',
  // Nut Download tren the: toi hon outline de tuong phan voi nut "Đã tải · Xem" (luon sang).
  download: 'border border-white/25 bg-black text-white/60 hover:border-white/60 hover:text-white',
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
  if (downloaded || state.kind === 'done') return <button onClick={e => { e.stopPropagation(); ctx.onDownloaded?.(); }} className={`${size} border border-white/70 bg-black text-white hover:border-white`}>Đã tải · Xem</button>;
  if (state.kind === 'view') return <div className="font-mono text-xs text-mute">{state.label}</div>;
  if (state.disabled) return <button disabled className={`${size} ${styles.ghost} ${state.kind === 'running' ? 'animate-pulse text-brand' : ''}`}>{state.label}</button>;
  if (state.kind === 'failed') return <button onClick={click} className={`${size} border border-danger/50 text-danger hover:bg-danger/10`}>{state.label}</button>;
  return <button onClick={click} className={`${size} ${big ? solid : styles.download}`}>{big ? 'Download model' : state.label}</button>;
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

// Popup anh lon khi re chuot vao anh the (nhu ban cu, to hon 25%: 440 -> 550px). Scene (anh ngang) dung khung ngang 4:3,
// anh lap day khung nen khong con 2 dai trang. Dat canh the, lat trai/phai cho vua cua so, khong chan chuot.
const POPUP = 550, SCENE_POPUP = 720;
function HoverPreview({ p, anchor, scene }) {
  const [failed, setFailed] = useState(false);
  const src = p.image || p.thumb;
  if (!anchor || !src || failed) return null;
  const vw = window.innerWidth, vh = window.innerHeight, ratio = scene ? 3 / 4 : 1;
  const width = Math.max(120, Math.min(scene ? SCENE_POPUP : POPUP, vw - 16, (vh - 16) / ratio));
  const height = width * ratio;
  const left = anchor.right + 8 + width <= vw - 8 ? anchor.right + 8 : Math.max(8, anchor.left - 8 - width);
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - height / 2), Math.max(8, vh - height - 8));
  return createPortal(
    <div data-testid="hover-preview" className={`pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-white/60 shadow-2xl ${scene ? 'bg-black' : 'bg-white'}`} style={{ left, top, width, height }}>
      <img src={src} alt="" onError={() => setFailed(true)} className={`size-full ${scene ? 'object-cover' : 'object-contain'}`} />
    </div>, document.body);
}

// Anh thu nho cua the (JPEG data URL <= 12000 ky tu, gioi han tin nhan bridge) cho o keo theo chuot; khong ve duoc thi bo qua (chi hien ten).
export function dragThumbnail(card) {
  try {
    const img = card?.querySelector('img');
    if (!img || !img.complete || !img.naturalWidth) return undefined;
    for (const [side, quality] of [[96, 0.75], [64, 0.6]]) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = side;
      const g = canvas.getContext('2d'); if (!g) return undefined;
      const scale = Math.max(side / img.naturalWidth, side / img.naturalHeight), w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      g.fillStyle = '#fff'; g.fillRect(0, 0, side, side); g.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.startsWith('data:image/jpeg;base64,') && url.length <= 12000) return url;
    }
  } catch { /* canvas bi khoa (anh khac nguon) */ }
  return undefined;
}

export function PluginCard({ p, active, onOpen, ctx }) {
  const scene = p.contentDomain === '3dscenes';
  const [anchor, setAnchor] = useState(null);
  const [dragError, setDragError] = useState('');
  // Model da tai: keo the vao cua so 3ds Max -> Max tu hien menu Open/Merge/XRef (host bat dau keo file .max that).
  const canDrag = Boolean(ctx.max && ctx.downloadedIds?.has(p.id));
  const onDragStart = (e) => {
    e.preventDefault(); // huy keo HTML cua trinh duyet; host lam keo that
    setDragError('');
    beginDragModel(p.id, dragThumbnail(e.currentTarget)).catch((err) => setDragError(err?.message || 'Không kéo thả được model này.'));
  };
  return (
    <div draggable={canDrag || undefined} onDragStart={canDrag ? onDragStart : undefined} onMouseLeave={() => setDragError('')}
      className={`group relative flex flex-col rounded-lg border bg-card transition ${canDrag ? 'cursor-grab ' : ''}${active ? 'border-white' : 'border-white/20 hover:border-white/50'}`}>
      <button onClick={() => onOpen(p)} onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setAnchor(null)}
        className="relative overflow-hidden rounded-t-[7px] bg-white">
        <Preview source={p.thumb} name={p.name} lazy fit={scene ? 'cover' : 'contain'} aspect={scene ? 'aspect-[4/3]' : 'aspect-square'} zoom={false} />
      </button>
      <HoverPreview p={p} anchor={anchor} scene={scene} />
      <button onClick={() => onOpen(p)} className="flex flex-1 flex-col px-2 pt-2 text-left">
        <div className="truncate text-[13px] font-bold" title={p.name}>{p.name}</div>
        <div className="mt-0.5 flex justify-between gap-2 font-mono text-[10px] text-mute">
          <span className="truncate">{p.subcategory}</span><span className="shrink-0">{mb(p.info.sizeMB)}</span>
        </div>
      </button>
      <div className="p-2"><ModelAction p={p} ctx={ctx} /></div>
      {dragError && <p role="alert" className="px-2 pb-2 text-[10px] text-danger">{dragError}</p>}
      <FavoriteHeart p={p} ctx={ctx} reveal className="absolute top-1.5 right-1.5 z-10" />
    </div>
  );
}
