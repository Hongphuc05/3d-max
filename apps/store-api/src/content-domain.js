import { apiError } from './drive/errors.js';
export const CONTENT_DOMAINS = ['3dmodels', '3dscenes'];
export function contentDomain(value = '3dmodels') {
  if (!CONTENT_DOMAINS.includes(value)) throw apiError('INVALID_PARAMS');
  return value;
}
export const previewUrl = (localPath, domain = '3dmodels') => `/previews/${localPath.includes('/') ? localPath : `${domain}/${localPath}`}`;
