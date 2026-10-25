import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
// Idle connection errors must not crash Node or print provider/SQL payloads.
pool.on('error', () => console.error('[database] idle connection failed'));

const DIR = path.resolve(import.meta.dirname, '../migrations');

// Chay cac file migrations/*.sql theo thu tu ten, moi file 1 lan (ghi vao schema_migrations).
// Khoa advisory de 2 tien trinh khoi dong cung luc khong chay trung.
export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(727001)');
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    const applied = [];
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      try {
        await c.query('begin');
        await c.query(readFileSync(path.join(DIR, f), 'utf8'));
        await c.query('insert into schema_migrations (name) values ($1)', [f]);
        await c.query('commit');
        applied.push(f);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`migration ${f} loi: ${e.message}`);
      }
    }
    return applied;
  } finally {
    await c.query('select pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}
