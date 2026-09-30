// routes/product.detail.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const verifyToken = require("../middlewares/verifyToken");

const Product = require("../models/Product");
const Category = require("../models/Category"); // cần field `parent`
const User = require("../models/Users");       // đổi sang "../models/User" nếu file bạn tên User.js

// ===== Config / Utils =====
const ASSET_BASE =
  process.env.ASSET_BASE_URL ||
  process.env.VITE_ASSET_BASE_URL ||
  process.env.API_BASE_URL ||
  ""; // ví dụ: http://localhost:5000

const DEFAULT_IMAGE_PATH = "/static/no-image.png"; // file tĩnh backend phục vụ

function normalizePath(p) {
  if (!p) return null;
  if (typeof p === "string") return p;
  if (Array.isArray(p)) return normalizePath(p[0]);
  if (typeof p === "object") {
    if (typeof p.url === "string") return p.url;
    if (typeof p.path === "string") return p.path;
    if (typeof p.src === "string") return p.src;
    if (typeof p.toString === "function") {
      const s = p.toString();
      if (s && s !== "[object Object]") return s;
    }
    return null;
  }
  return String(p);
}
function isHttpUrl(s) {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}
function buildUrl(p) {
  const s = normalizePath(p);
  if (!s) return null;
  if (isHttpUrl(s)) return s;
  const base = (ASSET_BASE || "").replace(/\/+$/, "");
  const rel = s.startsWith("/") ? s : `/${s}`;
  return `${base}${rel}`;
}

// Chỉ lấy ảnh từ previewImagePath (theo yêu cầu)
function getPreviewUrl(doc) {
  return buildUrl(doc?.previewImagePath) || buildUrl(DEFAULT_IMAGE_PATH);
}

async function buildBreadcrumbs(categoryId) {
  if (!categoryId) return [];
  const out = [];
  let cur = await Category.findById(categoryId).select("_id name slug parent").lean();
  while (cur) {
    out.push({ id: String(cur._id), name: cur.name, slug: cur.slug });
    cur = cur.parent ? await Category.findById(cur.parent).select("_id name slug parent").lean() : null;
  }
  return out.reverse();
}

function getLikedSetFromUser(userDoc) {
  const set = new Set();
  if (!userDoc?.collections?.length) return set;
  for (const c of userDoc.collections) {
    if (Array.isArray(c.items)) for (const pid of c.items) set.add(String(pid));
  }
  return set;
}

function mapProductDetail(doc, liked, breadcrumbs) {
  const fileSizeMB =
    doc.modelSize ??
    (typeof doc.modelSize === "number" ? +(doc.modelSize / (1024 * 1024)).toFixed(2) : null);

  return {
    id: String(doc._id),
    name: doc.name,
    price: doc.price ?? 0,
    liked: !!liked,
    image: getPreviewUrl(doc), // chỉ previewImagePath

    code: doc.customId || doc.customId || null,
    sizeMB: fileSizeMB,
    styles: (doc.styles || []).map(s => (typeof s === "object" ? s.name : s)),
    form: (doc.form || []).map(f => {
      if (typeof f === "object") return { id: String(f._id), name: f.name, image: buildUrl(f.image) };
      return { id: String(f), name: null, image: null };
    }),
    materials: (doc.materials || []).map(m => (typeof m === "object" ? m.name : m)),
    colors: (doc.color || []).map(c => (typeof c === "object" ? c.code : c)),
    description: doc.description || "",
    categories: breadcrumbs,
  };
}

function mapProductCard(p, likedSet) {
  return {
    id: String(p._id),
    name: p.name,
    price: p.price ?? 0,
    image: getPreviewUrl(p), // chỉ previewImagePath
    liked: likedSet ? likedSet.has(String(p._id)) : false,
  };
}

