const jwt = require("jsonwebtoken");
const User = require('../models/Users');

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key"; // KHÔNG hardcode khi triển khai thực tế

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Không có header
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Chưa đăng nhập" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // gắn thông tin user vào req
    next();
  } catch (err) {
    console.error("Token không hợp lệ:", err);
    return res.status(401).json({ message: "Token không hợp lệ" });
  }
};
const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing token' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid token' });

    req.user = user; // attach
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized', error: err.message });
  }
};


// middlewares/authorize.js (CommonJS)
function hasPermission(user, required = []) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = user.permissions || [];
  if (perms.includes('*')) return true;
  return required.some(p => perms.includes(p)); // “chỉ cần có 1”
  // Nếu muốn “phải có hết”, thay bằng: return required.every(p => perms.includes(p));
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
  next();
};

const requirePerm = (...perms) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  if (!hasPermission(req.user, perms)) return res.status(403).json({ message: 'Forbidden' });
  next();
};


module.exports = { requireAuth, requireRole, authMiddleware, hasPermission, requirePerm};
