// seed/seedForms.js
require("dotenv").config();
const mongoose = require("mongoose");
const Form = require("../models/Form"); // Đường dẫn đúng tới model Form

const formOptions = [
  { name: "Square", image: "/3dmodel/form/sq.svg" },
  { name: "Rectangle", image: "/3dmodel/form/cn.svg" },
  { name: "Circle", image: "/3dmodel/form/cy.svg" },
  { name: "Triangle", image: "/3dmodel/form/tg.svg" },
  { name: "Wave", image: "/3dmodel/form/ng.svg" },
  { name: "Oval", image: "/3dmodel/form/el.svg" },
  { name: "Irregular 1", image: "/3dmodel/form/nz.svg" },
  { name: "Irregular 2", image: "/3dmodel/form/ss.svg" },
];

async function run() {
  try {
    // Kết nối database với URI lấy từ .env
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected");

    // Xóa dữ liệu cũ nếu có
    await Form.deleteMany({});
    console.log("Old forms deleted");

    // Thêm dữ liệu mới
    await Form.insertMany(formOptions);
    console.log("Forms seeded successfully");
  } catch (err) {
    console.error("Error seeding forms:", err);
  } finally {
    // Ngắt kết nối
    await mongoose.disconnect();
  }
}

run();
