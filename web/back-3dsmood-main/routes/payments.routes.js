const router = require("express").Router();
const Setting = require("../models/Setting");
const verifyToken = require("../middlewares/verifyToken");
const User = require("../models/Users");

// ===== Helpers: get settings with sane defaults =====
async function getPointRateLegacy() {
  const DEFAULT = Number(process.env.POINT_RATE || 15000);
  const doc = await Setting.findOne({ key: "point_rate" });
  return doc ? Number(doc.value) || DEFAULT : DEFAULT;
}

async function getPointRatePay() {
  // ưu tiên key mới; nếu chưa có thì fallback env POINT_RATE_PAY, rồi POINT_RATE, rồi 15000
  const FALLBACK = Number(process.env.POINT_RATE || 15000);
  const ENV_DEFAULT = Number(process.env.POINT_RATE_PAY || FALLBACK);
  const doc = await Setting.findOne({ key: "point_rate_pay" });
  return doc ? Number(doc.value) || ENV_DEFAULT : ENV_DEFAULT;
}

async function getPointRateEarn() {
  // ưu tiên key mới; fallback env POINT_RATE_EARN, rồi POINT_RATE, rồi 15000
  const FALLBACK = Number(process.env.POINT_RATE || 15000);
  const ENV_DEFAULT = Number(process.env.POINT_RATE_EARN || FALLBACK);
  const doc = await Setting.findOne({ key: "point_rate_earn" });
  return doc ? Number(doc.value) || ENV_DEFAULT : ENV_DEFAULT;
}

async function getEarnPerProductCoins() {
  const DEFAULT = Number(process.env.EARN_POINTS_PER_PRODUCT_COINS || 10);
  const doc = await Setting.findOne({ key: "earn_points_per_product_coins" });
  return doc ? Number(doc.value) || DEFAULT : DEFAULT;
}

// ===== GET /api/payments/config =====
router.get("/config", verifyToken, async (_req, res) => {
  try {
    const [pointRatePay, pointRateEarn, earnPerProductCoins, pointRateLegacy] = await Promise.all([
      getPointRatePay(),
      getPointRateEarn(),
      getEarnPerProductCoins(),
      getPointRateLegacy(),
    ]);

    // Trả cả trường cũ để FE/BE cũ vẫn chạy
    res.json({
      pointRatePay,
      pointRateEarn,
      earnPerProductCoins,
      pointRate: pointRateLegacy,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ===== PUT /api/payments/config =====
// body: { pointRatePay?, pointRateEarn?, earnPerProductCoins?, pointRate? }
router.put("/config", verifyToken, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select("role");
    if (!me || me.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updates = {};
    const errors = [];

    // Validate từng trường nếu có
    if (req.body.pointRatePay !== undefined) {
      const v = Number(req.body.pointRatePay);
      if (!Number.isFinite(v) || v <= 0) errors.push("pointRatePay must be > 0");
      else updates.pointRatePay = v;
    }
    if (req.body.pointRateEarn !== undefined) {
      const v = Number(req.body.pointRateEarn);
      if (!Number.isFinite(v) || v <= 0) errors.push("pointRateEarn must be > 0");
      else updates.pointRateEarn = v;
    }
    if (req.body.earnPerProductCoins !== undefined) {
      const v = Number(req.body.earnPerProductCoins);
      if (!Number.isFinite(v) || v < 0) errors.push("earnPerProductCoins must be >= 0");
      else updates.earnPerProductCoins = v;
    }
    if (req.body.pointRate !== undefined) {
      const v = Number(req.body.pointRate);
      if (!Number.isFinite(v) || v <= 0) errors.push("pointRate must be > 0");
      else updates.pointRate = v; // legacy
    }

    if (errors.length) {
      return res.status(400).json({ message: errors.join("; ") });
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No changes" });
    }

    // Ghi DB theo keys tương ứng
    const ops = [];

    // Nếu có gửi pointRatePay => ghi key mới
    if (updates.pointRatePay !== undefined) {
      ops.push(
        Setting.findOneAndUpdate(
          { key: "point_rate_pay" },
          { value: updates.pointRatePay },
          { upsert: true }
        )
      );
    }

    // Nếu có gửi pointRateEarn => ghi key mới
    if (updates.pointRateEarn !== undefined) {
      ops.push(
        Setting.findOneAndUpdate(
          { key: "point_rate_earn" },
          { value: updates.pointRateEarn },
          { upsert: true }
        )
      );
    }

    // Nếu có gửi earnPerProductCoins => ghi key cũ
    if (updates.earnPerProductCoins !== undefined) {
      ops.push(
        Setting.findOneAndUpdate(
          { key: "earn_points_per_product_coins" },
          { value: updates.earnPerProductCoins },
          { upsert: true }
        )
      );
    }

    // Legacy: nếu có gửi pointRate (cũ)
    // - Nếu người dùng KHÔNG gửi pointRatePay/pointRateEarn thì đồng bộ cả 3 key: point_rate, point_rate_pay, point_rate_earn
    // - Nếu đã gửi riêng pay/earn thì chỉ ghi point_rate (để không override những gì gửi riêng)
    if (updates.pointRate !== undefined) {
      ops.push(
        Setting.findOneAndUpdate(
          { key: "point_rate" },
          { value: updates.pointRate },
          { upsert: true }
        )
      );

      const noSpecificRates =
        updates.pointRatePay === undefined && updates.pointRateEarn === undefined;

      if (noSpecificRates) {
        // đồng bộ cả 2 key mới nếu người dùng chỉ gửi pointRate
        ops.push(
          Setting.findOneAndUpdate(
            { key: "point_rate_pay" },
            { value: updates.pointRate },
            { upsert: true }
          )
        );
        ops.push(
          Setting.findOneAndUpdate(
            { key: "point_rate_earn" },
            { value: updates.pointRate },
            { upsert: true }
          )
        );
      }
    }

    await Promise.all(ops);

    // Trả lại cấu hình mới
    const [pointRatePay, pointRateEarn, earnPerProductCoins, pointRateLegacy] = await Promise.all([
      getPointRatePay(),
      getPointRateEarn(),
      getEarnPerProductCoins(),
      getPointRateLegacy(),
    ]);

    res.json({
      ok: true,
      pointRatePay,
      pointRateEarn,
      earnPerProductCoins,
      pointRate: pointRateLegacy,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ===== Exports (để service khác có thể dùng) =====
module.exports = router;
module.exports.getPointRateLegacy = getPointRateLegacy;
module.exports.getPointRatePay = getPointRatePay;
module.exports.getPointRateEarn = getPointRateEarn;
module.exports.getEarnPerProductCoins = getEarnPerProductCoins;
