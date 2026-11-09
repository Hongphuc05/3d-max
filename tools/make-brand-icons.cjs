// Generates the 3dsMood brand icon files from the icon part of LOGO-W.svg (red rounded square with a white "M").
// Run: node tools/make-brand-icons.cjs <path-to-LOGO-W.svg>
// Outputs (committed, so builds never need this script):
//   apps/store-web/public/favicon.svg, favicon.ico          website favicon
//   plugin-csharp/MaxWebViewHost/MaxWebViewHost/Resources/3dsmood.ico   plugin window icon (embedded in the DLL)
//   installer/mzp/icons/3dsmood_{16,24}{i,a}.bmp            3ds Max macro/toolbar icon (image + alpha mask)
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');
const sharp = createRequire(path.join(root, 'apps/store-api/package.json'))('sharp'); // already a dependency of the API

const source = fs.readFileSync(process.argv[2], 'utf8');
// Only the "Rounded_Rectangle_1" and "M" paths sit inside the viewBox; the rest of the file is the word mark placed off-canvas.
const pathOf = (id) => { const m = source.match(new RegExp('id="' + id + '"[^>]*\\sd="([^"]+)"')); if (!m) throw new Error('path not found: ' + id); return m[1].replace(/\s+/g, ' '); };
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 31.9 32" role="img" aria-label="3dsMood"><path fill="#8F120D" fill-rule="evenodd" d="${pathOf('Rounded_Rectangle_1')}"/><path fill="#FFFFFF" fill-rule="evenodd" d="${pathOf('M')}"/></svg>`;
const write = (rel, data) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); console.log('wrote', rel, data.length + ' bytes'); };

const rgba = (size) => sharp(Buffer.from(svg), { density: 72 * Math.max(1, Math.ceil(size / 32) * 4) }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const png = (size) => sharp(Buffer.from(svg), { density: 72 * Math.max(1, Math.ceil(size / 32) * 4) }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// ICO with PNG-compressed images (Windows Vista+ and every browser).
function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length; const entries = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16); e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length; entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

// Uncompressed 24-bit BMP (bottom-up, rows padded to 4 bytes). pixel(x,y) -> [r,g,b]
function bmp24(size, pixel) {
  const stride = Math.ceil((size * 3) / 4) * 4; const out = Buffer.alloc(54 + stride * size);
  out.write('BM'); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10); out.writeUInt32LE(40, 14);
  out.writeInt32LE(size, 18); out.writeInt32LE(size, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(stride * size, 34);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = pixel(x, y); const o = 54 + (size - 1 - y) * stride + x * 3; out[o] = b; out[o + 1] = g; out[o + 2] = r;
  }
  return out;
}

(async () => {
  write('apps/store-web/public/favicon.svg', Buffer.from(svg));
  write('apps/store-web/public/favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })))));
  write('plugin-csharp/MaxWebViewHost/MaxWebViewHost/Resources/3dsmood.ico', ico(await Promise.all([16, 24, 32, 48, 64, 256].map(async (size) => ({ size, data: await png(size) })))));
  for (const size of [16, 24]) {
    const { data } = await rgba(size); const at = (x, y) => (y * size + x) * 4;
    // "i" = colors (black where fully transparent), "a" = alpha mask as grey (white = opaque). The macro icon is a single image (index 1).
    write(`installer/mzp/icons/3dsmood_${size}i.bmp`, bmp24(size, (x, y) => [data[at(x, y)], data[at(x, y) + 1], data[at(x, y) + 2]]));
    write(`installer/mzp/icons/3dsmood_${size}a.bmp`, bmp24(size, (x, y) => { const a = data[at(x, y) + 3]; return [a, a, a]; }));
  }
})();
