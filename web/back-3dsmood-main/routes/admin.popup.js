const express = require('express');
const path = require('path');
const fs = require('fs');
const PopupConfig = require('../models/PopupConfig');
const { uploadBanner } = require('../utils/uploader');
const verifyToken = require('../middlewares/verifyToken');

const router = express.Router();

// GET current config (admin)
// GET /api/admin/home-popup
router.get('/api/admin/home-popup', verifyToken, async (req, res) => {
  try {
    const cfg = await PopupConfig.getSingleton();
    res.json(cfg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load popup config' });
  }
});

// Update config (admin)
// PUT /api/admin/home-popup (multipart/form-data)
router.put(
  '/api/admin/home-popup',
  verifyToken,
  uploadBanner.single('image'),
  async (req, res) => {
    try {
      const cfg = await PopupConfig.getSingleton();
      const body = req.body || {};

      if (typeof body.enabled !== 'undefined') cfg.enabled = body.enabled === 'true' || body.enabled === true;
      if (typeof body.title === 'string') cfg.title = body.title.trim();
      if (typeof body.href === 'string') cfg.href = body.href.trim();
      if (typeof body.widthPx !== 'undefined') cfg.widthPx = Number(body.widthPx) || cfg.widthPx;
      if (typeof body.devices === 'string') cfg.devices = body.devices;
      if (typeof body.startAt === 'string' && body.startAt) cfg.startAt = new Date(body.startAt);
      if (typeof body.endAt === 'string' && body.endAt) cfg.endAt = new Date(body.endAt);

      // Image handling: uploaded file OR external imageUrl
      if (req.file) {
        const publicPath = `/uploads/banners/${req.file.filename}`;
        if (cfg.image && cfg.image.startsWith('/uploads/banners/')) {
          const oldAbs = path.join(process.cwd(), cfg.image.replace(/^\/+/, ''));
          fs.promises.unlink(oldAbs).catch(() => {});
        }
        cfg.image = publicPath;
      } else if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) {
        cfg.image = body.imageUrl.trim();
      }

      cfg.updatedBy = req.user?._id;
      await cfg.save();
      res.json({ ok: true, config: cfg });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update popup config' });
    }
  }
);

module.exports = router;