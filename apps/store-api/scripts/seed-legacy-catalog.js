// Nap catalog cu vao DB dev. Chay: npm run seed:legacy -- <sourceId>
// Khong chay len production. Nguon (drive_sources) phai co san; Drive id khong bao gio duoc in ra.
import { readFileSync } from 'node:fs';
import { pool } from '../src/db.js';
import { seedLegacyCatalog } from '../src/worker/seed.js';

try {
  const sourceId = process.argv[2];
  if (!sourceId) throw new Error('usage: npm run seed:legacy -- <sourceId>');
  const file = new URL('../../../library/public/catalog.json', import.meta.url);
  const { items } = JSON.parse(readFileSync(file, 'utf8'));
  const price = Number(process.env.DEFAULT_MODEL_PRICE_VND ?? 15000);
  const r = await seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd: price });
  console.log(`Seed OK: ${r.categories} categories, ${r.models.inserted} models inserted, ${r.models.existing} already present, ${r.files} files`);
} catch (e) {
  console.error(`Seed failed: ${e.message}`);
  process.exitCode = 1;
} finally { await pool.end(); }
