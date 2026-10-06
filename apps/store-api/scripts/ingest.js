// Quet source/3DSMOOD -> storage/catalog.json + storage/previews/*.webp
// Chay lai nhieu lan: id = sha256 file nen, thumbnail da co thi bo qua.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);
// macOS/Linux: bsdtar. Windows 10+: tar.exe (cung libarchive). Chua verify RAR tren Windows.
const TAR = process.platform === 'win32' ? 'tar' : 'bsdtar';
const ROOT = path.resolve(import.meta.dirname, '../../..');
const SRC = process.env.SOURCE_DIR || path.join(ROOT, 'source/3DSMOOD');
const OUT = process.env.STORAGE_DIR || path.join(ROOT, 'storage');
const PRICE = 15000;
const IMG = /\.jpe?g$/i;
const ARC = /\.(rar|zip|7z)$/i;

const slugify = (s) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
const sha256 = (f) => new Promise((res, rej) => {
  const h = createHash('sha256');
  createReadStream(f).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')));
});

// Ghep anh voi file nen trong 1 thu muc con. Tra ve { pairs, orphans }.
export function pairFiles(files) {
  const key = (f) => path.parse(f).name.trim();
  const imgs = new Map(files.filter((f) => IMG.test(f)).map((f) => [key(f), f]));
  const arcs = files.filter((f) => ARC.test(f));
  const pairs = [], unmatchedArcs = [];
  for (const a of arcs) {
    const k = key(a);
    const hit = [k, k.replace(/(rar|zip|7z)$/i, '').trim()].find((c) => imgs.has(c));
    if (hit) { pairs.push({ img: imgs.get(hit), arc: a }); imgs.delete(hit); } else unmatchedArcs.push(a);
  }
  // con dung 1 anh + 1 file nen chua ghep -> ghep (2 cap lech hau to)
  if (imgs.size === 1 && unmatchedArcs.length === 1) {
    pairs.push({ img: [...imgs.values()][0], arc: unmatchedArcs[0] });
    imgs.clear(); unmatchedArcs.length = 0;
  }
  return { pairs, orphans: [...imgs.values(), ...unmatchedArcs] };
}

// Ten hien thi tu ten file .max ngan nhat, bo hau to renderer/version.
export function titleFromEntries(names) {
  const max = names.filter((n) => /\.max$/i.test(n)).map((n) => path.parse(n).name).sort((a, b) => a.length - b.length)[0];
  if (!max) return null;
  const t = max.replace(/([_\s-]+(vray|v-ray|corona|max\d*|fbx|obj|mat|20\d\d|\d{4}))+$/i, '').replace(/[_]+/g, ' ').trim();
  return t.length >= 3 ? t : null;
}

export function manifestFromEntries(names) {
  const lower = names.map((n) => n.toLowerCase());
  const has = (re) => lower.some((n) => re.test(n));
  const renderers = ['vray', 'corona'].filter((r) => has(new RegExp(r)));
  return {
    files: names.filter((n) => !n.endsWith('/')).length,
    max: names.filter((n) => /\.max$/i.test(n)),
    hasFbx: has(/\.fbx$/), hasObj: has(/\.obj$/), hasTextures: has(/\.(jpe?g|png|tga|tif)$/),
    renderers,
  };
}

async function thumbs(img, id) {
  const dir = path.join(OUT, 'previews');
  for (const [suffix, w] of [['sm', 480], ['lg', 1400]]) {
    const out = path.join(dir, `${id}-${suffix}.webp`);
    if (!existsSync(out)) await sharp(img).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
  }
}

async function ingestOne(category, sub, { img, arc }, report) {
  try {
    const [hash, st] = await Promise.all([sha256(arc), stat(arc)]);
    const id = hash.slice(0, 12);
    let names = [];
    try {
      names = (await run(TAR, ['-tf', arc], { maxBuffer: 64 << 20 })).stdout.split(/\r?\n/).filter(Boolean);
    } catch (e) { report.archiveErrors.push({ arc: path.relative(SRC, arc), error: String(e.stderr || e.message).split('\n').find((l) => /bsdtar|tar:/.test(l)) || 'bsdtar failed' }); }
    await thumbs(img, id);
    const title = titleFromEntries(names);
    return {
      id, category, subcategory: sub, title, price: PRICE, status: 'active',
      asset: { file: path.relative(SRC, arc), ext: path.extname(arc).toLowerCase(), size: st.size, sha256: hash, ...manifestFromEntries(names) },
    };
  } catch (e) {
    report.errors.push({ img: path.relative(SRC, img), error: e.message });
    return null;
  }
}

async function main() {
  await mkdir(path.join(OUT, 'previews'), { recursive: true });
  const report = { orphans: [], archiveErrors: [], errors: [], noMax: [] };
  const jobs = [];
  for (const cat of (await readdir(SRC, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    for (const sub of (await readdir(path.join(SRC, cat.name), { withFileTypes: true })).filter((d) => d.isDirectory())) {
      const dir = path.join(SRC, cat.name, sub.name);
      const files = (await readdir(dir)).filter((f) => !f.startsWith('.')).map((f) => path.join(dir, f));
      const { pairs, orphans } = pairFiles(files);
      orphans.forEach((o) => report.orphans.push(path.relative(SRC, o)));
      pairs.forEach((p) => jobs.push([cat.name, sub.name, p]));
    }
  }
  console.log(`${jobs.length} cap anh+file nen, ${report.orphans.length} orphan`);

  const results = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await ingestOne(...jobs[i], report);
      if (++done % 20 === 0) console.log(`  ${done}/${jobs.length}`);
    }
  }));

  // dat ten: title tu .max, trung/khong co thi "<Sub> NN" theo thu tu on dinh (sha256)
  const items = results.filter(Boolean).sort((a, b) => a.asset.sha256.localeCompare(b.asset.sha256));
  const counter = {}, seen = new Set();
  for (const p of items) {
    const n = (counter[p.subcategory] = (counter[p.subcategory] || 0) + 1);
    let name = p.title && !seen.has(p.title.toLowerCase()) ? p.title : `${p.subcategory} ${String(n).padStart(2, '0')}`;
    seen.add(name.toLowerCase());
    p.name = name; p.slug = `${slugify(name)}-${p.id}`; delete p.title;
    if (!p.asset.max.length) report.noMax.push(p.asset.file);
  }
  const bySub = (k) => (a, b) => a[k].localeCompare(b[k]);
  items.sort((a, b) => bySub('category')(a, b) || bySub('subcategory')(a, b) || bySub('name')(a, b));
  await writeFile(path.join(OUT, 'catalog.json'), JSON.stringify({ generatedAt: new Date().toISOString(), products: items }));
  await writeFile(path.join(OUT, 'ingest-report.json'), JSON.stringify(report, null, 2));
  console.log(`OK ${items.length} san pham -> ${path.join(OUT, 'catalog.json')}`);
  console.log(`report: orphans=${report.orphans.length} archiveErrors=${report.archiveErrors.length} errors=${report.errors.length} khongCoMax=${report.noMax.length}`);
}

if (process.argv[1] === import.meta.filename) main().catch((e) => { console.error(e); process.exit(1); });
