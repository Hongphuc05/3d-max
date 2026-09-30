const mongoose = require("mongoose");

// Giúp parse URL wasabi -> { bucket, key } (chỉ dùng cho model 3D)
function parseBucketKeyFromUrl(fileUrl) {
  try {
    const u = new URL(fileUrl);
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    const bucket = parts.shift();
    const key = parts.join("/");
    if (!bucket || !key) return null;
    return { bucket, key };
  } catch {
    return null;
  }
}

// ===== SubSchema cho ảnh (gallery) LƯU LOCAL =====
// Ví dụ path: "/uploads/products/abc/1.webp"
const ImageSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, trim: true }, // đường dẫn tương đối local
    alt: { type: String, default: "", trim: true },
    isCover: { type: Boolean, default: false },
    order: { type: Number, default: 0 },

    // metadata (tuỳ chọn)
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    size: { type: Number, default: null }, // bytes

    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    price: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0, index: true }, // 👉 thứ tự thủ công (toàn cục)

    // Thuộc tính liên kết
    color: [{ type: mongoose.Schema.Types.ObjectId, ref: "Color" }],
    form: [{ type: mongoose.Schema.Types.ObjectId, ref: "Form" }],
    styles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Style" }],
    materials: [{ type: mongoose.Schema.Types.ObjectId, ref: "Material" }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],

    // ===== Thông tin render/ánh sáng/camera (NEW) =====
    render: { type: String, default: "", trim: true },
    lighting: { type: String, default: "", trim: true },
    cameraType: { type: String, default: "", trim: true },
    customId: { type: String, default: "", trim: true },
    // ===== Lưu trữ model 3D trên Wasabi (private) =====
    modelKey: { type: String, required: true }, // ví dụ: "models/1733940_abcd.glb"
    modelBucket: { type: String, default: null },
    modelContentType: { type: String, default: null },
    modelSize: { type: Number, default: null },
    modelEtag: { type: String, default: null },
    modelUploadedAt: { type: Date, default: Date.now },

    // ===== Gallery nhiều ảnh (LOCAL) =====
    images: { type: [ImageSchema], default: [] },

    // ===== Legacy / hiển thị (DEPRECATED) =====
    modelFilePath: { type: String, default: null },    // URL cũ (không dùng để ký link)
    previewImagePath: { type: String, default: null }, // ví dụ: "/uploads/previews/xxx.webp"

    // ===== Hiển thị Trang chủ =====
    displayhome: { type: Boolean, default: false, index: true },
    viewCount: { type: Number, default: 0, min: 0 },        // dùng cho "Nhiều lượt xem"
    purchasedCount: { type: Number, default: 0, min: 0 },   // dùng cho "Nhiều lượt mua"
  },
  { timestamps: true }
);

// ===== Indexes =====
// Mở rộng text index để tìm theo name/description/render/lighting/cameraType
ProductSchema.index({
  name: "text",
  description: "text",
  render: "text",
  lighting: "text",
  cameraType: "text",
});
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ categoryIds: 1 });
// Tối ưu truy vấn phần Trang chủ
ProductSchema.index({ displayhome: 1, createdAt: -1 });
ProductSchema.index({ viewCount: -1 });
ProductSchema.index({ purchasedCount: -1 });
// Lấy bucket/key dùng để ký URL tải (model 3D)
ProductSchema.methods.getModelS3Location = function () {
  const bucket = this.modelBucket || process.env.WASABI_BUCKET;
  let key = this.modelKey;
  if (!key && this.modelFilePath) {
    const parsed = parseBucketKeyFromUrl(this.modelFilePath);
    if (parsed) return { bucket: parsed.bucket || bucket, key: parsed.key };
  }
  return { bucket, key };
};

// Ảnh cover nhanh (ưu tiên isCover, fallback ảnh đầu tiên)
ProductSchema.virtual("coverImage").get(function () {
  if (!Array.isArray(this.images) || this.images.length === 0) return null;
  const found = this.images.find((i) => i.isCover);
  return found || this.images[0];
});

// Backfill & chuẩn hoá dữ liệu
ProductSchema.pre("validate", function (next) {
  // Backfill modelKey/modelBucket từ modelFilePath (legacy, Wasabi)
  if (!this.modelKey && this.modelFilePath) {
    const parsed = parseBucketKeyFromUrl(this.modelFilePath);
    if (parsed?.key) {
      this.modelKey = parsed.key;
      if (!this.modelBucket) this.modelBucket = parsed.bucket;
    }
  }

  // Backfill images[] từ previewImagePath (legacy, LOCAL)
  if ((!this.images || this.images.length === 0) && this.previewImagePath) {
    const p = String(this.previewImagePath).trim();
    if (p) {
      this.images = [
        {
          path: p.startsWith("/") ? p : `/${p}`,
          isCover: true,
          order: 0,
        },
      ];
    }
  }

  // Chuẩn hoá từng ảnh local
  if (Array.isArray(this.images)) {
    this.images = this.images.map((it, idx) => {
      const cloned = { ...it };
      if (!cloned.path) return cloned;
      // đảm bảo path bắt đầu bằng "/"
      cloned.path = cloned.path.startsWith("/") ? cloned.path : `/${cloned.path}`;
      if (cloned.order === undefined || cloned.order === null) cloned.order = idx;
      return cloned;
    });
  }

  next();
});

module.exports = mongoose.model("Product", ProductSchema);
