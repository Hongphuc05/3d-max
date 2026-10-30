import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool, seedLegacyCatalog, sourceId;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('worker_seed');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
  ({ seedLegacyCatalog } = await import('./seed.js'));
  sourceId = (await pool.query(
    "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','seedRootFolder01','root','MY_DRIVE') returning id")).rows[0].id;
});
after(async () => { if (dispose) await dispose(pool); });

const sha = s => createHash('sha256').update(s).digest('hex');
const driveId = n => `DRIVEID${String(n).padStart(12, '0')}`;
const item = (n, over = {}) => ({
  id: `model-${n}`, name: `Model ${n}`, category: 'Furniture / Desk', preview: `previews/x${n}.jpg`,
  driveFileId: driveId(n), fileName: `Model ${n}.rar`, sha256: sha(`m${n}`), entryFile: '', ...over,
});
const count = async t => (await pool.query(`select count(*)::int n from ${t}`)).rows[0].n;
const reset = async () => {
  await pool.query('update models set primary_file_id=null');
  for (const t of ['model_files', 'models', 'categories']) await pool.query(`delete from ${t}`);
};

test('seeds categories (parent + child once), models as PUBLISHED with default price, primary file, cleaned names/extensions', { skip }, async () => {
  await reset();
  const r = await seedLegacyCatalog(pool, {
    sourceId, defaultPriceVnd: 15000,
    items: [item(1, { name: '  Spaced name  ', fileName: 'Upper.RAR' }), item(2, { category: 'Furniture / Chair' }), item(3, { category: 'Lighting / Lamp', fileName: 'a.7z' })],
  });
  assert.deepEqual(r, { categories: 5, models: { inserted: 3, existing: 0 }, files: 3 });
  assert.equal(await count('categories'), 5); // Furniture, Furniture/Desk, Furniture/Chair, Lighting, Lighting/Lamp
  const m = (await pool.query(
    `select m.name, m.status, m.price_vnd, m.legacy_id, m.published_at is not null as pub, m.name_overridden, m.price_overridden,
            f.file_type, f.sha256, f.drive_file_id, f.id = m.primary_file_id as primary_ok, c.full_path, p.full_path as parent_path
       from models m join model_files f on f.model_id=m.id join categories c on c.id=m.category_id left join categories p on p.id=c.parent_id
      where m.legacy_id='model-1'`)).rows[0];
  assert.deepEqual(m, {
    name: 'Spaced name', status: 'PUBLISHED', price_vnd: 15000, legacy_id: 'model-1', pub: true, name_overridden: false, price_overridden: false,
    file_type: 'rar', sha256: sha('m1'), drive_file_id: driveId(1), primary_ok: true, full_path: 'Furniture / Desk', parent_path: 'Furniture',
  });
  assert.equal((await pool.query('select file_type from model_files where drive_file_id=$1', [driveId(3)])).rows[0].file_type, '7z');
});

test('idempotent: second run adds nothing and never overwrites what an admin edited', { skip }, async () => {
  await reset();
  const items = [item(1), item(2)];
  await seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd: 15000 });
  await pool.query("update models set name='Admin name', name_overridden=true, price_vnd=99000, price_overridden=true, status='HIDDEN' where legacy_id='model-1'");
  const before = [await count('categories'), await count('models'), await count('model_files')];
  const r = await seedLegacyCatalog(pool, { sourceId, items: items.map(i => ({ ...i, name: 'Changed in file' })), defaultPriceVnd: 20000 });
  assert.deepEqual(r, { categories: 0, models: { inserted: 0, existing: 2 }, files: 0 });
  assert.deepEqual([await count('categories'), await count('models'), await count('model_files')], before);
  const m = (await pool.query("select name, price_vnd, status from models where legacy_id='model-1'")).rows[0];
  assert.deepEqual(m, { name: 'Admin name', price_vnd: 99000, status: 'HIDDEN' });
});

