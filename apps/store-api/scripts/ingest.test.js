import test from 'node:test';
import assert from 'node:assert/strict';
import { pairFiles, titleFromEntries } from './ingest.js';

test('ghep anh + nen, ke ca ten ban va doi duoi', () => {
  const { pairs, orphans } = pairFiles([
    '/d/AAA.jpg', '/d/AAA.rar',
    '/d/BBB.jpg', '/d/BBBrar.rar',
    '/d/C.JPG', '/d/C.zip',
    '/d/D.jpg', '/d/E.rar', '/d/F.jpg',
  ]);
  assert.equal(pairs.length, 3);
  assert.deepEqual(orphans.map((o) => o.split('/').pop()).sort(), ['D.jpg', 'E.rar', 'F.jpg']);
});

test('khoang trang truoc duoi + hau to lech: ghep khi con dung 1 cap', () => {
  const { pairs, orphans } = pairFiles(['/d/198034.55 .jpg', '/d/198034.55-yzbmix.rar']);
  assert.equal(pairs.length, 1); assert.equal(orphans.length, 0);
});

test('ten tu file .max', () => {
  assert.equal(titleFromEntries(['maps/', 'Zehnder Subway_max13.max', 'Zehnder Subway.obj']), 'Zehnder Subway');
  assert.equal(titleFromEntries(['33B_20_Murakami_2_2016_Vray.max', '33B_20_Murakami_2_2013_Vray.max']), '33B 20 Murakami 2');
  assert.equal(titleFromEntries(['a.fbx']), null);
});
