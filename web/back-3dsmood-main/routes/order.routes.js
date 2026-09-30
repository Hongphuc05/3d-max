// routes/order.routes.js
const router = require("express").Router();
const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/Users");
const Product = require("../models/Product");
const Discount = require("../models/Discount");
const verifyToken = require('../middlewares/verifyToken');
const Setting = require("../models/Setting");
// Nếu bạn đã có services coupon trước đó
let previewCoupon = null, redeemCoupon = null;
try {
  ({ previewCoupon, redeemCoupon } = require("../services/coupon.service"));
} catch {}

function endOfDay(d) { const t = new Date(d); t.setHours(23,59,59,999); return t; }
function inTimeRange(item, now = new Date()) {
  const sOK = !item.startDate || now >= new Date(item.startDate);
  const eOK = !item.endDate || now <= endOfDay(item.endDate);
  return sOK && eOK;
}
  
// ---- Thay bằng middleware auth thực tế của bạn
function isAuth(req, res, next) {
  // YÊU CẦU: gắn req.user = { _id, role, ... } sau khi xác thực
  if (!req.user?._id) return res.status(401).json({ message: "Unauthenticated" });
  next();
}

/**
 * POST /api/orders/buy
 * body: { productIds: [id], couponCode?, discountId? }
 * Trả: { ok, orderId, coinsLeft, purchasedNew, alreadyOwned }
 */
// router.post("/buy", verifyToken, async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const { productIds = [], couponCode, discountId } = req.body;

//     if (!Array.isArray(productIds) || productIds.length === 0) {
//       return res.status(400).json({ message: "productIds is empty" });
//     }

//     // Lấy sản phẩm & map giá
//     const ids = [...new Set(productIds.map((x) => new mongoose.Types.ObjectId(String(x))))];
//     const products = await Product.find({ _id: { $in: ids } }, { price: 1 });
//     if (products.length === 0) return res.status(404).json({ message: "Products not found" });

//     // Lấy user (để biết coins & purchased)
//     const user = await User.findById(userId).lean();
//     if (!user) return res.status(404).json({ message: "User not found" });

//     const ownedSet = new Set((user.purchased || []).map((p) => String(p.productId)));
//     const freeSet  = new Set(products.filter(p => Number(p.price || 0) === 0).map(p => String(p._id)));

//     const toCharge = [];
//     const alreadyOwned = [];
//     const allToGrant = []; // tất cả sản phẩm sẽ add vào purchased (kể cả free)

//     for (const p of products) {
//       const pid = String(p._id);
//       const price = Number(p.price || 0);
//       const already = ownedSet.has(pid);
//       if (already) alreadyOwned.push(pid);
//       else allToGrant.push(pid);
//       if (!already && price > 0) toCharge.push({ pid, price });
//     }

//     const subtotal = toCharge.reduce((s, i) => s + i.price, 0);

//     // TÍNH DISCOUNT (ưu tiên couponCode nếu có)
//     let discount = 0, appliedCoupon = null, appliedDiscountId = null;

//     if (subtotal > 0) {
//       if (couponCode && typeof previewCoupon === "function") {
//         const cartItems = toCharge.map(i => ({ productId: i.pid, price: i.price, qty: 1 }));
//         const r = await previewCoupon({ code: couponCode, userId, cartItems, orderTotal: subtotal });
//         if (r.ok) { discount = r.discount; appliedCoupon = couponCode.toUpperCase(); }
//       } else if (discountId) {
//         const d = await Discount.findById(discountId);
//         if (d && d.status === "active" && inTimeRange(d)) {
//           discount = Math.round((subtotal * Number(d.percent || 0)) / 100);
//           appliedDiscountId = d._id;
//           // Nếu d.couponCode có & previewCoupon khả dụng => chuẩn hóa theo coupon:
//           if (d.couponCode && typeof previewCoupon === "function") {
//             const cartItems = toCharge.map(i => ({ productId: i.pid, price: i.price, qty: 1 }));
//             const r = await previewCoupon({ code: d.couponCode, userId, cartItems, orderTotal: subtotal });
//             if (r.ok) { discount = r.discount; appliedCoupon = d.couponCode; }
//           }
//         }
//       }
//     }

//     discount = Math.min(discount, subtotal);
//     const finalTotal = Math.max(0, subtotal - discount);

