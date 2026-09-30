// routes/product.detail.routes.js
const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// Nên set ENV này để trả về URL ảnh đầy đủ, ví dụ: http://localhost:5000
// ASSET_BASE_URL mặc định là chuỗi rỗng => trả về path tương đối "/uploads/..."
const ASSET_BASE = process.env.ASSET_BASE_URL || "";

// Chuẩn hoá URL ảnh local
function buildUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * GET /api/products/:id
 * -> Trả chi tiết sản phẩm + danh sách ảnh từ product.images (đã chuẩn hoá URL)
 */
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const doc = await Product.findById(id)
      .populate("styles", "name")
      .populate("materials", "name")
      .populate("color", "name code")
      .populate("form", "name image")
      .populate("categoryIds", "name")
      .lean();

    if (!doc) return res.status(404).json({ message: "Product not found" });

    // Chuẩn hoá mảng images (ưu tiên isCover, sau đó theo order, rồi index)
    let images = Array.isArray(doc.images) ? doc.images.slice() : [];

    // Fallback từ previewImagePath (legacy) nếu chưa có images
    if (images.length === 0 && doc.previewImagePath) {
      images = [
        {
          path: doc.previewImagePath.startsWith("/")
            ? doc.previewImagePath
            : `/${doc.previewImagePath}`,
          alt: doc.name || "",
          isCover: true,
          order: 0,
        },
      ];
    }

    const imagesNormalized = images
      .map((img, idx) => ({
        url: buildUrl(img.path),
        alt: img.alt || doc.name || "",
        isCover: !!img.isCover,
        width: img.width ?? null,
        height: img.height ?? null,
        size: img.size ?? null,
        order: typeof img.order === "number" ? img.order : idx,
      }))
      .sort((a, b) => {
        // Cover trước, rồi theo order tăng dần
        if (a.isCover && !b.isCover) return -1;
        if (!a.isCover && b.isCover) return 1;
        return a.order - b.order;
      });

    const cover =
      imagesNormalized.find((i) => i.isCover) || imagesNormalized[0] || null;

    // Trả về DTO phù hợp front-end
    const payload = {
      id: String(doc._id),
      name: doc.name,
      description: doc.description || "",
      price: doc.price || 0,

      categories: (doc.categoryIds || []).map((c) => ({
        id: String(c._id),
        name: c.name,
      })),
      styles: (doc.styles || []).map((s) => ({
        id: String(s._id),
        name: s.name,
      })),
      materials: (doc.materials || []).map((m) => ({
        id: String(m._id),
        name: m.name,
      })),
      color: (doc.color || []).map((c) => ({
        id: String(c._id),
        name: c.name,
        code: c.code,
      })),
      form: (doc.form || []).map((f) => ({
        id: String(f._id),
        name: f.name,
        image: f.image ? buildUrl(f.image) : null,
      })),

      // Thông tin model 3D (tuỳ bạn hiển thị)
      modelSize: doc.modelSize ?? null,
      modelContentType: doc.modelContentType ?? null,
      modelUploadedAt: doc.modelUploadedAt ?? null,
      customId: doc.customId,
      // Ảnh chi tiết cho slider
      images: imagesNormalized, // <-- front-end dùng mảng này cho slider
      cover,   
      render: doc.render,
      lighting:doc.lighting,
      cameraType: doc.cameraType,           // Ảnh cover nhanh
    };

    return res.json(payload);
  } catch (err) {
    console.error("GET /api/products/:id error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

/**
 * GET /api/products/:id/similar?limit=12
 * -> Trả danh sách sản phẩm tương tự (cùng category hoặc cùng style nếu không có category)
 *    Format gọn: { id, name, price, image } để feed vào grid "SMILAR PRODUCT"
 */
router.get("/:id/similar", async (req, res) => {
  try {
    const id = req.params.id;
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    const base = await Product.findById(id).select("categoryIds styles").lean();
    if (!base) return res.status(404).json({ message: "Product not found" });

    const query = { _id: { $ne: id } };
    if (base.categoryIds?.length) {
      query.categoryIds = { $in: base.categoryIds };
    } else if (base.styles?.length) {
      query.styles = { $in: base.styles };
    }

    const docs = await Product.find(query)
      .limit(limit)
      .select("name price images previewImagePath")
      .lean();

    const items = docs.map((d) => {
      // Lấy cover
      let coverPath = null;
      if (Array.isArray(d.images) && d.images.length) {
        const c = d.images.find((i) => i.isCover) || d.images[0];
        coverPath = c?.path || null;
      } else if (d.previewImagePath) {
        coverPath = d.previewImagePath;
      }
      return {
        id: String(d._id),
        name: d.name,
        price: d.price || 0,
        image: coverPath ? buildUrl(coverPath) : null,
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error("GET /api/products/:id/similar error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
