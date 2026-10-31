// Cau hinh worker tu bien moi truong. Loi chi neu TEN bien: gia tri (nhat la API key) khong bao gio duoc in ra.
import path from 'node:path';

const API_KEY = /^[A-Za-z0-9_-]{20,256}$/;
const DEFAULT_STORAGE = path.resolve(import.meta.dirname, '../../../../storage');

const nonNegativeInt = (raw, fallback) => (raw === undefined || raw === '' ? fallback : /^\d+$/.test(String(raw)) ? Number(raw) : NaN);

export function loadWorkerConfig(env = process.env) {
  const errors = [];
  const apiKey = API_KEY.test(env.DRIVE_API_KEY ?? '') ? env.DRIVE_API_KEY : undefined;
  if (!apiKey) errors.push('DRIVE_API_KEY');
  const minFreeDiskBytes = nonNegativeInt(env.MIN_FREE_DISK_BYTES, 2 * 1024 ** 3);
  if (!Number.isSafeInteger(minFreeDiskBytes)) errors.push('MIN_FREE_DISK_BYTES');
  const previewDelayMs = nonNegativeInt(env.PREVIEW_DELAY_MS, 1500);
  if (!Number.isSafeInteger(previewDelayMs)) errors.push('PREVIEW_DELAY_MS');
  const previewConcurrency = nonNegativeInt(env.PREVIEW_CONCURRENCY, 1);
  if (!Number.isSafeInteger(previewConcurrency) || previewConcurrency < 1) errors.push('PREVIEW_CONCURRENCY');
  const defaultPriceVnd = nonNegativeInt(env.DEFAULT_MODEL_PRICE_VND, 15000);
  if (!Number.isSafeInteger(defaultPriceVnd)) errors.push('DEFAULT_MODEL_PRICE_VND');
  const previewDir = path.resolve(env.PREVIEW_DIR || path.join(env.STORAGE_DIR || DEFAULT_STORAGE, 'previews-v3'));
  return { apiKey, previewDir, minFreeDiskBytes, defaultPriceVnd, previewDelayMs, previewConcurrency, errors };
}
