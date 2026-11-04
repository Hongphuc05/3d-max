// D29: khoa ghep cap anh <-> file nen = ten file da chuan hoa, KHONG phu thuoc thu muc.
// Bo khoang trang cuoi va moi duoi anh/nen lap lai ("x .jpg", "x.rar.rar"), gom khoang trang, NFC, chu thuong.
export const IMAGE = /\.(jpe?g|png|webp)$/i;
export const ARCHIVE = /\.(zip|rar|7z)$/i;
const TAIL = /(\s*\.(jpe?g|png|webp|rar|zip|7z))+\s*$/i;

/** Ten hien thi (giu hoa/thuong). */
export const displayName = (filename) => String(filename).normalize('NFC').replace(TAIL, '').replace(/\s+/g, ' ').trim();
export const normalizeStem = (filename) => displayName(filename).toLowerCase();

/** "A/B/C" -> ['A','B','C']; null neu rong, qua sau, ky tu dieu khien, '.'/'..' hoac qua dai. */
export function parseCategoryPath(raw, { maxDepth = 6 } = {}) {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('/').map((p) => p.normalize('NFC').replace(/\s+/g, ' ').trim());
  if (!parts.length || parts.length > maxDepth) return null;
  if (parts.some((p) => !p || p.length > 200 || p === '.' || p === '..' || /[\u0000-\u001f\u007f\\]/.test(p))) return null;
  return parts;
}
