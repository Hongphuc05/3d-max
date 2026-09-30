const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/Users');

// Helpers
const pick = (obj, fields = []) =>
  fields.reduce((acc, k) => {
    if (typeof obj[k] !== 'undefined') acc[k] = obj[k];
    return acc;
  }, {});

// GET /api/admin/users
// query: q, role, page=1, limit=10, sort=createdAt:desc | username:asc | points:desc | coins:asc ...
exports.listUsers = async (req, res) => {
  try {
    let { q = '', role, page = 1, limit = 10, sort = 'createdAt:desc' } = req.query;

    const allowSortFields = new Set(['createdAt','updatedAt','username','email','points','coins']);
    let [sortField, sortDir] = String(sort).split(':');
    if (!allowSortFields.has(sortField)) sortField = 'createdAt';
    const sortObj = { [sortField]: sortDir === 'asc' ? 1 : -1 };

    const filter = {};
    if (q) {
      const re = new RegExp(String(q), 'i');
      filter.$or = [{ username: re }, { email: re }];
    }
    if (role) filter.role = role;

    const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    const [items, total] = await Promise.all([
      User.find(filter)
        .sort(sortObj)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter)
    ]);

    const data = items.map(u => ({
      ...u,
      cartCount: Array.isArray(u.cart) ? u.cart.length : 0,
      purCount:  Array.isArray(u.purchased) ? u.purchased.length : 0,
      favCount:  Array.isArray(u.favorites) ? u.favorites.length : 0, // nếu không có -> 0
      provider:  u.googleId ? 'Google' : 'Local',
      // nếu có log thì lấy mốc gần nhất, fallback updatedAt
      lastPointsAtApprox: (u.pointsHistory && u.pointsHistory[0]?.at) || u.updatedAt,
    }));

    res.json({
      data,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.max(1, Math.ceil(total / limitNum)) }
    });
  } catch (err) {
    res.status(500).json({ message: 'List users failed', error: err.message });
  }
};

// POST /api/admin/users
exports.createUser = async (req, res) => {
  try {
    const allowed = ['googleId', 'username', 'avatar', 'email', 'password', 'coins', 'points', 'role'];
    const body = pick(req.body, allowed);

    if (!body.username) return res.status(400).json({ message: 'username is required' });
    if (!body.email) return res.status(400).json({ message: 'email is required' });

    if (body.password) {
      if (String(body.password).length < 6) return res.status(400).json({ message: 'password must be >= 6 chars' });
      body.password = await bcrypt.hash(String(body.password), 10);
    }

    const user = await User.create(body);
    res.status(201).json({ data: user });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      return res.status(409).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Create user failed', error: err.message });
  }
};

// GET /api/admin/users/:id
exports.getUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ data: user });
  } catch (err) {
    res.status(500).json({ message: 'Get user failed', error: err.message });
  }
};

// PATCH /api/admin/users/:id
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const allowed = ['username', 'avatar', 'email', 'points', 'coins', 'role', 'phone', 'address'];
    const updates = pick(req.body, allowed);

    if (Object.prototype.hasOwnProperty.call(updates, 'coins')) {
      const n = Number(updates.coins);
      if (!Number.isFinite(n)) return res.status(400).json({ message: 'coins must be a number' });
      updates.coins = n;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'points')) {
      const p = Number(updates.points);
      if (!Number.isFinite(p)) return res.status(400).json({ message: 'points must be a number' });
      updates.points = p;
    }

    const user = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!user) return res.status(404).json({ message: 'Not found' });

    res.json({ data: user });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      return res.status(409).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Update user failed', error: err.message });
  }
};

// PATCH /api/admin/users/:id/password
exports.updatePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    if (!password || String(password).length < 6) return res.status(400).json({ message: 'password must be >= 6 chars' });

    const hash = await bcrypt.hash(String(password), 10);
    const user = await User.findByIdAndUpdate(id, { password: hash }, { new: true });
    if (!user) return res.status(404).json({ message: 'Not found' });

    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ message: 'Update password failed', error: err.message });
  }
};

// DELETE /api/admin/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Delete user failed', error: err.message });
  }
};

