import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { load, query } from './catalog.js';

const mk = (id, name, category, subcategory) => ({
  id, slug: `${name}-${id}`, name, category, subcategory, price: 15000,
  asset: { file: 'SECRET/path.rar', sha256: 'SECRET', size: 5242880, max: ['a.max'], hasFbx: true, hasObj: false, hasTextures: true, renderers: ['vray'] },
});
const file = path.join(mkdtempSync(path.join(tmpdir(), 'cat-')), 'catalog.json');
writeFileSync(file, JSON.stringify({ products: [mk('1', 'Sofa A', 'Furniture', 'Sofa'), mk('2', 'Desk B', 'Furniture', 'Desk'), mk('3', 'Vase C', 'Decoration', 'Vase')] }));
const cat = load(file);

test('khong lo duong dan/sha256 nguon', () => {
  assert.ok(!JSON.stringify(cat.products).includes('SECRET'));
});
test('cay category co dem', () => {
  const f = cat.categories.find((c) => c.name === 'Furniture');
  assert.equal(f.count, 2); assert.equal(f.children.length, 2);
});
test('loc theo category, sub, tu khoa, phan trang', () => {
  assert.equal(query(cat, { category: 'Furniture' }).total, 2);
  assert.equal(query(cat, { sub: 'Vase' }).total, 1);
  assert.equal(query(cat, { q: 'desk' }).items[0].id, '2');
  assert.equal(query(cat, { limit: 1, page: 2 }).items[0].id, '2');
});
