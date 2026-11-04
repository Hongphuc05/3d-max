// Tao (hoac dat lai mat khau) tai khoan admin: node scripts/create-admin.js <username> [password]
// Hoac qua env: ADMIN_USERNAME, ADMIN_PASSWORD. Nen dung env de mat khau khong nam trong lich su shell.
// Idempotent: chay lai voi cung username chi cap nhat mat khau, role=ADMIN, must_change_credentials=false.
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const username = (process.argv[2] ?? process.env.ADMIN_USERNAME ?? '').trim().toLowerCase();
const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? '';
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) throw new Error('username: 3-64 ky tu [a-z0-9_.-], bat dau bang chu/so');
  if (password.length < 8 || password.length > 128) throw new Error('password: 8-128 ky tu');
  const { rows } = await pool.query(
    `insert into users (email, password_hash, role, username, must_change_credentials)
     values ($1, $2, 'ADMIN', $3, false)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'ADMIN', username = excluded.username, must_change_credentials = false
     returning id`, [`${username}@admin.local`, await hashPassword(password), username]);
  await pool.query('delete from sessions where user_id = $1', [rows[0].id]);
  console.log(`Admin "${username}" san sang (id ${rows[0].id}).`);
} catch (e) {
  console.error(e.code === '23505' ? 'Ten dang nhap da thuoc tai khoan khac.' : e.message);
  process.exitCode = 1;
} finally { await pool.end(); }
