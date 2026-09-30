// routes/admin.stats.routes.js
// Mount: app.use("/api/admin/stats", require("./routes/admin.stats.routes"));


const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");


// Adjust paths to your project structure
const User = require("../models/Users");
const Order = require("../models/Order");


const router = express.Router();


// ===== Config =====
const TZ = process.env.DASHBOARD_TZ || "Asia/Bangkok"; // your timezone


// ===== Admin auth middleware (works with Passport or Bearer JWT) =====
async function ensureAdmin(req, res, next) {
try {
// 1) Passport/Session user available?
if (req.user && req.user.role === "admin") return next();


// 2) Fallback: Bearer token
const auth = req.headers.authorization || "";
const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
if (!token) return res.status(401).json({ message: "Unauthorized" });


const payload = jwt.verify(token, process.env.JWT_SECRET || "changeme");
if (!payload || !payload.id) return res.status(401).json({ message: "Unauthorized" });


const user = await User.findById(payload.id).select("role");
if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden" });


req.user = user;
next();
} catch (err) {
console.error("ensureAdmin error", err);
return res.status(401).json({ message: "Unauthorized" });
}
}


// ===== Helpers =====
function parseDateRange(q) {
// Default: last 30 days
const now = new Date();
const to = q.to ? new Date(q.to) : now; // inclusive end (we'll add +1 day for $lt)
const from = q.from ? new Date(q.from) : new Date(now.getTime() - 29 * 86400000);


// Normalize: from 00:00:00, to next day 00:00:00 for $lt
const fromUTC = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0));
const toNextUTC = new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0));
return { from: fromUTC, to: toNextUTC };
}


module.exports = router;