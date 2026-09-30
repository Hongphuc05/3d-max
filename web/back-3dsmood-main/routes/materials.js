// routes/materials.js
const express = require("express");
const router = express.Router();
const Material = require("../models/Material");

router.get("/", async (req, res) => {
  try {
    const materials = await Material.find().sort({ name: 1 }); // sắp xếp theo tên
    res.json(materials);
  } catch (error) {
    res.status(500).json({ message: "Lỗi server khi lấy materials" });
  }
});

module.exports = router;
