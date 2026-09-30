// routes/products.client.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Product  = require("../models/Product");
const Category = require("../models/Category");

/* =============== Helpers (inline) =============== */
function escRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Trả về Set<string> các ID danh mục leaf dưới 1 root:
 * - root = category name (parent=null), không phân biệt hoa/thường
 * - Cây: root -> level2 -> level3; leaf theo NHÁNH:
 *   + Nếu level2 có con level3 => leaf = các level3 đó
 *   + Nếu level2 KHÔNG có con  => leaf = chính level2 đó
 */
async function getLeafIdsUnderRootName(rootName) {
  const root = await Category.findOne({
    name: { $regex: new RegExp(`^${escRegex(String(rootName).trim())}$`, "i") },
    parent: null,
  }).select("_id").lean();

  if (!root) return new Set();

  const level2 = await Category.find({ parent: root._id })
    .select("_id")
    .lean();
  if (!level2.length) return new Set();

  const level2Ids = level2.map((c) => c._id.toString());

  const level3 = await Category.find({ parent: { $in: level2.map((c) => c._id) } })
    .select("_id parent")
    .lean();

  const childrenByL2 = new Map();
  for (const l2Id of level2Ids) childrenByL2.set(l2Id, []);
  for (const l3 of level3) {
    const p = l3.parent.toString();
    if (childrenByL2.has(p)) childrenByL2.get(p).push(l3._id.toString());
  }

  const leaf = [];
  for (const l2Id of level2Ids) {
    const kids = childrenByL2.get(l2Id);
    if (kids && kids.length) leaf.push(...kids);
    else leaf.push(l2Id);
  }

  return new Set(leaf);
}
/* ============ /Helpers (inline) ============ */

/**
 * GET /api/products/client
 * Query:
 *  - root | name: "3dscenes" | "3dmodel" (đọc 1 trong 2; nếu thiếu -> mặc định "3dscenes")
 *  - page, limit
 *  - search (text)
 *  - styles: CSV ObjectId (ANY)
 *  - priceType: "free" | "pro"
 *  - categories: CSV ObjectId (chỉ nhận id thuộc leaf dưới root)
 *  - sort: "newest" | "oldest" (bỏ qua khi có search -> ưu tiên textScore)
 *  - debug: "1" để trả kèm thông tin debug
 */
// routes/products.client.js
router.get("/client", async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 24)));
    const skip  = (page - 1) * limit;

    const rootName = String(req.query.root || req.query.name || "3dscenes")
      .trim()
      .toLowerCase();

    const underSet = await getLeafIdsUnderRootName(rootName);

    const wantDebug = String(req.query.debug) === "1";
    if (!underSet || underSet.size === 0) {
      return res.json({
        page, limit, total: 0, items: [],
        ...(wantDebug ? { debug: { root: rootName, leafCount: 0 } } : {}),
      });
    }

    const cond = {};
    const proj = {};
    let sort = { createdAt: -1 };

    // ⭐ Chỉ lấy item hiển thị Home nếu gọi qua alias /api/home
    const isHomeEndpoint = /\/api\/home$/i.test(req.baseUrl);
    if (isHomeEndpoint) {
      cond.displayhome = true;            // <-- nếu schema dùng "displayhome", đổi key cho đúng
    }

    // search
    const search = String(req.query.search || "").trim();
    if (search) {
      cond.$text = { $search: search };
      proj.score = { $meta: "textScore" };
      sort = { score: { $meta: "textScore" }, createdAt: -1 };
    }

    // styles (ANY)
    if (req.query.styles) {
      const list = String(req.query.styles)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const ids = list
        .filter(mongoose.Types.ObjectId.isValid)
        .map(mongoose.Types.ObjectId.createFromHexString);
      if (ids.length) cond.styles = { $in: ids };
    }

    // priceType
    const priceType = String(req.query.priceType || "");
    if (priceType === "free") cond.price = 0;
    if (priceType === "pro")  cond.price = { $gt: 0 };

    // categories (multi) – chỉ giữ id thuộc leaf dưới root
    if (req.query.categories) {
      const list = String(req.query.categories)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const chosen = list.filter(
        (id) => mongoose.Types.ObjectId.isValid(id) && underSet.has(id)
      );

      if (chosen.length === 0) {
        return res.json({
          page, limit, total: 0, items: [],
          ...(wantDebug ? {
            debug: {
              root: rootName,
              leafCount: underSet.size,
              filteredByCategories: true
            }
          } : {}),
        });
      }

      cond.categoryIds = {
        $in: chosen.map(mongoose.Types.ObjectId.createFromHexString),
      };
    } else {
      cond.categoryIds = {
        $in: [...underSet].map(mongoose.Types.ObjectId.createFromHexString),
      };
    }

    // sort (khi không search)
    const s = String(req.query.sort || "newest");
    if (!search) sort = s === "oldest" ? { createdAt: 1 } : { createdAt: -1 };

    const [items, total] = await Promise.all([
      Product.find(cond)
        .select({ ...proj, modelKey: 0, modelEtag: 0 })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(cond),
    ]);

    res.json({
      page, limit, total, items,
      ...(wantDebug ? {
        debug: {
          root: rootName,
          leafCount: underSet.size,
          usedCond: cond,                  // ⭐ sẽ thấy displayHome: true khi gọi /api/home
          baseUrl: req.baseUrl
        }
      } : {}),
    });
  } catch (e) {
    console.error("List product-client error:", e);
    res.status(500).json({ message: e.message || "Lỗi server" });
  }
});


module.exports = router;

/**
 * Gợi ý mount trong server.js:
 *   const productsClientRoutes = require("./routes/products.client");
 *   app.use("/api/products", productsClientRoutes);
 *   app.use("/api/home",     productsClientRoutes); // alias để FE cũ /api/home/client hoạt động
 */
