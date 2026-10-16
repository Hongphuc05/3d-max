// Tai goi: Download tren trinh duyet (cookie) va Import vao 3ds Max (ticket 1 lan, host khong co cookie).
// Web chi gui slug/ticket; duong dan file nam o server (catalog.files), khong bao gio lo ra ngoai.
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from './auth.js';
import { pool } from './db.js';
import { requireJson } from './security.js';

const TICKET_MINUTES = 5;
const sha = (s) => createHash('sha256').update(s).digest();

export function assetRouter(cat, srcDir) {
  const r = Router();

  function send(res, p) {
    const file = path.resolve(srcDir, cat.files.get(p.id));
    res.download(file, p.slug + path.extname(file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'FILE_MISSING' });
    });
  }

  // shortcut: dang nhap la duoc tai/import, chua kiem license. Thay bang check license khi lam A4 (thanh toan).
  r.get('/products/:slug/download', requireAuth, (req, res) => {
    const p = cat.bySlug.get(req.params.slug);
    return p ? send(res, p) : res.status(404).json({ error: 'NOT_FOUND' });
  });

  r.post('/products/:slug/import-ticket', requireJson, requireAuth, async (req, res, next) => {
    try {
      const p = cat.bySlug.get(req.params.slug);
      if (!p) return res.status(404).json({ error: 'NOT_FOUND' });
      const ticket = randomBytes(32).toString('base64url');
      await pool.query(
        `insert into import_tickets (id, user_id, product_id, expires_at)
         values ($1, $2, $3, now() + make_interval(mins => $4))`,
        [sha(ticket), req.user.id, p.id, TICKET_MINUTES]);
      res.json({ assetId: p.id, ticket });
    } catch (e) { next(e); }
  });

  // Host goi. Danh dau da dung trong cung 1 cau lenh: 2 request trung ticket chi 1 cai thang.
  r.get('/downloads/stream/:ticket', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `update import_tickets set used_at = now()
         where id = $1 and used_at is null and expires_at > now() returning product_id`,
        [sha(req.params.ticket)]);
      const p = rows[0] && cat.products.find((x) => x.id === rows[0].product_id);
      return p ? send(res, p) : res.status(404).json({ error: 'TICKET_INVALID' });
    } catch (e) { next(e); }
  });

  return r;
}
