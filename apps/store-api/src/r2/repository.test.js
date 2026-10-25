import test from 'node:test';
import assert from 'node:assert/strict';
import { planObjectDiff } from './repository.js';

const object=(key,size=10,etag='v1',lastModified='2026-01-01T00:00:00.000Z')=>({key,size,etag,lastModified});

test('unchanged inventory produces no object writes',()=>{
  const current=[object('3DSMOOD/A/a.jpg'),object('3DSMOOD/A/a.rar',20,'v2')];
  const plan=planObjectDiff(current,current.map(value=>({...value})));
  assert.deepEqual(plan,{upserts:[],removedKeys:[],changed:false});
});

test('inventory diff upserts only new or metadata-changed objects',()=>{
  const previous=[object('3DSMOOD/A/a.jpg'),object('3DSMOOD/A/a.rar',20,'v2')];
  const current=[object('3DSMOOD/A/a.jpg',11,'v3'),previous[1],object('3DSMOOD/A/new.zip',30,'v4')];
  const plan=planObjectDiff(previous,current);
  assert.deepEqual(plan.upserts.map(value=>value.key),['3DSMOOD/A/a.jpg','3DSMOOD/A/new.zip']);
  assert.deepEqual(plan.removedKeys,[]);assert.equal(plan.changed,true);
});

test('completed inventory diff marks missing keys for removal',()=>{
  const previous=[object('3DSMOOD/A/a.jpg'),object('3DSMOOD/A/a.rar',20,'v2')];
  const plan=planObjectDiff(previous,[previous[0]]);
  assert.deepEqual(plan.upserts,[]);assert.deepEqual(plan.removedKeys,['3DSMOOD/A/a.rar']);assert.equal(plan.changed,true);
});
