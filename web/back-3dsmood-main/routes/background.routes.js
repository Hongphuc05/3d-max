const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Background = require("../models/Background");

// === Multer upload setup ===
const uploadDir = path.join(__dirname, "..", "uploads", "backgrounds");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, "bg-" + Date.now() + ext.toLowerCase());
  },
});

const upload = multer({ storage });

// Helper: build absolute URL
function absoluteUrl(req, relPath) {
  if (!relPath) return null;
  const base = `${req.protocol}://${req.get("host")}`;
  return relPath.startsWith("http") ? relPath : base + relPath;
}

// === LIST === GET /api/backgrounds
router.get("/", async (req, res) => {
  try {
    const docs = await Background.find().sort({ order: 1, createdAt: -1 });
    const result = docs.map((d) => ({
      ...d.toObject(),
      imageUrlAbs: absoluteUrl(req, d.imageUrl),
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// === CREATE === POST /api/backgrounds
// form-data: image (file), startAt (ISO|""), endAt (ISO|""), isActive (true/false), order (number)
router.post("/", upload.single("image"), async (req, res) => {
  try {
    let imageUrl = req.body.imageUrl;
    if (req.file) imageUrl = "/uploads/backgrounds/" + req.file.filename;
    if (!imageUrl) return res.status(400).json({ message: "image hoặc imageUrl là bắt buộc" });

    const payload = {
      imageUrl,
      startAt: req.body.startAt ? new Date(req.body.startAt) : null,
      endAt: req.body.endAt ? new Date(req.body.endAt) : null,
      isActive: req.body.isActive === "false" ? false : true,
      order: isNaN(Number(req.body.order)) ? 0 : Number(req.body.order),
    };

    const doc = await Background.create(payload);
    res.status(201).json({ ...doc.toObject(), imageUrlAbs: absoluteUrl(req, doc.imageUrl) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// === UPDATE === PUT /api/backgrounds/:id
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Background.findById(id);
    if (!doc) return res.status(404).json({ message: "Not found" });

    // Nếu upload file mới -> thay đường dẫn
    if (req.file) {
      // xóa file cũ (nếu là file nội bộ)
      if (doc.imageUrl && doc.imageUrl.startsWith("/uploads/")) {
        const abs = path.join(__dirname, "..", doc.imageUrl);
        fs.existsSync(abs) && fs.unlinkSync(abs);
      }
      doc.imageUrl = "/uploads/backgrounds/" + req.file.filename;
    } else if (typeof req.body.imageUrl === "string" && req.body.imageUrl.trim()) {
      doc.imageUrl = req.body.imageUrl.trim();
    }

    if ("startAt" in req.body) doc.startAt = req.body.startAt ? new Date(req.body.startAt) : null;
    if ("endAt" in req.body) doc.endAt = req.body.endAt ? new Date(req.body.endAt) : null;
    if ("isActive" in req.body) doc.isActive = req.body.isActive === "false" ? false : true;
    if ("order" in req.body && !isNaN(Number(req.body.order))) doc.order = Number(req.body.order);

    await doc.save();
    res.json({ ...doc.toObject(), imageUrlAbs: absoluteUrl(req, doc.imageUrl) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// === DELETE === DELETE /api/backgrounds/:id
router.delete("/:id", async (req, res) => {
  try {
    const doc = await Background.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Not found" });
    // xóa file nội bộ
    if (doc.imageUrl && doc.imageUrl.startsWith("/uploads/")) {
      const abs = path.join(__dirname, "..", doc.imageUrl);
      fs.existsSync(abs) && fs.unlinkSync(abs);
    }
    await doc.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// === RESOLVE === GET /api/backgrounds/resolve?now=ISO_OPTIONAL
// Trả về 1 ảnh thỏa điều kiện: isActive=true và trong [startAt, endAt] (nếu set), sắp xếp theo order ASC, createdAt DESC
router.get("/resolve", async (req, res) => {
  try {
    const now = req.query.now ? new Date(req.query.now) : new Date();

    const candidates = await Background.find({ isActive: true }).sort({ order: 1, createdAt: -1 });

    const pick = candidates.find((d) => {
      const sOk = !d.startAt || d.startAt <= now;
      const eOk = !d.endAt || d.endAt >= now;
      return sOk && eOk;
    }) || candidates[0];

    if (!pick) return res.json(null);

    res.json({
      ...pick.toObject(),
      imageUrlAbs: absoluteUrl(req, pick.imageUrl),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
