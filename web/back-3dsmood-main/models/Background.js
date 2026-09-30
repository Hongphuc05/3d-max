const mongoose = require("mongoose");

const BackgroundSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true }, // ví dụ: /uploads/backgrounds/xxx.jpg
    startAt: { type: Date, default: null },     // thời gian bắt đầu hiệu lực (có thể null)
    endAt: { type: Date, default: null },       // thời gian kết thúc (có thể null)
    isActive: { type: Boolean, default: true }, // trạng thái bật/tắt
    order: { type: Number, default: 0 },        // số thứ tự (ưu tiên thấp -> cao)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Background", BackgroundSchema);
