import express from 'express';
import path from 'node:path';
import { load, query } from './catalog.js';

const STORAGE = process.env.STORAGE_DIR || path.resolve(import.meta.dirname, '../../../storage');
const cat = load(path.join(STORAGE, 'catalog.json'));

export const app = express();
app.disable('x-powered-by');
app.use('/previews', express.static(path.join(STORAGE, 'previews'), { maxAge: '30d', immutable: true }));
app.get('/api/health', (_q, r) => r.json({ ok: true, products: cat.products.length }));
app.get('/api/categories', (_q, r) => r.json(cat.categories));
app.get('/api/products', (q, r) => r.json(query(cat, q.query)));
app.get('/api/products/:slug', (q, r) => {
  const p = cat.bySlug.get(q.params.slug);
  return p ? r.json(p) : r.status(404).json({ error: 'NOT_FOUND' });
});

if (process.argv[1] === import.meta.filename) {
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`store-api http://localhost:${port} (${cat.products.length} san pham)`));
}
