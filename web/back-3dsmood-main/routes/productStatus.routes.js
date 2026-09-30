const router = require("express").Router();
const mongoose = require("mongoose");
const verifyToken = require("../middlewares/verifyToken");
const User = require("../models/Users"); // chỉnh đường dẫn nếu khác

// Helper: stringify ObjectId
const idStr = (v) => String(v);

// ✅ Single product status: purchased? in cart? in which collections?
router.get("/products/:id/status", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { id } = req.params; // product _id dạng 24-hex string

    if (!userId) return res.status(401).json({ ok: false, message: "UNAUTHORIZED" });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "INVALID_PRODUCT_ID" });
    }

    const user = await User.findById(userId)
      .select("purchased.productId cart.productId collections._id collections.name collections.items")
      .lean();

    if (!user) return res.status(404).json({ ok: false, message: "USER_NOT_FOUND" });

    const pid = id; // already string 24-hex

    const purchased = Array.isArray(user.purchased)
      ? user.purchased.some((p) => idStr(p.productId) === pid)
      : false;

    const inCart = Array.isArray(user.cart)
      ? user.cart.some((c) => idStr(c.productId) === pid)
      : false;

    const inCollections = Array.isArray(user.collections)
      ? user.collections
          .filter((col) => Array.isArray(col.items) && col.items.some((itm) => idStr(itm) === pid))
          .map((col) => ({ id: col._id, name: col.name }))
      : [];

    return res.json({ ok: true, status: { purchased, inCart, inCollections } });
  } catch (err) {
    console.error("/products/:id/status error:", err);
    return res.status(500).json({ ok: false, message: "SERVER_ERROR" });
  }
});

// ✅ Batch status for multiple products: /api/products/status?ids=1,2,3
router.get("/products/status", verifyToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ ok: false, message: "UNAUTHORIZED" });

    const raw = req.query.ids || ""; // comma separated
    const ids = Array.from(new Set(String(raw).split(",").map((s) => s.trim()).filter(Boolean)));
    if (!ids.length) return res.status(400).json({ ok: false, message: "NO_IDS" });

    // Filter hợp lệ để so sánh với ObjectId -> Chuẩn là 24-hex
    const validIds = ids.filter((x) => mongoose.Types.ObjectId.isValid(x));

    const user = await User.findById(userId)
      .select("purchased.productId cart.productId collections._id collections.name collections.items")
      .lean();

    if (!user) return res.status(404).json({ ok: false, message: "USER_NOT_FOUND" });

    const purchasedSet = new Set((user.purchased || []).map((p) => idStr(p.productId)));
    const cartSet = new Set((user.cart || []).map((c) => idStr(c.productId)));

    // Map productId -> [collectionInfo]
    const colMap = new Map();
    for (const col of user.collections || []) {
      for (const itm of col.items || []) {
        const key = idStr(itm);
        if (!colMap.has(key)) colMap.set(key, []);
        colMap.get(key).push({ id: col._id, name: col.name });
      }
    }

    const statuses = {};
    for (const pid of validIds) {
      statuses[pid] = {
        purchased: purchasedSet.has(pid),
        inCart: cartSet.has(pid),
        inCollections: colMap.get(pid) || [],
      };
    }

    return res.json({ ok: true, statuses });
  } catch (err) {
    console.error("/products/status batch error:", err);
    return res.status(500).json({ ok: false, message: "SERVER_ERROR" });
  }
});

module.exports = router;
