import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from './pairing.js';

test('catalog discovers all category levels and empty markers without exposing storage root', () => {
  const scan = buildCatalog([{key:'3DSMOOD/Furniture/Gaming Chair/Gold/'}, {key:'3DSMOOD/Lighting/Other/only.JPG'}], '3DSMOOD/');
  assert.deepEqual(scan.folders.map(x=>x.path), ['Furniture','Furniture/Gaming Chair','Furniture/Gaming Chair/Gold','Lighting','Lighting/Other']);
  assert.equal(scan.folders[2].parentId, 'Furniture/Gaming Chair');
  assert.equal(scan.models[0].status,'missing_archive');
});

test('pairing preserves exact basenames and paths, extension case only is ignored', () => {
  const keys=['A/A Name & %.JPG','A/A Name & %.RAR','B/A Name & %.zip','A/a name & %.jpg','A/conflict.rar','A/conflict.zip','A/conflict.jpg','A/dup.JPG','A/dup.jpeg'];
  const scan=buildCatalog(keys.map(key=>({key:`3DSMOOD/${key}`,size:10,etag:'v1'})), '3DSMOOD/');
  const byName=new Map(scan.models.map(x=>[`${x.folderId}/${x.name}`,x]));
  assert.equal(byName.get('A/A Name & %').status,'ready');
  assert.equal(byName.get('B/A Name & %').status,'missing_preview');
  assert.equal(byName.get('A/a name & %').status,'missing_archive');
  assert.equal(byName.get('A/conflict').status,'conflict');
  assert.equal(byName.get('A/dup').status,'conflict');
  assert.equal(byName.get('A/conflict').canDownload,false);
  assert.equal(byName.get('A/conflict').archiveId,null);
});

test('keys outside root are excluded, root is never a category, duplicate inventory is rejected', () => {
  const scan=buildCatalog([{key:'else/A/a.jpg'},{key:'3DSMOOD/'},{key:'3DSMOOD/root.jpg'},{key:'3DSMOOD/root.zip'},{key:'3DSMOOD/A/file.txt'}], '3DSMOOD/');
  assert.equal(scan.folders.length,1);
  assert.equal(scan.folders[0].path,'A');
  assert.equal(scan.models[0].folderId,'');
  assert.throws(()=>buildCatalog([{key:'3DSMOOD/a.jpg'},{key:'3DSMOOD/a.jpg'}],'3DSMOOD/'),/DUPLICATE/);
});
