// routes/admin.stats.routes.js
// Mount in server: app.use("/api/admin/stats", require("./routes/admin.stats.routes"));
// Provides KPIs & charts data for Users and Orders.

const express = require("express");
const jwt = require("jsonwebtoken");

// Adjust these paths to your project structure if needed
const User = require("../models/Users");
const Order = require("../models/Order");

const router = express.Router();

// ===== Settings =====
const TZ = process.env.DASHBOARD_TZ || "Asia/Bangkok"; // Keep consistent with your frontend

// ===== Admin auth (Passport or Bearer JWT) =====
async function ensureAdmin(req, res, next) {
  try {
    // 1) If Passport has already attached user
    if (req.user && req.user.role === "admin") return next();

    // 2) Otherwise validate Bearer token
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const payload = jwt.verify(token, process.env.JWT_SECRET || "changeme");
    if (!payload || !payload.id) return res.status(401).json({ message: "Unauthorized" });

    // Lightweight role check (avoid heavy query; adapt if needed)
    const user = await User.findById(payload.id).select("role");
    if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    req.user = user;
    next();
  } catch (err) {
    console.error("ensureAdmin error", err);
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// ===== Helpers =====
function parseDateRange(q) {
  // Default last 30 days
  const now = new Date();
  const to = q.to ? new Date(q.to) : now; // inclusive end (convert to next day for $lt)
  const from = q.from ? new Date(q.from) : new Date(now.getTime() - 29 * 86400000);

  // Normalize to UTC day boundaries (Mongo uses UTC)
  const fromUTC = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0));
  const toNextUTC = new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0));
  return { from: fromUTC, to: toNextUTC };
}

function buildTimeBucket(granularity = "day") {
  // Requires MongoDB 5+
  return {
    $dateTrunc: {
      date: "$createdAt",
      unit: granularity, // "day" | "week" | "month"
      timezone: TZ,
    },
  };
}

// ===== Index suggestions (create in your schema or migration script) =====
// UserSchema.index({ createdAt: 1 });
// OrderSchema.index({ createdAt: 1, status: 1 });
// OrderSchema.index({ paymentMethod: 1 });

// =====================
// GET /api/admin/stats/overview
// -> KPIs (overall + in-range)
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// =====================
router.get("/overview", ensureAdmin, async (req, res) => {
  try {
    const { from, to } = parseDateRange(req.query);

    const matchPaidInRange = {
      createdAt: { $gte: from, $lt: to },
      status: "paid",
    };

    const [
      totalUsers,
      totalPaidOrders,
      totalRevenueAgg,
      rangeUsersCount,
      rangeOrdersAgg,
      pointsAgg,
    ] = await Promise.all([
      User.countDocuments({}),
      Order.countDocuments({ status: "paid" }),
      Order.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, revenue: { $sum: "$finalTotal" }, aov: { $avg: "$finalTotal" } } },
      ]),
      User.countDocuments({ createdAt: { $gte: from, $lt: to } }),
      Order.aggregate([
        { $match: matchPaidInRange },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$finalTotal" }, aov: { $avg: "$finalTotal" } } },
      ]),
      Order.aggregate([
        { $match: matchPaidInRange },
        { $group: { _id: null, pointsUsed: { $sum: "$pointsUsed" }, earnedPoints: { $sum: "$earnedPoints" } } },
      ]),
    ]);

    const overallRevenue = totalRevenueAgg[0]?.revenue || 0;
    const overallAOV = totalRevenueAgg[0]?.aov || 0;
    const rangeOrders = rangeOrdersAgg[0]?.orders || 0;
    const rangeRevenue = rangeOrdersAgg[0]?.revenue || 0;
    const rangeAOV = rangeOrdersAgg[0]?.aov || 0;
    const pointsUsed = pointsAgg[0]?.pointsUsed || 0;
    const earnedPoints = pointsAgg[0]?.earnedPoints || 0;

    return res.json({
      timeframe: { from, to },
      totals: {
        users: totalUsers,
        paidOrders: totalPaidOrders,
        revenue: overallRevenue,
        avgOrderValue: overallAOV,
      },
      period: {
        newUsers: rangeUsersCount,
        paidOrders: rangeOrders,
        revenue: rangeRevenue,
        avgOrderValue: rangeAOV,
        pointsUsed,
        earnedPoints,
      },
    });
  } catch (err) {
    console.error("GET /overview error", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// =====================
// GET /api/admin/stats/orders/by-day?granularity=day|week|month
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week|month
// =====================
router.get("/orders/by-day", ensureAdmin, async (req, res) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const granularity = ["day", "week", "month"].includes(req.query.granularity)
      ? req.query.granularity
      : "day";

    const bucket = buildTimeBucket(granularity);

    const rows = await Order.aggregate([
      { $match: { status: "paid", createdAt: { $gte: from, $lt: to } } },
      { $group: {
        _id: bucket,
        orders: { $sum: 1 },
        revenue: { $sum: "$finalTotal" },
        avg: { $avg: "$finalTotal" },
      } },
      { $project: { _id: 0, date: "$_id", orders: 1, revenue: 1, avg: 1 } },
      { $sort: { date: 1 } },
    ]);

    res.json({ timeframe: { from, to }, granularity, rows });
  } catch (err) {
    console.error("GET /orders/by-day error", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// =====================
// GET /api/admin/stats/users/by-day?granularity=day|week|month
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week|month
// =====================
router.get("/users/by-day", ensureAdmin, async (req, res) => {
  try {
    const { from, to } = parseDateRange(req.query);
    const granularity = ["day", "week", "month"].includes(req.query.granularity)
      ? req.query.granularity
      : "day";

    const bucket = buildTimeBucket(granularity);

    const rows = await User.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: bucket, users: { $sum: 1 } } },
      { $project: { _id: 0, date: "$_id", users: 1 } },
      { $sort: { date: 1 } },
    ]);

    res.json({ timeframe: { from, to }, granularity, rows });
  } catch (err) {
    console.error("GET /users/by-day error", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// =====================
// GET /api/admin/stats/orders/payment-methods
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// =====================
router.get("/orders/payment-methods", ensureAdmin, async (req, res) => {
  try {
    const { from, to } = parseDateRange(req.query);

    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to }, status: "paid" } },
      { $group: {
        _id: "$paymentMethod",
        orders: { $sum: 1 },
        revenue: { $sum: "$finalTotal" },
      } },
      { $project: { _id: 0, method: "$_id", orders: 1, revenue: 1 } },
      { $sort: { revenue: -1 } },
    ]);

    res.json({ timeframe: { from, to }, rows });
  } catch (err) {
    console.error("GET /orders/payment-methods error", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// =====================
// GET /api/admin/stats/orders/points
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// =====================
router.get("/orders/points", ensureAdmin, async (req, res) => {
  try {
    const { from, to } = parseDateRange(req.query);

    const agg = await Order.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to }, status: "paid" } },
      { $group: {
        _id: null,
        pointsUsed: { $sum: "$pointsUsed" },
        earnedPoints: { $sum: "$earnedPoints" },
      } },
    ]);

    res.json({
      timeframe: { from, to },
      pointsUsed: agg[0]?.pointsUsed || 0,
      earnedPoints: agg[0]?.earnedPoints || 0,
    });
  } catch (err) {
    console.error("GET /orders/points error", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
