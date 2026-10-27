import { readFileSync, existsSync, statSync, lstatSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const safePath = value => typeof value === 'string' && value.length <= 500 && !/[\\%?#:]/.test(value) && value.split('/').every(p =>
  p && p !== '.' && p !== '..' && !/[\x00-\x1f<>"|*]/.test(p) && !/[. ]$/.test(p)
  && !/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(p.split('.')[0]));
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
export function validateCatalog(catalog, { previewExists } = {}) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.items) || catalog.items.length > 10000) throw new Error('Expected version 1 and items array (maximum 10000).');
  const ids = new Set();
  for (const item of catalog.items) {
    if (!item || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(item.id ?? '') || ids.has(item.id.toLowerCase())) throw new Error('Invalid or duplicate model ID.');
    ids.add(item.id.toLowerCase());
    if (!text(item.name) || !text(item.category)) throw new Error(`${item.id}: name/category required, maximum 200 characters.`);
    if (!safePath(item.preview) || !/\.(png|jpe?g|webp)$/i.test(item.preview)) throw new Error(`${item.id}: preview must be a relative raster image path.`);
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(item.driveFileId ?? '') || /REPLACE|PLACEHOLDER/i.test(item.driveFileId)) throw new Error(`${item.id}: supply the real Drive file ID.`);
    if (!safePath(item.fileName) || item.fileName.includes('/') || item.fileName.length > 200 || !/\.(zip|rar|7z|max|fbx|obj)$/i.test(item.fileName)) throw new Error(`${item.id}: invalid model/archive fileName.`);
    if (!/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error(`${item.id}: SHA-256 must be 64 lowercase hexadecimal characters.`);
    if (item.entryFile != null && (!safePath(item.entryFile) || !/\.(max|fbx|obj)$/i.test(item.entryFile))) throw new Error(`${item.id}: invalid entryFile.`);
    if (previewExists && !previewExists(item.preview)) throw new Error(`${item.id}: preview file missing, unsafe, or too large.`);
  }
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalogPath = resolve(process.argv[2] ?? 'library/public/catalog.json');
  const root = dirname(catalogPath);
  const catalog = validateCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')), { previewExists: preview => {
    const path = resolve(root, preview);
    if (!path.startsWith(root + sep) || !existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile() || statSync(path).size > 2 * 1024 * 1024) return false;
    const data = readFileSync(path);
    const lower = preview.toLowerCase();
    if (lower.endsWith('.png')) return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (lower.endsWith('.webp')) return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    return data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  } });
  console.log(`Validated ${catalog.items.length} models: ${catalogPath}`);
}
