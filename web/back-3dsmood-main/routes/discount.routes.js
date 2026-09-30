// routes/discount.routes.js
const router = require("express").Router();
const Discount = require("../models/Discount");
const verifyToken = require("../middlewares/verifyToken");
const { requireRole } = require("../middlewares/authMiddleware");

// Nếu đã có service coupon trước đó, bạn có thể dùng để apply theo couponCode
let previewCoupon = null;
try {
  // optional: dùng nếu bạn đã tạo services/coupon.service.js trước đó
  ({ previewCoupon } = require("../services/coupon.service"));
} catch {}

function inTimeRange(item, now = new Date()) {
  if (item.startDate && now < item.startDate) return false;
  if (item.endDate && now > item.endDate) return false;
  return true;
}

// --- Demo middleware (thay bằng auth/role thật nếu có)
function isAuth(req, res, next) { next(); }
function isAdmin(req, res, next) { next(); }

// =================== ADMIN ===================

// CREATE
router.post("/", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const payload = req.body;
    if (payload.couponCode) payload.couponCode = String(payload.couponCode).toUpperCase().trim();
    const doc = await Discount.create(payload);
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: "Create discount failed", error: err.message });
  }
});

// LIST ?q=&status=&from=&to=
router.get("/", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const { q, status } = req.query;
    const cond = {};
    if (q) cond.$or = [{ text: { $regex: q, $options: "i" } }, { couponCode: { $regex: q, $options: "i" } }];
    if (status) cond.status = status;
    const items = await Discount.find(cond).sort({ priority: -1, createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "List discount failed", error: err.message });
  }
});
router.get("/highlight", async (req, res) => {
  try {
    const limitNum = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const now = new Date();

    // chỉ lấy active + trong khung thời gian
    const all = await Discount.find({ status: "active" })
      .sort({ priority: -1, percent: -1, createdAt: -1 })
      .lean();

    const items = all.filter(d => inTimeRange(d, now)).slice(0, limitNum);

    const ASSET_BASE =
      process.env.ASSET_BASE_URL ||
      process.env.STATIC_BASE_URL ||
      process.env.API_BASE_URL ||
      "";

    const data = items.map(d => ({
      _id: d._id,
      text: d.text,
      percent: Math.round(d.percent),
      couponCode: d.couponCode || null,
      icon: d.icon
        ? (/^https?:\/\//i.test(d.icon) ? d.icon : `${ASSET_BASE}/${String(d.icon || "").replace(/^\/+/, "")}`)
        : null,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("[GET /api/discounts/highlight]", err.name, err.message);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});
// DETAIL
router.get("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const doc = await Discount.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: "Get discount failed", error: err.message });
  }
});

// UPDATE
router.put("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.couponCode) payload.couponCode = String(payload.couponCode).toUpperCase().trim();
    const doc = await Discount.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: "Update discount failed", error: err.message });
  }
});

// TOGGLE
router.patch("/:id/toggle", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const doc = await Discount.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Not found" });
    doc.status = doc.status === "active" ? "inactive" : "active";
    await doc.save();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: "Toggle failed", error: err.message });
  }
});

// DELETE
router.delete("/:id", verifyToken, requireRole("admin"), async (req, res) => {
  try {
    const ok = await Discount.findByIdAndDelete(req.params.id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: err.message });
  }
});

// =================== PUBLIC ===================

// GET public badges -> trả tối giản cho UI: [{_id, percent, text}]
router.get("/public/list", async (req, res) => {
  try {
    const now = new Date();
    const items = await Discount.find({ status: "active" })
      .sort({ priority: -1, createdAt: -1 });

    const visible = items.filter((x) => inTimeRange(x, now));
    res.json(
      visible.map((x) => ({
        _id: x._id,
        percent: Math.round(x.percent),
        text: x.text,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: "Public list failed", error: err.message });
  }
});

// APPLY 1 badge -> trả về { ok, discount, finalTotal, ui: {percent, text} }
// Nếu badge gắn couponCode và bạn có services/coupon.service.js thì sẽ apply theo couponCode
router.post("/apply", async (req, res) => {
  try {
    const { discountId, userId, cartItems = [], orderTotal = null, mini = false } = req.body;

    const doc = await Discount.findById(discountId);
    if (!doc) return res.status(404).json({ message: "Not found" });
    if (doc.status !== "active" || !inTimeRange(doc)) {
      return res.status(400).json({ message: "Discount is inactive or out of time" });
    }

    // base total
    const computedCartTotal = cartItems.reduce((s, i) => {
      const price = Number(i.price || 0);
      const qty = Number(i.qty || 1);
      return s + price * qty;
    }, 0);
    const baseTotal = typeof orderTotal === "number" ? orderTotal : computedCartTotal;

    let discountAmount = Math.round((baseTotal * doc.percent) / 100);
    let uiPercent = Math.round(doc.percent);

    // Nếu có couponCode và service coupon khả dụng -> chạy preview coupon để kiểm tra đúng logic coupon
    if (doc.couponCode && typeof previewCoupon === "function") {
      try {
        const r = await previewCoupon({
          code: doc.couponCode,
          userId,
          cartItems,
          orderTotal: baseTotal,
        });
        if (r.ok) {
          discountAmount = r.discount;
          // Nếu coupon là fixed thì quy đổi ra %
          const safeBase = baseTotal > 0 ? baseTotal : 1;
          uiPercent = r.coupon.type === "percentage" ? Math.round(r.coupon.value) : Math.round((r.discount / safeBase) * 100);
        }
      } catch {}
    }

    const ui = { percent: uiPercent, text: doc.text };

    if (mini) return res.json(ui);

    return res.json({
      ok: true,
      discount: discountAmount,
      finalTotal: Math.max(0, Math.round(baseTotal - discountAmount)),
      ui,
      code: doc.couponCode || null,
    });
  } catch (err) {
    res.status(500).json({ message: "Apply failed", error: err.message });
  }
});
module.exports = router;
