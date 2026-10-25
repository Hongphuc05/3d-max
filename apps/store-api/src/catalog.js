// Doc catalog.json 1 lan, phuc vu API. Chi lo ra truong public (khong lo duong dan/sha256 nguon).
import { readFileSync } from 'node:fs';

export function load(file) {
  const { products } = JSON.parse(readFileSync(file, 'utf8'));
  const pub = products.map((p) => ({
    id: p.id, slug: p.slug, name: p.name, category: p.category, subcategory: p.subcategory,
    price: p.price, thumb: `/previews/${p.id}-sm.webp`, image: `/previews/${p.id}-lg.webp`,
    info: {
      sizeMB: Math.round(p.asset.size / 1048576), renderers: p.asset.renderers,
      formats: [p.asset.max.length && 'max', p.asset.hasFbx && 'fbx', p.asset.hasObj && 'obj'].filter(Boolean),
      hasTextures: p.asset.hasTextures,
    },
  }));
  const tree = {};
  for (const p of pub) {
    const c = (tree[p.category] ||= { name: p.category, count: 0, children: {} });
    c.count++;
    c.children[p.subcategory] = (c.children[p.subcategory] || 0) + 1;
  }
  const categories = Object.values(tree).map((c) => ({
    name: c.name, count: c.count,
    children: Object.entries(c.children).map(([name, count]) => ({ name, count })),
  }));
  return {
    products: pub, categories, bySlug: new Map(pub.map((p) => [p.slug, p])),
    files: new Map(products.map((p) => [p.id, p.asset.file])), // chi dung o server (assets.js)
  };
}

export function query({ products }, { category, sub, folder, q, sort, renderer, page = 1, limit = 48 }) {
  const needle = String(q || '').normalize('NFKC').trim().toLowerCase();
  const rows = products.filter((p) =>
    (!category || p.category === category) && (!sub || p.subcategory === sub) &&
    (!folder || p.folderIds?.includes(folder)) &&
    (!renderer || p.info.renderers.includes(renderer)) &&
    (!needle || p.name.normalize('NFKC').toLowerCase().includes(needle)));
  const sorts = { name: (a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    small: (a,b) => (a.info.sizeMB ?? Infinity) - (b.info.sizeMB ?? Infinity),
    big: (a,b) => (b.info.sizeMB ?? -Infinity) - (a.info.sizeMB ?? -Infinity) };
  if (Object.hasOwn(sorts,sort)) rows.sort(sorts[sort]);
  const lim = Math.min(100, Math.max(1, Math.floor(Number(limit) || 48)));
  const pg = Math.min(1000000, Math.max(1, Math.floor(Number(page) || 1)));
  return { items: rows.slice((pg - 1) * lim, pg * lim), total: rows.length, page: pg, limit: lim };
}
