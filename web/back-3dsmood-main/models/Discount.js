// models/Discount.js
const mongoose = require("mongoose");

const DiscountSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 200 }, // ví dụ: "Đăng nhập lần đầu"
    percent: { type: Number, required: true, min: 0, max: 100 }, // ví dụ: 99
    couponCode: { type: String, default: null, uppercase: true, trim: true }, // nếu gắn với coupon có sẵn thì điền mã
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    priority: { type: Number, default: 0 }, // sort giảm dần -> nổi bật hơn
    icon: { type: String, default: null }, // (tùy chọn) đường dẫn icon nếu bạn muốn
  },
  { timestamps: true }
);

module.exports = mongoose.model("Discount", DiscountSchema);
