// Tao (hoac dat lai mat khau) tai khoan admin: node scripts/create-admin.js <username> [password]
// Hoac qua env: ADMIN_USERNAME, ADMIN_PASSWORD. Nen dung env de mat khau khong nam trong lich su shell.
// Admin dau tien duoc tao bang script se la admin chu quan neu chua co owner.
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const username = (process.argv[2] ?? process.env.ADMIN_USERNAME ?? '').trim().toLowerCase();
const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? '';
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) throw new Error('username: 3-64 ky tu [a-z0-9_.-], bat dau bang chu/so');
  if (password.length < 8 || password.length > 128) throw new Error('password: 8-128 ky tu');
  const passwordHash = await hashPassword(password);
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query('select pg_advisory_xact_lock(727003)');
    const { rows } = await db.query(
      `insert into users (email,password_hash,role,username,must_change_credentials,is_admin_owner)
       select $1,$2,'ADMIN',$3,false,not exists(select 1 from users where is_admin_owner)
       on conflict (email) do update set password_hash=excluded.password_hash,role='ADMIN',username=excluded.username,
         must_change_credentials=false,admin_disabled_at=null,
         is_admin_owner=users.is_admin_owner or not exists(select 1 from users where is_admin_owner and id<>users.id)
       returning id,is_admin_owner`, [`${username}@admin.local`, passwordHash, username]);
    await db.query('delete from sessions where user_id=$1', [rows[0].id]);
    await db.query('commit');
    console.log(`Admin "${username}" san sang (id ${rows[0].id}${rows[0].is_admin_owner ? ', chu quan' : ''}).`);
  } catch (error) { await db.query('rollback').catch(() => {}); throw error; }
  finally { db.release(); }
} catch (e) {
  console.error(e.code === '23505' ? 'Ten dang nhap da thuoc tai khoan khac.' : e.message);
  process.exitCode = 1;
} finally { await pool.end(); }
