// routes/sepay.routes.js
const router = require("express").Router();
const DepositPack = require("../models/DepositPack");
const DepositOrder = require("../models/DepositOrder");
const verifyToken = require("../middlewares/verifyToken");
const User = require("../models/Users");

/* ===== Utils ===== */
function roundVND(n) {
  return Math.round(Number(n) || 0);
}
function effectiveUnit(amount, discount) {
  return roundVND(Number(amount) * (1 - (Number(discount) || 0) / 100));
}
function calcTotal(amount, quantity, discount) {
  return roundVND(effectiveUnit(amount, discount) * Number(quantity || 0));
}
function genOrderCode() {
  const ts = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DEP-${ts}-${r}`;
}

/** Build QR SePay (chuẩn link ảnh QR của SePay) */
function buildSePayQR({ bank, accountNo, amount, description }) {
  const base = "https://qr.sepay.vn/img";
  const qs = new URLSearchParams({
    bank: String(bank || ""),
    acc: String(accountNo || ""),
    amount: String(amount || ""),
    des: String(description || ""),
  });
  return `${base}?${qs.toString()}`;
}

/* ===== Helpers bắt mã đơn từ content bank ===== */
// Bắt cả 2 dạng: "DEP-XXXX" (có gạch) và "DEPXXXXXXXX" (dính liền)
function extractDepTokens(str) {
  const up = String(str || "").toUpperCase();
  const exact = up.match(/DEP-[A-Z0-9-]{4,}/g) || [];     // có gạch
  const compact = up.match(/DEP[A-Z0-9]{6,40}/g) || [];   // dính liền
  return { exact, compact };
}

// Tạo regex cho phép "dấu gạch" xuất hiện linh hoạt giữa các ký tự của token compact
// Ví dụ 'DEPMEN8172CWGOT' -> /^D-?E-?P-?M-?E-?N-?8-?1-?7-?2-?C-?W-?G-?O-?T$/i
function hyphenFlexibleRegexFromCompact(compactToken) {
  const safe = String(compactToken || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!safe) return null;
  const body = safe.split("").map(ch => `${ch}-?`).join("");
  return new RegExp("^" + body + "$", "i");
}

/* ===== API ===== */

/**
 * POST /api/sepay/deposit/initiate
 * body: { packId?, quantity, amount?, discount? }
 * - Nếu có packId: lấy amount/discount từ pack (isActive=true, currency=VND)
 * - Nếu không có packId: dùng amount/discount từ body
 * Trả: { orderCode, status, total, currency, qrUrl, bank }
 */
router.post("/deposit/initiate", verifyToken,  async (req, res) => {
  try {
    const {
      packId,
      quantity = 1,
      // fallback cho case không dùng packId
      amount: rawAmount,
      discount: rawDiscount = 0,
      currency = "VND",
    } = req.body || {};

    let packDoc = null;
    let amount = roundVND(rawAmount);
    let discount = Number(rawDiscount) || 0;

    if (packId) {
      packDoc = await DepositPack.findOne({ _id: packId, isActive: true, currency }).lean();
      if (!packDoc) {
        return res.status(400).json({ message: "Pack không hợp lệ hoặc đã tắt" });
      }
      amount = roundVND(packDoc.amount);
      discount = Number(packDoc.discount || 0);
    } else {
      if (!amount || !quantity) {
        return res.status(400).json({ message: "Thiếu amount/quantity" });
      }
    }

    const total = calcTotal(amount, quantity, discount);
    const orderCode = genOrderCode();

    // cấu hình tài khoản nhận từ ENV
    const bank = process.env.RECEIVER_BANK || "Vietcombank"; // VD: "TPBank"
    const accountNo = process.env.RECEIVER_ACCOUNT_NO || "0010000000355";
    const accountName = process.env.RECEIVER_ACCOUNT_NAME || "TEN CHU TAI KHOAN";

    const qrUrl = buildSePayQR({
      bank,
      accountNo,
      amount: total,
      description: orderCode,
    });

    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const order = await DepositOrder.create({
      orderCode,
      userId: uid || undefined,
      packId: packDoc?._id || undefined,
      packSnapshot: packDoc
        ? {
            _id: packDoc._id,
            amount: packDoc.amount,
            discount: packDoc.discount,
            title: packDoc.title,
            note: packDoc.note,
            isActive: packDoc.isActive,
            sortOrder: packDoc.sortOrder,
            currency: packDoc.currency,
            metadata: packDoc.metadata ?? null,
          }
        : undefined,
      amountPerPack: amount,
      quantity: Number(quantity),
      discount,
      total,
      currency,
      status: "pending",
      bank: { nameOrCode: bank, accountNo, accountName },
      qr: { provider: "sepay", url: qrUrl },
    });

    res.status(201).json({
      orderCode: order.orderCode,
      status: order.status,
      total: order.total,
      currency: order.currency,
      qrUrl,
      bank: order.bank,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/sepay/deposit/:orderCode/status
 *  - FE poll trạng thái thanh toán
 */
router.get("/deposit/:orderCode/status", async (req, res) => {
  try {
    const order = await DepositOrder.findOne({ orderCode: req.params.orderCode }).lean();
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn" });
    res.json({
      orderCode: order.orderCode,
      status: order.status,
      total: order.total,
      currency: order.currency,
      paidAt: order.confirmedAt || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/sepay/webhook
 *  - Đặt URL này trong dashboard SePay (Sự kiện: có tiền vào)
 *  - Header: Authorization: Apikey <KEY>  (cũng chấp nhận chỉ "<KEY>")
 */
router.post("/webhook", async (req, res) => {
  try {
    // 1) Xác thực webhook
    const expectedKey = (process.env.SEPAY_WEBHOOK_APIKEY || "").trim();
    if (expectedKey) {
      const auth = (req.get("Authorization") || "").trim();
      let ok = false;
      if (auth === expectedKey) ok = true;
      const m = auth.match(/Apikey\s+(.+)/i);
      if (m && m[1].trim() === expectedKey) ok = true;
      if (!ok) {
        return res.status(401).json({ success: false, message: "Invalid API key" });
      }
    }

    // 2) Payload từ SePay
    const data = req.body || {};
    const {
      id,                   // Number theo model (ví dụ 21125637)
      gateway,              // TPBank, ...
      transactionDate,
      accountNumber,
      code,                 // thường null
      content,              // ...DEPMEN8172CWGOT...
      transferType,         // "in"
      transferAmount,       // VND
      referenceCode,
    } = data;

    // 3) Chỉ xử lý tiền vào
    if (String(transferType).toLowerCase() !== "in") {
      return res.status(200).json({ success: true, ignored: true, reason: "NOT_IN" });
    }

    // 4) Chống trùng theo transactionId (Number)
    if (id !== undefined && id !== null) {
      const txIdNum = Number(id);
      if (!Number.isNaN(txIdNum)) {
        const dup = await DepositOrder.findOne({ "sepay.transactionId": txIdNum });
        if (dup) {
          return res.status(201).json({ success: true, duplicate: true, orderCode: dup.orderCode });
        }
      }
    }

    // 5) Tìm order theo code hoặc content
    let order = null;

    // a) Nếu có code → thử exact rồi fallback regex linh hoạt
    if (code) {
      const upCode = String(code).toUpperCase();
      order = await DepositOrder.findOne({ orderCode: upCode });
      if (!order) {
        const rxFromCode = hyphenFlexibleRegexFromCompact(upCode);
        if (rxFromCode) {
          order = await DepositOrder.findOne({ orderCode: { $regex: rxFromCode } });
        }
      }
    }

    // b) Nếu chưa thấy và có content → tách token DEP-... và DEP...
    if (!order && content) {
      const { exact, compact } = extractDepTokens(content);

      // Ưu tiên exact
      for (const t of exact) {
        order = await DepositOrder.findOne({ orderCode: t });
        if (order) break;
      }

      // Sau đó compact: dùng regex cho phép gạch tùy ý
      if (!order) {
        for (const t of compact) {
          const rx = hyphenFlexibleRegexFromCompact(t);
          if (!rx) continue;
          order = await DepositOrder.findOne({ orderCode: { $regex: rx } });
          if (order) break;
        }
      }
    }

    if (!order) {
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "NO_ORDER_CODE",
        debug: { code, contentPreview: String(content || "").slice(0, 160) }
      });
    }

    // 6) Ghi dấu vết sepay (trước khi xét tiền)
    const txIdNum = (id !== undefined && id !== null) ? Number(id) : undefined;
    await DepositOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          "sepay.webhook": data,
          "sepay.transactionId": Number.isNaN(txIdNum) ? order?.sepay?.transactionId : txIdNum,
          "sepay.transactionDate": transactionDate,
          "sepay.referenceCode": referenceCode,
          "sepay.content": content,
          "sepay.transferAmount": roundVND(transferAmount),
          "sepay.accountNumber": accountNumber,
          "sepay.gateway": gateway,
        },
      }
    );

    // 7) Đối soát số tiền
    const amt = roundVND(transferAmount);
    const need = roundVND(order.total);

    // Nếu lệch tiền → chỉ log mismatch, KHÔNG set paid
    if (amt !== need) {
      return res.status(200).json({ success: true, mismatch: true, received: amt, need });
    }

    // 8) Đủ tiền → set paid (idempotent)
    await DepositOrder.updateOne(
      { _id: order._id, status: { $ne: "paid" } },
      {
        $set: {
          status: "paid",
          confirmedAt: new Date(),
        },
      }
    );

    // 9) CREDIT COINS (idempotent)
    const coinsToCredit = Math.max(0, Number(order.total) || 0); // 1 coin = 1 VND (đổi công thức nếu muốn)
    const toCredit = await DepositOrder.findOneAndUpdate(
      { _id: order._id, credited: { $ne: true } },
      { $set: { credited: true, creditedCoins: coinsToCredit, creditedAt: new Date() } },
      { new: true }
    );

    if (toCredit && order.userId) {
      const updatedUser = await User.findByIdAndUpdate(
        order.userId,
        { $inc: { coins: coinsToCredit } },
        { new: true }
      );
      if (updatedUser) {
        await DepositOrder.updateOne(
          { _id: order._id },
          { $set: { creditedUserBalanceAfter: updatedUser.coins } }
        );
      }
    }

    return res.status(201).json({ success: true, paid: true, orderCode: order.orderCode });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
