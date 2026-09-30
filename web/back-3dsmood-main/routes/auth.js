const express = require("express");
const router = express.Router();
const User = require("../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require('passport');
const authController = require('../controllers/auth.controller');
const { authMiddleware } = require('../middlewares/authMiddleware');
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key"; // đừng hardcode trong thực tế

router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ message: "Email hoặc username đã tồn tại" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    const savedUser = await newUser.save();

    // Tạo token
    const token = jwt.sign(
      { id: savedUser._id, email: savedUser.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,                // bắt buộc trên HTTPS
      sameSite: "Lax",             // đủ vì 3dsmood.com ↔ api.3dsmood.com là same-site
      domain: ".3dsmood.com",      // để subdomain chia sẻ cookie
      path: "/",
      maxAge: 30 * 24 * 3600 * 1000
    });
    // Xoá password trước khi trả về user
    const userToReturn = {
      _id: savedUser._id,
      username: savedUser.username,
      email: savedUser.email,
      coins: savedUser.coins || 0,
      avatar: savedUser.avatar || null,
    };

    res.status(201).json({ user: userToReturn, token });
  } catch (error) {
    console.error("Đăng ký lỗi:", error);
    res.status(500).json({ message: "Lỗi server" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email })
      .select("+password username email avatar coins role");

    if (!user) return res.status(400).json({ message: "Email không tồn tại" });

    const isMatch = await bcrypt.compare(password, user.password || "");
    if (!isMatch) return res.status(400).json({ message: "Mật khẩu không chính xác" });

    const role = user.role || "user";
    const token = jwt.sign(
      { id: user._id.toString(), role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,                // bắt buộc trên HTTPS
      sameSite: "Lax",             // đủ vì 3dsmood.com ↔ api.3dsmood.com là same-site
      domain: ".3dsmood.com",      // để subdomain chia sẻ cookie
      path: "/",
      maxAge: 30 * 24 * 3600 * 1000
    });
    const userToReturn = {
      _id: user._id,
      username: user.username,
      email: user.email,
      coins: user.coins || 0,
      avatar: user.avatar || null,
      role, // ✅ rất quan trọng cho FE
    };

    res.status(200).json({ user: userToReturn, token });
  } catch (err) {
    console.error("Lỗi đăng nhập:", err);
    res.status(500).json({ message: "Lỗi server khi đăng nhập" });
  }
});

  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  // Callback từ Google
  router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/' }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,                // bắt buộc trên HTTPS
      sameSite: "Lax",             // đủ vì 3dsmood.com ↔ api.3dsmood.com là same-site
      domain: ".3dsmood.com",      // để subdomain chia sẻ cookie
      path: "/",
      maxAge: 30 * 24 * 3600 * 1000
    });
    // Trả về cho FE qua query
    res.redirect(`${process.env.FRONTEND_URL}/google-callback?token=${token}`);
  }
);
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Lỗi lấy thông tin user" });
  }
});
// routes/auth.routes.js
router.get("/check-email", async (req, res) => {
  try {
    const { email, provider } = req.query; // provider=google
    if (!email) return res.status(400).json({ message: "Missing email" });

    const u = await User.findOne({ email: String(email).toLowerCase().trim() })
      .select("email providers")
      .lean();

    if (!u) return res.json({ exists: false });

    // providers ví dụ: ["local"] hoặc ["google"] hoặc ["local","google"]
    const providers = Array.isArray(u.providers) ? u.providers : [];
    return res.json({ exists: true, providers });
  } catch (e) {
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
