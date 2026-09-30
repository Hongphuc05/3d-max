const mongoose = require('mongoose');

const PopupConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'home', unique: true, index: true },
    enabled: { type: Boolean, default: true },
    title: { type: String, default: 'Home Banner' },
    href: { type: String, default: '#' },
    image: { type: String, default: '/uploads/banners/default.jpg' },
    widthPx: { type: Number, default: 560 },
    devices: { type: String, enum: ['all', 'desktop', 'mobile'], default: 'all' },
    startAt: { type: Date },
    endAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

PopupConfigSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ key: 'home' });
  if (!doc) doc = await this.create({ key: 'home' });
  return doc;
};

module.exports = mongoose.model('PopupConfig', PopupConfigSchema);