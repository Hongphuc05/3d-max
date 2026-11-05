import { licenseError } from '../errors.js';

export function isAdminUser(user) {
  return Boolean(user?.id) && user.role === 'ADMIN';
}

export function publicUser(row) {
  const base = { id: row.id, email: row.email };
  return isAdminUser(row) ? { ...base, role: 'ADMIN', username: row.username || '',
    mustChangeCredentials: Boolean(row.must_change_credentials), isAdminOwner: Boolean(row.is_admin_owner) } : base;
}

export function requireAdmin(req, _res, next) {
  if (!isAdminUser(req.user)) return next(licenseError('FORBIDDEN', 403));
  if (req.user.mustChangeCredentials) return next(licenseError('ADMIN_CREDENTIALS_CHANGE_REQUIRED', 403));
  next();
}

export function requireAdminOwner(req, _res, next) {
  if (!isAdminUser(req.user) || !req.user.isAdminOwner) {
    return next(Object.assign(new Error('ADMIN_OWNER_REQUIRED'), { code: 'ADMIN_OWNER_REQUIRED', status: 403 }));
  }
  next();
}
