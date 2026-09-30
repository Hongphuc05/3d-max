// controllers/background.controller.js
const path = require("path");
const Background = require("../models/Background");

// Convert wildcard pattern ("/account/*") sang RegExp
function wildcardToRegex(pattern) {
  // escape regex special chars trừ * và /
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const re = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(re);
}

function isWithinSchedule(item, now = new Date()) {
  const { schedule } = item || {};
  if (!schedule) return true;
  const { startAt, endAt } = schedule;
  if (startAt && now < new Date(startAt)) return false;
  if (endAt && now > new Date(endAt)) return false;
  return true;
}

// Chuẩn hoá URL tuyệt đối (nếu imageUrl là đường dẫn tương đối)
function absoluteUrl(req, urlOrPath) {
  if (!urlOrPath) return urlOrPath;
  // nếu đã bắt đầu bằng http(s), giữ nguyên
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

exports.list = async (req, res, next) => {
  try {
    const items = await Background.find().sort({ updatedAt: -1 }).lean();
    res.json(items);
  } catch (e) {
    next(e);
  }
};

exports.getByKey = async (req, res, next) => {
  try {
    const item = await Background.findOne({ key: req.params.key }).lean();
    if (!item) return res.status(404).json({ message: "Not found" });
    // Trả kèm URL tuyệt đối cho tiện FE
    item.imageUrlAbs = absoluteUrl(req, item.imageUrl);
    res.json(item);
  } catch (e) {
    next(e);
  }
};

exports.create = async (req, res, next) => {
  try {
    const payload = req.body || {};
    payload.updatedBy = req.user?._id;
    const created = await Background.create(payload);
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
};

exports.update = async (req, res, next) => {
  try {
    const payload = req.body || {};
    payload.updatedBy = req.user?._id;
    const updated = await Background.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (e) {
    next(e);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const removed = await Background.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ message: "Not found" });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
};

// Trả về cấu hình background phù hợp nhất với path truyền lên
// Ưu tiên: isActive=true, khớp pages + trong khung schedule; match đầu tiên theo updatedAt mới nhất
exports.resolve = async (req, res, next) => {
  try {
    const pathToMatch = String(req.query.path || "/");
    const now = new Date();

    const all = await Background.find({ isActive: true }).sort({ updatedAt: -1 }).lean();

    // Lọc theo schedule trước
    const validByTime = all.filter((it) => isWithinSchedule(it, now));

    // Tìm cấu hình khớp 'pages' (wildcard)
    const matched = validByTime.find((it) => {
      const pages = Array.isArray(it.pages) && it.pages.length ? it.pages : ["/*"];
      return pages.some((p) => wildcardToRegex(p).test(pathToMatch));
    });

    if (!matched) return res.json(null);

    // Kèm URL tuyệt đối để FE dùng trực tiếp
    matched.imageUrlAbs = absoluteUrl(req, matched.imageUrl);
    res.json(matched);
  } catch (e) {
    next(e);
  }
};
