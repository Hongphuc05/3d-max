import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTelegramAdminRouter({ config, accounts, login, guards = [], rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];

  router.get('/connections', ...pre, async (req, res) => {
    res.json({ loginConfigured: Boolean(config.loginConfigured), loginErrors: config.loginErrors ?? [],
      ownerChatIdsCount: config.ownerChatIds?.length ?? 0, accounts: await accounts.listForAdmin(req.user.id) });
  });

  router.post('/connections/authorize', ...pre, async (req, res) => {
    if (!config.loginConfigured || !login) throw apiError('TELEGRAM_LOGIN_NOT_CONFIGURED');
    res.redirect(302, await login.createAttempt(req.user.id));
  });

  router.delete('/connections/:id', ...pre, async (req, res) => {
    if (!UUID.test(req.params.id)) throw apiError('TELEGRAM_CONNECTION_NOT_FOUND');
    res.json(await accounts.revoke(req.user.id, req.params.id));
  });

  router.use(v3ErrorHandler);
  return router;
}
