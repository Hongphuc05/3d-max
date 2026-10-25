import { migrate, pool } from '../src/db.js';

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  console.log('Applied migrations:', (await migrate()).join(', ') || 'none');
} catch {
  console.error('Migration failed. Check database connectivity, migration role and schema state.');
  process.exitCode = 1;
} finally { await pool.end(); }
