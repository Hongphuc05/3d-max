// Cau hinh tai model tu bien moi truong. Loi chi neu TEN bien (khong bao gio in gia tri).
import path from 'node:path';

const DEFAULT_STORAGE = path.resolve(import.meta.dirname, '../../../../storage');
const GIB = 1024 ** 3;

export function loadDownloadConfig(env = process.env) {
  const errors = [];
  const int = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = /^\d+$/.test(String(raw)) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(n) || n < min || n > max) { errors.push(name); return fallback; }
    return n;
  };
  return {
    cacheDir: path.resolve(env.MODEL_CACHE_DIR || path.join(env.STORAGE_DIR || DEFAULT_STORAGE, 'model-cache')),
    maxBytes: int('MODEL_CACHE_MAX_BYTES', 20 * GIB, { min: 1 }),
    minFreeBytes: int('MODEL_CACHE_MIN_FREE_BYTES', 2 * GIB),
    maxFileBytes: int('MODEL_MAX_FILE_BYTES', 4 * GIB, { min: 1 }),     // plugin cung gioi han 4 GB
    sessionsPerHour: int('DOWNLOAD_SESSIONS_PER_HOUR', 120, { min: 1, max: 1000 }),
    maxConcurrent: int('DOWNLOAD_MAX_CONCURRENT', 3, { min: 1, max: 64 }),
    errors,
  };
}
