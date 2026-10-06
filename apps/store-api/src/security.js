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

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_LARGE' });
  console.error('[error]', err.message); // khong tra stack/chi tiet ra ngoai
  res.status(500).json({ error: 'INTERNAL' });
}
