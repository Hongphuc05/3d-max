// routes/colorRoutes.js
const express = require("express");
const router = express.Router();
const Color = require("../models/Color");

// GET /api/colors - Lấy tất cả màu
router.get("/", async (req, res) => {
  try {
    const colors = await Color.find().sort({ code: 1 }); // sắp xếp theo code
    res.json(colors);
  } catch (err) {
    res.status(500).json({ error: "Lỗi khi lấy danh sách colors" });
  }
});

module.exports = router;