// POST /api/admin/users/:id/coins { delta: number, reason?: string }
// Ghi nhận vào DB: pointsHistory (newest-first, giữ tối đa 300 mục)
exports.adjustCoins = async (req, res) => {
  try {
    const { id } = req.params;
    const delta = Number(req.body.delta || 0);
    const reason = String(req.body.reason || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });
    if (!Number.isInteger(delta)) return res.status(400).json({ message: 'delta must be integer' });

    for (let attempt = 0; attempt < 3; attempt++) {
      const user = await User.findById(id).select('_id points');
      if (!user) return res.status(404).json({ message: 'Not found' });

      const before = Number(user.points || 0);
      const after  = Math.max(0, before + delta);

      const upd = await User.updateOne(
        { _id: user._id, points: before },
        { $set: { points: after } }
      );

      if (upd.modifiedCount === 1) {
        const at = new Date();
        const logEntry = {
          delta, before, after, at, reason,
          source: 'admin',
          byAdmin: req.user?._id || null
        };

        // ✅ Push log vào mảng, mới nhất ở đầu, và cắt còn 300
        await User.updateOne(
          { _id: user._id },
          { $push: { pointsHistory: { $each: [logEntry], $position: 0, $slice: 300 } } }
        );

        return res.json({ ok: true, before, after, delta, at, reason });
      }
      // retry nếu race condition
    }

    return res.status(409).json({ message: 'Conflict. Please retry.' });
  } catch (err) {
    res.status(500).json({ message: 'Adjust coins failed', error: err.message });
  }
};

// ===== Profile (current user) =====
// GET /api/users/me
exports.me = async (req, res) => {
  const u = req.user;
  res.json({
    data: {
      _id: u._id,
      googleId: u.googleId,
      username: u.username,
      avatar: u.avatar,
      email: u.email,
      coins: u.coins,
      role: u.role,
      cartCount: (u.cart || []).length,
      favoritesCount: (u.favorites || []).length,
      purchasedCount: (u.purchased || []).length,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }
  });
};

// PATCH /api/users/me
exports.updateMe = async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid || !mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, username, email, phone, address, avatar } = req.body;

    const updates = {};

    if (name !== undefined) {
      const val = String(name).trim();
      if (!val) return res.status(400).json({ message: "Tên tài khoản không được rỗng" });
      updates.username = val;
    }
    if (username !== undefined) {
      const val = String(username).trim();
      if (!val) return res.status(400).json({ message: "Username không được rỗng" });
      updates.username = val;
    }
    if (email !== undefined) {
      const val = String(email).trim().toLowerCase();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      if (!isEmail) return res.status(400).json({ message: "Email không hợp lệ" });
      const exists = await User.exists({ email: val, _id: { $ne: uid } });
      if (exists) return res.status(409).json({ message: "Email đã tồn tại" });
      updates.email = val;
    }
    if (phone !== undefined) {
      const val = String(phone).trim();
      if (val && !/^[0-9+()\-\s]{8,20}$/.test(val)) {
        return res.status(400).json({ message: "Số điện thoại không hợp lệ" });
      }
      updates.phone = val;
    }
    if (address !== undefined) {
      updates.address = String(address).trim();
    }
    if (avatar !== undefined) {
      updates.avatar = String(avatar).trim();
    }

    const forbidden = ["coins", "role", "password", "cart", "favorites", "purchased", "points"];
    for (const k of forbidden) {
      if (k in req.body) {
        return res.status(400).json({ message: `Không thể cập nhật trường: ${k}` });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Không có dữ liệu để cập nhật" });
    }

    const updated = await User.findByIdAndUpdate(
      uid,
      { $set: updates },
      { new: true, runValidators: true, context: "query" }
    ).select("-password");

    return res.json(updated);
  } catch (e) {
    console.error(e);
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Giá trị đã tồn tại", keyValue: e.keyValue });
    }
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/admin/users/:id/points-logs  (đọc từ DB, phân trang trên mảng)
exports.getPointsLogsTemp = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });

    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const skip  = (page - 1) * limit;

    // dùng aggregate để slice theo skip/limit ngay trên mảng
    const result = await User.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      {
        $project: {
          total: { $size: { $ifNull: ['$pointsHistory', []] } },
          data:  { $slice: [{ $ifNull: ['$pointsHistory', []] }, skip, limit] }
        }
      }
    ]);

    if (!result.length) return res.status(404).json({ message: 'Not found' });

    const total = result[0].total || 0;
    const data  = result[0].data || [];
    const pages = Math.max(1, Math.ceil(total / limit));

    res.json({ data, meta: { total, page, limit, pages } });
  } catch (err) {
    res.status(500).json({ message: 'Get logs failed', error: err.message });
  }
};
