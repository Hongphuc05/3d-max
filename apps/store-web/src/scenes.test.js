import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from './v3-catalog.js';
import { matchesCategory } from './catalog-view.js';
import { validatePreviewFolder, buildAdminCategoryTree } from './admin-models-utils.js';
import { downloadedProducts } from './useDownloadedLibrary.js';
const categories = [{ id: 'interior', name: 'Interior', fullPath: 'Interior', contentDomain: '3dscenes' }, { id: 'bed', parentId: 'interior', name: 'Bedroom', fullPath: 'Interior / Bedroom', contentDomain: '3dscenes' }, { id: 'living', parentId: 'interior', name: 'Living', fullPath: 'Interior / Living', contentDomain: '3dscenes' }, { id: 'exterior', name: 'Exterior', fullPath: 'Exterior', contentDomain: '3dscenes' }];
const file = (path) => ({ name: path.split('/').pop(), webkitRelativePath: path, size: 100 });
test('mixed catalog keeps scene aliases and domain previews; subtree counts each scene once', () => {
  const { products, tree } = buildCatalog({ categories, catalog: { models: [{ id: 'm', name: 'Model', status: 'PUBLISHED' }, { id: 's', name: 'Scene', contentDomain: '3dscenes', categoryId: 'bed', categoryIds: ['bed', 'living'], status: 'PUBLISHED' }] }, manifest: { previews: [{ modelId: 's', variant: 'sm', sha256: 'abc', contentDomain: '3dscenes' }] } });
  assert.equal(products[0].contentDomain, '3dmodels');
  assert.equal(products[1].thumb, '/previews/3dscenes/abc.webp');
  assert.deepEqual(products[1].categoryIds, ['bed', 'living']);
  for (const category of ['interior', 'bed', 'living']) assert.equal(matchesCategory(products[1], new Set([category])), true);
  const interior = tree.find(c => c.id === 'interior');
  assert.equal(interior.count, 1);
  assert.deepEqual(interior.children.map(c => c.count), [1, 1]);
});
test('scene folders allow variable depth and repeated stems across categories, reject duplicates within a category', () => {
  const paths = ['3DSCENES/Exterior/one.jpg', '3DSCENES/Interior/Bedroom/one.png'];
  const result = validatePreviewFolder(paths.map(file), categories, { contentDomain: '3dscenes' });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items.map(i => i.category), ['Exterior', 'Interior/Bedroom']);
  assert.ok(validatePreviewFolder([...paths, '3DSCENES/Exterior/one.webp'].map(file), categories, { contentDomain: '3dscenes' }).errors.length);
  assert.ok(validatePreviewFolder([file('3DMODELS/Exterior/one.jpg')], categories, { contentDomain: '3dscenes' }).errors.length);
});
test('models accept both root names and retain global stem collision checks', () => {
  for (const root of ['3dsmood', '3DMODELS']) assert.deepEqual(validatePreviewFolder([file(`${root}/Exterior/one.jpg`)], categories).errors, []);
  assert.ok(validatePreviewFolder([file('3DMODELS/Interior/Bedroom/one.jpg'), file('3DMODELS/Exterior/one.png')], categories).errors.length);
});
test('admin counts use distinct subtree total; offline legacy downloads default to Models', () => {
  const tree = buildAdminCategoryTree([{ id: 'a', name: 'A', modelCount: 0, subtreeModelCount: 1 }, { id: 'b', parentId: 'a', name: 'B', modelCount: 1 }, { id: 'c', parentId: 'a', name: 'C', modelCount: 1 }]);
  assert.equal(tree[0].count, 1);
  assert.deepEqual(downloadedProducts([{ modelId: 'old' }, { modelId: 's', product: { id: 's', contentDomain: '3dscenes' } }], []).map(p => p.contentDomain), ['3dmodels', '3dscenes']);
});

test('manifest uses safe domain URL while refusing external or malformed preview URLs', () => {
  const sha256 = 'a'.repeat(64);
  const input = { catalog: { models: [{ id: 's', name: 'Scene', contentDomain: '3dscenes', status: 'PUBLISHED' }] }, categories: [] };
  for (const url of [`/previews/3dscenes/${sha256}.webp`, `https://other.example/previews/${sha256}.webp`]) {
    const product = buildCatalog({ ...input, manifest: { previews: [{ modelId: 's', variant: 'sm', sha256, url }] } }).products[0];
    assert.equal(product.thumb, url.startsWith('/') ? url : `/previews/${sha256}.webp`);
  }
});
