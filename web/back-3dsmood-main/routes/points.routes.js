// routes/points.routes.js
const router = require("express").Router();
const mongoose = require("mongoose");

const Order = require("../models/Order");
const User = require("../models/Users");
const verifyToken = require("../middlewares/verifyToken");

// Helpers
function shortOrderId(order) {
  if (order.orderCode) return order.orderCode;
  return "ID" + String(order._id).slice(-6).toUpperCase(); // ví dụ: ID45748
}

function deltaFromOrder(order) {
  // + earnedPoints nếu trả bằng coins; - pointsUsed nếu trả bằng points
  if (order.paymentMethod === "points" && Number(order.pointsUsed) > 0) {
    return -Number(order.pointsUsed);
  }
  if (order.paymentMethod === "coins" && Number(order.earnedPoints) > 0) {
    return Number(order.earnedPoints);
  }
  return 0;
}

router.get("/history", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;

    // phân trang
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    // chỉ lấy order có thay đổi điểm
    const match = {
      user: new mongoose.Types.ObjectId(String(userId)),
      $or: [
        { pointsUsed:   { $gt: 0 } },
        { earnedPoints: { $gt: 0 } },
      ],
    };

    const total = await Order.countDocuments(match);

    const orders = await Order.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .select("_id createdAt pointsUsed earnedPoints orderCode balanceAfter pointsAfter")
      .lean();

    if (!orders.length) {
      return res.json({
        ok: true,
        items: [],
        page,
        limit,
        total,
        hasMore: page * limit < total,
      });
    }

    // Formatters cho UI
    const tz = "Asia/Ho_Chi_Minh";
    const dfDate = new Intl.DateTimeFormat("vi-VN", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const dfTime = new Intl.DateTimeFormat("vi-VN", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    // Map sang shape UI
    const items = orders.map((o) => {
      const d = new Date(o.createdAt);
      const points = (o.earnedPoints || 0) - (o.pointsUsed || 0);

      return {
        time:   dfTime.format(d),     // "15:00"
        date:   dfDate.format(d),     // "07/08/2025"
        orderId: shortOrderId(o),     // ví dụ "ID45748"
        points,                       // ± điểm
        balance: o.balanceAfter ?? 0, // đọc trực tiếp
        pointsAfter: o.pointsAfter?? 0,
        createdAt: o.createdAt,
        _id: o._id,
      };
    });

    return res.json({
      ok: true,
      items,
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  } catch (e) {
    console.error("POINTS HISTORY ERROR:", e);
    res.status(500).json({ ok: false, message: e.message });
  }
});


// (tuỳ chọn) Tổng quan số dư hiện tại
router.get("/summary", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("points").lean();
    res.json({ ok: true, balance: Number(user?.points || 0) });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
