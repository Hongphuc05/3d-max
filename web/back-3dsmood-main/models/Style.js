// models/Style.js
// models/Style.js
const mongoose = require("mongoose");

const StyleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Style", StyleSchema);
