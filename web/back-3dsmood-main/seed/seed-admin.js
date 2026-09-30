
// scripts/seed-admin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

// chỉnh lại nếu model của bạn ở đường dẫn khác
const User = require(path.join(__dirname, '..', 'models', 'Users'));

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mydb';

// Parse args dạng --key=value
function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();

  const email = args.email || process.env.ADMIN_EMAIL || 'admin@example.com';
  const username = args.username || process.env.ADMIN_USERNAME || 'Admin';
  let password = args.password || process.env.ADMIN_PASSWORD;

  if (!email) {
    console.error('❌ Thiếu --email hoặc ADMIN_EMAIL');
    process.exit(1);
  }

  if (!password) {
    // Nếu không truyền password, tự tạo một cái mạnh và in ra console
    password = crypto.randomBytes(12).toString('base64url');
    console.log(`ℹ️  Không truyền password, đã tạo tạm: ${password}`);
  }

  await mongoose.connect(MONGODB_URI, {});

  // Tìm theo email
  let user = await User.findOne({ email }).select('+password role username email');
  if (user) {
    // Nếu đã tồn tại: set role=admin, optionally reset mật khẩu nếu truyền --reset=true
    const willReset = /^true|1$/i.test(String(args.reset || ''));
    user.role = 'admin';
    if (willReset) {
      user.password = await bcrypt.hash(password, 10);
    }
    // Nếu thiếu username (schema required) thì bổ sung
    if (!user.username) user.username = username;

    await user.save();
    console.log(`✅ Đã cập nhật user thành admin: ${email}${willReset ? ' (đổi mật khẩu)' : ''}`);
  } else {
    // Tạo mới admin
    const hash = await bcrypt.hash(password, 10);
    user = await User.create({
      email,
      username,
      password: hash,
      role: 'admin',
      coins: 0,
      points: 0,
    });
    console.log(`✅ Đã tạo admin: ${email}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Seed admin lỗi:', err);
  process.exit(1);
});
