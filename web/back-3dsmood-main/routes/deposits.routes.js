// routes/deposits.routes.js
const express = require("express");
const router = express.Router();
const DepositOrder = require("../models/DepositOrder");
const verifyToken = require("../middlewares/verifyToken");

// Nếu bạn đã có middleware auth riêng thì import vào thay thế
function requireAuth(req, res, next) {
  // Giả định hệ thống của bạn đã gắn req.user từ JWT middleware trước đó
  if (!req.user || !req.user._id) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

/**
 * GET /api/me/deposits
 * Lấy DS đơn nạp của user hiện tại + tổng tiền đã nạp (đơn trạng thái 'paid')
 * Query hỗ trợ: page, limit, status (optional), from, to (ISO hoặc yyyy-mm-dd), sort, dir
 */
router.get("/me/deposits", verifyToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "",           // 'pending' | 'paid' | 'cancelled' | ''
      from = "",             // '2025-08-01' | ISO
      to = "",               // '2025-08-22' | ISO
      sort = "createdAt",
      dir = "desc",
    } = req.query;

    const cond = { userId: req.user._id };

    if (status) cond.status = status;

    // Lọc theo mốc thời gian tạo đơn
    if (from || to) {
      cond.createdAt = {};
      if (from) cond.createdAt.$gte = new Date(from);
      if (to) {
        // đưa về cuối ngày nếu to là dạng yyyy-mm-dd
        const toDate = to.length <= 10 ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
        cond.createdAt.$lte = toDate;
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const sortDir = String(dir).toLowerCase() === "asc" ? 1 : -1;

    const [items, totalItems, totalPaidAgg] = await Promise.all([
      DepositOrder.find(cond)
        .sort({ [sort]: sortDir, _id: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),

      DepositOrder.countDocuments(cond),

      // Tổng tiền đã nạp (paid)
      DepositOrder.aggregate([
        { $match: { ...cond, status: "paid" } },
        { $group: { _id: null, sum: { $sum: "$total" } } },
        { $project: { _id: 0, sum: 1 } },
      ]),
    ]);

    const totalAmount = totalPaidAgg?.[0]?.sum || 0;

    res.json({
      items,
      page: pg,
      limit: lim,
      totalItems,
      totalPages: Math.ceil(totalItems / lim),
      totalAmount, // Tổng tiền đã nạp (paid)
    });
  } catch (err) {
    console.error("[ME/DEPOSITS] error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/deposits/:id
 * Lấy chi tiết 1 đơn nạp của chính user (bảo vệ truy cập chéo)
 */
router.get("/deposits/:id", verifyToken, async (req, res) => {
  try {
    const doc = await DepositOrder.findById(req.params.id).lean();
    if (!doc || String(doc.userId) !== String(req.user._id)) {
      return res.status(404).json({ message: "Not found" });
    }
    res.json(doc);
  } catch (err) {
    console.error("[DEPOSITS/:id] error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
