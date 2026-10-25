// Chong CSRF: cookie SameSite=Lax + kiem Origin voi request ghi (POST/PUT/PATCH/DELETE) + chi nhan JSON.
const allowed = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
);

// Trinh duyet luon gui Origin cho request ghi. Khong co Origin (curl, server-to-server) thi cho qua:
// ke tan cong cross-site khong lam duoc dieu do voi cookie cua nan nhan.
export function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o && !allowed.has(o)) return res.status(403).json({ error: 'BAD_ORIGIN' });
  next();
}

export function requireJson(req, res, next) {
  return req.is('application/json') ? next() : res.status(415).json({ error: 'JSON_REQUIRED' });
}

// Coarse, bounded single-process ingress protection; licensing also uses DB quotas.
export function rateLimit({ limit = 120, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of buckets) if (entry.until <= now) buckets.delete(key);
    const key = req.ip || 'unknown';
    const old = buckets.get(key);
    if ((old && old.hits >= limit) || (!old && buckets.size >= 10000)) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    }
    buckets.set(key, { hits: (old?.hits || 0) + 1, until: old?.until || now + windowMs });
    next();
  };
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_LARGE' });
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 600 && /^[A-Z][A-Z0-9_]{1,80}$/.test(err.code || '')) {
    return res.status(err.status).json({ error: err.code });
  }
  // Provider/SQL exceptions can include credentials or request payloads. Log only a classification.
  console.error('[error]', /^[A-Z0-9_]{2,40}$/.test(err.code || '') ? err.code : 'INTERNAL');
  res.status(500).json({ error: 'INTERNAL' });
}
