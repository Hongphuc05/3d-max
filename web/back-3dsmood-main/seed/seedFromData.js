// seed/seedFromData.js
// Chen data mau tu thu muc <repo>/Data vao Mongo LOCAL de preview. Chay: node seed/seedFromData.js
// Cau truc: Data/<Category>/<Subcategory>/<stem>.jpg + <stem>.(zip|rar|7z)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");

const URI = "mongodb://localhost:27017/3dsmood"; // co y hard-code: khong bao gio seed vao DB remote
const DATA = path.resolve(__dirname, "../../../Data");
const OUT = path.resolve(__dirname, "../uploads/sample");
const TAR = path.join(process.env.SystemRoot || "C:\Windows", "System32", "tar.exe");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ARCH = /\.(zip|rar|7z)$/i;
const IMG = /\.(jpe?g|png)$/i;
const MODEL = /\.(max|fbx|obj)$/i;

// ponytail: tar.exe doc duoc zip/rar, khong doc 7z -> 7z chi lay ten file, khong co danh sach noi dung
function listArchive(file) {
  try {
    return execFileSync(TAR, ["-tf", file], { encoding: "utf8", maxBuffer: 1 << 26 }).split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}

(async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  fs.mkdirSync(OUT, { recursive: true });
  const root = await Category.findOne({ name: /^3dmodel$/i, parent: null });
  if (!root) throw new Error("Chua co category goc 3dmodel — chay seedCategories truoc");
  await Product.deleteMany({ customId: /^sample-/ }); // chay lai an toan

  let n = 0, order = 0;
  for (const cat of fs.readdirSync(DATA, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    let catDoc = await Category.findOne({ parent: root._id, name: new RegExp(`^${cat.name}$`, "i") });
    if (!catDoc) catDoc = await Category.create({ name: cat.name, parent: root._id });
    const catDir = path.join(DATA, cat.name);
    for (const sub of fs.readdirSync(catDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const subs = await Category.find({ parent: catDoc._id });
      let subDoc = subs.find((c) => norm(c.name) === norm(sub.name));
      if (!subDoc) subDoc = await Category.create({ name: sub.name, parent: catDoc._id });
      // gom file theo stem (bo khoang trang thua truoc duoi file)
      const groups = {};
      for (const f of fs.readdirSync(path.join(catDir, sub.name))) {
        const ext = path.extname(f), stem = path.basename(f, ext).trim();
        const g = (groups[stem] ||= {});
        if (IMG.test(f)) g.img = f; else if (ARCH.test(f)) g.arch = f;
      }
      let i = 0;
      for (const [stem, g] of Object.entries(groups)) {
        i++;
        const entries = g.arch ? listArchive(path.join(catDir, sub.name, g.arch)) : [];
        const models = entries.filter((e) => MODEL.test(e));
        const base = models.length ? path.basename(models[0], path.extname(models[0])) : null;
        const formats = [...new Set(models.map((m) => path.extname(m).slice(1).toUpperCase()))];
        let preview = null, modelFilePath = null;
        if (g.arch) {
          const adest = `${norm(cat.name)}-${norm(sub.name)}-${norm(stem)}${path.extname(g.arch).toLowerCase()}`;
          const src = path.join(catDir, sub.name, g.arch), dst = path.join(OUT, adest);
          fs.rmSync(dst, { force: true });
          try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); } // hardlink: Data/ ~4GB, khong nhan doi dung luong
          modelFilePath = `sample/${adest}`; // tuong doi so voi uploads/ (LOCAL_STORAGE_DIR) -> route download doc duoc
        }
        if (g.img) {
          const dest = `${norm(cat.name)}-${norm(sub.name)}-${norm(stem)}${path.extname(g.img).toLowerCase()}`;
          fs.copyFileSync(path.join(catDir, sub.name, g.img), path.join(OUT, dest));
          preview = `/uploads/sample/${dest}`;
        }
        await Product.create({
          name: base || `${sub.name} ${String(i).padStart(2, "0")}`,
          description: `${cat.name} / ${sub.name}.${formats.length ? ` Formats: ${formats.join(", ")}.` : ""}${g.arch ? ` Package: ${g.arch} (${entries.length} files).` : ""}`,
          customId: `sample-${stem}`,
          price: i % 3 === 0 ? 0 : 50000, // mau: tron free/paid de xem UI
          order: order++,
          categoryIds: [root._id, catDoc._id, subDoc._id],
          modelKey: `sample/${g.arch || stem}`, // placeholder, chua co file tren Wasabi
          previewImagePath: preview,
          modelFilePath,
          displayhome: n < 12,
        });
        n++;
      }
    }
  }
  console.log(`Seeded ${n} products`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
