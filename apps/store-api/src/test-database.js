import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Opt in explicitly; each test file owns a disposable schema, never public data.
export async function isolatedTestDatabase(prefix) {
  if (!process.env.TEST_DATABASE_URL) return null;
  // Test-only signing secret, independent of development/production credentials.
  process.env.JWT_SECRET ||= randomBytes(32).toString('base64');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1))) {
    throw new Error('TEST_DATABASE_URL must name a dedicated test database');
  }
  if (!/^[a-z_]+$/.test(prefix)) throw new Error('Invalid test schema prefix');
  const schema = `${prefix}_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url.href });
  await admin.query(`create schema ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  return async pool => {
    await pool.end();
    try { await admin.query(`drop schema ${schema} cascade`); }
    finally { await admin.end(); }
  };
}
