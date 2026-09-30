// seed/seedStyles.js
require("dotenv").config();
const mongoose = require("mongoose");
const Style = require("../models/Style");

const styles = [
  { name: "Luxury" },
  { name: "Morden" },
  { name: "Classic" },
  { name: "Indochine" },
  { name: "Ethnic" },
  { name: "Rustic" },
];

async function run() {
  try {
    // 1. Kết nối DB
    await mongoose.connect(process.env.MONGO_URI);

    // 2. Xóa toàn bộ dữ liệu cũ
    await Style.deleteMany({});

    // 3. Thêm mới styles
    await Style.insertMany(styles);

    console.log("✅ Seed styles done!");
  } catch (err) {
    console.error("❌ Error seeding styles:", err);
  } finally {
    // 4. Ngắt kết nối DB
    await mongoose.disconnect();
  }
}

run();
