// P4.4: bo chuyen catalog v3 -> dang UI-1 va quy tac nut hanh dong. Ham thuan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionState, buildCatalog, buildCategoryTree, owns, previewUrl } from './v3-catalog.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (c) => c.repeat(64);
const categories = [
  { id: id(1), parentId: null, name: 'Living', fullPath: 'Living', modelCount: 3 },
  { id: id(2), parentId: id(1), name: 'Sofa', fullPath: 'Living / Sofa', modelCount: 2 },
  { id: id(3), parentId: id(1), name: 'Armchair', fullPath: 'Living / Armchair', modelCount: 1 },
  { id: id(4), parentId: null, name: 'Bedroom', fullPath: 'Bedroom', modelCount: 0 },
];
const model = (n, over = {}) => ({ id: id(100 + n), name: `Model ${n}`, categoryId: id(2), sizeBytes: 5 * 1024 * 1024, fileType: 'rar', status: 'PUBLISHED', ...over });
const manifest = { catalogVersion: 3, previews: [
  { modelId: id(101), variant: 'sm', sha256: sha('a') }, { modelId: id(101), variant: 'lg', sha256: sha('b') }, { modelId: id(102), variant: 'sm', sha256: sha('c') },
] };

test('products carry what the UI-1 components read: ids, size, formats, previews from the manifest, category ancestry', () => {
  const { products } = buildCatalog({ catalog: { models: [model(1), model(2)] }, categories, manifest });
  const [a, b] = products;
  assert.equal(a.id, id(101)); assert.equal(a.slug, a.id);
  assert.deepEqual([a.thumb, a.image], [previewUrl(sha('a')), previewUrl(sha('b'))]);
  assert.deepEqual([b.thumb, b.image], [previewUrl(sha('c')), previewUrl(sha('c'))], 'only a small preview: used for both');
  assert.deepEqual(a.folderIds, [id(2), id(1)], 'the model matches its category and every ancestor');
  assert.deepEqual([a.category, a.subcategory, a.folderPath], ['Living', 'Sofa', 'Living / Sofa']);
  assert.deepEqual(a.info, { sizeMB: 5, renderers: [], formats: ['rar'], hasTextures: false });
  assert.deepEqual([a.downloadable, a.status, a.priceVnd], [true, 'ready', undefined]);
});

test('previews are optional, sizes may be unknown, unpublished and unknown-category models are handled', () => {
  const { products } = buildCatalog({ catalog: { models: [model(3), model(4, { sizeBytes: null, fileType: null }), model(5, { status: 'HIDDEN' }), model(6, { categoryId: id(99) }), model(7, { sizeBytes: 100 })] }, categories, manifest });
  assert.deepEqual(products.map((p) => p.name), ['Model 3', 'Model 4', 'Model 6', 'Model 7'], 'only PUBLISHED models are shown');
  assert.deepEqual([products[0].thumb, products[0].image], [null, null]);
  assert.equal(products[1].info.sizeMB, null); assert.deepEqual(products[1].info.formats, []);
  assert.deepEqual([products[2].category, products[2].folderIds], ['Khác', []]);
  assert.equal(products[3].info.sizeMB, 0.1, 'tiny files never show as 0 MB');
});

test('category tree: nested, sorted, with counts; broken parents and cycles never lose a category', () => {
  const tree = buildCategoryTree(categories);
  assert.deepEqual(tree.map((n) => n.name), ['Bedroom', 'Living']);
  assert.deepEqual(tree[1].children.map((n) => [n.name, n.count]), [['Armchair', 1], ['Sofa', 2]]);
  assert.deepEqual(tree[1].id, id(1));
  const odd = buildCategoryTree([
    { id: 'orphan', parentId: 'missing', name: 'Orphan' }, { id: 'self', parentId: 'self', name: 'Self' },
    { id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' },
  ]);
  const names = []; const walk = (list) => list.forEach((n) => { names.push(n.name); walk(n.children); }); walk(odd);
  assert.deepEqual(names.sort(), ['A', 'B', 'Orphan', 'Self']);
  assert.deepEqual(buildCategoryTree(undefined), []);
  assert.deepEqual(buildCatalog({}).products, []);
});

test('owns(): only the library license (allModels) counts; unknown entitlements own nothing', () => {
  assert.equal(owns({ allModels: true }), true);
  assert.equal(owns({ allModels: false }), false);
  for (const nothing of [null, undefined, {}]) assert.equal(owns(nothing), false);
});

test('action state: browser views only; queue states win; unknown rights never offer a download; no license -> locked; licensed -> Download', () => {
  const ent = { allModels: true };
  const base = { max: true, entitlements: ent, owned: true, offline: false, job: undefined };
  assert.deepEqual(actionState({ ...base, max: false }), { kind: 'view', label: 'Trong plugin 3ds Max', disabled: true });
  assert.equal(actionState({ ...base, job: { status: 'queued' } }).kind, 'queued');
  assert.equal(actionState({ ...base, job: { status: 'running' } }).kind, 'running');
  assert.equal(actionState({ ...base, entitlements: undefined, owned: false }).kind, 'wait');
  const offlineWait = actionState({ ...base, entitlements: null, owned: false, offline: true });
  assert.deepEqual([offlineWait.kind, offlineWait.disabled, offlineWait.label], ['wait', true, 'Cần Internet để xác minh quyền']);
  assert.equal(actionState({ ...base, entitlements: null, owned: false }).label, 'Chưa xác minh được quyền');
  assert.deepEqual(actionState({ ...base, entitlements: { allModels: false }, owned: false }), { kind: 'locked', label: '🔒 Cần license thư viện', disabled: true });
  assert.equal(actionState({ ...base, job: { status: 'failed' } }).kind, 'failed');
  assert.equal(actionState({ ...base, job: { status: 'done' } }).kind, 'done');
  assert.deepEqual(actionState(base), { kind: 'download', label: 'Download', disabled: false });
  assert.equal(actionState({ ...base, entitlements: { allModels: false }, owned: false, job: { status: 'failed' } }).kind, 'locked', 'a stale failed job never unlocks a library the device does not own');
});

test('a model whose category sits in a parent cycle still gets a finite ancestry; a model with only a large preview uses it for the thumbnail too', () => {
  const cyc = [{ id: 'a', parentId: 'b', name: 'A', fullPath: 'A' }, { id: 'b', parentId: 'a', name: 'B', fullPath: 'B' }];
  const { products } = buildCatalog({ catalog: { models: [{ id: id(300), name: 'Cyclic', categoryId: 'a', status: 'PUBLISHED' }] }, categories: cyc, manifest: { previews: [] } });
  assert.deepEqual(products[0].folderIds.sort(), ['a', 'b']);
  const lgOnly = buildCatalog({ catalog: { models: [model(9)] }, categories, manifest: { previews: [{ modelId: id(109), variant: 'lg', sha256: sha('d') }] } }).products[0];
  assert.deepEqual([lgOnly.thumb, lgOnly.image], [previewUrl(sha('d')), previewUrl(sha('d'))]);
});
