import { useEffect, useMemo, useRef, useState } from 'react';
import { call, isMaxHost } from './integrations/3dsmax/bridge.js';

const buttonStyle = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed';
const errorText = error => error?.message || 'Không thể hoàn tất. Vui lòng thử lại.';
const localPreview = source => typeof source === 'string'
  && /^https:\/\/app\.3dsmood\.local\/library-previews\/[a-f0-9]{64}\.(?:png|jpe?g|webp)(?:\?v=[A-Za-z0-9_-]+)?$/.test(source);

function Preview({ source, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  // Only native-supplied packaged images are rendered; catalog links never enter the UI.
  const safe = typeof source === 'string' && (/^data:image\/(png|jpeg|webp);base64,/.test(source)
    || localPreview(source));
  return <div className="aspect-square overflow-hidden rounded bg-base">
    {safe && !failed ? <img src={source} alt={name} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain" />
      : <div className="grid h-full place-items-center text-sm text-mute">Chưa có ảnh preview</div>}
  </div>;
}

export default function OfflineLibrary({ request = call, available = isMaxHost() }) {
  const [status, setStatus] = useState(null);
  const [catalog, setCatalog] = useState({ items: [] });
  const [license, setLicense] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [job, setJob] = useState(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const importBusy = useRef(false);

  useEffect(() => {
    if (!available) return;
    let live = true;
    setRefreshing(true);
    request('library.status').then(value => { if (live) setStatus(value); })
      .catch(e => { if (live) setError(errorText(e)); });
    request('library.refresh', {}, 120000).then(value => { if (live) setCatalog(value); })
      .catch(e => { if (live) setError(errorText(e)); })
      .finally(() => { if (live) setRefreshing(false); });
    return () => { live = false; };
  }, [available, request]);

  useEffect(() => {
    if (!available || !Array.isArray(catalog.items)) return;
    // Load every catalog preview, including models outside the viewport or a filter.
    // The host serves the packaged bytes locally, without a network request.
    const sources = [...new Set(catalog.items.map(item => item?.preview).filter(localPreview))];
    const active = new Set();
    let next = 0;
    let stopped = false;
    function fillSlots() {
      while (!stopped && active.size < 4 && next < sources.length) {
        const image = new window.Image();
        active.add(image);
        image.onload = image.onerror = () => {
          image.onload = image.onerror = null;
          active.delete(image);
          fillSlots();
        };
        image.src = sources[next++];
      }
    }
    fillSlots();
    return () => {
      stopped = true;
      for (const image of active) image.onload = image.onerror = null;
      active.clear();
    };
  }, [available, catalog.items]);

  const items = Array.isArray(catalog.items) ? catalog.items : [];
  const categories = [...new Set(items.map(item => item.category))].sort();
  const visible = useMemo(() => items.filter(item => (!category || item.category === category)
    && item.name.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())), [items, category, text]);

  async function refresh() {
    setRefreshing(true); setError('');
    try { setCatalog(await request('library.refresh', {}, 120000)); }
    catch (e) { setError(errorText(e)); }
    finally { setRefreshing(false); }
  }
  async function activate(event) {
    event.preventDefault(); setActivating(true); setError('');
    try { setStatus(await request('library.activate', { license: license.trim() })); setLicense(''); }
    catch (e) { setError(errorText(e)); }
    finally { setActivating(false); }
  }
  async function copyMachineCode() {
    try { await navigator.clipboard.writeText(status.machineCode); setNotice('Đã copy mã máy.'); }
    catch { setNotice('Không copy tự động được. Chọn mã máy bên dưới và nhấn Ctrl+C.'); }
  }
  async function importModel(item) {
    if (importBusy.current || !status?.licensed) return;
    importBusy.current = true; setError('');
    setJob({ id: item.id, name: item.name, state: 'running', progress: null });
    try {
      await request('asset.import', { assetId: item.id }, 31 * 60 * 1000,
        progress => setJob(previous => ({ ...previous, progress })));
      setJob(previous => ({ ...previous, state: 'done' }));
    } catch (e) { setJob(previous => ({ ...previous, state: 'failed' })); setError(errorText(e)); }
    finally { importBusy.current = false; }
  }

  return <main className="min-h-screen bg-base p-4 text-fg sm:p-6">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
      <div><h1 className="text-xl font-bold">3DSMOOD · Thư viện model</h1><p className="mt-1 text-sm text-mute">License vĩnh viễn trên máy đã đăng ký · Xem thư viện offline; Import cần Internet</p></div>
      <button className={buttonStyle} disabled={!available || refreshing} onClick={refresh}>{refreshing ? 'Đang tải…' : 'Tải lại'}</button>
    </header>
    {!available ? <p role="status" className="rounded border border-line bg-panel p-5">Mở plugin trong 3ds Max để xem mã máy, kích hoạt license và tải model.</p> : <>
      <section aria-label="License" className="mb-5 rounded-lg border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold">{status?.licensed ? 'Đã kích hoạt · Vĩnh viễn' : 'Kích hoạt thư viện'}</h2>
          {status?.licensed && <span className="text-sm text-accent">Xác minh offline</span>}
        </div>
        <div className="my-3 flex flex-wrap items-center gap-3"><label htmlFor="machine-code" className="text-sm text-mute">Mã máy</label>
          <input id="machine-code" aria-label="Mã máy" readOnly value={status?.machineCode || ''} className="min-w-48 flex-1 rounded border border-line bg-base p-2 font-mono text-xs" />
          <span className="sr-only">{status?.machineCode}</span>
          <button className={buttonStyle} disabled={!status?.machineCode} onClick={copyMachineCode}>Copy mã máy</button>
        </div>
        {!status?.licensed && <form onSubmit={activate}>
          <p className="mb-3 text-sm text-mute">Chuyển khoản theo hướng dẫn của nhà cung cấp, gửi mã máy này để nhận license rồi dán vào ô bên dưới.</p>
          <label htmlFor="license-input" className="mb-1 block text-sm">License</label>
          <textarea id="license-input" value={license} onChange={event => setLicense(event.target.value)} maxLength={16384} rows={3}
            className="w-full rounded border border-line bg-base p-2 font-mono text-xs" placeholder="Dán license được cấp cho máy này" />
          <button className={`${buttonStyle} mt-2 bg-accent text-accent-ink`} disabled={activating} type="submit">{activating ? 'Đang xác minh…' : 'Kích hoạt'}</button>
        </form>}
        {status?.message && <p className="mt-2 text-sm text-mute">{status.message}</p>}
        {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
      </section>
      {error && <p role="alert" className="mb-4 rounded border border-danger p-3 text-sm text-danger">{error}</p>}
      {(catalog.offline || catalog.message) && <p role="status" className="mb-4 text-sm text-warn">{catalog.message || 'Thư viện và ảnh có sẵn trong bộ cài; tải model cần Internet.'}</p>}
      {job && <p role="status" className="mb-4 rounded border border-line p-3 text-sm">{job.name}: {job.state === 'done' ? 'Đã import vào scene.' : job.state === 'failed' ? 'Import thất bại.' : 'Đang tải và import…'}
        {job.state === 'running' && job.progress && <span> {Math.round(job.progress.receivedBytes / 1048576)} MB{job.progress.totalBytes > 0 ? ` / ${Math.round(job.progress.totalBytes / 1048576)} MB` : ''}</span>}
      </p>}
      <div className="mb-4 flex flex-wrap gap-3">
        <input aria-label="Tìm model" placeholder="Tìm model…" value={text} onChange={event => setText(event.target.value)} className="min-w-48 flex-1 rounded border border-line bg-panel p-2" />
        <select aria-label="Danh mục" value={category} onChange={event => setCategory(event.target.value)} className="rounded border border-line bg-panel p-2">
          <option value="">Tất cả danh mục</option>{categories.map(value => <option key={value}>{value}</option>)}
        </select><span className="self-center text-sm text-mute">{visible.length} model</span>
      </div>
      {!refreshing && visible.length === 0 && <p className="py-10 text-center text-mute">{items.length ? 'Không tìm thấy model phù hợp.' : 'Chưa có model trong bộ cài. Liên hệ nhà cung cấp.'}</p>}
      <section aria-label="Model" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {visible.map(item => <article key={item.id} className="rounded-lg border border-line bg-panel p-3">
          <Preview source={item.preview} name={item.name} />
          <h2 className="mt-3 truncate font-bold" title={item.name}>{item.name}</h2><p className="mb-3 text-xs text-mute">{item.category}</p>
          <button className={`${buttonStyle} w-full`} disabled={!status?.licensed || job?.state === 'running'} onClick={() => importModel(item)}>Import</button>
        </article>)}
      </section>
    </>}
  </main>;
}
