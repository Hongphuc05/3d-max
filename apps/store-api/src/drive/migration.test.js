import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedTestDatabase } from '../test-database.js';

const configured = Boolean(process.env.TEST_DATABASE_URL);
const skip = !configured;
let dispose, pool;
before(async () => {
  if (!configured) return;
  dispose = await isolatedTestDatabase('drive_migration');
  const db = await import('../db.js');
  pool = db.pool; await db.migrate();
});
after(async () => { if (dispose) await dispose(pool); });

test('drive_sources: folder id charset enforced; OAuth tables are gone (024)', { skip }, async () => {
  const src = f => pool.query("insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY',$1,'n','MY_DRIVE')", [f]);
  await assert.rejects(src("x' or '1'='1"), /check/i);
  await assert.rejects(src('short'), /check/i);
  await src('validFolderId01');
  await assert.rejects(src('validFolderId01'), /unique|duplicate/i);
  for (const t of ['drive_connections', 'oauth_states'])
    assert.equal((await pool.query('select to_regclass($1) as t', [t])).rows[0].t, null, t);
});
