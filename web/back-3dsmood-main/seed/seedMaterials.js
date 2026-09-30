const mongoose = require("mongoose");
require("dotenv").config();
const Material = require("../models/Material"); // đường dẫn đúng với vị trí file của bạn

const materials = [
  "Brick","Ceramics","Concrete","Fabric","Fur","Glass","Gypsum","Leather","Liquid","Metal","Organics","Paper","Plastic","Rattan","Stone","Wood"
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  for (const name of materials) {
    const exists = await Material.findOne({ name });
    if (!exists) {
      await Material.create({ name });
      console.log(`Inserted material: ${name}`);
    } else {
      console.log(`Material ${name} already exists`);
    }
  }

  await mongoose.disconnect();
  console.log("Disconnected");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
