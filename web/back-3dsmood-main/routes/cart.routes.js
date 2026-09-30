// routes/cart.routes.js
// Mount ở server: app.use("/api/cart", require("./routes/cart.routes"));

const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const verifyToken = require("../middlewares/verifyToken");

const router = express.Router();

// === Models ===
// Đổi path theo dự án của bạn nếu cần
const User = require("../models/Users");        // chứa cart, purchased
const Product = require("../models/Product");  // sản phẩm

// === Auth middleware (tự chứa trong file) ===
// - Ưu tiên Passport (req.user)
// - Nếu không có, dùng Bearer JWT (Authorization: Bearer <token>)
function ensureAuth(req, res, next) {
  if (req.user && req.user._id) return next();

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "changeme");
    req.user = { _id: payload.id || payload._id };
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
}

// === Helpers ===
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
function countCartItems(cart = []) {
  return cart.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
}

// ===================================================================
// GET /api/cart
// Lấy giỏ hàng (populate thông tin sản phẩm cơ bản)
// ===================================================================
// ===================================================================
router.get("/", verifyToken, async (req, res) => {
  try {
    // 1) Lấy giỏ (chưa populate) để đọc toàn bộ productId thô
    const rawUser = await User.findById(req.user._id).select("cart");
    if (!rawUser) {
      return res.status(404).json({ ok: false, message: "User không tồn tại" });
    }

    const rawItems = Array.isArray(rawUser.cart) ? rawUser.cart : [];
    const allIds = rawItems
      .map((it) => it?.productId)
      .filter(Boolean); // ObjectId hợp lệ

    // 2) Xác định product còn tồn tại
    let orphanIds = [];
    if (allIds.length) {
      const existing = await Product.find({ _id: { $in: allIds } })
        .select("_id")
        .lean();
      const alive = new Set(existing.map((d) => String(d._id)));
      orphanIds = allIds.filter((id) => !alive.has(String(id)));
    }

    // 3) Nếu có item mồ côi -> pull khỏi giỏ
    if (orphanIds.length) {
      await User.updateOne(
        { _id: req.user._id },
        { $pull: { cart: { productId: { $in: orphanIds } } } }
      );
    }

    // 4) Fetch lại với populate để trả về dữ liệu sạch/đầy đủ
    const user = await User.findById(req.user._id)
      .select("cart")
      .populate({
        path: "cart.productId",
        select: "name price previewImagePath customId categoryIds",
        model: "Product",
      });

    // 5) (Phòng thủ) lọc bỏ mọi item mà sau populate vẫn không có product
    const cleanCart = (Array.isArray(user?.cart) ? user.cart : []).filter(
      (it) => it?.productId
    );

    return res.json({
      ok: true,
      cartCount: countCartItems(cleanCart),
      cart: cleanCart,
      removedOrphans: orphanIds.length || 0,
    });
  } catch (err) {
    console.error("GET /api/cart ERROR:", err);
    return res.status(500).json({ ok: false, message: "Lỗi máy chủ" });
  }
});

// ===================================================================
// GET /api/cart/count
// Lấy tổng số lượng item trong giỏ (cộng quantity)
// ===================================================================
router.get("/count", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("cart");
    if (!user) return res.status(404).json({ ok: false, message: "User không tồn tại" });

    return res.json({ ok: true, cartCount: countCartItems(user.cart) });
  } catch (err) {
    console.error("GET /api/cart/count ERROR:", err);
    return res.status(500).json({ ok: false, message: "Lỗi máy chủ" });
  }
});

