const router = require('express').Router();
const ctrl = require('../controllers/user.controller');
const verifyToken = require("../middlewares/verifyToken");
const { requireRole } = require("../middlewares/authMiddleware");
const { authMiddleware } = require('../middlewares/authMiddleware');
const User = require("../models/Users");
const bcrypt = require('bcrypt');
// router.use(requireAuth, requireRole('admin'));

router.get('/',verifyToken, requireRole("admin"), ctrl.listUsers);
router.post('/',verifyToken, requireRole("admin"), ctrl.createUser);
router.patch("/update-profile", authMiddleware, async (req, res) => {
    try {
      const { username, phone, address, avatar } = req.body;
  
      if (!username || String(username).trim().length < 3) {
        return res.status(400).json({ message: "Username tối thiểu 3 ký tự." });
      }
  
      // Kiểm tra username trùng (nếu bạn muốn unique)
      const existed = await User.findOne({ username, _id: { $ne: req.user.id } }).select("_id");
      if (existed) {
        return res.status(400).json({ message: "Username đã được sử dụng." });
      }
  
      const update = {
        username: String(username).trim(),
        phone: phone || "",
        address: address || "",
      };
  
      // avatar là URL do /api/uploads/avatar trả về (vd: uploads/avatars/xxx.jpg)
      if (typeof avatar === "string") update.avatar = avatar;
  
      await User.updateOne({ _id: req.user.id }, { $set: update });
  
      return res.json({ ok: true, message: "Cập nhật thông tin thành công." });
    } catch (err) {
      console.error("update-profile error:", err);
      return res.status(500).json({ message: "Lỗi server khi cập nhật thông tin." });
    }
  });
  
  /**
   * POST /api/auth/change-password
   * Body: { currentPassword, newPassword }
   */
  router.post("/change-password", authMiddleware, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
  
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Thiếu currentPassword hoặc newPassword." });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Mật khẩu mới tối thiểu 8 ký tự." });
      }
  
      const user = await User.findById(req.user.id).select("+password googleId");
      if (!user) return res.status(404).json({ message: "User không tồn tại." });
  
      // Tài khoản social (không có password) -> không cho đổi bằng endpoint này
      if (!user.password) {
        return res.status(400).json({ message: "Tài khoản đăng nhập xã hội không thể đổi mật khẩu nội bộ." });
      }
  
      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(400).json({ message: "Mật khẩu hiện tại không đúng." });
  
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
      await user.save();
  
      return res.json({ ok: true, message: "Đổi mật khẩu thành công." });
    } catch (err) {
      console.error("change-password error:", err);
      return res.status(500).json({ message: "Lỗi server khi đổi mật khẩu." });
    }
  });
router.get('/:id',verifyToken, requireRole("admin"), ctrl.getUser);
router.patch('/:id',verifyToken, requireRole("admin"), ctrl.updateUser);
router.patch('/:id/password',verifyToken, requireRole("admin"), ctrl.updatePassword);
router.post('/:id/coins',verifyToken, requireRole("admin"), ctrl.adjustCoins);
router.delete('/:id',verifyToken, requireRole("admin"), ctrl.deleteUser);
router.get('/:id/points-logs', verifyToken, ctrl.getPointsLogsTemp);


module.exports = router;