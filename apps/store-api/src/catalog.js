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

export function query({ products }, { category, sub, q, page = 1, limit = 48 }) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = products.filter((p) =>
    (!category || p.category === category) && (!sub || p.subcategory === sub) &&
    (!needle || p.name.toLowerCase().includes(needle)));
  const lim = Math.min(100, Math.max(1, Number(limit) || 48));
  const pg = Math.max(1, Number(page) || 1);
  return { items: rows.slice((pg - 1) * lim, pg * lim), total: rows.length, page: pg, limit: lim };
}
