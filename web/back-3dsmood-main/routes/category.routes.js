// routes/category.routes.js
const router = require("express").Router();
const Category = require("../models/Category");
const Product = require("../models/Product");
router.get("/tree/both", async (req, res) => {
  try {
    // chấp nhận name/slug số ít & số nhiều
    const names = ["3dmodel", "3dmodels", "3dscene", "3dscenes"];

    // lấy 2 root theo name hoặc slug (parent = null)
    const roots = await Category.find({
      parent: null,
      $or: [
        { name: { $in: names } },
        { slug:  { $in: names } },
      ],
    }).lean();

    if (!roots.length) {
      const wantMerge = ["1","true","yes"].includes(String(req.query.merge || "").toLowerCase());
      return wantMerge
        ? res.json({ root: null, children: [] })
        : res.json({ trees: [] });
    }

    const rootIds = roots.map(r => r._id);

    // level 2 cho tất cả root
    const level2 = await Category.find({ parent: { $in: rootIds } })
      .sort({ name: 1 })
      .lean();
    const level2Ids = level2.map(c => c._id);

    // level 3 cho tất cả level2
    const level3 = await Category.find({ parent: { $in: level2Ids } })
      .sort({ name: 1 })
      .lean();

    // gắn level3 vào level2
    const l3ByParent = new Map();
    for (const c of level3) {
      const k = String(c.parent);
      if (!l3ByParent.has(k)) l3ByParent.set(k, []);
      l3ByParent.get(k).push(c);
    }
    const level2WithChildren = level2.map(c => ({
      ...c,
      children: l3ByParent.get(String(c._id)) || [],
    }));

    // gắn level2 vào từng root
    const l2ByRoot = new Map();
    for (const c of level2WithChildren) {
      const k = String(c.parent);
      if (!l2ByRoot.has(k)) l2ByRoot.set(k, []);
      l2ByRoot.get(k).push(c);
    }

    // chuẩn hoá output
    const trees = roots.map(r => ({
      root: { _id: r._id, name: r.name, slug: r.slug },
      children: (l2ByRoot.get(String(r._id)) || []).sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      ),
    }));

    const wantMerge = ["1","true","yes"].includes(String(req.query.merge || "").toLowerCase());
    if (wantMerge) {
      // gộp children của 2 cây thành 1 danh sách
      return res.json({
        root: null,
        children: trees.flatMap(t => t.children || []),
      });
    }

    res.json({ trees });
  } catch (e) {
    console.error("[/tree/both] error:", e);
    res.status(500).json({ message: e.message });
  }
});
// tree dưới root 3dmodel (cấp 2 + cấp 3)
router.get("/tree/3dmodel", async (req, res) => {
  try {
    const root = await Category.findOne({ name: "3dmodel", parent: null }).lean();
    if (!root) return res.json({ root: null, children: [] });

    const level2 = await Category.find({ parent: root._id }).sort({ name: 1 }).lean();
    const data = [];

    for (const p of level2) {
      const children = await Category.find({ parent: p._id }).sort({ name: 1 }).lean();
      data.push({ ...p, children });
    }

    res.json({ root, children: data });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.get("/tree/3dscenes", async (req, res) => {
  try {
    const root = await Category.findOne({ name: "3dscenes", parent: null }).lean();
    if (!root) return res.json({ root: null, children: [] });

    const level2 = await Category.find({ parent: root._id }).sort({ name: 1 }).lean();
    const data = [];

    for (const p of level2) {
      const children = await Category.find({ parent: p._id }).sort({ name: 1 }).lean();
      data.push({ ...p, children });
    }

    res.json({ root, children: data });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// lấy tất cả root (nếu cần)
router.get("/roots", async (_req, res) => {
  try {
    const roots = await Category.find({ parent: null }).sort({ name: 1 }).lean();
    res.json(roots);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});
router.get("/flat", async (req, res) => {
    try {
      const { rootName, leavesOnly } = req.query;
  
      // nếu có rootName -> tìm root và lấy toàn bộ descendant
      let underIds = null;
      if (rootName) {
        const root = await Category.findOne({ name: rootName, parent: null }).lean();
        if (!root) return res.json([]);
  
        // lấy tất cả node dưới root (2 cấp cũng được; nếu muốn multi-level, có thể viết đệ quy/aggregate)
        const level2 = await Category.find({ parent: root._id }).lean();
        const level2Ids = level2.map((x) => x._id);
        const level3 = await Category.find({ parent: { $in: level2Ids } }).lean();
        underIds = [root._id, ...level2Ids, ...level3.map((x) => x._id)];
      }
  
      // lấy toàn bộ categories (trừ root null nếu muốn)
      const all = await Category.find(underIds ? { _id: { $in: underIds } } : {}).lean();
  
      // map thành dictionary để biết con
      const byParent = new Map();
      all.forEach((c) => {
        const pid = c.parent ? String(c.parent) : "root";
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid).push(c);
      });
  
      // nếu leavesOnly -> chỉ trả về node không có con
      let list = all;
      if (leavesOnly === "1") {
        const hasChild = new Set();
        all.forEach((c) => {
          const arr = byParent.get(String(c._id));
          if (arr && arr.length) hasChild.add(String(c._id));
        });
        list = all.filter((c) => !hasChild.has(String(c._id)) && c.parent); // bỏ root
      } else {
        // mặc định bỏ root (parent = null), form thường chọn “nhóm con” trở xuống
        list = all.filter((c) => c.parent);
      }
  
      // gợi ý trả về thêm path cho đẹp (name xâu chuỗi)
      const idToCat = new Map(all.map((c) => [String(c._id), c]));
      const buildPath = (node) => {
        const parts = [node.name];
        let cur = node;
        while (cur.parent) {
          const p = idToCat.get(String(cur.parent));
          if (!p) break;
          parts.push(p.name);
          cur = p;
        }
        return parts.reverse().join(" / ");
      };
  
      const data = list
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          _id: c._id,
          name: c.name,
          image: c.image || null,
          parent: c.parent || null,
          path: buildPath(c),
          count: c.count ?? 0,
        }));
  
      res.json(data);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: e.message });
    }
  });
module.exports = router;

// Admin helper: rebuild category counts from products
// Usage: POST /api/categories/resync-counts
// NOTE: keep this protected in production (e.g. behind auth or env flag).
router.post("/resync-counts", async (req, res) => {
  try {
    // Aggregate counts from Product.categoryIds (handles multiple categories per product)
    const agg = await Product.aggregate([
      { $unwind: { path: "$categoryIds", preserveNullAndEmptyArrays: false } },
      { $group: { _id: "$categoryIds", count: { $sum: 1 } } },
    ]).allowDiskUse(true);

    const counts = new Map(agg.map((r) => [String(r._id), r.count]));

    const cats = await Category.find({}, "_id").lean();
    const bulk = cats.map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { count: counts.get(String(c._id)) || 0 } },
      },
    }));

    if (bulk.length) await Category.bulkWrite(bulk, { ordered: false });

    res.json({ ok: true, updated: bulk.length });
  } catch (e) {
    console.error("/resync-counts error:", e);
    res.status(500).json({ ok: false, message: e.message || String(e) });
  }
});
