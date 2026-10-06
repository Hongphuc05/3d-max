import { useEffect, useState } from 'react';
import { getCategories, getProducts } from './api.js';
import { Card, ProductModal, Sidebar } from './components.jsx';

const LIMIT = 48;

export default function App() {
  const [categories, setCategories] = useState([]);
  const [sel, setSel] = useState({});
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState({ items: [], total: 0, page: 1 });
  const [state, setState] = useState('loading'); // loading | ready | error
  const [active, setActive] = useState(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => { getCategories().then(setCategories).catch(() => setState('error')); }, []);
  useEffect(() => { const t = setTimeout(() => setQ(text), 250); return () => clearTimeout(t); }, [text]);

  // moi lan doi bo loc: tai lai tu trang 1, huy request cu
  useEffect(() => {
    const ac = new AbortController();
    setState('loading');
    getProducts({ ...sel, q, limit: LIMIT }, ac.signal)
      .then((d) => { setData(d); setState('ready'); })
      .catch((e) => e.name !== 'AbortError' && setState('error'));
    return () => ac.abort();
  }, [sel, q]);

  const more = () => getProducts({ ...sel, q, limit: LIMIT, page: data.page + 1 })
    .then((d) => setData((o) => ({ ...d, items: [...o.items, ...d.items] })));

  const pick = (s) => { setSel(s); setMenu(false); };
  const title = sel.sub || sel.category || 'Tất cả model';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur">
        <button className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm md:hidden" onClick={() => setMenu(!menu)}>☰</button>
        <div className="text-lg font-bold">3DS Mood <span className="text-brand">Library</span></div>
        <input
          value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm model…"
          className="ml-auto w-full max-w-sm rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm outline-none focus:border-brand"
        />
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        <aside className={`${menu ? 'block' : 'hidden'} fixed inset-x-0 top-[57px] bottom-0 z-20 overflow-auto bg-white p-3 md:sticky md:block md:h-[calc(100vh-57px)] md:w-64 md:shrink-0 md:border-r md:border-neutral-200`}>
          <Sidebar categories={categories} sel={sel} onSelect={pick} />
        </aside>

        <main className="min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <h1 className="text-xl font-bold">{title}</h1>
            <span className="text-sm text-neutral-500">{state === 'ready' ? `${data.total} model` : ''}</span>
          </div>

          {state === 'error' && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Không tải được dữ liệu. Backend đã chạy chưa? (<code>npm run dev</code> trong apps/store-api)</p>}
          {state === 'ready' && data.items.length === 0 && <p className="py-16 text-center text-neutral-500">Không có model nào khớp.</p>}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {state === 'loading' && data.items.length === 0
              ? Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-neutral-200" />)
              : data.items.map((p) => <Card key={p.id} p={p} onOpen={setActive} />)}
          </div>

          {data.items.length < data.total && (
            <div className="py-6 text-center">
              <button onClick={more} className="rounded-xl border border-neutral-300 bg-white px-6 py-2 text-sm font-bold hover:bg-neutral-100">
                Xem thêm ({data.total - data.items.length})
              </button>
            </div>
          )}
        </main>
      </div>

      {active && <ProductModal p={active} onClose={() => setActive(null)} />}
    </div>
  );
}
