// routes/product3dmodel.routes.js
const router = require("express").Router();

const verifyToken = require("../middlewares/verifyToken");
const { requireRole } = require("../middlewares/authMiddleware");

const {
  createProduct3D,
  updateProduct3D,
  getFilters,
  listProducts3D,
  getProductsGeneric,
  getProductById,
  incrementViewCount,
  Owned,
  get3DCategoryTree,
  getTopPurchased,
} = require("../controllers/product3dmodel.controller");

// ===== Order matters: cụ thể trước, động sau =====

// Create (giữ nguyên: yêu cầu admin)
router.post("/", createProduct3D);

router.post("/:id/view", incrementViewCount);
router.post("/owned", verifyToken, Owned);

// Update (giữ nguyên hành vi như bản bạn gửi: không ép middleware, nếu muốn bảo vệ thêm thì thêm verifyToken + requireRole("admin"))
router.put("/:id", updateProduct3D);

// Filters
router.get("/filters", getFilters);

// List với filter/sort/paginate (chỉ trong cây 3dmodel)
router.get("/list", listProducts3D);

// Generic list (vẫn ép cây 3dmodel)
router.get("/", getProductsGeneric);
router.get("/top-purchased", getTopPurchased);

// Detail (đặt sau cùng để không chạm /filters, /list)
router.get("/:id", getProductById);
router.get("/tree-3d", get3DCategoryTree);
// routes/products.js
const mongoose = require("mongoose");
const Product = require("../models/Product");

// Utils
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const toObjectIdArray = (csv) =>
  String(csv || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => isValidObjectId(x))
    .map((x) => new mongoose.Types.ObjectId(x));

// ============================
// PATCH /api/products/reorder (bulk)
// body: { pairs: [{ id, order }, ...] }
// ============================
// PATCH /api/products/reorder
router.patch("/reorder", verifyToken, async (req, res) => {
  try {
    const { pairs } = req.body || {};
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ ok: false, message: "pairs rỗng" });
    }

    // ✅ Lấy order lớn nhất hiện tại để làm trần
    const maxDoc = await Product.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
    const ceiling = (Number(maxDoc?.order) || 0); // nếu chưa có, mặc định 1

    const products = await Product.find().sort({ order: 1, createdAt: 1, _id: 1});

    const bulk = products.map((p, index) => ({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { order: index } }
      }
    }));

    await Product.bulkWrite(bulk);

    if (!bulk.length) {
      return res.status(400).json({ ok: false, message: "Không có bản ghi hợp lệ" });
    }

    await Product.bulkWrite(bulk, { ordered: false });
    res.json({ ok: true, updated: bulk.length, ceiling });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || "Reorder thất bại" });
  }
});

// Route drag and drop cập nhật thứ tự từng item (nếu muốn, có thể bỏ để chỉ dùng bulk reorder phía trên)
router.patch("/reorder-drag", verifyToken, async (req, res) => {
  try {
    const { id, from, to } = req.body;

    if (!id || from == null || to == null) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu dữ liệu",
      });
    }

    if (from === to) {
      return res.json({ ok: true });
    }

    // 🟢 kéo xuống
    if (from < to) {
      await Product.updateMany(
        {
          order: { $gt: from, $lte: to },
        },
        {
          $inc: { order: -1 },
        }
      );
    }

    // 🔵 kéo lên
    if (from > to) {
      await Product.updateMany(
        {
          order: { $gte: to, $lt: from },
        },
        {
          $inc: { order: 1 },
        }
      );
    }

    // 🔴 update item chính
    await Product.updateOne(
      { _id: id },
      { $set: { order: to } }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("reorder-drag error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Reorder thất bại",
    });
  }
});

// ============================================
// PATCH /api/products/:id/order (single update)
// body: { order: number }
// ============================================
router.patch("/products/:id/order", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: "ID không hợp lệ" });
    }
    const order = Number(req.body?.order) || 0;

    const doc = await Product.findByIdAndUpdate(
      id,
      { $set: { order } },
      { new: true, projection: { _id: 1, order: 1 } }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, message: "Không tìm thấy sản phẩm" });
    res.json({ ok: true, item: doc });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || "Cập nhật thứ tự thất bại" });
  }
});

