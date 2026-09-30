const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const BgFile = require("../models/BgFile");

// Helper: pick
function pick(obj, fields = []) {
  return fields.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
}

// Bảo đảm thư mục upload tồn tại
const UPLOAD_DIR = path.join(__dirname, "../uploads/bg");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Cấu hình multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext)
      .toString()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "file";
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${base}-${unique}${ext}`);
  },
});
const upload = multer({ storage });

// -----------------
// LIST
// GET /api/bg-files
// query: q, activeNow=1, status=0|1, page=1, limit=20, sort=createdAt:desc
router.get("/", async (req, res) => {
  try {
    const {
      q = "",
      activeNow,
      status,
      page = 1,
      limit = 20,
      sort = "createdAt:desc",
    } = req.query;

    const where = {};
    if (q) where.name = { $regex: q, $options: "i" };
    if (status === "0" || status === "1") where.status = status === "1";

    if (String(activeNow) === "1") {
      const now = new Date();
      where.$and = [
        { $or: [{ activeFrom: { $exists: false } }, { activeFrom: null }, { activeFrom: { $lte: now } }] },
        { $or: [{ activeTo: { $exists: false } }, { activeTo: null }, { activeTo: { $gte: now } }] },
        { status: true },
      ];
    }

    // parse sort: "createdAt:desc,name:asc"
    const sortObj = {};
    String(sort).split(",").map(s=>s.trim()).filter(Boolean).forEach(pair=>{
      const [k, dir] = pair.split(":");
      sortObj[k] = dir === "asc" ? 1 : -1;
    });

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));

    const [items, total] = await Promise.all([
      BgFile.find(where).sort(sortObj).skip((p - 1) * l).limit(l),
      BgFile.countDocuments(where),
    ]);

    res.json({ items, total, page: p, limit: l });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// -----------------
// READ
// GET /api/bg-files/:id
router.get("/:id", async (req, res) => {
  try {
    const item = await BgFile.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// -----------------
// CREATE (UPLOAD FILE)
// POST /api/bg-files (multipart/form-data)
// fields: file, name, activeFrom, activeTo, status
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });

    const { name, activeFrom, activeTo, status } = req.body;
    const filePath = "/uploads/bg/" + req.file.filename;

    const created = await BgFile.create({
      name: name?.trim(),
      filePath,
      activeFrom: activeFrom ? new Date(activeFrom) : null,
      activeTo: activeTo ? new Date(activeTo) : null,
      status: status !== undefined ? String(status) !== "0" && String(status) !== "false" : true,
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// -----------------
// UPDATE (OPTIONAL RE-UPLOAD)
// PUT /api/bg-files/:id (multipart/form-data)
// fields: (optional file), name, activeFrom, activeTo, status
router.put("/:id", upload.single("file"), async (req, res) => {
  try {
    const item = await BgFile.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    // cập nhật metadata
    const { name, activeFrom, activeTo, status } = req.body;
    if (name !== undefined) item.name = name.trim();
    if (activeFrom !== undefined) item.activeFrom = activeFrom ? new Date(activeFrom) : null;
    if (activeTo !== undefined) item.activeTo = activeTo ? new Date(activeTo) : null;
    if (status !== undefined) item.status = !(String(status) === "0" || String(status) === "false");

    // nếu có file mới, thay thế path (tuỳ chọn: xoá file cũ)
    if (req.file) {
      const newPath = "/uploads/bg/" + req.file.filename;
      // Xoá file cũ an toàn (nếu muốn)
      try {
        if (item.filePath && item.filePath.startsWith("/uploads/bg/")) {
          const oldFsPath = path.join(__dirname, "..", item.filePath);
          fs.unlink(oldFsPath, () => {});
        }
      } catch {}
      item.filePath = newPath;
    }

    await item.save();
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// -----------------
// TOGGLE STATUS
// PATCH /api/bg-files/:id/toggle
router.patch("/:id/toggle", async (req, res) => {
  try {
    const item = await BgFile.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    item.status = !item.status;
    await item.save();
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// -----------------
// DELETE
// DELETE /api/bg-files/:id
router.delete("/:id", async (req, res) => {
  try {
    const item = await BgFile.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });

    // tuỳ chọn: xoá file trên đĩa
    try {
      if (item.filePath && item.filePath.startsWith("/uploads/bg/")) {
        const oldFsPath = path.join(__dirname, "..", item.filePath);
        fs.unlink(oldFsPath, () => {});
      }
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

module.exports = router;