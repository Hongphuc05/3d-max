// node scripts/migrate.js                      -> ap dung cac migration con thieu
// node scripts/migrate.js rollback <file.sql>  -> P6: lui migration MOI NHAT bang migrations/rollback/<file.sql> (tu choi neu se mat du lieu)
import { migrate, pool } from '../src/db.js';
import { rollbackMigration } from '../src/rollback.js';

const OWN = new Set(['INVALID_MIGRATION_NAME', 'NO_ROLLBACK_FILE', 'NOT_LATEST', 'ROLLBACK_REFUSED']); // thong bao do ta viet, an toan de in
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const [command, name] = process.argv.slice(2);
  if (command === 'rollback') { await rollbackMigration(pool, name); console.log('Rolled back:', name); }
  else if (command === undefined) console.log('Applied migrations:', (await migrate()).join(', ') || 'none');
  else throw Object.assign(new Error('usage: migrate.js [rollback <file.sql>]'), { code: 'INVALID_MIGRATION_NAME' });
} catch (e) {
  if (OWN.has(e.code)) console.error(`${e.code}: ${e.message}`);
  else console.error('Migration failed. Check database connectivity, migration role and schema state.');
  process.exitCode = 1;
} finally { await pool.end(); }
