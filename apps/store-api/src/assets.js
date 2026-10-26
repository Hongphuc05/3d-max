// Tai goi: Download tren trinh duyet (cookie) va Import vao 3ds Max (ticket 1 lan, host khong co cookie).
// Web chi gui slug/ticket; duong dan file nam o server (catalog.files), khong bao gio lo ra ngoai.
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from './auth.js';
import { pool } from './db.js';
import { requireJson } from './security.js';
import { requireLicensedDevice } from './licensing/routes.js';

const TICKET_MINUTES = 5;
const sha = (s) => createHash('sha256').update(s).digest();

export function assetRouter(cat, srcDir, { repository, sendArchive } = {}) {
  const r = Router();
  const find = async key => repository ? repository.find(key) : cat.bySlug.get(key) || cat.products.find(p => p.id === key);

  function send(req, res, p) {
    if (sendArchive) return sendArchive(req, res, p);
    const file = path.resolve(srcDir, cat.files.get(p.id));
    if (!file.startsWith(path.resolve(srcDir) + path.sep)) return res.status(404).json({ error: 'FILE_MISSING' });
    res.download(file, p.slug + path.extname(file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'FILE_MISSING' });
    });
  }

  // Account login alone never grants access to a model package.
  r.get('/products/:slug/download', requireAuth, requireLicensedDevice, async (req, res) => {
    const p = await find(req.params.slug);
    if (p?.canDownload === false) return res.status(403).json({ error: 'MODEL_DOWNLOAD_RESTRICTED' });
    return p ? send(req, res, p) : res.status(404).json({ error: 'NOT_FOUND' });
  });

  r.post('/products/:slug/import-ticket', requireJson, requireAuth, requireLicensedDevice, async (req, res, next) => {
    try {
      const p = await find(req.params.slug);
      if (!p) return res.status(404).json({ error: 'NOT_FOUND' });
      if (p.canDownload === false) return res.status(403).json({ error: 'MODEL_DOWNLOAD_RESTRICTED' });
      const ticket = randomBytes(32).toString('base64url');
      const created = await pool.query(
        `insert into import_tickets (id,user_id,product_id,expires_at,auth_session_id,license_id,device_id)
         select $1,$2,$3,least(now()+make_interval(mins=>$4),ds.expires_at,s.expires_at),$5,l.id,d.id
         from device_sessions ds join sessions s on s.id=ds.auth_session_id
         join licenses l on l.id=ds.license_id
         join license_devices d on d.id=ds.device_id and d.license_id=l.id
         where ds.user_id=$2 and s.user_id=$2 and ds.auth_session_id=$5 and d.id=$6
         and ds.expires_at>now() and s.expires_at>now() and l.status='ACTIVE' returning id`,
        [sha(ticket), req.user.id, p.id, TICKET_MINUTES, req.auth.sessionId, req.licensedDevice.id]);
      if (!created.rowCount) return res.status(403).json({ error: 'DEVICE_SESSION_INVALID' });
      res.json({ assetId: p.id, ticket });
    } catch (e) { next(e); }
  });

  // Host goi. Danh dau da dung trong cung 1 cau lenh: 2 request trung ticket chi 1 cai thang.
  r.get('/downloads/stream/:ticket', async (req, res, next) => {
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.ticket)) return res.status(404).json({ error: 'TICKET_INVALID' });
      const { rows } = await pool.query(
        `update import_tickets t set used_at = now()
         where t.id=$1 and t.used_at is null and t.expires_at>now()
         and exists (select 1 from device_sessions ds
           join sessions s on s.id=ds.auth_session_id and s.user_id=ds.user_id
           join licenses l on l.id=ds.license_id
           join license_devices d on d.id=ds.device_id and d.license_id=l.id
           where ds.user_id=t.user_id and ds.auth_session_id=t.auth_session_id
           and ds.license_id=t.license_id and ds.device_id=t.device_id and l.user_id=t.user_id
           and ds.expires_at>now() and s.expires_at>now() and l.status='ACTIVE') returning t.product_id`,
        [sha(req.params.ticket)]);
      const p = rows[0] && await find(rows[0].product_id);
      if (p?.canDownload === false) return res.status(403).json({ error: 'MODEL_DOWNLOAD_RESTRICTED' });
      return p ? await send(req, res, p) : res.status(404).json({ error: 'TICKET_INVALID' });
    } catch (e) { next(e); }
  });

  return r;
}
