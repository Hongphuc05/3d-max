// controllers/product3dmodel.controller.js
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Busboy = require("busboy");
const { PassThrough } = require("stream");
const { CopyObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const { Upload } = require("@aws-sdk/lib-storage");
// const {
//   DeleteObjectCommand,
//   HeadObjectCommand,
// } = require("@aws-sdk/client-s3");

const s3 = require("../s3");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Color = require("../models/Color");
const Form = require("../models/Form");
const Style = require("../models/Style");
const Material = require("../models/Material");
const User = require("../models/Users");

// ===== Config =====
const ACCEPT_MODELS = [".zip", ".glb", ".fbx", ".obj", ".blend", ".rar"];
const ACCEPT_IMAGES = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_FILE_MB = 1024;

const WASABI_BUCKET = process.env.WASABI_BUCKET;
const WASABI_REGION = process.env.WASABI_REGION;
const WASABI_ENDPOINT = (
  process.env.WASABI_ENDPOINT ||
  (WASABI_REGION ? `https://s3.${WASABI_REGION}.wasabisys.com` : "https://s3.wasabisys.com")
).replace(/\/+$/, "");
const PUBLIC_BASE = (process.env.WASABI_PUBLIC_BASE || WASABI_ENDPOINT).replace(/\/+$/, "");

// Lưu ảnh preview tại local
const ROOT = path.join(__dirname, "..");
const PREVIEWS_DIR = path.join(ROOT, "uploads", "previews");
if (!fs.existsSync(PREVIEWS_DIR)) fs.mkdirSync(PREVIEWS_DIR, { recursive: true });

// ===== Helpers =====
const makeUniqueName = (original = "file") => {
  const ext = path.extname(original || "");
  const base = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${base}${ext}`;
};

const composeWasabiObjectUrl = (bucket, key) => {
  const encKey = String(key).split("/").map(encodeURIComponent).join("/");
  return `${PUBLIC_BASE}/${bucket}/${encKey}`;
};

const asIdArray = (arr) =>
  [...new Set((arr || []).map(String).map((s) => s.trim()).filter(Boolean))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function headWithRetry(bucket, key, retries = 8) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      lastErr = e;
      await sleep(200 * Math.pow(1.8, i));
    }
  }
  throw lastErr;
}

// Tăng/giảm đếm sản phẩm cho danh mục (cả count và productCount để an toàn schema)
async function incCategoryCounts(ids = [], delta = +1) {
  if (!Array.isArray(ids) || !ids.length) return;
  await Category.updateMany(
    { _id: { $in: ids } },
    { $inc: { count: delta, productCount: delta } }
  ).exec();

  // Ensure no negative counts after concurrent updates
  try {
    await Category.updateMany({ _id: { $in: ids }, count: { $lt: 0 } }, { $set: { count: 0 } }).exec();
  } catch (e) {
    // non-fatal: log and continue
    console.error('incCategoryCounts clamp error:', e);
  }
}

// Lấy toàn bộ _id (root + descendants) của danh mục có tên là "3dmodel" / "3dmodels"
async function getCategoryIdsUnderRoots(rootNames = ["3dmodel", "3dmodels"]) {
  const collName =
    Category.collection && Category.collection.name
      ? Category.collection.name
      : "categories";
  const rootsRegex = rootNames.map((n) => new RegExp(`^${n}$`, "i"));

  const rows = await Category.aggregate([
    { $match: { name: { $in: rootsRegex } } },
    {
      $graphLookup: {
        from: collName,
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "parent",
        as: "desc",
      },
    },
    {
      $project: {
        all: { $setUnion: [["$_id"], "$desc._id"] },
      },
    },
    { $unwind: "$all" },
    { $replaceRoot: { newRoot: { _id: "$all" } } },
  ]).exec();

  return rows.map((r) => r._id);
}

function parseBool(v) {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes";
}

const parseObjectIds = (val) => {
  const arr =
    typeof val === "string" ? val.split(",") : Array.isArray(val) ? val : [];
  return arr
    .filter(Boolean)
    .map((x) => {
      try {
        return new mongoose.Types.ObjectId(x);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const normalizeCode = (code) => {
  if (!code) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(code)) return code;
  if (/^[0-9a-fA-F]{6}$/.test(code)) return `#${code}`;
  return code;
};

const parseBoolParam = (v) => {
  if (v == null) return null;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on"
    ? true
    : s === "0" || s === "false" || s === "no" || s === "off"
    ? false
    : null;
};

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isValidId = (v) => mongoose.Types.ObjectId.isValid(v);
const toObjectIds = (csv) =>
  (csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(isValidId)
    .map((s) => new mongoose.Types.ObjectId(s));

/* ================== CONTROLLERS ================== */

// POST /api/products (tạo sản phẩm 3D)
async function createProduct3D(req, res, next) {
  try {
    if (!WASABI_BUCKET) {
      return res
        .status(500)
        .json({ code: "CONFIG_ERROR", message: "Thiếu cấu hình Wasabi bucket" });
    }
    try { fs.mkdirSync(PREVIEWS_DIR, { recursive: true }); } catch {}

    // --- helpers nội bộ (giữ nguyên logic cũ) ---
    const deriveIdFromFilename = (raw) => {
      return String(raw || "")
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
    };
    const deriveIdFromFilenameImage = (raw) => {
      if (!raw) return "";
      const ext = path.extname(raw);
      const base = path.basename(raw, ext);
      const safeBase = base
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      return `${safeBase}${ext.toLowerCase()}`;
    };
    const ensureUniqueModelKey = async (bucket, desiredKey, maxTries = 50) => {
      const dot = desiredKey.lastIndexOf(".");
      const ext = dot > -1 ? desiredKey.slice(dot) : "";
      const base = dot > -1 ? desiredKey.slice(0, dot) : desiredKey;

      for (let i = 0; i < maxTries; i++) {
        const key = i === 0 ? desiredKey : `${base}-${i}${ext}`;
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          // tồn tại → thử biến thể tiếp
        } catch (err) {
          // 404/NotFound → dùng key này
          return key;
        }
      }
      throw new Error("Không thể tạo tên file model duy nhất sau nhiều lần thử");
    };

    const bb = Busboy({
      headers: req.headers,
      limits: { files: 2, fileSize: MAX_FILE_MB * 1024 * 1024, fields: 200, parts: 204 },
    });

    const fields = {
      name: "",
      description: "",
      price: 0,
      order: 0,
      colors: [],
      form: [],
      categoryIds: [],
      styles: [],
      materials: [],
      displayHome: false,

      // ⬇️ Thêm 2 field cho luồng presigned
      modelKey_presigned: null,
      modelFilePath_presigned: null,
    };

    // trạng thái / biến làm việc
    let modelUploadPromise = null;
    let modelKey = null, modelUrl = null, modelMime = null, modelSizeBytes = null, modelEtag = null;
    let previewSavePromise = null, previewRel = null, previewAbs = null;

    let modelReceived = false;      // có stream file model (luồng cũ)?
    let previewReceived = false;

    let previewOriginalName = null;
    let customIdFromPreview = null;

    // cho luồng cũ
    let modelTempKey = null;
    let modelExt = null;

    const cleanup = async () => {
      if (previewAbs) { try { fs.unlinkSync(previewAbs); } catch {} }
      // Nếu là luồng cũ: xóa object tạm
      const keyToDelete = modelReceived ? (modelKey || modelTempKey) : null;
      if (keyToDelete) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: WASABI_BUCKET, Key: keyToDelete })); } catch {}
      }
    };

    bb.on("field", (name, val) => {
      const push = (k, v) => (fields[k] = [...fields[k], v]);
      switch (name) {
        case "name": fields.name = String(val || "").trim(); break;
        case "description": fields.description = String(val || "").slice(0, 2000).trim(); break;
        case "price": fields.price = Number(val); break;
        case "order": fields.order = Number(val); break;
        case "colors":
        case "colors[]": push("colors", String(val)); break;
        case "form":
        case "form[]": push("form", String(val)); break;
        case "categoryIds":
        case "categoryIds[]": push("categoryIds", String(val)); break;
        case "styles":
        case "styles[]": push("styles", String(val)); break;
        case "materials":
        case "materials[]": push("materials", String(val)); break;
        case "displayHome":
        case "displayhome":
        case "display_home":
          fields.displayHome = parseBool(val); break;

        // ⬇️ luồng presigned: FE gửi 2 field này thay vì modelFile
        case "modelKey":
          fields.modelKey_presigned = String(val || "").trim();
          break;
        case "modelFilePath":
          fields.modelFilePath_presigned = String(val || "").trim();
          break;

        default: break;
      }
    });

    bb.on("file", (fieldname, file, info = {}) => {
      const { filename = "", mimeType } = info;
      const ext = path.extname(filename).toLowerCase();

      file.on("error", (err) => bb.emit("error", err));

      // ====== LUỒNG CŨ: nhận trực tiếp modelFile ======
      if (fieldname === "modelFile") {
        if (!ACCEPT_MODELS.includes(ext)) {
          file.resume();
          return bb.emit("error", new Error("Model phải là .zip/.glb/.fbx/.obj/.blend/.rar"));
        }
        modelReceived = true;
        modelMime = mimeType || "application/octet-stream";
        modelExt = ext;

        const tempKey = `models/tmp/${makeUniqueName(filename || "model")}`;
        modelTempKey = tempKey;

        const pass = new PassThrough();
        let uploadedBytes = 0;
        file.on("data", (chunk) => { uploadedBytes += chunk.length; });
        file.on("limit", () => pass.destroy(new Error(`File model vượt quá ${MAX_FILE_MB}MB`)));

        const uploader = new Upload({
          client: s3,
          params: { Bucket: WASABI_BUCKET, Key: tempKey, Body: pass, ContentType: modelMime },
          queueSize: 3, partSize: 5 * 1024 * 1024, leavePartsOnError: false,
        });

        modelUploadPromise = uploader.done().then(async (out) => {
          modelKey = tempKey;
          modelUrl = composeWasabiObjectUrl(WASABI_BUCKET, tempKey);
          modelSizeBytes = Number.isFinite(uploadedBytes) ? uploadedBytes : null;
          if (out && out.ETag) modelEtag = String(out.ETag).replace(/"/g, "");
          if (modelSizeBytes == null || modelEtag == null) {
            try {
              const head = await headWithRetry(WASABI_BUCKET, tempKey, 8);
              if (modelSizeBytes == null) {
                const len = head.ContentLength;
                modelSizeBytes = typeof len === "number" ? len : Number(len) || null;
              }
              if (modelEtag == null && head.ETag) modelEtag = String(head.ETag).replace(/"/g, "");
            } catch {}
          }
        });

        file.pipe(pass);
        return;
      }

      // preview (dùng cho cả 2 luồng)
      if (fieldname === "previewImage") {
        if (!ACCEPT_IMAGES.includes(ext)) {
          file.resume();
          return bb.emit("error", new Error("Ảnh preview phải là .png/.jpg/.jpeg/.webp"));
        }
        previewReceived = true;

        previewOriginalName = filename || null;
        const originalBase = filename ? path.basename(filename, ext) : "";
        customIdFromPreview = deriveIdFromFilename(originalBase);

        const name = deriveIdFromFilenameImage(filename) || "preview";
        previewAbs = path.join(PREVIEWS_DIR, name);
        const ws = fs.createWriteStream(previewAbs);
        previewRel = `/uploads/previews/${name}`.replace(/\\/g, "/");

        previewSavePromise = new Promise((resolve, reject) => {
          file.on("limit", () => ws.destroy(new Error(`Ảnh preview vượt quá ${MAX_FILE_MB}MB`)));
          ws.on("finish", resolve);
          ws.on("error", reject);
        });

        file.pipe(ws);
        return;
      }

      file.resume();
    });

    bb.once("filesLimit", () => bb.emit("error", new Error("Quá số lượng file cho phép")));
    bb.once("fieldsLimit", () => bb.emit("error", new Error("Quá số lượng field cho phép")));
    bb.once("partsLimit", () => bb.emit("error", new Error("Quá số lượng parts cho phép")));

    bb.once("error", async (err) => {
      await cleanup();
      next(err);
    });

    bb.once("finish", async () => {
      try {
        // validate chung
        if (!fields.name) throw new Error("Thiếu tên sản phẩm");
        if (!Number.isFinite(fields.price) || fields.price < 0) throw new Error("Giá không hợp lệ");
        if (!Number.isFinite(fields.order) || fields.order < 0) fields.order = 0;

        // ✅ TỰ GÁN ORDER KẾ TIẾP (TOÀN CỤC)
        const last = await Product.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
        fields.order = ((last?.order ?? -1) + 1);

        fields.colors = asIdArray(fields.colors);
        fields.form = asIdArray(fields.form);
        fields.styles = asIdArray(fields.styles);
        fields.materials = asIdArray(fields.materials);
        fields.categoryIds = asIdArray(fields.categoryIds);
        if (!fields.categoryIds.length) throw new Error("Chọn ít nhất 1 category");

        // ===== Phân nhánh: presigned vs upload trực tiếp =====
        const isPresignedFlow = !!fields.modelKey_presigned;
        if (isPresignedFlow) {
          if (!previewReceived) throw new Error("Thiếu ảnh preview");
          await previewSavePromise;

          const head = await headWithRetry(WASABI_BUCKET, fields.modelKey_presigned, 8);
          const len = head.ContentLength;
          modelSizeBytes = typeof len === "number" ? len : Number(len) || null;
          modelMime = head.ContentType || "application/octet-stream";
          modelEtag = head.ETag ? String(head.ETag).replace(/"/g, "") : null;

          modelKey = fields.modelKey_presigned;
          modelUrl = fields.modelFilePath_presigned
            ? fields.modelFilePath_presigned
            : composeWasabiObjectUrl(WASABI_BUCKET, modelKey);
        } else {
          if (!modelReceived) throw new Error("Thiếu file model");
          if (!previewReceived) throw new Error("Thiếu ảnh preview");

          await Promise.all([modelUploadPromise, previewSavePromise]);

          const desiredBaseName =
            (customIdFromPreview && customIdFromPreview.length)
              ? customIdFromPreview
              : deriveIdFromFilename(fields.name || "model");

          const desiredKey = `models/${desiredBaseName}${modelExt || ""}`;
          const finalKey = await ensureUniqueModelKey(WASABI_BUCKET, desiredKey);

          if (modelTempKey && finalKey !== modelTempKey) {
            await s3.send(new CopyObjectCommand({
              Bucket: WASABI_BUCKET,
              CopySource: `${WASABI_BUCKET}/${modelTempKey}`,
              Key: finalKey,
              ContentType: modelMime,
              MetadataDirective: "REPLACE",
            }));
            await s3.send(new DeleteObjectCommand({ Bucket: WASABI_BUCKET, Key: modelTempKey }));
          }

          modelKey = finalKey;
          modelUrl = composeWasabiObjectUrl(WASABI_BUCKET, finalKey);
          try {
            const head = await headWithRetry(WASABI_BUCKET, finalKey, 8);
            const len = head.ContentLength;
            modelSizeBytes = typeof len === "number" ? len : Number(len) || modelSizeBytes;
            if (head.ETag) modelEtag = String(head.ETag).replace(/"/g, "");
          } catch {}
        }

        const doc = await Product.create({
          name: fields.name,
          description: fields.description || "",
          price: fields.price,
          order: fields.order, // ✅ số thứ tự tự tăng
          color: fields.colors,
          form: fields.form,
          categoryIds: fields.categoryIds,
          styles: fields.styles,
          materials: fields.materials,

          modelKey,
          modelBucket: WASABI_BUCKET,
          modelContentType: modelMime,
          modelSize: modelSizeBytes,
          modelEtag: modelEtag,
          modelFilePath: modelUrl,

          previewImagePath: previewRel,
          displayhome: !!fields.displayHome,

          customId: customIdFromPreview || null,
          previewOriginalName: previewOriginalName || null,
        });

        try { await incCategoryCounts(fields.categoryIds, +1); }
        catch (e) {
          await Product.findByIdAndDelete(doc._id).catch(() => {});
          await cleanup();
          throw e;
        }

        return res.json({ ok: true, product: doc });
      } catch (e) {
        await cleanup();
        return next(e);
      }
    });

    req.pipe(bb);
  } catch (outerErr) {
    next(outerErr);
  }
}




// PUT /api/products/:id (cập nhật sản phẩm 3D)
async function updateProduct3D(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID không hợp lệ" });
    }

    const oldDoc = await Product.findById(id).lean();
    if (!oldDoc) {
      return res.status(404).json({ message: "Không tìm thấy sản phẩm" });
    }

    try { fs.mkdirSync(PREVIEWS_DIR, { recursive: true }); } catch {}

    const bb = Busboy({
      headers: req.headers,
      limits: { files: 2, fileSize: MAX_FILE_MB * 1024 * 1024, fields: 200, parts: 204 },
    });

    const fields = {
      name: null,
      description: null,
      price: null,
      order: null,        // NEW: order
      colors: [],
      form: [],
      categoryIds: [],
      styles: [],
      materials: [],
      displayHome: null,  // boolean
    };
    const provided = {
      name: false, description: false, price: false, order: false, // NEW: order
      colors: false, form: false, categoryIds: false, styles: false, materials: false,
      displayHome: false,
    };

    let modelUploadPromise = null;
    let modelKeyNew = null, modelUrlNew = null, modelMimeNew = null, modelSizeBytesNew = null, modelEtagNew = null;
    let previewSavePromise = null, previewRelNew = null, previewAbsNew = null;
    let receivedModel = false, receivedPreview = false;

    const cleanupNew = async () => {
      if (previewAbsNew) { try { fs.unlinkSync(previewAbsNew); } catch {} }
      if (modelKeyNew) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: WASABI_BUCKET, Key: modelKeyNew })); } catch {}
      }
    };

    const removeOldResources = async (replaced) => {
      const { preview, model } = replaced || {};
      if (preview && oldDoc.previewImagePath) {
        try {
          const oldName = path.basename(String(oldDoc.previewImagePath));
          const oldAbs = path.join(PREVIEWS_DIR, oldName);
          fs.unlinkSync(oldAbs);
        } catch {}
      }
      if (model && oldDoc.modelKey) {
        try {
          await s3.send(new DeleteObjectCommand({
            Bucket: oldDoc.modelBucket || WASABI_BUCKET,
            Key: oldDoc.modelKey,
          }));
        } catch {}
      }
    };

    bb.on("field", (name, val) => {
      const push = (k, v) => { fields[k] = [...fields[k], v]; provided[k] = true; };

      switch (name) {
        case "name": fields.name = String(val || "").trim(); provided.name = true; break;
        case "description": fields.description = String(val || "").slice(0, 2000).trim(); provided.description = true; break;
        case "price": fields.price = Number(val); provided.price = true; break;
        case "order": fields.order = Number(val); provided.order = true; break; // NEW: order
        case "colors":
        case "colors[]": push("colors", String(val)); break;
        case "form":
        case "form[]": push("form", String(val)); break;
        case "categoryIds":
        case "categoryIds[]": push("categoryIds", String(val)); break;
        case "styles":
        case "styles[]": push("styles", String(val)); break;
        case "materials":
        case "materials[]": push("materials", String(val)); break;
        case "displayHome":
        case "displayhome":
        case "display_home":
          fields.displayHome = parseBool(val); provided.displayHome = true; break;
        default: break;
      }
    });

    bb.on("file", (fieldname, file, info = {}) => {
      const { filename = "", mimeType } = info;
      const ext = path.extname(filename).toLowerCase();
      file.on("error", (err) => bb.emit("error", err));

      if (fieldname === "modelFile") {
        if (!ACCEPT_MODELS.includes(ext)) {
          file.resume();
          return bb.emit("error", new Error("Model phải là .zip/.glb/.fbx/.obj/.blend"));
        }
        receivedModel = true;
        modelMimeNew = mimeType || "application/octet-stream";

        const key = `models/${makeUniqueName(filename || "model")}`;
        modelKeyNew = key;

        const pass = new PassThrough();

        let uploadedBytes = 0;
        file.on("data", (chunk) => { uploadedBytes += chunk.length; });
        file.on("limit", () => pass.destroy(new Error(`File model vượt quá ${MAX_FILE_MB}MB`)));

        const uploader = new Upload({
          client: s3,
          params: { Bucket: WASABI_BUCKET, Key: key, Body: pass, ContentType: modelMimeNew },
          queueSize: 3, partSize: 5 * 1024 * 1024, leavePartsOnError: false,
        });

        modelUploadPromise = uploader.done().then(async (out) => {
          modelUrlNew = composeWasabiObjectUrl(WASABI_BUCKET, key);
          modelSizeBytesNew = Number.isFinite(uploadedBytes) ? uploadedBytes : null;
          if (out && out.ETag) modelEtagNew = String(out.ETag).replace(/"/g, "");
          if (modelSizeBytesNew == null || modelEtagNew == null) {
            try {
              const head = await headWithRetry(WASABI_BUCKET, key, 8);
              if (modelSizeBytesNew == null) {
                const len = head.ContentLength;
                modelSizeBytesNew = typeof len === "number" ? len : Number(len) || null;
              }
              if (modelEtagNew == null && head.ETag) modelEtagNew = String(head.ETag).replace(/"/g, "");
            } catch {}
          }
        });

        file.pipe(pass);
        return;
      }

      if (fieldname === "previewImage") {
        if (!ACCEPT_IMAGES.includes(ext)) {
          file.resume();
          return bb.emit("error", new Error("Ảnh preview phải là .png/.jpg/.jpeg/.webp"));
        }
        receivedPreview = true;

        const name = filename || "preview";
        previewAbsNew = path.join(PREVIEWS_DIR, name);
        const ws = fs.createWriteStream(previewAbsNew);
        previewRelNew = `/uploads/previews/${name}`.replace(/\\/g, "/");

        previewSavePromise = new Promise((resolve, reject) => {
          file.on("limit", () => ws.destroy(new Error(`Ảnh preview vượt quá ${MAX_FILE_MB}MB`)));
          ws.on("finish", resolve);
          ws.on("error", reject);
        });

        file.pipe(ws);
        return;
      }

      file.resume();
    });

    bb.once("filesLimit", () => bb.emit("error", new Error("Quá số lượng file cho phép")));
    bb.once("fieldsLimit", () => bb.emit("error", new Error("Quá số lượng field cho phép")));
    bb.once("partsLimit", () => bb.emit("error", new Error("Quá số lượng parts cho phép")));

    bb.once("error", async (err) => {
      await cleanupNew();
      next(err);
    });

    bb.once("finish", async () => {
      try {
        if (provided.colors) fields.colors = asIdArray(fields.colors);
        if (provided.form) fields.form = asIdArray(fields.form);
        if (provided.styles) fields.styles = asIdArray(fields.styles);
        if (provided.materials) fields.materials = asIdArray(fields.materials);
        if (provided.categoryIds) fields.categoryIds = asIdArray(fields.categoryIds);

        // Giá trị hiệu lực kiểm tra tối thiểu (giữ nguyên)
        const eff = {
          name: provided.name ? fields.name : oldDoc.name,
          price: provided.price ? fields.price : oldDoc.price,
          categoryIds: provided.categoryIds ? fields.categoryIds : (oldDoc.categoryIds || []),
          form: provided.form ? fields.form : (oldDoc.form || []),
        };

        if (!eff.name || !String(eff.name).trim()) throw new Error("Thiếu tên sản phẩm");
        if (!Number.isFinite(eff.price) || eff.price < 0) throw new Error("Giá không hợp lệ");
        if (!eff.categoryIds || eff.categoryIds.length === 0) throw new Error("Chọn ít nhất 1 category");
        // if (!eff.form || eff.form.length === 0) throw new Error("Chọn ít nhất 1 form");

        // Chuẩn hoá order nếu có gửi lên
        if (provided.order) {
          if (!Number.isFinite(fields.order) || fields.order < 0) fields.order = 0;
        }

        await Promise.all([modelUploadPromise, previewSavePromise]);

        const patch = {};
        if (provided.name) patch.name = fields.name;
        if (provided.description) patch.description = fields.description || "";
        if (provided.price) patch.price = fields.price;
        if (provided.order) patch.order = fields.order; // NEW: order
        if (provided.colors) patch.color = fields.colors;
        if (provided.form) patch.form = fields.form;
        if (provided.styles) patch.styles = fields.styles;
        if (provided.materials) patch.materials = fields.materials;
        if (provided.categoryIds) patch.categoryIds = fields.categoryIds;
        if (provided.displayHome) patch.displayhome = !!fields.displayHome;

        // --- NEW: XÓA ẢNH CŨ TRƯỚC KHI CẬP NHẬT ---
        if (receivedPreview && previewRelNew) {
          if (oldDoc.previewImagePath) {
            try {
              const oldName = path.basename(String(oldDoc.previewImagePath));
              const oldAbs = path.join(PREVIEWS_DIR, oldName);
              fs.unlinkSync(oldAbs); // xoá trước
            } catch {}
          }
          patch.previewImagePath = previewRelNew; // sau khi xoá xong, gắn path mới
        }

        if (receivedModel && modelKeyNew) {
          patch.modelKey = modelKeyNew;
          patch.modelBucket = WASABI_BUCKET;
          patch.modelContentType = modelMimeNew;
          patch.modelSize = modelSizeBytesNew;
          patch.modelEtag = modelEtagNew;
          patch.modelFilePath = modelUrlNew;
        }

        let added = [], removed = [];
        if (provided.categoryIds) {
          const oldSet = new Set((oldDoc.categoryIds || []).map(String));
          const newSet = new Set((fields.categoryIds || []).map(String));
          added = [...newSet].filter((x) => !oldSet.has(x));
          removed = [...oldSet].filter((x) => !newSet.has(x));
        }

        const updated = await Product.findByIdAndUpdate(id, patch, { new: true });
        if (!updated) throw new Error("Cập nhật thất bại");

        if (added.length || removed.length) {
          try {
            if (added.length) await incCategoryCounts(added, +1);
            if (removed.length) await incCategoryCounts(removed, -1);
          } catch (e) {
            await Product.findByIdAndUpdate(id, { categoryIds: oldDoc.categoryIds || [] }).catch(() => {});
            await cleanupNew();
            throw e;
          }
        }

        // Giữ logic cũ cho model: xoá sau khi update DB (preview đã xoá trước rồi)
        await removeOldResources({
          preview: false,                                  // đã xoá trước đó
          model: receivedModel && !!modelKeyNew,
        });

        return res.json({ ok: true, product: updated });
      } catch (e) {
        await cleanupNew();
        return next(e);
      }
    });

    req.pipe(bb);
  } catch (outerErr) {
    next(outerErr);
  }
}


