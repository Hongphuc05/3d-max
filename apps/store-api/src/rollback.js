// P6 (plan §10.2): chay migrations/rollback/<ten>.sql bang tay khi deploy hong. Cac file rollback tu chua begin/commit, tu xoa dong trong
// schema_migrations va tu tu choi khi se mat du lieu khach da mua. Lop nay chi them: ten dung dang, chi migration MOI NHAT.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../migrations/rollback');
const fail = (code, message) => Object.assign(new Error(message), { code });

export async function rollbackMigration(pool, name, { dir = DIR } = {}) {
  if (typeof name !== 'string' || !/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) throw fail('INVALID_MIGRATION_NAME', 'Ten migration khong hop le.');
  let sql;
  try { sql = await readFile(path.join(dir, name), 'utf8'); } catch { throw fail('NO_ROLLBACK_FILE', `Khong co file rollback cho ${name}.`); }
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(727001)');
    const latest = (await c.query('select name from schema_migrations order by name desc limit 1')).rows[0]?.name;
    if (latest !== name) throw fail('NOT_LATEST', `Chi rollback duoc migration moi nhat (${latest ?? 'khong co'}), khong phai ${name}.`);
    try { await c.query(sql); } catch (e) {
      await c.query('rollback').catch(() => {});
      throw fail('ROLLBACK_REFUSED', String(e.message).replace(/^.*?Rollback refused: /, 'Rollback refused: '));
    }
  } finally {
    await c.query('select pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}