//     // Nếu chỉ có hàng free hoặc đã sở hữu hết -> finalTotal = 0 vẫn OK, vẫn tạo order & grant quyền
//     if (finalTotal > 0 && (user.coins || 0) < finalTotal) {
//       return res.status(400).json({ message: "Không đủ coins", need: finalTotal, have: user.coins || 0 });
//     }

//     // Cập nhật user: trừ coins + add purchased + xoá khỏi cart (nếu có)
//     const now = new Date();
//     const bulkPurchasedDocs = allToGrant.map(pid => ({ productId: pid, purchasedAt: now }));
//     const update = {
//       $pull: { cart: { productId: { $in: ids } } },
//     };
//     if (finalTotal > 0) update.$inc = { coins: -finalTotal };

//     // Không dùng $addToSet cho embedded vì so sánh object; ta thêm sau khi lọc duplicates phía trên
//     const updated = await User.findOneAndUpdate(
//       { _id: userId, ...(finalTotal > 0 ? { coins: { $gte: finalTotal } } : {}) },
//       { 
//         ...update,
//         $push: { purchased: { $each: bulkPurchasedDocs } }
//       },
//       { new: true }
//     );
//     if (!updated) return res.status(409).json({ message: "Thanh toán thất bại (race condition)" });

//     // Tạo order
//     const items = toCharge.map(i => ({ product: i.pid, price: i.price }));
//     const order = await Order.create({
//       user: userId,
//       items,
//       subtotal,
//       discount,
//       finalTotal,
//       paymentMethod: "coins",
//       couponCode: appliedCoupon,
//       discountId: appliedDiscountId,
//       status: "paid",
//     });

//     // Redeem coupon (nếu có)
//     if (appliedCoupon && typeof redeemCoupon === "function") {
//       try { await redeemCoupon({ code: appliedCoupon, userId }); } catch {}
//     }

//     res.json({
//       ok: true,
//       orderId: order._id,
//       coinsLeft: updated.coins,
//       purchasedNew: allToGrant, // những id mới được grant (kể cả free)
//       alreadyOwned,
//     });
//   } catch (err) {
//     console.error("BUY ERROR:", err);
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// });


let ext = {};
try { ext = require("../utils/discount"); } catch { ext = {}; }
const inTimeRangeExt = ext.inTimeRange;
const previewCouponExt = ext.previewCoupon;
const redeemCouponExt = ext.redeemCoupon;

/* -------------------- Settings helpers -------------------- */
async function getPointRate() {
  const DEFAULT = Number(process.env.POINT_RATE || 15000);
  const doc = await Setting.findOne({ key: "point_rate_pay" });
  return doc ? Number(doc.value) || DEFAULT : DEFAULT;
}

async function getEarnPerProductCoins() {
  const DEFAULT = Number(process.env.EARN_POINTS_PER_PRODUCT_COINS || 10);
  const doc = await Setting.findOne({ key: "earn_points_per_product_coins" });
  return doc ? Number(doc.value) || DEFAULT : DEFAULT;
}

/* -------------------- Local discount fallbacks -------------------- */
function pickStart(d) { return d?.startAt || d?.startDate || d?.start || null; }
function pickEnd(d) { return d?.endAt || d?.endDate || d?.end || null; }
function inTimeRangeFallback(d) {
  const now = new Date();
  const s = pickStart(d);
  const e = pickEnd(d);
  if (s && now < new Date(s)) return false;
  if (e && now > new Date(e)) return false;
  return true;
}
async function previewCouponFallback({ code, /* userId, cartItems, */ orderTotal }) {
  if (!code) return { ok: false, discount: 0 };
  const norm = String(code).trim();
  if (!norm) return { ok: false, discount: 0 };

  const d = await Discount.findOne({
    couponCode: { $regex: `^${norm}$`, $options: "i" },
    status: "active",
  }).lean();

  if (!d) return { ok: false, discount: 0 };
  if (!inTimeRangeFn(d)) return { ok: false, discount: 0 };

  const percent = Number(d.percent || 0);
  if (!(percent > 0)) return { ok: false, discount: 0 };

  const raw = Math.round((Number(orderTotal || 0) * percent) / 100);
  const discount = Math.max(0, raw);
  return { ok: discount > 0, discount, couponCode: d.couponCode };
}
async function redeemCouponFallback(/* { code, userId } */) { return true; }