// ============================================
// GET /api/products/list
// Hỗ trợ: q, minPrice, maxPrice, colors, forms, styles, materials,
//         categories, displayhome, sort, page, limit
// ============================================
// router.get("/products/list", async (req, res) => {
//   try {
//     const {
//       q,
//       minPrice,
//       maxPrice,
//       colors,       // comma ids → field: color
//       forms,        // comma ids → field: form
//       styles,       // comma ids
//       materials,    // comma ids
//       categories,   // comma ids → field: categoryIds
//       displayhome,  // "", "1", "0"
//       sort = "newest",
//       page = 1,
//       limit = 50,
//     } = req.query;

//     const filter = {};

//     // Text search
//     if (q && String(q).trim()) {
//       // Ưu tiên $text nếu có index text; nếu không, fallback regex name/description
//       filter.$or = [
//         { $text: { $search: String(q).trim() } },
//         { name: new RegExp(String(q).trim(), "i") },
//         { description: new RegExp(String(q).trim(), "i") },
//         { render: new RegExp(String(q).trim(), "i") },
//         { lighting: new RegExp(String(q).trim(), "i") },
//         { cameraType: new RegExp(String(q).trim(), "i") },
//         // tìm theo _id/slug/customId nếu người dùng nhập id thô
//       ];
//     }

//     // Price range
//     const minP = Number(minPrice);
//     const maxP = Number(maxPrice);
//     if (!Number.isNaN(minP) || !Number.isNaN(maxP)) {
//       filter.price = {};
//       if (!Number.isNaN(minP)) filter.price.$gte = minP;
//       if (!Number.isNaN(maxP)) filter.price.$lte = maxP;
//     }

//     // Colors
//     if (colors) {
//       const ids = toObjectIdArray(colors);
//       if (ids.length) filter.color = { $in: ids };
//     }
//     // Forms
//     if (forms) {
//       const ids = toObjectIdArray(forms);
//       if (ids.length) filter.form = { $in: ids };
//     }
//     // Styles
//     if (styles) {
//       const ids = toObjectIdArray(styles);
//       if (ids.length) filter.styles = { $in: ids };
//     }
//     // Materials
//     if (materials) {
//       const ids = toObjectIdArray(materials);
//       if (ids.length) filter.materials = { $in: ids };
//     }
//     // Categories
//     if (categories) {
//       const ids = toObjectIdArray(categories);
//       if (ids.length) filter.categoryIds = { $in: ids };
//     }

//     // Display home
//     if (displayhome === "1") filter.displayhome = true;
//     if (displayhome === "0") filter.displayhome = false;

//     // Pagination
//     const pg = Math.max(1, parseInt(page) || 1);
//     const lim = Math.min(100, Math.max(1, parseInt(limit) || 50));
//     const skip = (pg - 1) * lim;

//     // Sort options
//     let sortOpt;
//     switch (sort) {
//       case "manual":
//         sortOpt = { order: 1, createdAt: -1, _id: -1 };
//         break;
//       case "oldest":
//         sortOpt = { createdAt: 1, _id: 1 };
//         break;
//       case "price_asc":
//         sortOpt = { price: 1, _id: 1 };
//         break;
//       case "price_desc":
//         sortOpt = { price: -1, _id: -1 };
//         break;
//       case "name_asc":
//         sortOpt = { name: 1, _id: 1 };
//         break;
//       case "name_desc":
//         sortOpt = { name: -1, _id: -1 };
//         break;
//       default: // "newest"
//         sortOpt = { createdAt: -1, _id: -1 };
//     }

//     // Query
//     const [items, total] = await Promise.all([
//       Product.find(filter)
//         .sort(sortOpt)
//         .skip(skip)
//         .limit(lim)
//         .lean(),
//       Product.countDocuments(filter),
//     ]);

//     const pages = Math.max(1, Math.ceil(total / lim));

//     // Trả về giống format admin đang sử dụng
//     res.json({ ok: true, items, total, pages, page: pg, limit: lim });
//   } catch (e) {
//     res.status(500).json({ ok: false, message: e.message || "Lỗi list" });
//   }
// });



module.exports = router;
