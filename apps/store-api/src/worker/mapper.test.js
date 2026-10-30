import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFolder } from './mapper.js';

let n = 0;
const f = (name, extra = {}) => ({ id: `ID${String(++n).padStart(10, '0')}`, name, size: 10, md5: null, ...extra });
const map = (path, ...names) => mapFolder({ path, files: names.map(x => (typeof x === 'string' ? f(x) : x)) });
const summary = r => ({
  models: r.models.map(m => [m.name, m.layout, m.categoryPath, m.suggested, m.file.name, m.images.map(i => i.name)]),
  reviews: r.reviews.map(x => [x.kind, [...x.files].sort()]),
});

test('L1 standard pair: A.jpg + A.rar is one model named A in the folder category', () => {
  const r = map('Furniture/Desk', 'A.jpg', 'A.rar');
  assert.deepEqual(summary(r), { models: [['A', 'L1', 'Furniture/Desk', false, 'A.rar', ['A.jpg']]], reviews: [] });
  assert.equal(r.models[0].file.type, 'rar');
  assert.equal(r.models[0].images[0].primary, true);
});

test('L1 dirty names: "A .jpg" + "Arar.rar" (extension glued to the name) still pair; case and spacing are ignored', () => {
  assert.deepEqual(summary(map('X/Y', 'A .jpg', 'Arar.rar')).models, [['A', 'L1', 'X/Y', false, 'Arar.rar', ['A .jpg']]]);
  assert.deepEqual(summary(map('X/Y', 'my  Model.JPG', 'My Model.RAR')).models, [['My Model', 'L1', 'X/Y', false, 'My Model.RAR', ['my  Model.JPG']]]);
  assert.deepEqual(summary(map('X/Y', 'a.jpg', 'A.zip')).models.map(m => m[4]), ['A.zip']);
});

test('loose raw model files pair like archives (A.max + A.jpg)', () => {
  const r = map('X/Y', 'A.jpg', 'A.max', 'B.jpg', 'B.fbx', 'C.jpg', 'C.obj', 'D.jpg', 'D.7z');
  assert.deepEqual(r.models.map(m => m.file.type), ['max', 'fbx', 'obj', '7z']);
});

test('L1 leftover 1:1: with other pairs present, one image + one archive that cannot be paired become a SUGGESTED pair (model + flag)', () => {
  const r = map('X/Y', 'P.jpg', 'P.rar', 'Q.jpg', 'Q.rar', 'X.jpg', 'Y-yzbmix.rar');
  assert.equal(r.models.length, 3);
  const s = r.models.find(m => m.suggested);
  assert.deepEqual([s.name, s.file.name, s.images[0].name], ['Y-yzbmix', 'Y-yzbmix.rar', 'X.jpg']);
  assert.deepEqual(r.reviews.map(x => x.kind), ['SUGGESTED_PAIR']);
  assert.deepEqual(r.models.filter(m => !m.suggested).map(m => m.name), ['P', 'Q']);
});

test('L2: a folder with ONE model file and preview images is a single model named after the folder; category is the parent; first image is primary', () => {
  const r = map('Furniture/Kitchen/Model_A', 'model.max', 'preview_02.jpg', 'preview_01.jpg');
  assert.deepEqual(summary(r), { models: [['Model_A', 'L2', 'Furniture/Kitchen', false, 'model.max', ['preview_01.jpg', 'preview_02.jpg']]], reviews: [] });
  assert.deepEqual(r.models[0].images.map(i => i.primary), [true, false]);
  const one = map('Furniture/Kitchen/Model_B', 'model.max', 'preview.jpg');
  assert.deepEqual([one.models[0].layout, one.models[0].name, one.models[0].categoryPath], ['L2', 'Model_B', 'Furniture/Kitchen']);
  assert.deepEqual(map('Model_C', 'x.zip', 'a.jpg', 'b.jpg').models.map(m => [m.layout, m.categoryPath]), [['L2', '']], 'two images and no pair is L2 even without preview-like names');
});

test('a model folder directly under the root has an empty category path (the caller decides the fallback)', () => {
  assert.equal(map('Solo', 'model.max', 'preview.jpg').models[0].categoryPath, '');
});

test('ambiguous: one image with two archives, or two images with one archive → AMBIGUOUS_PAIR, nothing is guessed', () => {
  let r = map('X/Y', 'A.jpg', 'A.rar', 'A.zip');
  assert.deepEqual(summary(r), { models: [], reviews: [['AMBIGUOUS_PAIR', ['A.jpg', 'A.rar', 'A.zip']]] });
  r = map('X/Y', 'A.jpg', 'A.png', 'A.rar');
  assert.deepEqual(summary(r), { models: [], reviews: [['AMBIGUOUS_PAIR', ['A.jpg', 'A.png', 'A.rar']]] });
});

