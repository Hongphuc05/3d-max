// routes/admin.deposits.routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DepositOrder = require('../models/DepositOrder');
const User = require('../models/Users'); // lưu ý đúng path model Users của bạn
const verifyToken = require('../middlewares/verifyToken');

// ===== Helpers =====
function isObjectIdLike(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);
}
function toNumber(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function escCSV(v = '') {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}
function toNumberOrNull(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' && v.trim() === '') return null; // QUAN TRỌNG
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
// Yêu cầu quyền admin/owner
async function requireAdmin(req, res, next) {
  try {
    const uid = req.user?._id;
    if (!uid) return res.status(401).json({ message: 'Unauthorized' });
    const u = await User.findById(uid).select('role');
    if (!u || !['admin', 'owner', 'root'].includes(String(u.role).toLowerCase())) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
}

// Xây query lọc
function buildQuery(qs) {
  const {
    status, // pending|paid|cancelled
    currency, // VND
    userId,
    orderCode,
    q, // free text: tìm orderCode chứa q
    minTotal,
    maxTotal,
    from, // ISO date
    to,   // ISO date
  } = qs;

  const cond = {};
  if (status) cond.status = status;
  if (currency) cond.currency = currency;
  if (userId && isObjectIdLike(userId)) cond.userId = new mongoose.Types.ObjectId(userId);
  if (orderCode) cond.orderCode = orderCode;

  if (q) {
    cond.orderCode = { $regex: String(q), $options: 'i' };
  }

// thay bằng:
const tMin = toNumberOrNull(minTotal);
const tMax = toNumberOrNull(maxTotal);

if (tMin != null || tMax != null) {
  cond.total = {};
  if (tMin != null) cond.total.$gte = tMin;
  if (tMax != null) cond.total.$lte = tMax;
}

  if (from || to) {
    cond.createdAt = {};
    if (from) cond.createdAt.$gte = new Date(from);
    if (to) cond.createdAt.$lte = new Date(to);
  }

  return cond;
}

// ===== LIST (phân trang + lọc) =====
// GET /api/admin/deposits
router.get('/deposits', verifyToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, toNumber(req.query.page, 1));
    const limit = Math.min(200, Math.max(1, toNumber(req.query.limit, 20)));
    const sortField = req.query.sort || 'createdAt';
    const sortDir = (String(req.query.dir || 'desc').toLowerCase() === 'asc') ? 1 : -1;

    const cond = buildQuery(req.query);
    console.log('[ADMIN/LIST] req.query =', req.query);
    console.log('[ADMIN/LIST] cond =', JSON.stringify(cond));
    const [items, total] = await Promise.all([
      DepositOrder.find(cond)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DepositOrder.countDocuments(cond)
    ]);

    res.json({
      page, limit, total,
      items,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Export CSV theo filter =====
// GET /api/admin/deposits/export.csv
router.get('/deposits/export.csv', verifyToken, requireAdmin, async (req, res) => {
  try {
    const cond = buildQuery(req.query);
    const rows = await DepositOrder.find(cond).sort({ createdAt: -1 }).lean();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deposits.csv"');

    const header = [
      'orderCode','userId','status','currency','amountPerPack','quantity','discount','total','createdAt','confirmedAt','credited','creditedCoins','bankName','bankAccNo','qrUrl'
    ];
    res.write(header.join(',') + '\n');

    for (const r of rows) {
      const line = [
        escCSV(r.orderCode),
        escCSV(r.userId || ''),
        escCSV(r.status || ''),
        escCSV(r.currency || ''),
        r.amountPerPack ?? '',
        r.quantity ?? '',
        r.discount ?? '',
        r.total ?? '',
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        r.confirmedAt ? new Date(r.confirmedAt).toISOString() : '',
        r.credited ? 'true' : 'false',
        r.creditedCoins ?? '',
        escCSV(r?.bank?.nameOrCode || ''),
        escCSV(r?.bank?.accountNo || ''),
        escCSV(r?.qr?.url || ''),
      ];
      res.write(line.join(',') + '\n');
    }

    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Get by id hoặc orderCode =====
// GET /api/admin/deposits/:idOrCode
router.get('/deposits/:idOrCode', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { idOrCode } = req.params;
    const cond = isObjectIdLike(idOrCode) ? { _id: idOrCode } : { orderCode: idOrCode };
    const item = await DepositOrder.findOne(cond).lean();
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Đánh dấu PAID (idempotent) + cộng coin =====
// POST /api/admin/deposits/:idOrCode/mark-paid
router.post('/deposits/:idOrCode/mark-paid', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { idOrCode } = req.params;
    const cond = isObjectIdLike(idOrCode) ? { _id: idOrCode } : { orderCode: idOrCode };

    // Đặt trạng thái paid nếu chưa paid
    let order = await DepositOrder.findOneAndUpdate(
      { ...cond, status: { $ne: 'paid' } },
      { $set: { status: 'paid', confirmedAt: new Date() } },
      { new: true }
    );

    // Nếu đã paid sẵn, lấy lại document hiện tại
    if (!order) order = await DepositOrder.findOne(cond);
    if (!order) return res.status(404).json({ message: 'Not found' });

    // Cộng coin idempotent
    const coins = Math.max(0, Number(order.total) || 0);
    const updatedForCredit = await DepositOrder.findOneAndUpdate(
      { _id: order._id, credited: { $ne: true } },
      { $set: { credited: true, creditedCoins: coins, creditedAt: new Date() } },
      { new: true }
    );

    if (updatedForCredit && order.userId) {
      const updatedUser = await User.findByIdAndUpdate(
        order.userId,
        { $inc: { coins } },
        { new: true }
      );
      if (updatedUser) {
        await DepositOrder.updateOne(
          { _id: order._id },
          { $set: { creditedUserBalanceAfter: updatedUser.coins } }
        );
      }
    }

    const fresh = await DepositOrder.findById(order._id).lean();
    res.json(fresh);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Huỷ đơn (chỉ khi pending) =====
// POST /api/admin/deposits/:idOrCode/cancel
router.post('/deposits/:idOrCode/cancel', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { idOrCode } = req.params;
    const cond = isObjectIdLike(idOrCode) ? { _id: idOrCode } : { orderCode: idOrCode };

    const order = await DepositOrder.findOneAndUpdate(
      { ...cond, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!order) return res.status(409).json({ message: 'Không thể huỷ: chỉ huỷ khi pending' });
    res.json(order);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Thu hồi coin (rollback) nếu đã credited =====
// POST /api/admin/deposits/:idOrCode/revoke-credit
router.post('/deposits/:idOrCode/revoke-credit', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { idOrCode } = req.params;
    const cond = isObjectIdLike(idOrCode) ? { _id: idOrCode } : { orderCode: idOrCode };

    const order = await DepositOrder.findOne(cond);
    if (!order) return res.status(404).json({ message: 'Not found' });
    if (!order.credited || !order.userId) return res.status(409).json({ message: 'Đơn chưa credited hoặc không có user' });

    const dec = Math.max(0, Number(order.creditedCoins) || 0);

    // đảm bảo không âm số dư
    const updatedUser = await User.findOneAndUpdate(
      { _id: order.userId, coins: { $gte: dec } },
      { $inc: { coins: -dec } },
      { new: true }
    );
    if (!updatedUser) return res.status(409).json({ message: 'Số dư user không đủ để thu hồi' });

    await DepositOrder.updateOne(
      { _id: order._id, credited: true },
      { $set: { credited: false, creditedCoins: 0, creditedAt: null, creditedUserBalanceAfter: updatedUser.coins } }
    );

    const fresh = await DepositOrder.findById(order._id).lean();
    res.json(fresh);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ===== Thống kê theo ngày =====
// GET /api/admin/deposits/stats?from=2025-08-01&to=2025-08-31
router.get('/deposits/stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    const agg = await DepositOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            y: { $year: '$createdAt' },
            m: { $month: '$createdAt' },
            d: { $dayOfMonth: '$createdAt' },
            status: '$status',
          },
          sumTotal: { $sum: '$total' },
          count: { $sum: 1 },
        }
      },
      { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1 } }
    ]);

    res.json(agg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
