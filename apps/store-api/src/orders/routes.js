// P5.2 (plan §2.6): don hang cua khach. Guard gan TUNG route; duong dan khac roi xuong router phia sau.
//   POST /api/v1/orders · GET /api/v1/orders/:id · POST /api/v1/orders/:id/claim-paid · POST /api/v1/orders/:id/cancel
import express from 'express';
import { requestId, v3ErrorHandler } from '../drive/errors.js';
import { requireDevice } from '../devices/routes.js';

export function createOrderRouter({ pool, service, notifier, rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : [])];

  router.post('/orders', ...pre, requireDevice(pool), async (req, res) => {
    res.status(201).json(await service.createOrder(req.device.id)); // D28.1: don la cua ca thu vien, khong co danh sach model
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

