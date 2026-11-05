import express from 'express';
import { hashPassword } from '../auth.js';
import { inTransaction, audit } from '../catalog-admin/shared.js';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const view = (row) => ({ id: row.id, username: row.username, displayName: row.display_name || '', isOwner: Boolean(row.is_admin_owner),
  disabledAt: row.admin_disabled_at, mustChangeCredentials: Boolean(row.must_change_credentials), createdAt: row.created_at });

export function createAdminUsersRouter({ pool, guards = [], rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];

  router.get('/admins', ...pre, async (_req, res) => {
    const result = await pool.query(`select id, username, display_name, is_admin_owner, admin_disabled_at, must_change_credentials, created_at
      from users where role='ADMIN' order by is_admin_owner desc, created_at, username`);
    res.json({ accounts: result.rows.map(view) });
  });

  router.post('/admins', ...pre, async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['username', 'displayName', 'password'].includes(key))) throw apiError('INVALID_PARAMS');
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!USERNAME.test(username)) throw apiError('ADMIN_USERNAME_INVALID');
    if (displayName.length < 1 || displayName.length > 120) throw apiError('ADMIN_DISPLAY_NAME_INVALID');
    if (password.length < 8) throw apiError('ADMIN_PASSWORD_TOO_SHORT');
    if (password.length > 128) throw apiError('ADMIN_PASSWORD_TOO_LONG');
    const passwordHash = await hashPassword(password);
    try {
      const row = await inTransaction(pool, async (db) => {
        const created = (await db.query(`insert into users (email,password_hash,role,username,display_name,must_change_credentials,is_admin_owner)
          values ($1,$2,'ADMIN',$3,$4,true,false)
          returning id, username, display_name, is_admin_owner, admin_disabled_at, must_change_credentials, created_at`,
        [`${username}@admin.local`, passwordHash, username, displayName])).rows[0];
        await audit(db, req.user.id, 'ADMIN_ACCOUNT_CREATED', 'user', created.id, { username });
        return created;
      });
      res.status(201).json({ account: view(row) });
    } catch (error) {
      if (error?.code === '23505') throw apiError('ADMIN_USERNAME_TAKEN');
      throw error;
    }
  });

  router.patch('/admins/:id', ...pre, async (req, res) => {
    if (!UUID.test(req.params.id)) throw apiError('ADMIN_ACCOUNT_NOT_FOUND');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['action', 'password'].includes(key))) throw apiError('INVALID_PARAMS');
    if (!['disable', 'enable', 'reset_password'].includes(body.action)) throw apiError('INVALID_PARAMS');
    let passwordHash = null;
    if (body.action === 'reset_password') {
      if (typeof body.password !== 'string' || body.password.length < 8) throw apiError('ADMIN_PASSWORD_TOO_SHORT');
      if (body.password.length > 128) throw apiError('ADMIN_PASSWORD_TOO_LONG');
      passwordHash = await hashPassword(body.password);
    } else if (body.password !== undefined) throw apiError('INVALID_PARAMS');

    const result = await inTransaction(pool, async (db) => {
      const row = (await db.query(`select id,username,display_name,is_admin_owner,admin_disabled_at,must_change_credentials,created_at
        from users where id=$1 and role='ADMIN' for update`, [req.params.id])).rows[0];
      if (!row) throw apiError('ADMIN_ACCOUNT_NOT_FOUND');
      if (row.is_admin_owner || row.id === req.user.id) throw apiError('ADMIN_ACCOUNT_PROTECTED');
      if (body.action === 'disable') {
        row.admin_disabled_at = (await db.query('update users set admin_disabled_at=coalesce(admin_disabled_at,now()) where id=$1 returning admin_disabled_at', [row.id])).rows[0].admin_disabled_at;
        await db.query('delete from sessions where user_id=$1', [row.id]);
      } else if (body.action === 'enable') {
        row.admin_disabled_at = (await db.query('update users set admin_disabled_at=null where id=$1 returning admin_disabled_at', [row.id])).rows[0].admin_disabled_at;
      } else {
        await db.query('update users set password_hash=$2,must_change_credentials=true where id=$1', [row.id, passwordHash]);
        row.must_change_credentials = true;
        await db.query('delete from sessions where user_id=$1', [row.id]);
      }
      await audit(db, req.user.id, `ADMIN_ACCOUNT_${body.action.toUpperCase()}`, 'user', row.id, { username: row.username });
      return row;
    });
    res.json({ account: view(result) });
  });

  router.use(v3ErrorHandler);
  return router;
}