test('ambiguity blocks the 1:1 suggestion in the same folder: leftovers stay orphans', () => {
  const r = map('X/Y', 'A.jpg', 'A.rar', 'A.zip', 'X.jpg', 'Y.rar');
  assert.deepEqual(r.models, []);
  assert.deepEqual(r.reviews.map(x => x.kind).sort(), ['AMBIGUOUS_PAIR', 'ORPHAN_IMAGE', 'ORPHAN_MODEL']);
});

test('orphans: a model file without an image is ORPHAN_MODEL (no model created); an image alone is ORPHAN_IMAGE', () => {
  assert.deepEqual(summary(map('X/Y', 'B.rar')), { models: [], reviews: [['ORPHAN_MODEL', ['B.rar']]] });
  assert.deepEqual(summary(map('X/Y', 'C.jpg')), { models: [], reviews: [['ORPHAN_IMAGE', ['C.jpg']]] });
  const r = map('X/Y', 'P.jpg', 'P.rar', 'Z.rar', 'W.rar');
  assert.deepEqual(r.models.map(m => m.name), ['P']);
  assert.deepEqual(r.reviews.map(x => x.kind), ['ORPHAN_MODEL', 'ORPHAN_MODEL']);
});

test('several unmatched images and archives are never paired by position (no guessing)', () => {
  const r = map('X/Y', 'X1.jpg', 'X2.jpg', 'M1.rar', 'M2.rar');
  assert.deepEqual(r.models, []);
  assert.equal(r.reviews.filter(x => x.kind === 'ORPHAN_IMAGE').length, 2);
  assert.equal(r.reviews.filter(x => x.kind === 'ORPHAN_MODEL').length, 2);
});

test('other extensions are reported as skipped, never an error; an empty folder maps to nothing', () => {
  const r = map('X/Y', 'A.jpg', 'A.rar', 'readme.txt', '.DS_Store', 'notes');
  assert.equal(r.models.length, 1);
  assert.deepEqual(r.skipped.sort(), ['.DS_Store', 'notes', 'readme.txt']);
  assert.deepEqual(summary(map('X/Y')), { models: [], reviews: [] });
});

test('output does not depend on the input order', () => {
  const files = ['P.jpg', 'P.rar', 'Q.jpg', 'Q.rar', 'X.jpg', 'Y.rar', 'stray.jpg'].map(x => f(x));
  const a = summary(mapFolder({ path: 'X/Y', files }));
  const b = summary(mapFolder({ path: 'X/Y', files: [...files].reverse() }));
  assert.deepEqual(a, b);
});

test('L2 is never inferred inside a folder that already has L1 pairs: extra preview-like files stay orphans', () => {
  const r = map('X/Y', 'P.jpg', 'P.rar', 'Z.max', 'preview_a.jpg', 'preview_b.jpg');
  assert.deepEqual(r.models.map(m => [m.layout, m.name]), [['L1', 'P']]);
  assert.deepEqual(r.reviews.map(x => x.kind).sort(), ['ORPHAN_IMAGE', 'ORPHAN_IMAGE', 'ORPHAN_MODEL']);
});

test('L2 is not inferred in a folder that holds an ambiguous group either', () => {
  const r = map('X/Y', 'A.jpg', 'A.rar', 'A.zip', 'Z.max', 'preview.jpg');
  assert.deepEqual(r.models, []);
  assert.ok(r.reviews.some(x => x.kind === 'AMBIGUOUS_PAIR'));
});

test('one image + one model file with unrelated names and no preview-like name is only a SUGGESTED pair, never silently L2', () => {
  const r = map('X/Y', 'X.jpg', 'Y.rar');
  assert.deepEqual(r.models.map(m => [m.layout, m.suggested, m.categoryPath]), [['L1', true, 'X/Y']]);
  assert.deepEqual(r.reviews.map(x => x.kind), ['SUGGESTED_PAIR']);
});

test('reviews carry names and the folder path only, never ids', () => {
  const r = map('X/Y', 'A.jpg', 'A.rar', 'A.zip', 'C.jpg');
  for (const rev of r.reviews) {
    assert.equal(rev.path, 'X/Y');
    assert.ok(rev.files.every(x => typeof x === 'string'));
    assert.ok(!JSON.stringify(rev).includes('ID0000'), 'file ids must not appear in a review');
  }
});

test('a model keeps the Drive ids of its own files (needed for identity), and size/md5 are passed through', () => {
  const img = f('A.jpg', { md5: 'a'.repeat(32), size: 5 }), arc = f('A.rar', { md5: 'b'.repeat(32), size: 99 });
  const m = mapFolder({ path: 'X', files: [arc, img] }).models[0];
  assert.deepEqual([m.file.id, m.file.size, m.file.md5, m.images[0].id, m.images[0].md5], [arc.id, 99, 'b'.repeat(32), img.id, 'a'.repeat(32)]);
});
