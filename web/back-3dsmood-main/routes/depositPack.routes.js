// routes/depositPack.routes.js
const router = require("express").Router();
const mongoose = require("mongoose");
const DepositPack = require("../models/DepositPack");
const verifyToken = require("../middlewares/verifyToken");

// Tuỳ hệ thống role, sửa tại đây cho khớp với dự án của bạn
function isAdmin(req, res, next) {
  try {
    const u = req.user || {};
    if (u.role === "admin" || u.isAdmin === true) return next();
    return res.status(403).json({ message: "Forbidden: Admin only" });
  } catch (e) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

/**
 * GET /api/deposit-packs
 * - Lấy danh sách gói.
 * Query:
 *  - active: "1"/"true" => chỉ lấy gói đang bật
 *  - limit, page
 *  - all: "1" => bỏ phân trang
 */
router.get("/", async (req, res) => {
  try {
    const {
      active,
      page = 1,
      limit = 50,
      all,
    } = req.query;

    const filter = {};
    if (String(active).toLowerCase() === "1" || String(active).toLowerCase() === "true") {
      filter.isActive = true;
    }

    const sort = { sortOrder: 1, amount: 1 };

    if (String(all) === "1") {
      const items = await DepositPack.find(filter).sort(sort).lean();
      return res.json({ items, total: items.length });
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.max(1, parseInt(limit, 10) || 50);

    const [items, total] = await Promise.all([
      DepositPack.find(filter)
        .sort(sort)
        .skip((p - 1) * l)
        .limit(l)
        .lean(),
      DepositPack.countDocuments(filter),
    ]);

    return res.json({
      items,
      pagination: {
        page: p,
        limit: l,
        total,
        pages: Math.ceil(total / l),
      },
    });
  } catch (err) {
    console.error("GET /deposit-packs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/deposit-packs/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });
    const doc = await DepositPack.findById(id).lean();
    if (!doc) return res.status(404).json({ message: "Not found" });
    return res.json(doc);
  } catch (err) {
    console.error("GET /deposit-packs/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/deposit-packs
 * - Tạo gói mới (Admin)
 * Body: { amount, discount, title?, note?, isActive?, sortOrder?, currency? }
 */
router.post("/", verifyToken, isAdmin, async (req, res) => {
  try {
    const payload = {
      amount: req.body.amount,
      discount: req.body.discount,
      title: req.body.title,
      note: req.body.note,
      isActive: req.body.isActive,
      sortOrder: req.body.sortOrder,
      currency: req.body.currency,
      metadata: req.body.metadata,
    };

    if (!payload.amount) {
      return res.status(400).json({ message: "amount is required" });
    }

    const doc = await DepositPack.create(payload);
    return res.status(201).json(doc.toJSON());
  } catch (err) {
    console.error("POST /deposit-packs error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PUT /api/deposit-packs/:id
 * - Cập nhật gói (Admin)
 */
router.put("/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const updates = {
      amount: req.body.amount,
      discount: req.body.discount,
      title: req.body.title,
      note: req.body.note,
      isActive: req.body.isActive,
      sortOrder: req.body.sortOrder,
      currency: req.body.currency,
      metadata: req.body.metadata,
    };

    const doc = await DepositPack.findByIdAndUpdate(id, updates, { new: true });
    if (!doc) return res.status(404).json({ message: "Not found" });

    return res.json(doc.toJSON());
  } catch (err) {
    console.error("PUT /deposit-packs/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/deposit-packs/:id/toggle
 * - Bật/tắt gói (Admin)
 * Body: { isActive: boolean }
 */
router.patch("/:id/toggle", verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const doc = await DepositPack.findByIdAndUpdate(id, { isActive: !!isActive }, { new: true });
    if (!doc) return res.status(404).json({ message: "Not found" });
    return res.json(doc.toJSON());
  } catch (err) {
    console.error("PATCH /deposit-packs/:id/toggle error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/deposit-packs/reorder
 * - Cập nhật thứ tự hàng loạt (Admin)
 * Body: { orders: [{ id, sortOrder }, ...] }
 */
router.patch("/reorder", verifyToken, isAdmin, async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || !orders.length) {
      return res.status(400).json({ message: "orders is required" });
    }

    const bulk = DepositPack.collection.initializeUnorderedBulkOp();
    for (const item of orders) {
      if (item.id && mongoose.isValidObjectId(item.id)) {
        bulk.find({ _id: new mongoose.Types.ObjectId(item.id) })
            .updateOne({ $set: { sortOrder: Math.round(Number(item.sortOrder) || 0) } });
      }
    }
    if (bulk.length === 0) return res.json({ matched: 0, modified: 0 });

    const result = await bulk.execute();
    return res.json({ ok: 1, result });
  } catch (err) {
    console.error("PATCH /deposit-packs/reorder error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * DELETE /api/deposit-packs/:id
 * - Xoá gói (Admin). Nếu không muốn xoá cứng, có thể chuyển sang toggle isActive=false
 * Query: ?hard=1 để xoá cứng, mặc định xoá mềm (set isActive=false)
 */
router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const hard = String(req.query.hard) === "1";
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    if (hard) {
      const del = await DepositPack.findByIdAndDelete(id);
      if (!del) return res.status(404).json({ message: "Not found" });
      return res.json({ ok: 1, deletedId: id });
    }

    const doc = await DepositPack.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!doc) return res.status(404).json({ message: "Not found" });
    return res.json(doc.toJSON());
  } catch (err) {
    console.error("DELETE /deposit-packs/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * (Tuỳ chọn) Seed nhanh trong môi trường dev:
 * GET /api/deposit-packs/seed
 */
router.get("/seed/dev", async (req, res) => {
  try {
    if (process.env.NODE_ENV && !/^dev|development$/i.test(process.env.NODE_ENV)) {
      return res.status(403).json({ message: "Seed chỉ bật ở môi trường development" });
    }

    const exists = await DepositPack.countDocuments();
    if (exists > 0) return res.json({ message: "Đã có dữ liệu, bỏ qua seed." });

    const demo = [
      { amount: 200000, discount: 0,  sortOrder: 1, title: "Gói 200K" },
      { amount: 400000, discount: 3,  sortOrder: 2, title: "Gói 400K" },
      { amount: 800000, discount: 5,  sortOrder: 3, title: "Gói 800K" },
      { amount: 1000000, discount: 10, sortOrder: 4, title: "Gói 1 Triệu" },
      { amount: 1500000, discount: 15, sortOrder: 5, title: "Gói 1.5 Triệu" },
    ];

    const docs = await DepositPack.insertMany(demo);
    return res.json({ ok: 1, inserted: docs.map(d => d.toJSON()) });
  } catch (err) {
    console.error("GET /deposit-packs/seed/dev error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
