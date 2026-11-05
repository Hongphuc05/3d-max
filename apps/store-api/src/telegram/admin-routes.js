import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTelegramAdminRouter({ config, accounts, linking, client, guards = [], rateLimit }) {
  const router = express.Router();
  const pre = [requestId, ...(rateLimit ? [rateLimit] : []), ...guards];

  router.get('/connections', ...pre, async (req, res) => {
    res.json({ canConnect: Boolean(config.enabled && client && linking),
      ownerChatIdsCount: config.ownerChatIds?.length ?? 0, accounts: await accounts.listForAdmin(req.user.id) });
  });

  router.post('/connections/authorize', ...pre, async (req, res) => {
    if (!config.enabled || !client || !linking) throw apiError('TELEGRAM_BOT_NOT_READY');
    if ((await accounts.listForAdmin(req.user.id)).length) throw apiError('TELEGRAM_ADMIN_ALREADY_CONNECTED');
    const bot = await client.getMe();
    if (!/^[A-Za-z0-9_]{5,32}$/.test(bot.username ?? '')) throw apiError('TELEGRAM_BOT_NOT_READY');
    const token = await linking.createAttempt(req.user.id);
    const url = new URL(`https://t.me/${bot.username}`);
    url.searchParams.set('start', token);
    res.redirect(303, url.href);
  });

  router.delete('/connections/:id', ...pre, async (req, res) => {
    if (!UUID.test(req.params.id)) throw apiError('TELEGRAM_CONNECTION_NOT_FOUND');
    res.json(await accounts.revoke(req.user.id, req.params.id));
  });

  router.use(v3ErrorHandler);
  return router;
}