// Quyết định hàm sử dụng thực tế (external nếu có, ngược lại dùng fallback)
const inTimeRangeFn = typeof inTimeRangeExt === "function" ? inTimeRangeExt : inTimeRangeFallback;
const previewCouponFn = typeof previewCouponExt === "function" ? previewCouponExt : previewCouponFallback;
const redeemCouponFn = typeof redeemCouponExt === "function" ? redeemCouponExt : redeemCouponFallback;

/* -------------------- BUY -------------------- */
/* -------------------- BUY -------------------- */
router.post("/buy", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { productIds = [], couponCode, discountId, paymentMethod = "coins" } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "productIds is empty" });
    }

    const ids = [...new Set(productIds.map((x) => new mongoose.Types.ObjectId(String(x))))];

    // chỉ lấy giá
    const products = await Product.find({ _id: { $in: ids } }, { price: 1 });
    if (products.length === 0) return res.status(404).json({ message: "Products not found" });

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // Tách món đã sở hữu / cần tính phí
    const ownedSet = new Set((user.purchased || []).map((p) => String(p.productId)));
    const toCharge = [];     // item sẽ tính phí (chưa mua & price>0)
    const alreadyOwned = []; // đã mua rồi
    const allToGrant = [];   // tất cả sẽ grant (kể cả free)

    for (const p of products) {
      const pid = String(p._id);
      const price = Number(p.price || 0);
      const already = ownedSet.has(pid);

      if (already) alreadyOwned.push(pid);
      else allToGrant.push(pid);

      if (!already && price > 0) toCharge.push({ pid, price });
    }

    const subtotal = toCharge.reduce((s, i) => s + i.price, 0);

    /* -------------------- DISCOUNT -------------------- */
    let discount = 0, appliedCoupon = null, appliedDiscountId = null;

    if (subtotal > 0) {
      // Ưu tiên couponCode nếu có
      if (couponCode) {
        const r = await previewCouponFn({
          code: couponCode,
          userId,
          cartItems: toCharge.map(i => ({ productId: i.pid, price: i.price, qty: 1 })),
          orderTotal: subtotal,
        });
        if (r?.ok) {
          discount = r.discount;
          appliedCoupon = String(couponCode).toUpperCase();
        }
      }
      // Nếu không có coupon hợp lệ, thử discountId
      if (!appliedCoupon && discountId) {
        const d = await Discount.findById(discountId).lean();
        if (d && d.status === "active" && inTimeRangeFn(d)) {
          const percent = Number(d.percent || 0);
          if (percent > 0) {
            discount = Math.round((subtotal * percent) / 100);
            appliedDiscountId = d._id;

            // Nếu bản ghi có couponCode, tính lại bằng previewCoupon cho đồng nhất
            if (d.couponCode) {
              const r = await previewCouponFn({
                code: d.couponCode,
                userId,
                cartItems: toCharge.map(i => ({ productId: i.pid, price: i.price, qty: 1 })),
                orderTotal: subtotal,
              });
              if (r?.ok) {
                discount = r.discount;
                appliedCoupon = d.couponCode;
              }
            }
          }
        }
      }
    }

    discount = Math.min(discount, subtotal);
    const finalTotal = Math.max(0, subtotal - discount); // coins

    /* -------------------- CHECK & DEDUCT / EARN -------------------- */
    let orderPaymentMethod = "coins";
    let pointsUsed = 0;
    let earnedPoints = 0;

    if (finalTotal > 0) {
      if (paymentMethod === "points") {
        const rate = await getPointRate();              // coins / 1 điểm
        pointsUsed = Math.ceil(finalTotal / rate);
        if ((user.points || 0) < pointsUsed) {
          return res.status(400).json({
            message: "Không đủ điểm",
            needPoints: pointsUsed,
            havePoints: user.points || 0,
            pointRate: rate,
          });
        }
        orderPaymentMethod = "points";
      } else { // coins
        if ((user.coins || 0) < finalTotal) {
          return res.status(400).json({ message: "Không đủ coins", need: finalTotal, have: user.coins || 0 });
        }
        // Thưởng điểm: mỗi sản phẩm tính phí
        const earnPerProductCoins = await getEarnPerProductCoins();
        earnedPoints = (toCharge.length > 0 ? earnPerProductCoins * toCharge.length : 0);
      }
    }

    /* -------------------- UPDATE USER + GRANT -------------------- */
    const now = new Date();
    const bulkPurchasedDocs = allToGrant.map(pid => ({ productId: pid, purchasedAt: now }));

    const update = {
      $pull: { cart: { productId: { $in: ids } } },
      $push: { purchased: { $each: bulkPurchasedDocs } }
    };

    if (finalTotal > 0) {
      update.$inc = update.$inc || {};
      if (orderPaymentMethod === "points") {
        update.$inc.points = -pointsUsed;
      } else {
        update.$inc.coins = -finalTotal;
        if (earnedPoints > 0) update.$inc.points = (update.$inc.points || 0) + earnedPoints;
      }
    }

    const guard = finalTotal > 0
      ? (orderPaymentMethod === "points" ? { points: { $gte: pointsUsed } } : { coins: { $gte: finalTotal } })
      : {};

    const updated = await User.findOneAndUpdate(
      { _id: userId, ...guard },
      update,
      { new: true }
    );

    if (!updated) {
      return res.status(409).json({ message: "Thanh toán thất bại (race condition)" });
    }

    // ====== Snapshot số dư sau thanh toán ======
    const balanceAfter = (orderPaymentMethod === "points")
      ? (typeof updated.points === "number" ? updated.points : null)
      : (typeof updated.coins  === "number" ? updated.coins  : null);

    const pointsAfter = (typeof updated.points === "number" ? updated.points : null);
    /* -------------------- ORDER RECORD -------------------- */
    const items = toCharge.map(i => ({ product: i.pid, price: i.price }));
    const order = await Order.create({
      user: userId,
      items,
      subtotal,
      discount,
      finalTotal,
      paymentMethod: orderPaymentMethod,                 // "coins" | "points"
      pointsUsed:   orderPaymentMethod === "points" ? pointsUsed   : 0,
      earnedPoints: orderPaymentMethod === "coins"  ? earnedPoints : 0,
      couponCode: appliedCoupon,
      discountId: appliedDiscountId,
      status: "paid",
      balanceAfter, // snapshot sau giao dịch
      pointsAfter,
    });

    // Ghi nhận coupon dùng (nếu muốn)
    if (appliedCoupon) {
      try { await redeemCouponFn({ code: appliedCoupon, userId }); } catch {}
    }

    /* -------------------- INCREMENT purchasedCount -------------------- */
    // Tăng cho TẤT CẢ sản phẩm vừa được cấp quyền (free & trả phí)
    // (nếu bạn muốn CHỈ đếm hàng trả phí, thay allToGrant bằng toCharge.map(i => i.pid))
    try {
      if (allToGrant.length > 0) {
        const grantObjIds = allToGrant
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));

        if (grantObjIds.length > 0) {
          await Product.updateMany(
            { _id: { $in: grantObjIds } },
            { $inc: { purchasedCount: 1 } }
          );
        }
      }
    } catch (e) {
      console.warn("Failed to increment purchasedCount:", e?.message || e);
    }

    /* -------------------- RESPONSE -------------------- */
    res.json({
      ok: true,
      orderId: order._id,
      purchasedNew: allToGrant, // các productId vừa được grant
      alreadyOwned,
      earnedPoints,
      balances: {
        wallet: updated.coins,
        points: updated.points,
      }
    });

  } catch (err) {
    console.error("BUY ERROR:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});



/**
 * GET /api/orders/owned?ids=a,b,c
 * Trả: { owned: [id,...] }
 */
router.get("/owned", verifyToken, async (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return res.json({ owned: [] });

    const user = await User.findById(req.user._id, { purchased: 1 }).lean();
    const ownedSet = new Set((user?.purchased || []).map((p) => String(p.productId)));
    const owned = ids.filter((id) => ownedSet.has(String(id)));
    res.json({ owned });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
// routes/orders.js (trích riêng endpoint /used)
const TZ = "Asia/Ho_Chi_Minh";
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  });
}
function toDisplayOrderId(mongoId) {
  const s = String(mongoId);
  return "ID" + s.slice(-6).toUpperCase();
}

router.get("/used", verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid || !mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const page  = Math.max(parseInt(req.query.page || "1", 10), 1);

    const q = { user: uid, status: "paid" };

    // === Lọc theo phương thức thanh toán (mới): ?payment=coins|points
    const payment = String(req.query.payment || "").toLowerCase();
    if (payment === "coins" || payment === "points") {
      q.paymentMethod = payment;
    }

    // Lọc theo khoảng thời gian (tùy chọn)
    const { from, to } = req.query;
    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = new Date(from);
      if (to)   q.createdAt.$lte = new Date(to);
    }

    const [docs, total] = await Promise.all([
      Order.find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        // CẦN lấy thêm paymentMethod + pointsUsed để map amount đúng như yêu cầu
        .select("_id finalTotal balanceAfter createdAt paymentMethod pointsUsed")
        .lean(),
      Order.countDocuments(q),
    ]);

  // ... trong router.get("/used", verifyToken, async (req, res) => { ... })

      const rows = docs.map(o => {
        const used = (o.paymentMethod === "points")
          ? (o.pointsUsed || 0)
          : (o.finalTotal || 0);

        return {
          id: String(o._id),               // ← THÊM DÒNG NÀY
          time:    fmtTime(o.createdAt),
          date:    fmtDate(o.createdAt),
          orderId: toDisplayOrderId(o._id),
          amount:  used,
          balance: o.balanceAfter ?? null,
          paymentMethod: o.paymentMethod,
        };
      });


    // Tổng đã dùng trên trang hiện tại (cùng logic với cột amount ở trên)
    const totalUsedPage = rows.reduce((s, r) => s + (r.amount || 0), 0);

    return res.json({
      ok: true,
      pagination: { page, limit, total },
      summary: { totalUsedPage },
      rows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Server error" });
  }
});



    function isObjectId(id) {
      return mongoose.Types.ObjectId.isValid(id);
    }
    
    function escapeRegExp(str = "") {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    
    function parseSort(sortStr) {
      // Examples: "createdAt:-1", "finalTotal:1,createdAt:-1"
      if (!sortStr) return { createdAt: -1 };
      const out = {};
      String(sortStr)
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((p) => {
          const [k, v] = p.split(":");
          if (!k) return;
          const n = Number(v);
          out[k] = Number.isNaN(n) ? -1 : (n >= 0 ? 1 : -1);
        });
      if (Object.keys(out).length === 0) out.createdAt = -1;
      return out;
    }
    
    function toDateRange(from, to) {
      const cond = {};
      if (from) {
        const d = new Date(from);
        if (!isNaN(d)) {
          d.setHours(0,0,0,0);
          cond.$gte = d;
        }
      }
      if (to) {
        const d = new Date(to);
        if (!isNaN(d)) {
          d.setHours(23,59,59,999);
          cond.$lte = d;
        }
      }
      return Object.keys(cond).length ? cond : null;
    }
    
    // --- Auth helpers (adjust to your project) ---
    // Expect req.user injected by your auth middleware (JWT/Passport).
    // req.user.role === 'admin' OR req.user.isAdmin === true for admin.
 
    
    // Build shared filter from query
    async function buildFilter(req) {
      const {
        q: qRaw = "",
        status,
        method,
        from,
        to,
      } = req.query;
    
      const cond = {};
    
      if (status && ["paid", "failed"].includes(String(status))) {
        cond.status = status;
      }
      if (method && typeof method === "string" && method !== "all") {
        cond.paymentMethod = method;
      }
    
      const dr = toDateRange(from, to);
      if (dr) cond.createdAt = dr;
    
      const q = String(qRaw).trim();
      if (q) {
        const regex = new RegExp(escapeRegExp(q), "i");
    
        // Try lookup users by email/username
        const users = await User.find({
          $or: [{ email: regex }, { username: regex }],
        })
          .select("_id")
          .lean();
        const userIds = users.map((u) => u._id);
    
        const or = [{ couponCode: regex }];
    
        if (userIds.length) or.push({ user: { $in: userIds } });
    
        if (isObjectId(q)) {
          or.push({ _id: new mongoose.Types.ObjectId(q) });
        }
    
        cond.$or = or;
      }
    
      return cond;
    }
    
    function buildPageLimit(req) {
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
      const skip = (page - 1) * limit;
      return { page, limit, skip };
    }
    
    function maybePopulate(query, populateFlag) {
      if (String(populateFlag) === "1" || String(populateFlag).toLowerCase() === "true") {
        query = query
          .populate({ path: "user", select: "username email" })
          .populate({ path: "items.product", select: "name sku price" })
          .populate({ path: "discountId", select: "couponCode text percent" });
          }
      return query;
    }
    router.get("/admin", verifyToken,async (req, res) => {
      try {
        const cond = await buildFilter(req);
        const { page, limit, skip } = buildPageLimit(req);
        const sort = parseSort(req.query.sort);
    
        const [total, items] = await Promise.all([
          Order.countDocuments(cond),
          maybePopulate(
            Order.find(cond).sort(sort).skip(skip).limit(limit),
            req.query.populate
          ).lean(),
        ]);
    
        return res.json({ page, limit, total, items });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ message: e.message || "Server error" });
      }
    });
    // routes/orders.js
    router.get("/client/:id", verifyToken, async (req, res) => {
      try {
      const uid = req.user?._id;
      const { id } = req.params;
      if (!uid || !mongoose.Types.ObjectId.isValid(uid) || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Bad request" });
      }
  
      // ID category dùng để nhận diện Scene ở FE/BE
      const SCENE_CATEGORY_ID = "68a55296e06aee921714659e";
  
      // ✅ chỉ populate product; KHÔNG populate categories (vì schema không có)
      const o = await Order.findOne({ _id: id, user: uid })
        .populate({
          path: "items.product",
          select: "name images previewImagePath categoryIds",
        })
        .lean();
  
      if (!o) return res.status(404).json({ message: "Order not found" });
  
      const TZ = "Asia/Ho_Chi_Minh";
      const fmtTime = (d) =>
        new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
      const fmtDate = (d) =>
        new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
      const toDisplayOrderId = (mongoId) => "ID" + String(mongoId).slice(-6).toUpperCase();
  
      const items = (o.items || []).map((it) => {
        const p = it.product || null;
  
        // Ảnh cover
        let coverPath = null;
        if (p) {
          if (Array.isArray(p.images) && p.images.length) {
            const cover = p.images.find((i) => i.isCover) || p.images[0];
            coverPath = cover?.path || null;
          }
          if (!coverPath && p.previewImagePath) coverPath = p.previewImagePath;
        }
  
        // Chuẩn hoá mảng category id → string
        const catIds = Array.isArray(p?.categoryIds) ? p.categoryIds.map(String) : [];
        const isScene = catIds.includes(String(SCENE_CATEGORY_ID));
  
        return {
          product: p
            ? {
                _id: p._id,
                name: p.name,
                coverPath,                 // FE: buildUrl(coverPath)
                previewImagePath: p.previewImagePath || null,
                catIds,                    // FE dùng để so SCENE_CATEGORY_ID
                isScene,                   // (tuỳ chọn) FE dùng trực tiếp
              }
            : null,
          price: it.price,
        };
      });
  
      res.json({
        id: String(o._id),
        orderId: toDisplayOrderId(o._id),
        createdAt: o.createdAt,
        createdAtText: `${fmtDate(o.createdAt)} ${fmtTime(o.createdAt)}`,
        paymentMethod: o.paymentMethod,
        subtotal: o.subtotal,
        discount: o.discount,
        finalTotal: o.finalTotal,
        pointsUsed: o.pointsUsed,
        earnedPoints: o.earnedPoints,
        couponCode: o.couponCode,
        balanceAfter: o.balanceAfter ?? null,
        items,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Server error" });
    }
    });

    // --- GET /api/orders/:id (admin or owner) ---
    router.get("/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });
    
        let q = Order.findById(id);
        q = maybePopulate(q, req.query.populate);
        const order = await q.lean();
        if (!order) return res.status(404).json({ message: "Not found" });
    
        const isAdmin = req.user.role === "admin" || req.user.isAdmin === true;
        if (!isAdmin && String(order.user) !== String(req.user._id)) {
          return res.status(403).json({ message: "Forbidden" });
        }
    
        return res.json(order);
      } catch (e) {
        console.error(e);
        return res.status(500).json({ message: e.message || "Server error" });
      }
    });
    
    // --- PATCH /api/orders/:id/status (admin only) ---
    router.patch("/:id/status", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { status, balanceAfter } = req.body || {};
    
        if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });
    
        const allowed = ["paid", "failed"];
        if (!allowed.includes(String(status))) {
          return res.status(400).json({ message: "Invalid status" });
        }
    
        const update = { status };
    
        if (balanceAfter !== undefined) {
          const n = Number(balanceAfter);
          if (Number.isFinite(n) && n >= 0) update.balanceAfter = n;
        }
    
        const order = await Order.findByIdAndUpdate(id, update, { new: true })
          .populate({ path: "user", select: "username email" })
          .populate({ path: "items.product", select: "name sku price" })
          .populate({ path: "discountId", select: "couponCode text percent" })
          .lean();
    
        if (!order) return res.status(404).json({ message: "Not found" });
    
        return res.json(order);
      } catch (e) {
        console.error(e);
        return res.status(500).json({ message: e.message || "Server error" });
      }
    });
    

module.exports = router;
