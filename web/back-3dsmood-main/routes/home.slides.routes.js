const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const mime = require('mime-types');

const HomeSlide = require('../models/HomeSlide');
const verifyToken = require('../middlewares/verifyToken'); // bạn đã có sẵn

// ========================= Local upload config =========================
const UPLOAD_ROOT = process.env.SLIDES_UPLOAD_ROOT || path.join(process.cwd(), 'uploads'); // public
const SLIDES_DIR = process.env.SLIDES_UPLOAD_DIR || path.join(UPLOAD_ROOT, 'home-slides'); // physical folder
const PUBLIC_PREFIX = '/uploads'; // phải khớp với app.use('/uploads', express.static(...))

fs.mkdirSync(SLIDES_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SLIDES_DIR),
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname) || 'bin';
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext.replace(/^\./, '')}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function isHttpUrl(s) { return /^https?:\/\//i.test(String(s || '')); }

function publicPathFromFilename(filename) {
  return `${PUBLIC_PREFIX}/home-slides/${filename}`.replace(/\\/g, '/');
}
function localPathFromPublic(pth) {
  if (!pth || typeof pth !== 'string') return null;
  if (!pth.startsWith(`${PUBLIC_PREFIX}/`)) return null;
  const rel = pth.replace(`${PUBLIC_PREFIX}/`, '');
  return path.join(UPLOAD_ROOT, rel);
}
async function safeUnlink(localPath) {
  if (!localPath) return;
  try { await fsp.unlink(localPath); } catch (_) {}
}

// ========================= Routes =========================

// PUBLIC: list slides cho Home (lọc enabled/device/time)
router.get('/', async (req, res) => {
  try {
    const { enabled, device } = req.query;
    const now = new Date();
    const q = {};

    if (typeof enabled !== 'undefined') {
      q.enabled = enabled === 'true' || enabled === true;
    } else {
      q.enabled = true;
    }

    if (device === 'mobile') q.devices = { $in: ['all', 'mobile'] };
    else if (device === 'desktop') q.devices = { $in: ['all', 'desktop'] };

    q.$and = [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }, { startAt: { $exists: false } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }, { endAt: { $exists: false } }] },
    ];

    const items = await HomeSlide.find(q).sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ADMIN: list tất cả
router.get('/admin', verifyToken, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      HomeSlide.find({}).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      HomeSlide.countDocuments({}),
    ]);

    res.json({ items, total, page, limit });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ADMIN: create (multipart hoặc JSON)
router.post('/', verifyToken, upload.single('file'), async (req, res) => {
  try {
    const { title, href, enabled, devices, sortOrder, startAt, endAt, imageUrl } = req.body;

    let imagePath = imageUrl && imageUrl.trim();

    if (req.file) {
      const pub = publicPathFromFilename(req.file.filename);
      imagePath = pub; // lưu public path tương đối: '/uploads/home-slides/xxx.jpg'
    }

    if (!imagePath) return res.status(400).json({ ok: false, message: 'Missing image (file or imageUrl)' });

    const doc = await HomeSlide.create({
      title: title?.trim(),
      href: href?.trim() || '#',
      imagePath,
      enabled: String(enabled) === 'false' ? false : true,
      devices: ['all', 'desktop', 'mobile'].includes(devices) ? devices : 'all',
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
    });

    res.json({ ok: true, item: doc });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ADMIN: update (có thể thay ảnh)
router.put('/:id', verifyToken, upload.single('file'), async (req, res) => {
  try {
    const doc = await HomeSlide.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: 'Not found' });

    const { title, href, enabled, devices, sortOrder, startAt, endAt, imageUrl } = req.body;
    let newImagePath = doc.imagePath;

    if (req.file) {
      // có file mới => xoá file cũ nếu là nội bộ
      if (!isHttpUrl(doc.imagePath)) {
        const local = localPathFromPublic(doc.imagePath);
        await safeUnlink(local);
      }
      newImagePath = publicPathFromFilename(req.file.filename);
    } else if (typeof imageUrl === 'string' && imageUrl.trim()) {
      // đổi sang external URL => xoá cũ nếu cũ là nội bộ
      if (!isHttpUrl(doc.imagePath)) {
        const local = localPathFromPublic(doc.imagePath);
        await safeUnlink(local);
      }
      newImagePath = imageUrl.trim();
    }

    doc.title = typeof title === 'string' ? title.trim() : doc.title;
    doc.href = typeof href === 'string' ? href.trim() : doc.href;
    doc.enabled = typeof enabled === 'undefined' ? doc.enabled : !(String(enabled) === 'false');
    doc.devices = ['all', 'desktop', 'mobile'].includes(devices) ? devices : doc.devices;
    doc.sortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : doc.sortOrder;
    doc.startAt = startAt ? new Date(startAt) : doc.startAt;
    doc.endAt = endAt ? new Date(endAt) : doc.endAt;
    doc.imagePath = newImagePath;

    await doc.save();
    res.json({ ok: true, item: doc });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ADMIN: delete
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const doc = await HomeSlide.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: 'Not found' });

    if (!isHttpUrl(doc.imagePath)) {
      const local = localPathFromPublic(doc.imagePath);
      await safeUnlink(local);
    }
    await doc.deleteOne();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
