// seed/seedCategories.js
require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/Category");

// Khai báo dữ liệu seed
const groups = [
  {
    name: "Exterior",
    image: "/3dmodel/categories/home.svg",
    children: [
      { name: "Architecture", count: 0 },
      { name: "Garden", count: 0 },
      { name: "Balcony", count: 0 },
      { name: "Pool", count: 0 },
      { name: "Playground", count: 0 },
      { name: "Other", count: 0 },
    ],
  },
  {
    name: "Interior",
    image: "/3dmodel/categories/interior.svg",
    children: [
      { name: "Altar room", count: 0 },
      { name: "Bathroom", count: 0 },
      { name: "Bedroom", count: 0 },
      { name: "Dressing room", count: 0 },
      { name: "Kidroom", count: 0 },
      { name: "Kitchen-Dinning room", count: 0 }, // theo đúng label bạn dùng
      { name: "Living room", count: 0 },
      { name: "Lobby", count: 0 },
      { name: "Office", count: 0 },
      { name: "Reception hall", count: 0 },
      { name: "Restaurant", count: 0 },
      { name: "Shop", count: 0 },
      { name: "Workroom", count: 0 },
      { name: "Other", count: 0 },
    ],
  },
];

async function upsertCategory({ name, parent = null, count = 0, image }) {
  const filter = parent ? { name, parent } : { name, parent: null };
  const update = { $set: { name, parent, count, ...(image ? { image } : {}) } };
  const opts = { new: true, upsert: true };
  return Category.findOneAndUpdate(filter, update, opts);
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("Missing MONGO_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  // 1) Tạo/đảm bảo root '3dscenes'
  const root = await upsertCategory({
    name: "3dscenes",
    parent: null,
    count: 0,
    image: "/3dmodel/categories/root.svg",
  });

  // 2) Tạo/đảm bảo các group + children
  for (const group of groups) {
    const parent = await upsertCategory({
      name: group.name,
      parent: root._id,
      count: 0,
      image: group.image,
    });

    for (const child of group.children) {
      await upsertCategory({
        name: child.name,
        parent: parent._id,
        count: child.count ?? 0,
      });
    }
  }

  console.log("✅ Seed categories (root '3dscenes') done!");
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error("Seed error:", e);
  process.exit(1);
});
