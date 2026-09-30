// routes/forms.js
const express = require("express");
const router = express.Router();
const Form = require("../models/Form");

// GET /api/forms
router.get("/", async (req, res) => {
  try {
    const forms = await Form.find({});
    res.json(forms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Lỗi lấy danh sách form" });
  }
});

module.exports = router;
