const router = require("express").Router();
const mongoose = require("mongoose");
const User = require("../models/Users");
const Product = require("../models/Product");
const verifyToken = require("../middlewares/verifyToken");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const slugify = (str = "") =>
  String(str)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);

async function ensureDefaultCollection(userId) {
  const after = await User.findOneAndUpdate(
    { _id: userId, $or: [{ collections: { $exists: false } }, { collections: { $size: 0 } }] },
    { $set: { collections: [{ name: "Default", slug: "default", items: [] }] } },
    { new: true, projection: { collections: 1 } }
  ).lean();
  return after;
}

function boolish(v) {
  if (v === true) return true;
  const s = String(v ?? "").toLowerCase();
  return ["1", "true", "t", "yes", "y"].includes(s);
}

const toSlug = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

router.get("/", verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    let user = await User.findById(uid, { collections: 1 }).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // Đảm bảo có collection mặc định
    if (!user.collections || user.collections.length === 0) {
      await ensureDefaultCollection(uid);
      user = await User.findById(uid, { collections: 1 }).lean();
    }

    const { productId, populate } = req.query;
    const wantPopulate = boolish(populate);
    const pid = mongoose.isValidObjectId(productId)
      ? new mongoose.Types.ObjectId(productId)
      : null;

    const rawCols = Array.isArray(user.collections) ? user.collections : [];

    // Nếu FE không cần populate: trả tối giản
    if (!wantPopulate) {
      const collections = rawCols.map((c) => {
        const slug = c.slug || toSlug(c.name);
        const contains = pid
          ? (c.items || []).some((id) => String(id) === String(pid))
          : undefined;
        return {
          _id: c._id,
          name: c.name,
          slug,
          count: (c.items || []).length,
          contains,
        };
      });
      return res.json({ collections });
    }

    // ===== Populate items =====
    const uniqIdStrs = [
      ...new Set(
        rawCols.flatMap((c) => (c.items || []).map((id) => String(id)))
      ),
    ];
    const uniqIds = uniqIdStrs
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const products = uniqIds.length
      ? await Product.find(
          { _id: { $in: uniqIds } },
          "name price images previewImagePath categoryIds createdAt"
        ).lean({ virtuals: true })
      : [];

    const byId = new Map(products.map((p) => [String(p._id), p]));

    // Gắn items populate + tính count thực sự (lọc ID chết)
    const withItems = rawCols.map((c) => {
      const slug = c.slug || toSlug(c.name);
      const items = (c.items || [])
        .map((id) => byId.get(String(id)))
        .filter(Boolean); // loại sản phẩm đã xoá
      const contains = pid
        ? (c.items || []).some((id) => String(id) === String(pid))
        : undefined;
      return {
        _id: c._id,
        name: c.name,
        slug,
        contains,
        count: items.length, // ✅ đếm theo tồn tại
        items,
      };
    });

    // Build categories + allItems cho FE
    const totalAll = withItems.reduce((s, c) => s + c.count, 0);
    const categories = [
      { key: "all", label: "Tất cả", count: totalAll },
      ...withItems.map((c) => ({ key: c.slug, label: c.name, count: c.count })),
    ];

    const allItems = withItems.flatMap((c) =>
      (c.items || []).map((p) => ({ product: p, inSlug: c.slug }))
    );

    return res.json({
      collections: withItems,
      categories,
      allItems,
    });
  } catch (err) {
    console.error("GET /api/collections error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


/**
 * (Optional) GET /api/collections/:slugOrId?page=1&limit=24
 * Lấy chi tiết 1 collection + items phân trang
 */
router.get("/:slugOrId", verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const { slugOrId } = req.params;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.max(parseInt(req.query.limit || "24", 10), 1);
    const skip = (page - 1) * limit;

    let user = await User.findById(uid, { collections: 1 }).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.collections || user.collections.length === 0) {
      const after = await ensureDefaultCollection(uid);
      if (after) user = after;
    }

    const isId = isValidObjectId(slugOrId);
    const col =
      (user.collections || []).find(
        (c) =>
          (isId && String(c._id) === slugOrId) ||
          (!isId && (c.slug || slugify(c.name)) === slugOrId)
      ) || null;

    if (!col) return res.status(404).json({ message: "Collection not found" });

    const total = (col.items || []).length;
    const pageIds = (col.items || []).slice(skip, skip + limit);

    const products = pageIds.length
      ? await Product.find(
          { _id: { $in: pageIds } },
          "name slug cover thumbnail images price"
        ).lean()
      : [];

    // giữ thứ tự theo items
    const map = new Map(products.map((p) => [String(p._id), p]));
    const items = pageIds.map((id) => map.get(String(id))).filter(Boolean);

    res.json({
      collection: {
        _id: col._id,
        name: col.name,
        slug: col.slug || slugify(col.name),
        count: total,
      },
      page,
      limit,
      total,
      items,
    });
  } catch (err) {
    console.error("GET /api/collections/:slugOrId error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


  router.delete("/:slug/items/:productId", verifyToken, async (req, res) => {
    try {
      const uid = req.user?._id;
      const { slug, productId } = req.params;
  
      if (!uid || !isValidObjectId(uid) || !slug || !isValidObjectId(productId)) {
        return res.status(400).json({ message: "Bad request" });
      }
  
      const result = await User.updateOne(
        { _id: uid, "collections.slug": slug },
        { $pull: { "collections.$[c].items": new mongoose.Types.ObjectId(productId) } },
        { arrayFilters: [{ "c.slug": slug }] }
      );
  
      if (result.matchedCount === 0) {
        return res.status(404).json({ message: "Collection not found" });
      }
  
      return res.json({ ok: true, matched: result.matchedCount, modified: result.modifiedCount });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ message: "Server error" });
    }
  });
  // DELETE /api/account/collections/items/:productId
  // Xoá 1 product khỏi **tất cả** collections của user (hữu ích khi đang ở tab "All")
  router.delete("/items/:productId", verifyToken, async (req, res) => {
    try {
      const uid = req.user?._id;
      const { productId } = req.params;
  
      if (!uid || !isValidObjectId(uid) || !isValidObjectId(productId)) {
        return res.status(400).json({ message: "Bad request" });
      }
  
      const result = await User.updateOne(
        { _id: uid },
        { $pull: { "collections.$[].items": new mongoose.Types.ObjectId(productId) } }
      );
  
      return res.json({ ok: true, matched: result.matchedCount, modified: result.modifiedCount });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ message: "Server error" });
    }
  });
  
  // DELETE /api/account/favorites/:productId
  // Tương thích cũ: coi "favorites" là collection mặc định có slug = "default"
  router.delete("/favorites/:productId", verifyToken, async (req, res) => {
    try {
      const uid = req.user?._id;
      const { productId } = req.params;
      const slug = "default";
  
      if (!uid || !isValidObjectId(uid) || !isValidObjectId(productId)) {
        return res.status(400).json({ message: "Bad request" });
      }
  
      const result = await User.updateOne(
        { _id: uid, "collections.slug": slug },
        { $pull: { "collections.$[c].items": new mongoose.Types.ObjectId(productId) } },
        { arrayFilters: [{ "c.slug": slug }] }
      );
  
      if (result.matchedCount === 0) {
        return res.status(404).json({ message: "Collection not found" });
      }
  
      return res.json({ ok: true, matched: result.matchedCount, modified: result.modifiedCount });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ message: "Server error" });
    }
  });
  
  /**
   * PATCH /api/account/collections/:slug
   * Body: { name: string }
   * -> Đổi tên collection theo slug (slug cũng thay đổi theo name)
   */
  router.patch("/:slug", verifyToken, async (req, res) => {
    try {
      const uid = req.user?._id;
      if (!uid) return res.status(401).json({ message: "Unauthorized" });
  
      const { slug } = req.params;
      const { name } = req.body || {};
      const newName = String(name || "").trim();
      if (!newName) return res.status(400).json({ message: "Tên không hợp lệ" });
  
      const user = await User.findById(uid, { collections: 1 });
      if (!user) return res.status(404).json({ message: "User not found" });
  
      const idx = (user.collections || []).findIndex((c) => c.slug === slug);
      if (idx < 0) return res.status(404).json({ message: "Collection không tồn tại" });
  
      // Không cho sửa "all" nếu bạn dùng key "all" là tab tổng hợp
      if (slug === "all") return res.status(400).json({ message: "Không thể sửa tab tổng hợp" });
  
      const newSlug = slugify(newName);
  
      // Kiểm tra trùng slug
      const dup = (user.collections || []).some((c, i) => i !== idx && c.slug === newSlug);
      if (dup) return res.status(409).json({ message: "Slug đã tồn tại. Hãy chọn tên khác." });
  
      user.collections[idx].name = newName;
      user.collections[idx].slug = newSlug;
      await user.save();
  
      return res.json({ ok: true, collection: user.collections[idx] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ message: "Lỗi máy chủ" });
    }
  });
  
  /**
   * DELETE /api/account/collections/:slug
   * -> Xoá collection theo slug
   */
  router.delete("/:slug", verifyToken, async (req, res) => {
    try {
      const uid = req.user?._id;
      if (!uid) return res.status(401).json({ message: "Unauthorized" });
  
      const { slug } = req.params;
      if (!slug) return res.status(400).json({ message: "Slug không hợp lệ" });
  
      // Không cho xoá "all" nếu bạn dùng key "all" là tab tổng hợp
      if (slug === "all") return res.status(400).json({ message: "Không thể xoá tab tổng hợp" });
  
      const user = await User.findById(uid, { collections: 1 });
      if (!user) return res.status(404).json({ message: "User not found" });
  
      const before = user.collections?.length || 0;
      user.collections = (user.collections || []).filter((c) => c.slug !== slug);
      const after = user.collections.length;
  
      if (before === after) return res.status(404).json({ message: "Collection không tồn tại" });
  
      await user.save();
      return res.json({ ok: true, removed: slug });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ message: "Lỗi máy chủ" });
    }
  });
  
module.exports = router;
