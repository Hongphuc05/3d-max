const mongoose = require('mongoose');

const CollectionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, trim: true },
  items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
}, { timestamps: true });
// ✅ Subdocument lưu lịch sử điểm (không tạo collection mới)
const PointsLogSchema = new mongoose.Schema({
  delta:   { type: Number, required: true },
  before:  { type: Number, required: true, min: 0 },
  after:   { type: Number, required: true, min: 0 },
  at:      { type: Date, default: Date.now, index: true },
  reason:  { type: String, trim: true, maxlength: 200 },
  source:  { type: String, enum: ['admin', 'system', 'user'], default: 'admin' },
  byAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });
const UserSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: false,
  },
  username: {
    type: String,
    required: true,
    trim: true
  },
  avatar: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },

  password: {
    type: String,
    required: false,
    minlength: 6,
    select: false // Không trả password về mặc định khi query
  },

  coins: {
    type: Number,
    default: 0,
    min: 0
  },

  cart: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      quantity: { type: Number, default: 1, min: 1 },
      addedAt: { type: Date, default: Date.now }
    }
  ],

  purchased: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      purchasedAt: { type: Date, default: Date.now }
    }
  ],

  collections: {
    type: [CollectionSchema],
    default: []
  },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  points: {
    type: Number,
    default: 0,
    min: 0,
  },
  phone: { // ✅ Thêm trường number
    type: String,
    trim: true, 
    default: ""
  },

  address: { // ✅ Thêm trường address
    type: String,
    trim: true
  },
  pointsHistory: { type: [PointsLogSchema], default: [] },
},
 {
  timestamps: true
});
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ googleId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', UserSchema);
