const express = require('express');
const PopupConfig = require('../models/PopupConfig');
const router = express.Router();

// Public endpoint used by client to fetch popup config
// GET /api/home/popup
router.get('/api/home/popup', async (req, res) => {
  try {
    const cfg = await PopupConfig.getSingleton();
    const now = new Date();
    let enabled = cfg.enabled;
    if (cfg.startAt && now < cfg.startAt) enabled = false;
    if (cfg.endAt && now > cfg.endAt) enabled = false;

    res.json({
      enabled,
      title: cfg.title,
      href: cfg.href,
      image: cfg.image,
      widthPx: cfg.widthPx,
      devices: cfg.devices,
      startAt: cfg.startAt,
      endAt: cfg.endAt,
      updatedAt: cfg.updatedAt,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load popup config' });
  }
});

module.exports = router;