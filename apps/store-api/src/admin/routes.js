import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { rateLimit, requireJson } from '../security.js';
import { requireAdmin } from './access.js';
import { updateAdminAccount } from './account.js';
import { overview, listUsers, userDetail, listOrders, listAudit } from './repository.js';

export function adminRouter(catalog) {
  const router = Router();
  router.use(requireAuth);
  // A bootstrap administrator can change credentials before gaining access to data.
  router.patch('/account', rateLimit({ limit: 20 }), requireJson, updateAdminAccount);
  router.use(['/overview', '/users', '/legacy-orders', '/audit'], requireAdmin, rateLimit({ limit: 120 }));
  router.get('/overview', async (_req, res) => res.json(await overview(catalog)));
  router.get('/users', async (req, res) => res.json(await listUsers(req.query)));
  router.get('/users/:id', async (req, res) => res.json(await userDetail(req.params.id)));
  router.get('/legacy-orders', async (req, res) => res.json(await listOrders(req.query)));
  router.get('/audit', async (req, res) => res.json(await listAudit(req.query)));
  return router;
}
