// seedForms.js
const mongoose = require("mongoose");
const Form = require("../models/Form");
require("dotenv").config();

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

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    // Xoá hết dữ liệu cũ (nếu cần)
    await Form.deleteMany({});
    console.log("Old forms deleted");

    // Thêm dữ liệu mới
    await Form.insertMany(formOptions);
    console.log("Forms seeded successfully");

    mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

seed();
