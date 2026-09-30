// seed/seedCategories.js
require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/Category");

const categories = [
  {
    name: "Architecture",
    image: "/3dmodel/categories/home.svg",
    children: [
      { name: "Barbecue and grill" },
      { name: "Building" },
      { name: "Environment elements" },
      { name: "Facade element" },
      { name: "Fence" },
      { name: "Other" },
      { name: "Paving" },
      { name: "Playground" },
      { name: "Urban environment" },
    ],
  },
  {
    name: "Bathroom",
    image: "/3dmodel/categories/bathroom.svg",
    children: [
      { name: "Bathroom accessories" },
      { name: "Bathroom furniture" },
      { name: "Bathtub" },
      { name: "Faucet" },
      { name: "Shower" },
      { name: "Toilet and Bidet" },
      { name: "Towel rail" },
      { name: "Wash basin" },
    ],
  },
  {
    name: "Childroom",
    image: "/3dmodel/categories/children-park.svg",
    children: [
      { name: "Bed Child" },
      { name: "Full furniture set" },
      { name: "Miscellaneous" },
      { name: "Table + Chair" },
      { name: "Toy" },
      { name: "Wardrobe" },
    ],
  },
  {
    name: "Furniture",
    image: "/3dmodel/categories/Furniture.svg",
    children: [
      { name: "Armchair" },
      { name: "Bar Stool" },
      { name: "Bed" },
      { name: "Console" },
      { name: "Chair" },
      { name: "Desk" },
      { name: "Dressing table" },
      { name: "Office furniture" },
      { name: "Other soft seating" },
      { name: "Outdoor" },
      { name: "Rack" },
      { name: "Reception" },
      { name: "Sideboard & Chest of drawer" },
      { name: "Sofa" },
      { name: "Table" },
      { name: "Table + Chair" },
      { name: "Tab-Sile tab" },
      { name: "TV wall" },
      { name: "Wardrobe & Display cabinets" },
    ],
  },
  {
    name: "Kitchen",
    image: "/3dmodel/categories/Kitchen.svg",
    children: [
      { name: "Faucet&Sink" },
      { name: "Food and drinks" },
      { name: "Kitchen" },
      { name: "Kitchen appliance" },
      { name: "Other kitchen accessories" },
      { name: "Tableware" },
    ],
  },
  {
    name: "Lighting",
    image: "/3dmodel/categories/Lighting.svg",
    children: [
      { name: "Ceiling lamp" },
      { name: "Floor lamp" },
      { name: "Other lighting" },
      { name: "Outdoor light" },
      { name: "Pendant light" },
      { name: "Spot light" },
      { name: "Table lamp" },
      { name: "Technical lighting" },
      { name: "Wall light" },
    ],
  },
  {
    name: "Material",
    image: "/3dmodel/categories/Material.svg",
    children: [
      { name: "Concrete" },
      { name: "Fabric" },
      { name: "Glass" },
      { name: "Leather" },
      { name: "Liquid" },
      { name: "Metal" },
      { name: "Miscellaneous" },
      { name: "Stone" },
      { name: "Stone Light" },
      { name: "Tile" },
      { name: "Wood" },
    ],
  },
  {
    name: "Plants",
    image: "/3dmodel/categories/plant.svg",
    children: [
      { name: "Bouquet" },
      { name: "Bush" },
      { name: "Fitowall" },
      { name: "Grass" },
      { name: "Indoor" },
      { name: "Outdoor" },
      { name: "Tree" },
    ],
  },
  {
    name: "Technology",
    image: "/3dmodel/categories/tech.svg",
    children: [
      { name: "Audio tech" },
      { name: "Household appliance" },
      { name: "Miscellaneous" },
      { name: "PC & other electronics" },
      { name: "Phones" },
      { name: "Technology Devices" },
      { name: "Tv" },
    ],
  },
  {
    name: "Textures",
    image: "/3dmodel/categories/texture.svg",
    children: [
      { name: "Brick" },
      { name: "Fabric" },
      { name: "Floor coverings" },
      { name: "Leather" },
      { name: "Metal" },
      { name: "Miscellaneous" },
      { name: "Natural materials" },
      { name: "Other textures" },
      { name: "Rug" },
      { name: "Stone" },
      { name: "Tile" },
      { name: "Wall covering" },
      { name: "Wood" },
    ],
  },
  {
    name: "Decoration",
    image: "/3dmodel/categories/decoration.svg",
    children: [
      { name: "3D panel" },
      { name: "Books" },
      { name: "Carpets" },
      { name: "Clothes" },
      { name: "Curtains" },
      { name: "Decorative plaster" },
      { name: "Decorative set" },
      { name: "Frame" },
      { name: "Mirror" },
      { name: "Other decorative objects" },
      { name: "Pillows" },
      { name: "Sculpture" },
      { name: "Vase" },
      { name: "Watches & Clocks" },
    ],
  },
  {
    name: "Other models",
    image: "/3dmodel/categories/othermodel.svg",
    children: [
      { name: "Aquarium" },
      { name: "Bar" },
      { name: "Beauty salon" },
      { name: "Billiards" },
      { name: "Creature" },
      { name: "Doors" },
      { name: "Fireplace" },
      { name: "Miscellaneous" },
      { name: "Musical instrument" },
      { name: "Radiator" },
      { name: "Restaurant" },
      { name: "Shop" },
      { name: "Sports" },
      { name: "Staircase" },
      { name: "Transport" },
      { name: "Windows" },
    ],
  },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  await Category.deleteMany({});

  const root = await Category.create({
    name: "3dmodel",
    image: "/3dmodel/categories/root.svg",
    count: 0,
    parent: null,
  });

  for (const group of categories) {
    const parent = await Category.create({
      name: group.name,
      image: group.image,
      count: 0,
      parent: root._id,
    });

    for (const child of group.children) {
      await Category.create({
        name: child.name,
        count: 0,
        parent: parent._id,
      });
    }
  }

  console.log("Seed categories with root '3dmodel' done!");
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
