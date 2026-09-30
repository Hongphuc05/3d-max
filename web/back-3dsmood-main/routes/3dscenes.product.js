// routes/product.scenes.routes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");

// ===== Auth (thay bằng verifyToken/requireRole nếu bạn đã có) =====
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ message: "Unauthorized" });
  return next();
}

// ===== Multer: memoryStorage =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2000 * 1024 * 1024 }, // 200MB cho model
});

// ===== Controllers =====
const {
  listProductScenes,
  listProductScenesClient,
  getProductSceneById,
  createProductScene,
  updateProductScene,
  deleteProductScene,
} = require("../controllers/productScenes.controller");

// ====================================================================
// Routes mapping (giữ nguyên hành vi)
// ====================================================================

// List trong cây 3dscenes + search + filter
router.get("/", requireAuth, listProductScenes);

// Public list cho client (không yêu cầu auth)
router.get("/client", listProductScenesClient);

// Detail
router.get("/:id", requireAuth, getProductSceneById);

// Create (support: modelFile, previewImage, extraImage(s))
router.post(
  "/",
  requireAuth,
  upload.fields([
    { name: "previewImage", maxCount: 1 },
    { name: "extraImage", maxCount: 1 },
    { name: "extraImages", maxCount: 20 }, // nhiều ảnh phụ
  ]),
  createProductScene
);

// Update (text + categoryIds + styles + preview/extra)
router.patch(
  "/:id",
  requireAuth,
  upload.fields([
    { name: "previewImage", maxCount: 1 },
    { name: "extraImage", maxCount: 1 },
  ]),
  updateProductScene
);

// Delete
router.delete("/:id", requireAuth, deleteProductScene);

module.exports = router;
