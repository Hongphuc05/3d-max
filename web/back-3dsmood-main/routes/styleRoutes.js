// routes/styleRoutes.js
const express = require("express");
const router = express.Router();
const Style = require("../models/Style");

// GET /api/styles
router.get("/", async (req, res) => {
  try {
    const styles = await Style.find().sort({ createdAt: -1 });
    res.json(styles);
  } catch (error) {
    console.error("Error fetching styles:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
