// middlewares/verifyToken.js
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

module.exports = function verifyToken(req, res, next) {
  let token = null;

  // 1) Header Bearer (giữ cho các request fetch/axios hiện tại)
  const auth = req.get("authorization") || req.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }

  // 2) Cookie (dành cho <a>/window.location/iframe/redirect)
  if (!token && req.cookies) {
    token = req.cookies.token || req.cookies.access_token || null;
  }

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Chuẩn hóa _id như middleware cũ của bạn
    const id = decoded._id || decoded.id || decoded.userId || decoded.sub;
    if (!id || !mongoose.isValidObjectId(id)) {
      return res.status(401).json({ message: "Invalid token payload: missing _id" });
    }

    req.user = { ...decoded, _id: String(id) };
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
};
