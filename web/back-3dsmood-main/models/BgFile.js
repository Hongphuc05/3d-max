const mongoose = require("mongoose");

// Trường theo yêu cầu: filePath, name, thời gian bắt đầu/kết thúc, trạng thái
const BgFileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    filePath: { type: String, required: true, trim: true }, // nơi lưu file trên server (VD: /uploads/bg/xxx.png)
    activeFrom: { type: Date }, // thời gian bắt đầu
    activeTo: { type: Date },   // thời gian kết thúc
    status: { type: Boolean, default: true }, // bật/tắt
  },
  { timestamps: true }
);

module.exports = mongoose.model("BgFile", BgFileSchema);