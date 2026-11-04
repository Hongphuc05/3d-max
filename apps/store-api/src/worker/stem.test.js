import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, normalizeStem, parseCategoryPath } from './stem.js';

test('stem: dirty names from the real data pair up (trailing space before extension, repeated extensions, case, NFC)', () => {
  for (const name of ['Lamp 01.jpg', 'lamp 01 .JPG', 'Lamp  01.rar', 'LAMP 01.rar.rar', ' lamp 01 .zip ', 'lamp 01.jpeg.jpg', 'Lamp 01.7z']) assert.equal(normalizeStem(name), 'lamp 01', name);
  assert.equal(normalizeStem('Café.jpg'), normalizeStem('Café.PNG'), 'NFC');
  assert.equal(displayName('Lamp  01 .jpg'), 'Lamp 01', 'display keeps the case');
  assert.equal(normalizeStem('v1.2 chair.rar'), 'v1.2 chair', 'only known extensions are stripped');
  assert.equal(normalizeStem('.jpg'), '');
});

test('category path: segments are trimmed; empty, dot, control, backslash and too-deep paths are refused', () => {
  assert.deepEqual(parseCategoryPath(' Furniture / Desk '), ['Furniture', 'Desk']);
  for (const bad of ['', '/', 'A//B', 'A/../B', '.', 'A/\u0000', 'A\\B', 'a/b/c/d/e/f/g', 'x'.repeat(201), undefined, 5]) assert.equal(parseCategoryPath(bad), null, String(bad));
});