// ===== Auth (optional/required) =====
async function attachUserIfAny(req, _res, next) {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) return next();
    const token = auth.slice(7).trim();
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.sub).select("_id collections").lean();
  } catch {
    req.user = null;
  }
  next();
}
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ message: "Unauthorized" });
  try {
    const token = auth.slice(7).trim();
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    req.authUser = user;
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// ===== Routes =====

// GET /api/product-detail/products/:id  (id là ObjectId)
router.get("/products/:id", attachUserIfAny, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid product id" });

    const product = await Product.findById(id)
      .populate("styles", "name")
      .populate("form", "name image")
      .populate("materials", "name")
      .populate("color", "code name")
      .lean();

    if (!product) return res.status(404).json({ message: "Product not found" });

    const likedSet = getLikedSetFromUser(req.user);
    const likedCurrent = likedSet.has(String(product._id));
    const breadcrumbs = await buildBreadcrumbs(product.categoryIds?.[0]);

    const payload = mapProductDetail(product, likedCurrent, breadcrumbs);

    // ===== Similar: KẾT HỢP 2 điều kiện (categoryIds AND styles) nếu cả hai cùng tồn tại =====
    const similarQuery = { _id: { $ne: product._id } };

    const hasCats = Array.isArray(product.categoryIds) && product.categoryIds.length > 0;
    const styleIds = (product.styles || [])
      .map(s => (typeof s === "object" && s !== null ? s._id : s))
      .filter(Boolean);
    const hasStyles = styleIds.length > 0;

    if (hasCats && hasStyles) {
      similarQuery.$and = [
        { categoryIds: { $in: product.categoryIds } },
        { styles: { $in: styleIds } },
      ];
    } else if (hasCats) {
      similarQuery.categoryIds = { $in: product.categoryIds };
    } 
    // Nếu không có cats & styles, similarQuery sẽ chỉ loại trừ chính nó (_id: {$ne: ...})

    const similarDocs = await Product.find(similarQuery)
      .select("name price previewImagePath")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const similar = similarDocs.map(p => mapProductCard(p, likedSet));

    return res.json({ product: payload, similar });
  } catch (err) {
    console.error("GET /products/:id error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// GET /api/product-detail/products/:id/similar
router.get("/products/:id/similar", attachUserIfAny, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid product id" });

    const product = await Product.findById(id).select("categoryIds styles").lean();
    if (!product) return res.status(404).json({ message: "Product not found" });

    const q = { _id: { $ne: product._id }, $or: [] };
    if (product.categoryIds?.length) q.$or.push({ categoryIds: { $in: product.categoryIds } });
    if (product.styles?.length) q.$or.push({ styles: { $in: product.styles } });
    if (q.$or.length === 0) delete q.$or;

    const docs = await Product.find(q)
      .select("name price previewImagePath")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const likedSet = getLikedSetFromUser(req.user);
    const similar = docs.map(p => mapProductCard(p, likedSet));
    return res.json({ similar });
  } catch (err) {
    console.error("GET /products/:id/similar error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});



router.get('/favorites', verifyToken, async (req, res) => {
    try {
      const userId = req.user._id; // Lấy user ID từ token
      const user = await User.findById(userId).populate('collections.items'); // Sửa populate
  
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
  
      // Kiểm tra nếu collections.items không có sản phẩm
      if (!user.collections || user.collections.length === 0) {
        return res.status(200).json([]); // Trả về mảng rỗng nếu không có collection
      }
  
      // Duyệt qua tất cả các collections và lấy các sản phẩm
      const allProducts = user.collections.reduce((acc, collection) => {
        return acc.concat(collection.items); // Kết hợp tất cả các items từ các collections
      }, []);
  
      // Kiểm tra nếu allProducts rỗng
      if (allProducts.length === 0) {
        return res.status(200).json([]); // Trả về mảng rỗng nếu không có sản phẩm yêu thích
      }
  
      // Trả về danh sách sản phẩm yêu thích
      return res.json(allProducts);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });
  
module.exports = router;
