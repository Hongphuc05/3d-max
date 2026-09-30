// models/Color.js
const mongoose = require("mongoose");

const colorSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
});

module.exports = mongoose.model("Color", colorSchema);
