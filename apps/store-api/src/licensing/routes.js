import { createHash } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { requireJson } from '../security.js';
import { uuid, objectBody, licenseError } from './errors.js';
import { getLicenseByAccount, getActivatedDevices, publicLicense, issueLifetimeLicense, revokeLicense, resumeLicense, inTransaction, audit } from './service.js';
import { createDeviceChallenge, activateDevice, verifyDevice, getDeviceSession } from './devices.js';
import { requireAdmin } from '../admin/access.js';

// Shared PostgreSQL counters apply across API instances. Fixed one-minute buckets.
function limit(scope, maximum) {
  return async (req, res, next) => {
    try {
      const minute = Math.floor(Date.now() / 60_000);
      const actor = createHash('sha256').update(`${req.user.id}|${scope}|${minute}`).digest('hex');
      const { rows } = await pool.query(`insert into license_rate_limits (bucket,hits,expires_at)
        values ($1,1,now()+interval '2 minutes') on conflict (bucket)
        do update set hits=license_rate_limits.hits+1 returning hits`, [actor]);
      if (rows[0].hits > maximum) {
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
      }
      next();
    } catch (error) { next(error); }
  };
}

function noStore(_req, res, next) { res.set('Cache-Control', 'no-store'); next(); }
function sessionId(req) { return req.auth?.sessionId; }
function cookie(req) {
  const match = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('dsid='));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(5)); } catch { return null; }
}

function deviceResponse(res, result) {
  const { token, ...body } = result;
  res.cookie('dsid', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', expires: result.expiresAt,
  });
  return res.json(body);
}

export async function requireLicensedDevice(req, _res, next) {
  try {
    if (!req.user) throw licenseError('UNAUTHENTICATED', 401);
    const session = await getDeviceSession(req.user.id, sessionId(req), cookie(req));
    const ownedLicense = await getLicenseByAccount(req.user.id);
    if (ownedLicense?.status !== 'ACTIVE' || ownedLicense.id !== session.license.id) {
      throw licenseError('LICENSE_REQUIRED', 403);
    }
    req.license = session.license;
    req.licensedDevice = session.device;
    next();
  } catch (error) { next(error); }
}

export const licenseRouter = Router();
licenseRouter.use(requireAuth, noStore, limit('license', 60));
licenseRouter.get('/me', async (req, res) => {
  res.json({ license: publicLicense(await getLicenseByAccount(req.user.id), { includeKey: true }) });
});
licenseRouter.get('/devices', async (req, res) => res.json({ devices: await getActivatedDevices(req.user.id) }));
licenseRouter.post('/activate', requireJson, limit('activation', 10), async (req, res) => {
  deviceResponse(res, await activateDevice(req.user.id, sessionId(req), req.body));
});

export const deviceRouter = Router();
deviceRouter.use(requireAuth, noStore, limit('devices', 60));
deviceRouter.post('/challenge', requireJson, limit('challenge', 20), async (req, res) => {
  res.status(201).json(await createDeviceChallenge(req.user.id, sessionId(req), req.body));
});
deviceRouter.post('/verify', requireJson, limit('verify', 20), async (req, res) => {
  deviceResponse(res, await verifyDevice(req.user.id, sessionId(req), req.body));
});
deviceRouter.get('/session', async (req, res) => {
  res.json(await getDeviceSession(req.user.id, sessionId(req), cookie(req)));
});

export const adminLicenseRouter = Router();
adminLicenseRouter.use(requireAuth, noStore, requireAdmin, limit('admin-license', 10));
adminLicenseRouter.post('/issue', requireJson, async (req, res) => {
  const input = objectBody(req.body, ['userId']);
  const userId = uuid(input.userId, 'INVALID_USER_ID');
  const license = await inTransaction(async db => {
    const row = await issueLifetimeLicense(userId, null, db);
    await audit(db, req.user.id, row.id, 'ADMIN_LICENSE_ISSUE', { targetUserId: userId });
    return row;
  });
  res.status(201).json({ license: publicLicense(license) });
});
adminLicenseRouter.post('/revoke', requireJson, async (req, res) => {
  const input = objectBody(req.body, ['userId','status','reason']);
  const row = await revokeLicense(uuid(input.userId), req.user.id, input.status, input.reason);
  res.json({ license: publicLicense(row) });
});
adminLicenseRouter.post('/resume', requireJson, async (req, res) => {
  const input = objectBody(req.body, ['userId']);
  res.json({ license: publicLicense(await resumeLicense(uuid(input.userId), req.user.id)) });
});

// Start from server lifecycle, not import time (keeps test processes independent).
// Do not remove permanent license/device rows. Audit retention is operator-owned.
export function startLicenseMaintenance() {
  const timer = setInterval(async () => {
    try {
      await pool.query("delete from device_challenges where expires_at < now()-interval '1 day'");
      await pool.query('delete from device_sessions where expires_at < now()');
      await pool.query('delete from license_rate_limits where expires_at < now()');
    } catch { console.error('[licensing] maintenance failed'); }
  }, 10 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
