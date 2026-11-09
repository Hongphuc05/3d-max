// GET /api/v1/plugin/latest: cong khai (goi mzp cung cong khai tai /download/), plugin so sanh voi ban dang chay.
import express from 'express';
import { apiError, requestId, v3ErrorHandler } from '../drive/errors.js';

export function createPluginReleaseRouter({ latest, rateLimit = (_q, _s, next) => next() }) {
  const router = express.Router();
  router.get('/plugin/latest', requestId, rateLimit, async (req, res, next) => {
    try {
      const release = await latest();
      if (!release) return next(apiError('PLUGIN_RELEASE_NOT_FOUND'));
      res.json(release);
    } catch (e) { next(e); }
  });
  router.use(v3ErrorHandler);
  return router;
}
