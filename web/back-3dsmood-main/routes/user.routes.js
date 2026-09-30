// routes/account.routes.js
const router = require("express").Router();
const mongoose = require("mongoose");
const User = require("../models/Users");
const Discount = require("../models/Discount");
const verifyToken = require("../middlewares/verifyToken"); // middleware gắn req.user._id
const ctrl = require('../controllers/user.controller');
const bcrypt = require('bcrypt');
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid || !mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Lấy user (chỉ các field cần)
    const user = await User.findById(uid, {
      coins: 1,
      points: 1,             // nếu chưa có field points, xem mục (2)
      collections: 1,
      purchased: 1,
    }).lean();

    if (!user) return res.status(404).json({ message: "User not found" });

    // Đếm coupon đang active trong thời gian (nếu coupon là global)
    const now = new Date();
    const coupons = await Discount.countDocuments({
      status: "active",
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ],
    });

    // downloads: nếu chưa có DownloadLog, tạm dùng purchased.length
    const downloads = Array.isArray(user.purchased) ? user.purchased.length : 0;

    // collections: dùng favorites.length
    const collections = Array.isArray(user.collections) ? user.collections.length : 0;

    const payload = {
      balance: Number(user.coins || 0),
      points: Number(user.points || 0),
      coupons: Number(coupons || 0),
      downloads,
      collections,
    };

    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
});
router.patch("/users/me", verifyToken, ctrl.updateMe);
router.get("/counters", verifyToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, message: "Unauthorized" });

    const u = await User.findById(userId).select("cart collections").lean();
    if (!u) return res.status(404).json({ ok: false, message: "User not found" });

    // Tổng số item trong giỏ = SUM(quantity)
    const cartCount = Array.isArray(u.cart)
      ? u.cart.reduce((sum, it) => sum + Math.max(1, Number(it.quantity || 1)), 0)
      : 0;

    // Yêu thích = số sản phẩm duy nhất trong tất cả collections
    const favSet = new Set();
    if (Array.isArray(u.collections)) {
      for (const col of u.collections) {
        if (Array.isArray(col.items)) {
          for (const pid of col.items) favSet.add(String(pid));
        }
      }
    }
    const favoritesCount = favSet.size;

    return res.json({ ok: true, cartCount, favoritesCount });
  } catch (err) {
    console.error("GET /api/user/counters error:", err);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
});

// routes/account.routes.js


// Tùy model Product của bạn: đổi "category" bên dưới cho đúng.
// Ví dụ nếu bạn lưu category là key (string): product.category
// Nếu là ref Category: product.category.slug hoặc product.categoryKey




module.exports = router;
