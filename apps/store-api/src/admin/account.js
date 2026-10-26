import { createSession, setSessionCookie, hashPassword, verifyPassword } from '../auth.js';
import { audit, inTransaction } from '../licensing/service.js';
import { objectBody, licenseError } from '../licensing/errors.js';
import { isAdminUser, publicUser } from './access.js';

function credentials(body) {
  const input = objectBody(body, ['username', 'currentPassword', 'newPassword']);
  if (typeof input.username !== 'string') throw licenseError('INVALID_USERNAME');
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) throw licenseError('INVALID_USERNAME');
  if (typeof input.currentPassword !== 'string' || !input.currentPassword || input.currentPassword.length > 128) {
    throw licenseError('INVALID_CURRENT_PASSWORD', 403);
  }
  if (input.newPassword !== undefined) {
    if (typeof input.newPassword !== 'string' || input.newPassword.length < 8) throw licenseError('PASSWORD_TOO_SHORT');
    if (input.newPassword.length > 128) throw licenseError('PASSWORD_TOO_LONG');
  }
  return { ...input, username };
}

export async function updateAdminAccount(req, res) {
  if (!isAdminUser(req.user)) throw licenseError('FORBIDDEN', 403);
  const input = credentials(req.body);
  let result;
  try {
    result = await inTransaction(async db => {
      const row = (await db.query('select * from users where id=$1 for update', [req.user.id])).rows[0];
      if (!isAdminUser(row)) throw licenseError('FORBIDDEN', 403);
      const session = await db.query('select id from sessions where id=$1 and user_id=$2 and expires_at>now()',
        [req.auth.sessionId, row.id]);
      if (!session.rowCount) throw licenseError('UNAUTHENTICATED', 401);
      if (!await verifyPassword(input.currentPassword, row.password_hash)) throw licenseError('INVALID_CURRENT_PASSWORD', 403);
      if (row.must_change_credentials && (!input.newPassword || input.newPassword === input.currentPassword)) {
        throw licenseError('PASSWORD_CHANGE_REQUIRED');
      }
      const hash = input.newPassword ? await hashPassword(input.newPassword) : row.password_hash;
      const changed = (await db.query(`update users set username=$2,password_hash=$3,must_change_credentials=false
        where id=$1 returning *`, [row.id, input.username, hash])).rows[0];
      await db.query('delete from sessions where user_id=$1', [row.id]);
      const renewed = await createSession(req, row.id, db);
      await audit(db, row.id, null, 'ADMIN_CREDENTIALS_CHANGED', {
        usernameChanged: row.username !== changed.username, passwordChanged: Boolean(input.newPassword),
      });
      return { user: publicUser(changed), session: renewed };
    });
  } catch (error) {
    if (error.code === '23505') throw licenseError('USERNAME_TAKEN', 409);
    throw error;
  }
  setSessionCookie(res, result.session);
  res.clearCookie('dsid', { path: '/' });
  res.json({ user: result.user });
}
