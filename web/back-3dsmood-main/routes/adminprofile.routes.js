// routes/uploads.routes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Tạo thư mục lưu nếu chưa có
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");
const AVATAR_DIR = path.join(UPLOAD_ROOT, "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Cấu hình Multer lưu file vào /uploads/avatars
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  }
});
const fileFilter = (req, file, cb) => {
  const ok = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
  cb(ok ? null : new Error("Chỉ cho phép ảnh PNG/JPG/JPEG/WEBP/GIF"), ok);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// POST /api/uploads/avatar (multipart/form-data, field: file)
router.post("/avatar", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Không có file." });
    // URL tương đối để FE build thành ${API}/${url}
    const url = `uploads/avatars/${req.file.filename}`;
    return res.json({ url });
  } catch (err) {
    console.error("upload avatar error:", err);
    return res.status(500).json({ message: "Tải ảnh thất bại." });
  }
});

module.exports = router;
