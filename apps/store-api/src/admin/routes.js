import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { rateLimit, requireJson } from '../security.js';
import { updateAdminAccount } from './account.js';

// Chi con doi tai khoan admin (ten dang nhap/mat khau). Danh sach/thong ke nam o cac router v3 (drive, catalog-admin, orders).
export function adminRouter() {
  const router = Router();
  router.patch('/account', requireAuth, rateLimit({ limit: 20 }), requireJson, updateAdminAccount);
  return router;
}
