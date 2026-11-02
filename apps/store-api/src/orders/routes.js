// P5.2 (plan §2.6): don hang cua khach. Guard gan TUNG route; duong dan khac roi xuong router phia sau.
//   POST /api/v1/orders · GET /api/v1/orders/:id · POST /api/v1/orders/:id/claim-paid · POST /api/v1/orders/:id/cancel
import express from 'express';
import { requestId, v3ErrorHandler } from '../drive/errors.js';
import { bad, UUID } from '../catalog-admin/shared.js';
import { requireDevice } from '../devices/routes.js';

const MAX_ITEMS = 20;
// Gia/tong tien client gui van duoc CHAP NHAN nhung bi bo qua (plan §2.6); moi khoa khac bi tu choi.
const onlyKeys = (obj, allowed) => { if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some((k) => !allowed.includes(k))) throw bad(); return obj; };

function parseModelIds(body) {
  onlyKeys(body, ['items', 'amountVnd']);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) throw bad();
  const ids = body.items.map((item) => {
    onlyKeys(item, ['modelId', 'priceVnd']);
    if (typeof item.modelId !== 'string' || !UUID.test(item.modelId)) throw bad();
    return item.modelId.toLowerCase();
  });
  if (new Set(ids).size !== ids.length) throw bad();
  return ids;
}

export function createOrderRouter({ pool, service, notifier, rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : [])];

  router.post('/orders', ...pre, requireDevice(pool), async (req, res) => {
    res.status(201).json(await service.createOrder(req.device.id, parseModelIds(req.body)));
  });

  router.get('/orders/:id', ...pre, requireDevice(pool), async (req, res) => {
    res.json(await service.getOrder(req.device.id, req.params.id));
  });

  router.post('/orders/:id/claim-paid', ...pre, requireDevice(pool), async (req, res) => {
    await service.claimPaid(req.device.id, req.params.id);
    // Thong bao chu la tac dung phu: loi (Telegram sap, chua cau hinh) KHONG duoc lam hong don cua khach; ghi lai de van hanh biet.
    try {
      if (!notifier) throw new Error('owner notifications are not configured');
      await notifier.orderClaimed(await service.summary(req.params.id));
    } catch (e) { await service.recordNotifyFailure(req.params.id, e?.message ?? 'unknown').catch(() => {}); }
    res.json({ status: 'AWAITING_OWNER' });
  });

  router.post('/orders/:id/cancel', ...pre, requireDevice(pool), async (req, res) => {
    await service.cancelOrder(req.device.id, req.params.id);
    res.json({ status: 'CANCELLED' });
  });

  router.use(v3ErrorHandler);
  return router;
}

