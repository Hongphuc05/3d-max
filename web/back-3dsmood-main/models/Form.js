// models/Form.js
const mongoose = require("mongoose");

const formSchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String, required: true }
});

module.exports = mongoose.model("Form", formSchema);
