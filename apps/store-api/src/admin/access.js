import { licenseError } from '../licensing/errors.js';

export function isAdminUser(user, env = process.env) {
  if (!user?.id) return false;
  if (user.role === 'ADMIN') return true;
  // Preserve explicitly provisioned administrators from existing deployments.
  return (env.LICENSE_ADMIN_USER_IDS || '').split(',')
    .some(id => id.trim().toLowerCase() === user.id.toLowerCase());
}

export function publicUser(row) {
  const base = { id: row.id, email: row.email };
  return isAdminUser(row) ? { ...base, role: 'ADMIN', username: row.username || '',
    mustChangeCredentials: Boolean(row.must_change_credentials) } : base;
}

export function requireAdmin(req, _res, next) {
  if (!isAdminUser(req.user)) return next(licenseError('FORBIDDEN', 403));
  if (req.user.mustChangeCredentials) return next(licenseError('ADMIN_CREDENTIALS_CHANGE_REQUIRED', 403));
  next();
}
