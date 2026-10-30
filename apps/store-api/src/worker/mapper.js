// Ghep anh voi file model trong MOT thu muc Drive. Ham thuan: khong I/O, ket qua khong phu thuoc thu tu dau vao.
// Quy tac: docs/v3-architecture.md §6.2. Mo ho -> dua vao review, KHONG doan.
//   L1  thu muc phang: <ten>.jpg + <ten>.rar (ten ban: "A .jpg" + "Arar.rar" van ghep)
//   L2  thu muc rieng cho 1 model: model.max + preview*.jpg (ten model = ten thu muc, danh muc = thu muc cha)
const IMAGE = /\.(jpe?g|png|webp)$/i;
const ARCHIVE = /\.(zip|rar|7z)$/i;
const RAW = /\.(max|fbx|obj)$/i;
const PREVIEW_LIKE = /^(preview|thumb|thumbnail|cover|image|img)/i;

const typeOf = (name) => name.match(/\.([^.]+)$/)[1].toLowerCase();
const stem = (name) => name.replace(/\.[^.]+$/, '');
const display = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const norm = (s) => display(s).toLowerCase();
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const entry = (f) => ({ id: f.id, name: f.name, size: f.size ?? null, md5: f.md5 ?? null });
const modelFile = (f) => ({ ...entry(f), type: typeOf(f.name) });
const review = (kind, path, files) => ({ kind, path, files: files.map((x) => x.name).sort() });

// Ten ban hay dinh duoi file nen vao ten ("Arar.rar"): thu ca ten day du lan ten da bo duoi do.
const keysOf = (f) => {
  const full = norm(stem(f.name));
  const keys = [full];
  if (ARCHIVE.test(f.name)) { const stripped = full.replace(/(rar|zip|7z)$/, '').trim(); if (stripped && stripped !== full) keys.push(stripped); }
  return keys;
};

export function mapFolder({ path = '', files }) {
  const images = [], models = [], skipped = [];
  for (const f of [...files].sort(byName)) {
    if (typeof f?.name !== 'string') continue;
    if (IMAGE.test(f.name)) images.push(f);
    else if (ARCHIVE.test(f.name) || RAW.test(f.name)) models.push(f);
    else skipped.push(f.name);
  }

  const imagesByKey = new Map();
  for (const img of images) { const k = norm(stem(img.name)); (imagesByKey.get(k) ?? imagesByKey.set(k, []).get(k)).push(img); }
  const groups = new Map(); // key -> { images, models: [{ file, viaStrip }] }
  for (const m of models) {
    const keys = keysOf(m);
    const key = keys.find((k) => imagesByKey.has(k));
    if (key === undefined) continue;
    if (!groups.has(key)) groups.set(key, { images: imagesByKey.get(key), models: [] });
    groups.get(key).models.push({ file: m, viaStrip: key !== keys[0] });
  }

  const out = { models: [], reviews: [], skipped };
  const usedImages = new Set(), usedModels = new Set();
  let ambiguous = false;
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key);
    const all = [...g.images, ...g.models.map((x) => x.file)];
    all.forEach((x) => (RAW.test(x.name) || ARCHIVE.test(x.name) ? usedModels : usedImages).add(x));
    if (g.models.length === 1 && g.images.length === 1) {
      const { file, viaStrip } = g.models[0];
      const base = display(stem(file.name));
      out.models.push({
        layout: 'L1', categoryPath: path, suggested: false,
        name: viaStrip ? base.replace(/(rar|zip|7z)$/i, '').trim() || base : base,
        file: modelFile(file), images: [{ ...entry(g.images[0]), primary: true }],
      });
    } else { ambiguous = true; out.reviews.push(review('AMBIGUOUS_PAIR', path, all)); }
  }

  const freeImages = images.filter((x) => !usedImages.has(x));
  const freeModels = models.filter((x) => !usedModels.has(x));
  const paired = out.models.length > 0;

  if (!paired && !ambiguous && freeModels.length === 1 && freeImages.length >= 1
      && (freeImages.length >= 2 || freeImages.some((i) => PREVIEW_LIKE.test(stem(i.name))))) {
    const parts = path.split('/').filter(Boolean);
    out.models.push({
      layout: 'L2', suggested: false, categoryPath: parts.slice(0, -1).join('/'),
      name: parts.length ? parts[parts.length - 1] : display(stem(freeModels[0].name)),
      file: modelFile(freeModels[0]), images: freeImages.map((x, i) => ({ ...entry(x), primary: i === 0 })),
    });
  } else if (!ambiguous && freeImages.length === 1 && freeModels.length === 1) {
    // Sot lai dung 1 anh + 1 file model: goi y ghep (admin xac nhan mot lan), khong tu cong bo.
    out.models.push({
      layout: 'L1', suggested: true, categoryPath: path, name: display(stem(freeModels[0].name)),
      file: modelFile(freeModels[0]), images: [{ ...entry(freeImages[0]), primary: true }],
    });
    out.reviews.push(review('SUGGESTED_PAIR', path, [freeImages[0], freeModels[0]]));
  } else {
    for (const x of freeImages) out.reviews.push(review('ORPHAN_IMAGE', path, [x]));
    for (const x of freeModels) out.reviews.push(review('ORPHAN_MODEL', path, [x]));
  }

  out.models.sort((a, b) => byName(a.file, b.file));
  return out;
}