// ===================================================================
// POST /api/cart/add
// body: { productId: string, quantity?: number }
// - Kiểm tra đã mua (purchased) -> không cho thêm
// - Nếu chưa, thêm vào giỏ (tăng quantity nếu đã có)
// ===================================================================
router.post("/add", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { productId } = req.body || {};

    if (!productId || !isValidObjectId(productId)) {
      return res.status(400).json({ ok: false, message: "productId không hợp lệ" });
    }

    // Sản phẩm tồn tại?
    const product = await Product.findById(productId).select("_id");
    if (!product) {
      return res.status(404).json({ ok: false, message: "Sản phẩm không tồn tại" });
    }

    // Đã mua chưa?
    const hasPurchased = await User.exists({
      _id: userId,
      "purchased.productId": productId,
    });
    // if (hasPurchased) {
    //   return res.json({
    //     ok: true,
    //     alreadyPurchased: true,
    //     message: "Bạn đã sở hữu sản phẩm này.",
    //   });
    // }

    // Lấy giỏ, kiểm tra đã có trong giỏ chưa
    const user = await User.findById(userId).select("cart");
    if (!user) return res.status(404).json({ ok: false, message: "User không tồn tại" });

    const existsInCart = user.cart.some(
      (it) => String(it.productId) === String(productId)
    );

    if (existsInCart) {
      // Không thêm nữa, giữ nguyên (mỗi sản phẩm chỉ 1)
      return res.json({
        ok: true,
        alreadyInCart: true,
        message: "Sản phẩm đã có trong giỏ hàng (mỗi sản phẩm chỉ 1).",
        cartCount: countCartItems(user.cart),
        cart: user.cart,
      });
    }

    // Thêm mới với quantity = 1
    user.cart.push({
      productId,
      quantity: 1,
      addedAt: new Date(),
    });

    await user.save();

    return res.json({
      ok: true,
      added: true,
      message: "Đã thêm vào giỏ hàng",
      cartCount: countCartItems(user.cart),
      cart: user.cart,
    });
  } catch (err) {
    console.error("POST /api/cart/add ERROR:", err);
    return res.status(500).json({ ok: false, message: "Lỗi máy chủ" });
  }
});


// ===================================================================
// PATCH /api/cart/:productId
// body: { quantity: number }  (quantity <= 0 => xoá luôn)
// ===================================================================
router.patch("/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body || {};
    if (!isValidObjectId(productId)) {
      return res.status(400).json({ ok: false, message: "productId không hợp lệ" });
    }

    const user = await User.findById(req.user._id).select("cart");
    if (!user) return res.status(404).json({ ok: false, message: "User không tồn tại" });

    const idx = user.cart.findIndex((it) => String(it.productId) === String(productId));
    if (idx < 0) return res.status(404).json({ ok: false, message: "Sản phẩm không có trong giỏ" });

    const q = Number(quantity);
    if (!Number.isFinite(q)) {
      return res.status(400).json({ ok: false, message: "quantity không hợp lệ" });
    }

    if (q <= 0) {
      // Xoá khi số lượng <= 0
      user.cart = user.cart.filter((it) => String(it.productId) !== String(productId));
    } else {
      user.cart[idx].quantity = Math.max(1, Math.floor(q));
    }

    await user.save();

    return res.json({
      ok: true,
      message: "Cập nhật giỏ hàng thành công",
      cartCount: countCartItems(user.cart),
      cart: user.cart,
    });
  } catch (err) {
    console.error("PATCH /api/cart/:productId ERROR:", err);
    return res.status(500).json({ ok: false, message: "Lỗi máy chủ" });
  }
});

// ===================================================================
// DELETE /api/cart/:productId
// Xoá 1 sản phẩm khỏi giỏ
// ===================================================================
router.delete("/:productId", verifyToken, async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) {
      return res.status(400).json({ ok: false, message: "productId không hợp lệ" });
    }

    const user = await User.findById(req.user._id).select("cart");
    if (!user) return res.status(404).json({ ok: false, message: "User không tồn tại" });

    const before = user.cart.length;
    user.cart = user.cart.filter((it) => String(it.productId) !== String(productId));

    if (user.cart.length === before) {
      return res.status(404).json({ ok: false, message: "Sản phẩm không có trong giỏ" });
    }

    await user.save();

    return res.json({
      ok: true,
      message: "Đã xoá khỏi giỏ hàng",
      cartCount: countCartItems(user.cart),
      cart: user.cart,
    });
  } catch (err) {
    console.error("DELETE /api/cart/:productId ERROR:", err);
    return res.status(500).json({ ok: false, message: "Lỗi máy chủ" });
  }
});

// ===================================================================
// DELETE /api/cart
// Xoá toàn bộ giỏ
// ===================================================================
router.delete("/", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("cart");
    if (!user) return res.status(404).json({ ok: false, message: "User không tồn tại" });

    user.cart = [];
    await user.save();

    return res.json({ ok: true, message: "Đã xoá toàn bộ giỏ hàng", cartCount: 0, cart: [] });
  } catch (err) {
    console.error("DELETE /api/cart ERROR:", err);
    return res.status(500).json({ ok: false, message: "Lỗi máy chủ" });
  }
});

module.exports = router;
