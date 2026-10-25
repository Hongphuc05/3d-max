import { Router } from 'express';
import { paymentError } from './validation.js';

const pass = (_req, _res, next) => next();
const authenticated = (req, _res, next) => req.user?.id ? next() : next(paymentError('UNAUTHENTICATED', 401));
function emptyBody(req, _res, next) {
  if (!req.is('application/json') || !req.body || Array.isArray(req.body) || Object.keys(req.body).length) {
    return next(paymentError('INVALID_REQUEST', 400));
  }
  next();
}

export function createPaymentRouter({ service, requireUser = authenticated, mutationGuard = pass, rateLimit = pass }) {
  const router = Router();
  router.get('/product', (_req, res) => res.json({ product: service.product() }));
  router.use(requireUser, authenticated);
  router.post('/create', mutationGuard, rateLimit, emptyBody, async (req, res) => res.json({ order: await service.create(req.user) }));
  router.get('/:orderId', async (req, res) => res.json({ order: await service.get(req.user.id, req.params.orderId) }));
  router.post('/:orderId/reconcile', mutationGuard, rateLimit, emptyBody,
    async (req, res) => res.json({ order: await service.reconcile(req.user.id, req.params.orderId) }));
  return router;
}

export function createPayosWebhookRouter({ service, rateLimit = pass }) {
  const router = Router();
  router.post('/', rateLimit, async (req, res) => {
    if (!req.is('application/json')) throw paymentError('INVALID_REQUEST', 400);
    res.json(await service.webhook(req.body));
  });
  return router;
}
