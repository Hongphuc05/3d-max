// models/DepositPack.js
const mongoose = require("mongoose");

const DepositPackSchema = new mongoose.Schema(
  {
    // Số tiền gốc (VND)
    amount: {
      type: Number,
      required: true,
      min: 1000,
      set: (v) => Math.round(Number(v) || 0),
    },

    // % giảm (0-100)
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      set: (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0))),
    },

    // Tiêu đề hiển thị (tuỳ chọn)
    title: {
      type: String,
      trim: true,
    },

    // Ghi chú (tuỳ chọn)
    note: {
      type: String,
      trim: true,
    },

    // Đang bật/ẩn gói
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Thứ tự sắp xếp tăng dần
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
      set: (v) => Math.round(Number(v) || 0),
    },

    // Tiền tệ (để mở rộng đa tiền tệ sau này)
    currency: {
      type: String,
      default: "VND",
      enum: ["VND"],
      index: true,
    },

    // Tuỳ ý mở rộng
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
  }
);

// Index thường dùng: danh sách đang active + thứ tự
DepositPackSchema.index({ isActive: 1, sortOrder: 1, amount: 1 });

module.exports = mongoose.model("DepositPack", DepositPackSchema);
