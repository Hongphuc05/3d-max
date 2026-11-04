// GET /api/admin/overview, GET /api/admin/health, POST /api/admin/health/telegram-test. Guard gan tung route (nhu cac router admin khac).
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';

export function createOverviewRouter({ service, guards = [], rateLimit, now = () => Date.now() }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];
  let lastTest = 0; // ponytail: 1 tien trinh; nhieu instance thi chuyen sang DB
  router.get('/overview', ...pre, async (_req, res) => res.json(await service.overview()));
  router.get('/health', ...pre, async (_req, res) => res.json(await service.health()));
  router.post('/health/telegram-test', ...pre, async (_req, res) => {
    if (now() - lastTest < 10_000) throw apiError('RATE_LIMITED');
    lastTest = now();
    res.json(await service.telegramTest());
  });
  router.use(v3ErrorHandler);
  return router;
}