// GET /api/products/filters
async function getFilters(_req, res) {
  try {
    let [colors, forms, styles, materials, categories] = await Promise.all([
      Color.find({}, "code").sort({ code: 1 }).lean(),
      Form.find({}, "name image").sort({ name: 1 }).lean(),
      // STYLE: trả thêm image để FE hiển thumbnail
      Style.find({}, "name image").sort({ name: 1 }).lean(),
      Material.find({}, "name").sort({ name: 1 }).lean(),
      // CATEGORY: trả thêm parent để FE phân cấp cha–con
      Category.find({}, "name parent").sort({ name: 1 }).lean(),
    ]);

    colors = colors.map((c) => ({ ...c, hex: normalizeCode(c.code) || "#e5e7eb" }));

    res.json({ colors, forms, styles, materials, categories });
  } catch (e) {
    res.status(500).json({ message: "Không lấy được filters", error: e.message });
  }
}

// GET /api/products/list (lọc/sort/paginate + populate) – ép vào cây 3dmodel
async function listProducts3D(req, res) {
  try {
    const {
      q, minPrice, maxPrice, colors, forms, styles, materials, categories,
      // vẫn đọc sort như cũ, nhưng dù là gì cũng sẽ ưu tiên order trước
      sort = "newest", page = 1, limit = 20,
      displayhome, displayHome,
    } = req.query;

    const filter = {};

    // ---- Tìm kiếm theo q: name OR customId/customID ----
    if (q && String(q).trim()) {
      const rx = { $regex: q, $options: "i" };
      filter.$or = [
        { name: rx },
        { customId: rx },  // nếu schema dùng customId
        { customID: rx },  // nếu schema dùng customID
      ];
    }

    const min = Number(minPrice);
    const max = Number(maxPrice);
    if (!Number.isNaN(min) || !Number.isNaN(max)) {
      filter.price = {};
      if (!Number.isNaN(min)) filter.price.$gte = min;
      if (!Number.isNaN(max)) filter.price.$lte = max;
    }

    const colorIds = parseObjectIds(colors);
    const formIds = parseObjectIds(forms);
    const styleIds = parseObjectIds(styles);
    const materialIds = parseObjectIds(materials);
    const categoryIds = parseObjectIds(categories);

    if (colorIds.length) filter.color = { $in: colorIds };
    if (formIds.length) filter.form = { $in: formIds };
    if (styleIds.length) filter.styles = { $in: styleIds };
    if (materialIds.length) filter.materials = { $in: materialIds };
    if (categoryIds.length) filter.categoryIds = { $in: categoryIds };

    const dHome = parseBoolParam(displayhome ?? displayHome);
    if (dHome !== null) filter.displayhome = dHome;

    // ép vào cây 3dmodel
    const root3dIds = await getCategoryIdsUnderRoots(["3dmodel", "3dmodels"]);
    if (!root3dIds || root3dIds.length === 0) {
      return res.json({ items: [], total: 0, page: 1, pages: 0, limit: Number(limit) || 20 });
    }
    if (!filter.categoryIds) filter.categoryIds = {};
    if (filter.categoryIds.$in && Array.isArray(filter.categoryIds.$in)) {
      const setRoot = new Set(root3dIds.map(String));
      filter.categoryIds.$in = filter.categoryIds.$in.filter((id) => setRoot.has(String(id)));
      if (!filter.categoryIds.$in.length) {
        return res.json({ items: [], total: 0, page: 1, pages: 0, limit: Number(limit) || 20 });
      }
    } else {
      filter.categoryIds.$in = root3dIds;
    }

    // ---- LUÔN ƯU TIÊN ORDER TRƯỚC, sau đó mới đến sort hiện có ----
    const secondarySortMap = {
      manual:    { createdAt: -1, _id: -1 }, // nếu client truyền manual vẫn hoạt động
      newest:    { createdAt: -1, _id: -1 },
      oldest:    { createdAt:  1, _id:  1 },
      price_asc: { price:      1, _id:  1 },
      price_desc:{ price:     -1, _id: -1 },
      name_asc:  { name:       1, _id:  1 },
      name_desc: { name:      -1, _id: -1 },
    };
    const secondary = secondarySortMap[sort] || secondarySortMap.newest;

    // Quan trọng: giữ thứ tự khóa sort → order đứng TRƯỚC
    const sortOpt = sort === "default" ? { order: -1, createdAt: -1 } : secondary;
    // const sortOpt = Object.assign({}, { order: -1 }, secondary);

    const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    const [total, items] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .populate("color", "code")
        .populate("form", "name image")
        .populate("styles", "name")
        .populate("materials", "name")
        .populate("categoryIds", "name")
        .sort(sortOpt)
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    items.forEach((p) => {
      if (Array.isArray(p.color)) {
        p.color = p.color.map((c) => ({ ...c, hex: normalizeCode(c.code) || "#e5e7eb" }));
      }
    });

    res.json({
      items,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      limit: limitNum
    });
  } catch (e) {
    res.status(500).json({ message: "Không lấy được danh sách sản phẩm", error: e.message });
  }
}

