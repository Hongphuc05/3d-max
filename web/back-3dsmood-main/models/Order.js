// models/Order.js
const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    price:   { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    user:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items:        { type: [OrderItemSchema], default: [] },
    subtotal:     { type: Number, required: true, min: 0 },
    discount:     { type: Number, required: true, min: 0, default: 0 },
    finalTotal:   { type: Number, required: true, min: 0 },
    paymentMethod:{ type: String, default: "coins" },
    couponCode:   { type: String, default: null },
    discountId:   { type: mongoose.Schema.Types.ObjectId, ref: "Discount", default: null },
    status:       { type: String, enum: ["paid", "failed"], default: "paid" },

    // === ĐIỂM THƯỞNG (CHỈ THÊM PHẦN NÀY) ===
    pointsUsed:    { type: Number, default: 0, min: 0 }, // điểm đã dùng nếu trả bằng points
    earnedPoints:  { type: Number, default: 0, min: 0 }, // điểm thưởng nhận được nếu trả bằng coins

    // Snapshot số dư ví/điểm sau thanh toán
    balanceAfter: { type: Number, default: null },
    pointsAfter: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
