const mongoose = require('mongoose');

const HomeSlideSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    href: { type: String, trim: true, default: '#' },
    imagePath: { type: String, required: true }, // '/uploads/home-slides/xxx.jpg' hoặc URL tuyệt đối
    enabled: { type: Boolean, default: true },
    devices: { type: String, enum: ['all', 'desktop', 'mobile'], default: 'all' },
    sortOrder: { type: Number, default: 0, index: true },
    startAt: { type: Date },
    endAt: { type: Date },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

HomeSlideSchema.index({ enabled: 1, sortOrder: 1 });

module.exports = mongoose.model('HomeSlide', HomeSlideSchema);
