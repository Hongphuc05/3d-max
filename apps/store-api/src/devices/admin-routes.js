// D28.2: admin xem thiet bi + license thu vien, thu hoi / chuyen license sang thiet bi khac. Moi thao tac ghi audit_events cung transaction.
//   GET /api/admin/devices · POST /api/admin/devices/:id/license/revoke · POST /api/admin/devices/:id/license/transfer { toDeviceId }
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';
import { audit, bad, inTransaction, UUID } from '../catalog-admin/shared.js';

export function createDeviceAdminRouter({ pool, guards = [], rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];
  const json = express.json({ limit: '4kb' });

  router.get('/devices', ...pre, async (_req, res) => {
    const rows = (await pool.query(
      `select d.id, d.device_name, d.status, d.first_seen_at, d.last_seen_at,
              exists(select 1 from entitlements e where e.device_id = d.id and e.revoked_at is null) as has_license
         from devices d order by d.last_seen_at desc limit 500`)).rows;
    res.json({ items: rows.map((d) => ({ id: d.id, name: d.device_name, status: d.status, createdAt: d.first_seen_at, lastSeenAt: d.last_seen_at, hasLicense: d.has_license })) });
  });

  // Khoa dong thiet bi (theo thu tu id) de hai thao tac cung luc khong cap/thu hoi chong nhau.
  const lock = (db, ids) => db.query('select id from devices where id = any($1::uuid[]) order by id for update', [ids]);
  const activeLicense = async (db, deviceId) => (await db.query('select id, order_id from entitlements where device_id = $1 and revoked_at is null for update', [deviceId])).rows[0];

  router.post('/devices/:id/license/revoke', ...pre, json, async (req, res) => {
    if (!UUID.test(req.params.id)) throw apiError('DEVICE_NOT_FOUND');
    await inTransaction(pool, async (db) => {
      if ((await lock(db, [req.params.id])).rowCount !== 1) throw apiError('DEVICE_NOT_FOUND');
      const lic = await activeLicense(db, req.params.id);
      if (!lic) throw apiError('LICENSE_NOT_FOUND');
      await db.query('update entitlements set revoked_at = now() where id = $1', [lic.id]);
      await audit(db, req.user.id, 'LICENSE_REVOKED', 'device', req.params.id, {});
    });
    res.json({ status: 'REVOKED' });
  });

  router.post('/devices/:id/license/transfer', ...pre, json, async (req, res) => {
    const to = req.body?.toDeviceId;
    if (!UUID.test(req.params.id)) throw apiError('DEVICE_NOT_FOUND');
    if (typeof to !== 'string' || !UUID.test(to) || to.toLowerCase() === req.params.id.toLowerCase()) throw bad();
    await inTransaction(pool, async (db) => {
      if ((await lock(db, [req.params.id, to])).rowCount !== 2) throw apiError('DEVICE_NOT_FOUND');
      const lic = await activeLicense(db, req.params.id);
      if (!lic) throw apiError('LICENSE_NOT_FOUND');
      if (await activeLicense(db, to)) throw apiError('ALREADY_ENTITLED');
      await db.query('update entitlements set revoked_at = now() where id = $1', [lic.id]);
      await db.query("insert into entitlements (device_id, source, order_id, granted_by) values ($1, 'ADMIN', $2, $3)", [to, lic.order_id, req.user.id]);
      await audit(db, req.user.id, 'LICENSE_TRANSFERRED', 'device', req.params.id, { toDeviceId: to });
    });
    res.json({ status: 'TRANSFERRED' });
  });

  router.use(v3ErrorHandler);
  return router;
}
