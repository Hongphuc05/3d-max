// models/DepositOrder.js
const mongoose = require("mongoose");

const DepositOrderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, required: true, unique: true, index: true },

    // Nếu có liên kết user
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Liên kết pack & snapshot theo đúng model bạn đang dùng
    packId: { type: mongoose.Schema.Types.ObjectId, ref: "DepositPack" },
    packSnapshot: {
      // chụp lại trạng thái pack tại thời điểm tạo đơn (đảm bảo tính toàn vẹn)
      _id: mongoose.Schema.Types.ObjectId,
      amount: Number,
      discount: Number,
      title: String,
      note: String,
      isActive: Boolean,
      sortOrder: Number,
      currency: String,
      metadata: mongoose.Schema.Types.Mixed,
    },

    // Giá/SL/CK tính toán theo packSnapshot
    amountPerPack: { type: Number, required: true }, // VND
    quantity: { type: Number, required: true },
    discount: { type: Number, default: 0 },          // %
    total: { type: Number, required: true },         // VND, đã áp dụng CK %
    currency: { type: String, default: "VND", index: true },

    // Trạng thái đơn
    status: { type: String, enum: ["pending", "paid", "cancelled"], default: "pending", index: true },
    confirmedAt: Date,

    // Thông tin tài khoản nhận & QR (dùng SePay)
    bank: {
      nameOrCode: String,     // tên NH như "Vietcombank" hoặc code SePay
      accountNo: String,      // số TK nhận
      accountName: String,    // tên TK nhận
    },
    qr: {
      provider: { type: String, enum: ["sepay", "vietqr"], default: "sepay" },
      url: String,            // link ảnh QR dùng để hiển thị
    },

    // Dấu vết webhook từ SePay
    sepay: {
      webhook: { type: Object },
      transactionId: Number,
      transactionDate: String,
      referenceCode: String,
      content: String,
      transferAmount: Number,
      accountNumber: String,
      gateway: String,
    },
    credited: { type: Boolean, default: false, index: true }, // đã cộng coin chưa
    creditedCoins: { type: Number, default: 0 },
    creditedAt: Date,
    creditedUserBalanceAfter: Number, 
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

module.exports = mongoose.model("DepositOrder", DepositOrderSchema);
