const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/Users');
require('dotenv').config();

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const googleId = profile.id;
      const email = (profile.emails?.[0]?.value || '').trim().toLowerCase();
      const displayName = profile.displayName || '';
      const avatar = profile.photos?.[0]?.value || '';

      // 1) Đã link Google trước đó → đăng nhập luôn
      let user = await User.findOne({ googleId });
      if (user) return done(null, user);

      // 2) Chưa link: nếu có email → LINK googleId vào user hiện có
      if (email) {
        user = await User.findOne({ email });
        if (user) {
          user.googleId = googleId;
          if (!user.username && displayName) user.username = displayName;
          if (!user.avatar && avatar) user.avatar = avatar;

          try {
            await user.save();
          } catch (e) {
            // Race condition: nếu vừa có doc khác gán googleId/email → lấy lại doc và dùng
            if (e?.code === 11000) {
              user = await User.findOne({ $or: [{ googleId }, { email }] });
            } else {
              return done(e);
            }
          }
          return done(null, user);
        }
      } else {
        // Google không trả email (hiếm). Cho fail mềm để FE hiển thị thông báo lịch sự.
        return done(null, false, { reason: 'NO_EMAIL_FROM_GOOGLE' });
      }

      // 3) Không có user nào trùng email → tạo mới
      try {
        user = await User.create({
          googleId,
          email,
          username: displayName || email.split('@')[0],
          avatar,
          role: 'user',
        });
        return done(null, user);
      } catch (e) {
        if (e?.code === 11000) {
          // Nếu vẫn trùng (do cạnh tranh), lấy doc đã tồn tại và cho đăng nhập
          const existing = await User.findOne({ $or: [{ email }, { googleId }] });
          if (existing) return done(null, existing);
        }
        return done(e);
      }
    } catch (err) {
      return done(err);
    }
  }
));
