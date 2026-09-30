// routes/collection.routes.js
const router = require('express').Router();
const mongoose = require('mongoose');
const User = require('../models/Users');
const Product = require('../models/Product');
const verifyToken = require('../middlewares/verifyToken');

// helper: tạo slug đơn giản
function slugify(str='') {
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 100);
}

// đảm bảo có "Default" nếu user chưa có collection nào
async function ensureDefaultCollection(user) {
  if (!user.collections || user.collections.length === 0) {
    user.collections.push({ name: 'Default', slug: 'default', items: [] });
    await user.save();
  }
}

// GET /api/collections?productId=<id>  -> danh sách collection + cờ contains
router.get('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { productId } = req.query;

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ message: 'User not found' });

    await ensureDefaultCollection(user);

    const collections = user.collections.map(c => {
      const contains = productId
        ? c.items.some(p => String(p) === String(productId))
        : false;
      return {
        _id: c._id,
        name: c.name,
        slug: c.slug,
        count: c.items.length,
        contains
      };
    });

    res.json({ collections });
  } catch (err) {
    console.error('GET /collections error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/collections { name }
router.post('/', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const s = slugify(name);
    const existed = user.collections.find(c => c.slug === s || c.name.toLowerCase() === name.toLowerCase());
    if (existed) return res.status(409).json({ message: 'Collection name already exists' });

    user.collections.push({ name: name.trim(), slug: s, items: [] });
    await user.save();

    const created = user.collections[user.collections.length - 1];
    res.status(201).json({ collection: { _id: created._id, name: created.name, slug: created.slug, count: 0 } });
  } catch (err) {
    console.error('POST /collections error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/collections/:cid { name }
router.patch('/:cid', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { cid } = req.params;
    const { name } = req.body;

    if (!mongoose.isValidObjectId(cid)) return res.status(400).json({ message: 'Invalid collection id' });
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'Name is required' });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const col = user.collections.id(cid);
    if (!col) return res.status(404).json({ message: 'Collection not found' });

    // không cho rename trùng
    const s = slugify(name);
    const dup = user.collections.find(c => String(c._id) !== cid && (c.slug === s || c.name.toLowerCase() === name.toLowerCase()));
    if (dup) return res.status(409).json({ message: 'Collection name already exists' });

    col.name = name.trim();
    col.slug = s;
    await user.save();

    res.json({ collection: { _id: col._id, name: col.name, slug: col.slug, count: col.items.length } });
  } catch (err) {
    console.error('PATCH /collections/:cid error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/collections/:cid
router.delete('/:cid', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { cid } = req.params;
    if (!mongoose.isValidObjectId(cid)) return res.status(400).json({ message: 'Invalid collection id' });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const col = user.collections.id(cid);
    if (!col) return res.status(404).json({ message: 'Collection not found' });

    // Không cho xóa "Default" nếu muốn
    if (col.slug === 'default' || col.name.toLowerCase() === 'default') {
      return res.status(400).json({ message: 'Cannot delete Default collection' });
    }

    col.deleteOne();
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /collections/:cid error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/collections/:cid/items  { productId }
router.post('/:cid/items', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { cid } = req.params;
    const { productId } = req.body;

    if (!mongoose.isValidObjectId(cid)) return res.status(400).json({ message: 'Invalid collection id' });
    if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ message: 'Invalid product id' });

    // đảm bảo product tồn tại
    const p = await Product.findById(productId).select('_id');
    if (!p) return res.status(404).json({ message: 'Product not found' });

    // 1) update atomic
    const up = await User.updateOne(
      { _id: uid, 'collections._id': cid },
      { $addToSet: { 'collections.$.items': productId } }
    );

    if (up.matchedCount === 0) {
      return res.status(404).json({ message: 'User or collection not found' });
    }

    // 2) fetch lại đúng collection (không positional projection)
    const doc = await User.findById(uid, {
      collections: { $elemMatch: { _id: cid } }
    }).lean();

    const col = doc?.collections?.[0];
    const count = Array.isArray(col?.items) ? col.items.length : 0;

    return res.status(201).json({ ok: true, count });
  } catch (err) {
    console.error('POST /collections/:cid/items error', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/remove', verifyToken, async (req, res) => {
  try {
    const { productId } = req.body || {};
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ ok: false, message: 'productId không hợp lệ' });
    }

    // Gỡ productId khỏi items của mọi collection
    const pullRes = await User.updateOne(
      { _id: req.user.id },
      { $pull: { 'collections.$[].items': new mongoose.Types.ObjectId(productId) } }
    );

    // Lấy lại tổng số sp đã "liked" (đếm items duy nhất hoặc tổng items)
    const user = await User.findById(req.user.id).select('collections');
    if (!user) return res.status(404).json({ ok: false, message: 'User không tồn tại' });

    // Tổng số items (không unique) trong tất cả collections
    const totalItems = (user.collections || []).reduce((sum, c) => sum + (c.items?.length || 0), 0);

    return res.json({
      ok: true,
      message: 'Đã gỡ sản phẩm khỏi bộ sưu tập',
      modifiedCount: pullRes.modifiedCount || 0,
      favorites: totalItems
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/**
 * (Tuỳ chọn) DELETE /api/collections/:collectionId/items/:productId
 * → Gỡ product khỏi MỘT collection cụ thể.
 */
router.delete('/:collectionId/items/:productId', verifyToken, async (req, res) => {
  try {
    const { collectionId, productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(collectionId) || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ ok: false, message: 'ID không hợp lệ' });
    }

    const result = await User.updateOne(
      { _id: req.user.id, 'collections._id': collectionId },
      { $pull: { 'collections.$.items': new mongoose.Types.ObjectId(productId) } }
    );

    const user = await User.findById(req.user.id).select('collections');
    const totalItems = (user?.collections || []).reduce((s, c) => s + (c.items?.length || 0), 0);

    return res.json({
      ok: true,
      message: 'Đã gỡ sản phẩm khỏi collection',
      modifiedCount: result.modifiedCount || 0,
      favorites: totalItems
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});
// DELETE /api/collections/:cid/items/:pid
router.delete('/:cid/items/:pid', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { cid, pid } = req.params;

    if (!mongoose.isValidObjectId(cid) || !mongoose.isValidObjectId(pid)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const col = user.collections.id(cid);
    if (!col) return res.status(404).json({ message: 'Collection not found' });

    col.items = col.items.filter(x => String(x) !== String(pid));
    await user.save();
    res.json({ ok: true, count: col.items.length });
  } catch (err) {
    console.error('DELETE /collections/:cid/items/:pid error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/collections/:cid/items?skip=0&limit=24
router.get('/:cid/items', verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    const { cid } = req.params;
    let { skip = 0, limit = 24 } = req.query;
    skip = parseInt(skip, 10) || 0;
    limit = Math.min(parseInt(limit, 10) || 24, 100);

    const user = await User.findById(uid).populate({
      path: 'collections.items',
      select: '_id name images price',
      model: 'Product'
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    const col = user.collections.id(cid);
    if (!col) return res.status(404).json({ message: 'Collection not found' });

    const total = col.items.length;
    const items = col.items.slice(skip, skip + limit);

    res.json({ total, items });
  } catch (err) {
    console.error('GET /collections/:cid/items error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