// GET /api/products (generic) – vẫn ép vào cây 3dmodel
function resolveSort(sort) {
  switch (String(sort || '').trim()) {
    case 'default':
    case 'newest':
      return { createdAt: -1, _id: -1 };
    case 'oldest':
      return { createdAt: 1, _id: 1 };
    case 'most_purchased':
      return { purchasedCount: -1, createdAt: -1, _id: -1 };
    case 'most_viewed':
      return { viewCount: -1, createdAt: -1, _id: -1 };
    case 'price_asc':
      return { price: 1, _id: 1 };
    case 'price_desc':
      return { price: -1, _id: -1 };
    case 'name_asc':
      return { name: 1, _id: 1 };
    case 'name_desc':
      return { name: -1, _id: -1 };
    default:
      return { createdAt: -1, _id: -1 };
  }
}

// 🆕 Helper: ghép order ưu tiên trước, tránh bị resolveSort trả về order đè ngược
function withOrderFirst(secondarySort = {}) {
  // Nếu secondary có key 'order', loại bỏ để không ghi đè
  const { order, ...rest } = secondarySort || {};
  // Ưu tiên order trước, sau đó mới đến các tie-breaker hiện có
  return Object.assign({}, { order: -1 }, rest);
}

async function getProductsGeneric(req, res) {
  try {
    const {
      page = "1", limit = "20", q = "", sort = "default",
      priceType, categoryIds, styleIds, colorIds, formIds, materialIds, populate,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = {};

    if (q && q.trim()) {
      filter.name = { $regex: new RegExp(escapeRegex(q.trim()), "i") };
    }

    if (priceType === "free") filter.price = 0;
    else if (priceType === "pro") filter.price = { $gt: 0 };

    // Tất cả các field liên kết trong schema hiện là MẢNG ⇒ dùng $all
    const catIds = toObjectIds(categoryIds);
    if (catIds.length) filter.categoryIds = { $all: catIds };

    const styleIdsArr = toObjectIds(styleIds);
    if (styleIdsArr.length) filter.styles = { $all: styleIdsArr };

    const colorIdsArr = toObjectIds(colorIds);
    if (colorIdsArr.length) filter.color = { $all: colorIdsArr };

    const formIdsArr = toObjectIds(formIds);
    if (formIdsArr.length) filter.form = { $all: formIdsArr };

    const materialIdsArr = toObjectIds(materialIds);
    if (materialIdsArr.length) filter.materials = { $all: materialIdsArr };

    // ép vào cây 3dmodel
    const root3dIds = await getCategoryIdsUnderRoots(["3dmodel", "3dmodels"]);
    if (!root3dIds || root3dIds.length === 0) {
      return res.json({ items: [], total: 0, page: pageNum, limit: limitNum });
    }
    if (!filter.categoryIds) filter.categoryIds = {};
    if (filter.categoryIds.$in && Array.isArray(filter.categoryIds.$in)) {
      const setRoot = new Set(root3dIds.map(String));
      filter.categoryIds.$in = filter.categoryIds.$in.filter((id) => setRoot.has(String(id)));
      if (!filter.categoryIds.$in.length) {
        return res.json({ items: [], total: 0, page: pageNum, limit: limitNum });
      }
    } else {
      filter.categoryIds.$in = root3dIds;
    }

    // ⬇️ Giữ nguyên resolveSort hiện có, rồi ghép 'order:1' đứng trước
    const secondarySort = resolveSort(sort);         // ví dụ { createdAt:-1, _id:-1 } hoặc { price:1, _id:1 } ...
    const sortOption = sort === "default" ? withOrderFirst(secondarySort) : secondarySort;
    let query = Product.find(filter)
      .sort(sortOption)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .select("name price previewImagePath modelFilePath viewCount purchasedCount createdAt");

    if (populate === "1") {
      query = query
        .populate("color", "name code")
        .populate("form", "name image")
        .populate("styles", "name")
        .populate("materials", "name")
        .populate("categoryIds", "name");
    }

    const [items, total] = await Promise.all([
      query.lean(),
      Product.countDocuments(filter),
    ]);

    res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("GET /api/products error:", err);
    res.status(500).json({ error: "SERVER_ERROR", message: err?.message || "Internal Server Error" });
  }
}


// GET /api/products/:id
async function getProductById(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID không hợp lệ" });
    }

    const product = await Product.findById(id)
      .populate("color", "_id code hex name")
      .populate("form", "_id name image")
      .populate("styles", "_id name")
      .populate("materials", "_id name")
      .populate("categoryIds", "_id name")
      .lean();

    if (!product) return res.status(404).json({ message: "Không tìm thấy sản phẩm" });
    product.previewImagePath = product.previewImagePath || "";
    return res.json({ product });
  } catch (err) {
    next(err);
  }
}
async function incrementViewCount(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "ID không hợp lệ" });
    }

    // $inc là atomic ⇒ an toàn khi nhiều request đồng thời
    const updated = await Product.findByIdAndUpdate(
      id,
      { $inc: { viewCount: 1 } },
      { new: true, projection: { _id: 1, viewCount: 1 } }
    );

    if (!updated) {
      return res.status(404).json({ ok: false, message: "Không tìm thấy sản phẩm" });
    }

    return res.json({ ok: true, viewCount: updated.viewCount });
  } catch (err) {
    console.error("incrementViewCount error:", err);
    return res.status(500).json({ ok: false, message: "SERVER_ERROR" });
  }
}
async function Owned(req, res) {
  try {
    const userId = req.user._id;
    const { ids = [] } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ ownedIds: [] });
    }

    // đọc từ user.purchased
    const user = await User.findById(userId, { purchased: 1 }).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const ownedSet = new Set((user.purchased || []).map(p => String(p.productId)));
    const ownedIds = ids.map(String).filter(id => ownedSet.has(id));

    return res.json({ ownedIds });
  } catch (err) {
    console.error("owned route error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/* NEW: GET /api/categories/tree-3d  (cây category cho 3D Models: root -> level2 -> level3) */
async function get3DCategoryTree(req, res) {
  try {
    const rootName = String(req.query.root || "3dmodel").trim(); // cho phép ?root=3dmodel|3dmodels
    const regex = new RegExp(`^${escapeRegex(rootName)}s?$`, "i");

    const root = await Category.findOne({ name: regex, parent: null }).lean();
    if (!root) return res.json({ root: null, children: [] });

    const level2 = await Category.find({ parent: root._id }).sort({ name: 1 }).lean();

    const children = [];
    for (const p of level2) {
      const grand = await Category.find({ parent: p._id }).sort({ name: 1 }).lean();
      children.push({ ...p, children: grand });
    }

    return res.json({ root, children });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
async function getTopPurchased(req, res) {
  try {
    const limitRaw = (req.query.limit || "50").toString().trim().toLowerCase();
    const noLimit = limitRaw === "0" || limitRaw === "all";

    // nếu có limit số thì kẹp lại 1..500, còn noLimit thì bỏ hẳn $limit
    const limitNum = noLimit
      ? null
      : Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 500);

    const displayhome = req.query.displayhome; // "1"|"0"|undefined
    const match = {};
    if (displayhome === "1") match.displayhome = true;
    if (displayhome === "0") match.displayhome = false;

    const pipeline = [
      { $match: match },

      // Ưu tiên images.isCover, fallback images[0], fallback previewImagePath
      {
        $addFields: {
          _coverFromImages: {
            $let: {
              vars: {
                cover: {
                  $first: {
                    $filter: {
                      input: { $ifNull: ["$images", []] },
                      as: "img",
                      cond: { $eq: ["$$img.isCover", true] }
                    }
                  }
                },
                firstImg: { $first: { $ifNull: ["$images", []] } }
              },
              in: { $ifNull: ["$$cover.path", "$$firstImg.path"] }
            }
          }
        }
      },
      {
        $addFields: {
          coverImagePath: { $ifNull: ["$_coverFromImages", "$previewImagePath"] }
        }
      },

      // Chỉ trường cần thiết
      {
        $project: {
          _id: 1,
          name: 1,
          customId: 1,
          price: 1,
          purchasedCount: { $ifNull: ["$purchasedCount", 0] },
          image: "$coverImagePath",
          createdAt: 1
        }
      },

      // Sort theo purchasedCount ↓, rồi createdAt để ổn định
      { $sort: { purchasedCount: -1, createdAt: -1, _id: 1 } }
    ];

    // 👉 chỉ thêm $limit khi KHÔNG ở chế độ lấy hết
    if (!noLimit) {
      pipeline.push({ $limit: limitNum });
    }

    const items = await Product.aggregate(pipeline).allowDiskUse(true);
    return res.json({
      items,
      total: items.length,
      // phản hồi thêm để FE biết đang ở chế độ nào
      limit: noLimit ? 0 : limitNum
    });
  } catch (err) {
    console.error("getTopPurchased error:", err);
    return res.status(500).json({ message: "Lỗi server", error: String(err?.message || err) });
  }
}

module.exports = {
  createProduct3D,
  updateProduct3D,
  getFilters,
  listProducts3D,
  getProductsGeneric,
  getProductById,
  incrementViewCount,
  Owned,
  // NEW
  get3DCategoryTree,
  getTopPurchased,
};