test('one bad item rejects the WHOLE file: nothing is written and the error never echoes a Drive id', { skip }, async () => {
  const bad = {
    'sha256 not hex': item(9, { sha256: 'xyz' }),
    'drive id with quote': item(9, { driveFileId: "LEAKMARK x' or '1'='1" }),
    'archive extension': item(9, { fileName: 'virus.exe' }),
    'empty name': item(9, { name: '   ' }),
    'no category': item(9, { category: '' }),
    'bad legacy id': item(9, { id: '../etc/passwd' }),
  };
  for (const [label, broken] of Object.entries(bad)) {
    await reset();
    await assert.rejects(seedLegacyCatalog(pool, { sourceId, items: [item(1), broken], defaultPriceVnd: 1 }),
      e => { assert.ok(!/DRIVEID|LEAKMARK/.test(e.message), `${label}: message leaks a Drive id`); return /item/i.test(e.message); }, label);
    assert.equal(await count('models'), 0, `${label}: partial write`);
    assert.equal(await count('categories'), 0, `${label}: partial write`);
  }
  await reset();
  await assert.rejects(seedLegacyCatalog(pool, { sourceId, items: [item(1), item(1, { driveFileId: driveId(5) })], defaultPriceVnd: 1 }), /duplicate/i, 'duplicate legacy id');
  await assert.rejects(seedLegacyCatalog(pool, { sourceId, items: [item(1), item(2, { driveFileId: driveId(1) })], defaultPriceVnd: 1 }), /duplicate/i, 'duplicate drive id');
  assert.equal(await count('models'), 0);
  await assert.rejects(seedLegacyCatalog(pool, { sourceId: randomUUID(), items: [item(1)], defaultPriceVnd: 1 }), /source/i);
  await assert.rejects(seedLegacyCatalog(pool, { sourceId, items: 'nope', defaultPriceVnd: 1 }), /items/i);
  await assert.rejects(seedLegacyCatalog(pool, { sourceId, items: [item(1)], defaultPriceVnd: -5 }), /price/i);
});

test('a database failure in the middle rolls back everything written before it (atomic)', { skip }, async () => {
  await reset();
  // another model already owns the Drive file of item 2, so inserting item 2's file fails AFTER item 1 was written
  const cat = (await pool.query("insert into categories(name,slug,full_path) values('Other','other','Other') returning id")).rows[0].id;
  const owner = (await pool.query("insert into models(category_id,name,status,price_vnd,legacy_id) values($1,'Owner','DRAFT',1,'owner') returning id", [cat])).rows[0].id;
  await pool.query("insert into model_files(model_id,source_id,drive_file_id,filename,file_type) values($1,$2,$3,'o.rar','rar')", [owner, sourceId, driveId(2)]);
  await assert.rejects(seedLegacyCatalog(pool, { sourceId, items: [item(1), item(2)], defaultPriceVnd: 1 }), /unique|duplicate/i);
  assert.equal((await pool.query("select count(*)::int n from models where legacy_id in ('model-1','model-2')")).rows[0].n, 0, 'item 1 must not survive');
  assert.equal((await pool.query("select count(*)::int n from categories where full_path like 'Furniture%'")).rows[0].n, 0, 'categories must not survive');
});

test('real legacy catalog: 360 models, 79 categories, 360 files; running it twice creates no duplicates', { skip }, async () => {
  await reset();
  const { items } = JSON.parse(readFileSync(new URL('../../../../library/public/catalog.json', import.meta.url), 'utf8'));
  const r1 = await seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd: 15000 });
  assert.deepEqual(r1, { categories: 79, models: { inserted: 360, existing: 0 }, files: 360 });
  const r2 = await seedLegacyCatalog(pool, { sourceId, items, defaultPriceVnd: 15000 });
  assert.deepEqual(r2, { categories: 0, models: { inserted: 0, existing: 360 }, files: 0 });
  assert.deepEqual([await count('models'), await count('model_files'), await count('categories')], [360, 360, 79]);
  assert.equal((await pool.query("select count(*)::int n from models where primary_file_id is null or status<>'PUBLISHED'")).rows[0].n, 0);
  assert.equal((await pool.query('select count(*)::int n from models where legacy_id is null')).rows[0].n, 0);
});
