// controllers/productScenes.controller.js
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const mongoose = require("mongoose");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

const Product = require("../models/Product");
const Category = require("../models/Category");

// ===== Wasabi config (thêm để build public URL giống controller kia) =====
const WASABI_BUCKET   = process.env.WASABI_BUCKET;
const WASABI_REGION   = process.env.WASABI_REGION;
const WASABI_ENDPOINT = (
  process.env.WASABI_ENDPOINT ||
  (WASABI_REGION ? `https://s3.${WASABI_REGION}.wasabisys.com` : "https://s3.wasabisys.com")
).replace(/\/+$/, "");
// Nếu bạn có CDN/domain public riêng, set WASABI_PUBLIC_BASE; mặc định dùng endpoint
const PUBLIC_BASE     = (process.env.WASABI_PUBLIC_BASE || WASABI_ENDPOINT).replace(/\/+$/, "");

function composeWasabiObjectUrl(bucket, key) {
  const encKey = String(key).split("/").map(encodeURIComponent).join("/");
  return `${PUBLIC_BASE}/${bucket}/${encKey}`;
}

// ===== S3 (Wasabi) client =====
const s3 = new S3Client({
  region: process.env.WASABI_REGION || "us-east-1",
  endpoint: process.env.WASABI_ENDPOINT || "https://s3.wasabisys.com",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
  },
});

// ===== Category mặc định cần tự động thêm khi tạo mới =====
const DEFAULT_SCENE_CATEGORY_ID =
  process.env.DEFAULT_SCENE_CATEGORY_ID || "68a55296e06aee921714659e";

// ===== Helpers =====
async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

function extFromMimetype(mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "model/gltf-binary": ".glb",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "text/plain": ".obj",
    "application/vnd.rar": ".rar",
    "application/x-rar-compressed": ".rar",
    "application/x-rar": ".rar",
    "application/octet-stream": "",
  };
  return map[mime] ?? "";
}

async function saveLocalFileFromBuffer(file, subFolder) {
  const safeBase = path.basename(file.originalname || "file");
  const withExt = path.extname(safeBase) ? safeBase : (safeBase + (extFromMimetype(file.mimetype) || ""));
  const rel = path.join("uploads", subFolder, withExt);
  const abs = path.join(process.cwd(), rel);

  await ensureDir(path.dirname(abs));

  try {
    // Nếu muốn fail khi trùng tên:
    await fsp.writeFile(abs, file.buffer, { flag: "wx" });
    return { rel: `/${rel.replace(/\\/g, "/")}`, abs };
  } catch (err) {
    if (err.code === "EEXIST") {
      const parsed = path.parse(withExt);
      const rand = crypto.randomBytes(4).toString("hex");
      const newName = `${parsed.name}_${rand}${parsed.ext}`;
      const rel2 = path.join("uploads", subFolder, newName);
      const abs2 = path.join(process.cwd(), rel2);
      await fsp.writeFile(abs2, file.buffer);
      return { rel: `/${rel2.replace(/\\/g, "/")}`, abs: abs2 };
    }
    throw err;
  }
}

function parseIdList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.map(String);
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

const asIdArray = (arr) =>
  [...new Set((arr || []).map(String).map((s) => s.trim()).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

async function incCategoryCounts(ids = [], delta = +1) {
  if (!Array.isArray(ids) || !ids.length) return;
  await Category.updateMany({ _id: { $in: ids } }, { $inc: { count: delta } }).exec();

  // Clamp negative counts to zero to avoid showing negative numbers in UI
  try {
    await Category.updateMany({ _id: { $in: ids }, count: { $lt: 0 } }, { $set: { count: 0 } }).exec();
  } catch (e) {
    console.error('incCategoryCounts clamp error (scenes):', e);
  }
}

// ===== Giới hạn theo cây 3dscenes =====
const ROOT_NAME = process.env.SCENES_ROOT_NAME || "3dscenes";
const ROOT_ID   = process.env.SCENES_ROOT_ID || ""; // _id của node 3dscenes (khuyến nghị set ENV)

let _underCache = { ids: null, at: 0 };
const UNDER_TTL_MS = 60 * 1000; // cache 60s

async function getDescendantIdsOf3dScenes() {
  const now = Date.now();
  if (_underCache.ids && (now - _underCache.at) < UNDER_TTL_MS) {
    return _underCache.ids; // Set<string>
  }

  let match = {};
  if (ROOT_ID && mongoose.Types.ObjectId.isValid(ROOT_ID)) {
    match = { _id: mongoose.Types.ObjectId.createFromHexString(ROOT_ID) };
  } else {
    match = { name: ROOT_NAME };
  }

  const agg = await Category.aggregate([
    { $match: match },
    {
      $graphLookup: {
        from: "categories",
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "parent",
        as: "descendants",
      },
    },
    { $project: { allIds: { $concatArrays: [["$_id"], "$descendants._id"] } } },
  ]);

  const ids = new Set((agg?.[0]?.allIds || []).map((x) => String(x)));
  _underCache = { ids, at: now };
  return ids;
}

/* ====================================================================
   CONTROLLERS
==================================================================== */

// GET /api/product-scenes   (list trong cây 3dscenes + search + filter)
async function listProductScenes(req, res) {
  try {
    const page  = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 12)));
    const skip  = (page - 1) * limit;

    const cond = {};
    const proj = {};
    let sort = { createdAt: -1 };

    // 1) Giới hạn trong cây 3dscenes
    const underSet = await getDescendantIdsOf3dScenes();
    if (!underSet || underSet.size === 0) {
      return res.json({ page, limit, total: 0, items: [] });
    }

    // 2) search
    const search = String(req.query.search || "").trim();
    if (search) {
      cond.$text = { $search: search };
      proj.score = { $meta: "textScore" };
      sort = { score: { $meta: "textScore" }, createdAt: -1 };
    }

    // 3) styles filter (match ANY)
    const stylesRaw = parseIdList(req.query.styles);
    const styleIds  = asIdArray(stylesRaw).map((id) => mongoose.Types.ObjectId.createFromHexString(id));
    if (styleIds.length) cond.styles = { $in: styleIds };

    // 4) category filter (chỉ id trong cây)
    const cat = String(req.query.category || "").trim();
    if (cat) {
      if (!mongoose.Types.ObjectId.isValid(cat) || !underSet.has(cat)) {
        return res.json({ page, limit, total: 0, items: [] });
      }
      cond.categoryIds = mongoose.Types.ObjectId.createFromHexString(cat);
    } else {
      cond.categoryIds = { $in: [...underSet].map((id) => mongoose.Types.ObjectId.createFromHexString(id)) };
    }

    const [items, total] = await Promise.all([
      Product.find(cond)
        .select({ ...proj, modelKey: 0, modelEtag: 0 })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(cond),
    ]);

    res.json({ page, limit, total, items });
  } catch (e) {
    console.error("List product-scenes error:", e);
    res.status(500).json({ message: e.message || "Lỗi server" });
  }
}

// GET /api/product-scenes/client (public list)
async function listProductScenesClient(req, res) {
  try {
    const page  = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 24)));
    const skip  = (page - 1) * limit;

    const underSet = await getDescendantIdsOf3dScenes();
    if (!underSet || underSet.size === 0) return res.json({ page, limit, total: 0, items: [] });

    const cond = {};
    const proj = {};
    let sort = { createdAt: -1 };

    // search
    const search = String(req.query.search || "").trim();
    if (search) {
      cond.$text = { $search: search };
      proj.score = { $meta: "textScore" };
      sort = { score: { $meta: "textScore" }, createdAt: -1 };
    }

    // styles
    if (req.query.styles) {
      const list = String(req.query.styles).split(",").map(s => s.trim()).filter(Boolean);
      const ids = list
        .filter(mongoose.Types.ObjectId.isValid)
        .map(mongoose.Types.ObjectId.createFromHexString);
      if (ids.length) cond.styles = { $in: ids }; // ANY
    }

    // priceType
    const priceType = String(req.query.priceType || "");
    if (priceType === "free") cond.price = 0;
    if (priceType === "pro")  cond.price = { $gt: 0 };

    // categories (multi)
    if (req.query.categories) {
      const list = String(req.query.categories).split(",").map(s => s.trim()).filter(Boolean);
      const chosen = list.filter((id) => mongoose.Types.ObjectId.isValid(id) && underSet.has(id));
      if (chosen.length === 0) return res.json({ page, limit, total: 0, items: [] });
      cond.categoryIds = { $in: chosen.map(mongoose.Types.ObjectId.createFromHexString) };
    } else {
      cond.categoryIds = { $in: [...underSet].map(mongoose.Types.ObjectId.createFromHexString) };
    }

    // sort (khi không search)
    const s = String(req.query.sort || "newest");
    if (!search) {
      sort = (s === "oldest") ? { createdAt: 1 } : { createdAt: -1 };
    }

    const [items, total] = await Promise.all([
      Product.find(cond)
        .select({ ...proj, modelKey: 0, modelEtag: 0 })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(cond),
    ]);

    res.json({ page, limit, total, items });
  } catch (e) {
    console.error("List product-scenes error:", e);
    res.status(500).json({ message: e.message || "Lỗi server" });
  }
}

// GET /api/product-scenes/:id
async function getProductSceneById(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID không hợp lệ" });

    const doc = await Product.findById(id).select("-modelKey -modelEtag").lean();
    if (!doc) return res.status(404).json({ message: "Không tìm thấy sản phẩm" });

    res.json(doc);
  } catch (e) {
    console.error("Detail product-scenes error:", e);
    res.status(500).json({ message: e.message || "Lỗi server" });
  }
}

// POST /api/product-scenes (create)
// async function createProductScene(req, res) {
//   // --- helper: ép kiểu boolean ---
//   function parseBool(v) {
//     if (typeof v === "boolean") return v;
//     if (v == null) return false;
//     const s = String(v).trim().toLowerCase();
//     return s === "true" || s === "1" || s === "on" || s === "yes";
//   }
//   const readStr = (v, def = "") =>
//     v === undefined || v === null ? def : String(v).trim();

//   // NEW: helper sinh id an toàn từ tên file (bỏ dấu, chỉ [a-z0-9-])
//   function deriveIdFromFilename(raw) {
//     const out = String(raw || "")
//       .trim()
//       .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
//       .replace(/[^a-zA-Z0-9]+/g, "-")
//       .replace(/^-+|-+$/g, "")
//       .toLowerCase();
//     return out || null;
//   }

//   // NEW: helper đảm bảo key duy nhất theo dạng models/<customId>[-n].ext
//   async function ensureUniqueModelKey(bucket, desiredKey, maxTries = 50) {
//     const dot = desiredKey.lastIndexOf(".");
//     const ext = dot > -1 ? desiredKey.slice(dot) : "";
//     const base = dot > -1 ? desiredKey.slice(0, dot) : desiredKey;

//     for (let i = 0; i < maxTries; i++) {
//       const key = i === 0 ? desiredKey : `${base}-${i}${ext}`;
//       try {
//         await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
//         // tồn tại -> thử biến thể tiếp
//       } catch (err) {
//         // 404/NotFound -> dùng key này
//         return key;
//       }
//     }
//     throw new Error("Không thể tạo tên file model duy nhất sau nhiều lần thử");
//   }

//   // Biến rollback
//   let modelKey = null;
//   let previewAbs = null;
//   const extraAbsList = [];

//   async function cleanup() {
//     if (previewAbs) { try { fs.unlinkSync(previewAbs); } catch {} }
//     for (const abs of extraAbsList) { try { fs.unlinkSync(abs); } catch {} }
//     if (modelKey) {
//       try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.WASABI_BUCKET, Key: modelKey })); } catch {}
//     }
//   }

//   try {
//     const bucket = process.env.WASABI_BUCKET;
//     if (!bucket) return res.status(500).json({ message: "WASABI_BUCKET chưa được cấu hình" });
//     if (!process.env.WASABI_ACCESS_KEY_ID || !process.env.WASABI_SECRET_ACCESS_KEY) {
//       return res.status(500).json({ message: "Thông tin Wasabi chưa đầy đủ" });
//     }

//     const name = (req.body.name || "").trim();
//     const description = (req.body.description || "").trim();
//     const priceNumber = Number(req.body.price ?? 0);

//     // NEW: nhận toggle FE
//     const displayHome = parseBool(
//       req.body.displayHome ?? req.body.displayhome ?? req.body.display_home
//     );

//     // NEW: nhận 3 trường text
//     const render      = readStr(req.body.render);
//     const lighting    = readStr(req.body.lighting);
//     const cameraType  = readStr(req.body.cameraType ?? req.body.camera_type);

//     // categories: ép thêm DEFAULT_SCENE_CATEGORY_ID
//     const rawCat = parseIdList(req.body.categoryIds || req.body["categoryIds[]"]);
//     let categoryIds = asIdArray(rawCat);
//     const defId = String(DEFAULT_SCENE_CATEGORY_ID).trim();
//     if (mongoose.Types.ObjectId.isValid(defId) && !categoryIds.includes(defId)) {
//       categoryIds.push(defId);
//     }
//     if (!categoryIds.length) return res.status(400).json({ message: "Chọn ít nhất 1 category" });

//     // styles
//     const rawStyles = parseIdList(req.body.styles || req.body["styles[]"]);
//     const styles = asIdArray(rawStyles);

//     if (!name) return res.status(400).json({ message: "Thiếu tên sản phẩm" });
//     if (!Number.isFinite(priceNumber) || priceNumber < 0) {
//       return res.status(400).json({ message: "Giá không hợp lệ" });
//     }

//     const files = req.files || {};
//     const modelFile    = files.modelFile?.[0] || null;
//     const previewImage = files.previewImage?.[0] || null;
//     const extraImages = [
//       ...(files.extraImages || []),  // nhiều ảnh
//       ...(files.extraImage || []),   // key cũ (nếu có)
//     ];
//     if (!modelFile) return res.status(400).json({ message: "Chưa upload modelFile" });
//     if (!previewImage) return res.status(400).json({ message: "Chưa upload previewImage" });

//     // >>> NEW: tạo customId từ tên file preview gốc (chưa đổi)
//     const previewOriginalName = previewImage.originalname || null;
//     let customIdFromPreview = null;
//     if (previewOriginalName) {
//       const ext0 = path.extname(previewOriginalName);
//       const base0 = path.basename(previewOriginalName, ext0);
//       customIdFromPreview = deriveIdFromFilename(base0);
//     }

//     // 1) Upload model lên Wasabi với tên theo customId
//     const modelExt =
//       (path.extname(modelFile.originalname || "").toLowerCase()) ||
//       extFromMimetype(modelFile.mimetype) ||
//       ""; // nếu không suy được thì không ép đuôi

//     // Nếu không có customId từ preview, fallback từ name sản phẩm hoặc "model"
//     const desiredBase =
//       customIdFromPreview ||
//       deriveIdFromFilename(name) ||
//       "model";

//     // Dựng key mong muốn: models/<customId>.ext (và đảm bảo không đụng)
//     const desiredKey = `models/${desiredBase}${modelExt}`;
//     modelKey = await ensureUniqueModelKey(bucket, desiredKey);

//     const putRes = await s3.send(
//       new PutObjectCommand({
//         Bucket: bucket,
//         Key: modelKey,
//         Body: modelFile.buffer,
//         ContentType: modelFile.mimetype || "application/octet-stream",
//       })
//     );

//     // >>> NEW: build public URL để lưu modelFilePath (giống controller 3dmodel)
//     const modelUrl = composeWasabiObjectUrl(bucket, modelKey);

//     // 2) Lưu ảnh LOCAL
//     const images = [];

//     // preview -> cover + previewImagePath
//     const { rel: previewPath, abs: previewAbsPath } = await saveLocalFileFromBuffer(previewImage, "previews");
//     previewAbs = previewAbsPath;
//     images.push({
//       path: previewPath, alt: name, isCover: true, order: 0,
//       width: null, height: null, size: previewImage.size ?? null,
//     });

//     // extra -> ảnh phụ
//     let orderBase = 1;
//     for (const f of extraImages) {
//       const { rel: extraPath, abs: extraAbs } = await saveLocalFileFromBuffer(f, "products");
//       extraAbsList.push(extraAbs);
//       images.push({
//         path: extraPath, alt: name, isCover: false, order: orderBase++,
//         width: null, height: null, size: f.size ?? null,
//       });
//     }

//     // 3) Tạo Product
//     const product = await Product.create({
//       name,
//       description,
//       price: priceNumber,
//       categoryIds,
//       styles,

//       // NEW: lưu render/lighting/cameraType
//       render,
//       lighting,
//       cameraType,

//       modelKey,
//       modelBucket: bucket,
//       modelContentType: modelFile.mimetype || null,
//       modelSize: modelFile.size ?? null,
//       modelEtag: (putRes.ETag || "").replace(/"/g, "") || null,

//       // >>> NEW: lưu luôn URL public
//       modelFilePath: modelUrl,

//       images,
//       previewImagePath: previewPath,

//       // lưu theo schema
//       displayhome: displayHome,

//       // NEW: lưu id từ tên preview + tên gốc
//       customId: customIdFromPreview || null,
//       previewOriginalName: previewOriginalName || null,
//     });

//     // 4) Tăng đếm category
//     try {
//       await incCategoryCounts(categoryIds, +1);
//     } catch (e) {
//       await Product.findByIdAndDelete(product._id).catch(() => {});
//       await cleanup();
//       throw e;
//     }

//     return res.status(201).json({ message: "Tạo sản phẩm thành công", product });
//   } catch (err) {
//     console.error("Create product-scenes error:", err);
//     await cleanup();
//     return res.status(500).json({ message: err.message || "Lỗi server" });
//   }
// }
// POST /api/product-scenes (create)
async function createProductScene(req, res) {
  // --- helpers cục bộ, giữ style cũ ---
  const parseBool = (v) => {
    if (typeof v === "boolean") return v;
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1" || s === "on" || s === "yes";
  };
  const readStr = (v, def = "") =>
    v === undefined || v === null ? def : String(v).trim();

  const deriveIdFromFilename = (raw) => {
    const out = String(raw || "")
      .trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return out || null;
  };

  const ensureUniqueModelKey = async (bucket, desiredKey, maxTries = 50) => {
    const dot = desiredKey.lastIndexOf(".");
    const ext = dot > -1 ? desiredKey.slice(dot) : "";
    const base = dot > -1 ? desiredKey.slice(0, dot) : desiredKey;
    for (let i = 0; i < maxTries; i++) {
      const key = i === 0 ? desiredKey : `${base}-${i}${ext}`;
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        // đã tồn tại -> thử biến thể tiếp
      } catch (err) {
        // 404/NotFound -> dùng key này
        return key;
      }
    }
    throw new Error("Không thể tạo tên file model duy nhất sau nhiều lần thử");
  };

  // --- guard abort để tránh gửi response 2 lần / Nginx 104 ---
  let clientAborted = false;
  try { req.setTimeout(10 * 60 * 1000); } catch {}
  req.on("aborted", () => { clientAborted = true; });
  res.on("close",   () => { clientAborted = true; });

  const safeJson = (code, payload) => {
    if (res.headersSent || clientAborted) return;
    return res.status(code).json(payload);
  };

  // --- biến rollback ---
  let createdModelKey = null;  // chỉ set khi chính route này PutObject
  let previewAbs = null;
  const extraAbsList = [];

  const cleanup = async () => {
    if (previewAbs) { try { fs.unlinkSync(previewAbs); } catch {} }
    for (const abs of extraAbsList) { try { fs.unlinkSync(abs); } catch {} }
    if (createdModelKey) {
      try { await s3.send(new DeleteObjectCommand({ Bucket: process.env.WASABI_BUCKET, Key: createdModelKey })); } catch {}
    }
  };

  try {
    const bucket = process.env.WASABI_BUCKET;
    if (!bucket) return safeJson(500, { message: "WASABI_BUCKET chưa được cấu hình" });
    if (!process.env.WASABI_ACCESS_KEY_ID || !process.env.WASABI_SECRET_ACCESS_KEY) {
      return safeJson(500, { message: "Thông tin Wasabi chưa đầy đủ" });
    }

    // ---------- Body chuẩn ----------
    const name = (req.body.name || "").trim();
    const description = (req.body.description || "").trim();
    const priceNumber = Number(req.body.price ?? 0);

    const displayHome = parseBool(
      req.body.displayHome ?? req.body.displayhome ?? req.body.display_home
    );

    const render      = readStr(req.body.render);
    const lighting    = readStr(req.body.lighting);
    const cameraType  = readStr(req.body.cameraType ?? req.body.camera_type);

    // ép default category
    const rawCat = parseIdList(req.body.categoryIds || req.body["categoryIds[]"]);
    let categoryIds = asIdArray(rawCat);
    const defId = String(DEFAULT_SCENE_CATEGORY_ID).trim();
    if (mongoose.Types.ObjectId.isValid(defId) && !categoryIds.includes(defId)) {
      categoryIds.push(defId);
    }
    if (!categoryIds.length) return safeJson(400, { message: "Chọn ít nhất 1 category" });

    // styles
    const rawStyles = parseIdList(req.body.styles || req.body["styles[]"]);
    const styles = asIdArray(rawStyles);

    if (!name) return safeJson(400, { message: "Thiếu tên sản phẩm" });
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return safeJson(400, { message: "Giá không hợp lệ" });
    }

    // ---------- Files & Presigned inputs ----------
    const files = req.files || {};
    const modelFile    = files.modelFile?.[0] || null;  // chỉ dùng nếu KHÔNG presigned
    const previewImage = files.previewImage?.[0] || null;
    const extraImages  = [
      ...(files.extraImages || []),
      ...(files.extraImage  || []),
    ];

    // HỖ TRỢ PRESIGNED:
    // - FE có thể gửi modelKey (và optional modelFilePath) nếu đã upload multipart trực tiếp lên Wasabi
    const presignedModelKey = (req.body.modelKey || "").trim();
    const presignedModelUrl = (req.body.modelFilePath || "").trim();

    // Yêu cầu preview (luồng nào cũng cần)
    if (!previewImage) return safeJson(400, { message: "Chưa upload previewImage" });

    // customId từ tên file preview
    const previewOriginalName = previewImage.originalname || null;
    let customIdFromPreview = null;
    if (previewOriginalName) {
      const ext0 = path.extname(previewOriginalName);
      const base0 = path.basename(previewOriginalName, ext0);
      customIdFromPreview = deriveIdFromFilename(base0);
    }

    // ------------------ A) PRESIGNED FLOW ------------------
    let finalModelKey = null;
    let modelSize = null, modelEtag = null, modelContentType = "application/octet-stream";
    let modelFilePath = "";

    if (presignedModelKey) {
      // Verify object tồn tại
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: presignedModelKey }));
        modelContentType = head.ContentType || modelContentType;
        const len = head.ContentLength;
        modelSize = typeof len === "number" ? len : Number(len) || null;
        if (head.ETag) modelEtag = String(head.ETag).replace(/"/g, "");
      } catch (e) {
        return safeJson(404, { message: "Model chưa tồn tại trên Wasabi hoặc modelKey sai" });
      }
      finalModelKey = presignedModelKey;
      modelFilePath = presignedModelUrl || composeWasabiObjectUrl(bucket, finalModelKey);
    }

    // ------------------ B) DIRECT UPLOAD FLOW (giữ nguyên chức năng cũ) ------------------
    if (!finalModelKey) {
      if (!modelFile) return safeJson(400, { message: "Chưa upload modelFile" });

      const modelExt =
        (path.extname(modelFile.originalname || "").toLowerCase()) ||
        extFromMimetype(modelFile.mimetype) ||
        "";

      const desiredBase =
        customIdFromPreview ||
        deriveIdFromFilename(name) ||
        "model";

      const desiredKey = `models/${desiredBase}${modelExt}`;
      const uniqueKey  = await ensureUniqueModelKey(bucket, desiredKey);

      // Hỗ trợ cả memoryStorage & diskStorage
      const bodyStreamOrBuffer =
        modelFile.path ? fs.createReadStream(modelFile.path) :
        (modelFile.buffer ?? Buffer.from([]));

      const putRes = await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: uniqueKey,
        Body: bodyStreamOrBuffer,
        ContentType: modelFile.mimetype || "application/octet-stream",
      }));

      // nếu dùng disk storage, xóa file tạm
      if (modelFile.path) {
        try { fs.unlink(modelFile.path, () => {}); } catch {}
      }

      createdModelKey = uniqueKey; // để rollback nếu DB fail
      finalModelKey = uniqueKey;
      modelContentType = modelFile.mimetype || modelContentType;
      modelSize = modelFile.size ?? modelSize;
      modelEtag = (putRes.ETag || "").replace(/"/g, "") || null;
      modelFilePath = composeWasabiObjectUrl(bucket, finalModelKey);
    }

    if (clientAborted) { await cleanup(); return; }

    // ---------- Lưu ảnh LOCAL ----------
    const images = [];

    // preview -> cover + previewImagePath
    const { rel: previewPath, abs: previewAbsPath } = await saveLocalFileFromBuffer(previewImage, "previews");
    previewAbs = previewAbsPath;
    images.push({
      path: previewPath, alt: name, isCover: true, order: 0,
      width: null, height: null, size: previewImage.size ?? null,
    });

    // extra -> ảnh phụ
    let orderBase = 1;
    for (const f of extraImages) {
      const { rel: extraPath, abs: extraAbs } = await saveLocalFileFromBuffer(f, "products");
      extraAbsList.push(extraAbs);
      images.push({
        path: extraPath, alt: name, isCover: false, order: orderBase++,
        width: null, height: null, size: f.size ?? null,
      });
    }

    if (clientAborted) { await cleanup(); return; }

    // ---------- Tạo Product ----------
    const product = await Product.create({
      name,
      description,
      price: priceNumber,
      categoryIds,
      styles,

      // meta render
      render,
      lighting,
      cameraType,

      // model
      modelKey: finalModelKey,
      modelBucket: bucket,
      modelContentType,
      modelSize,
      modelEtag,
      modelFilePath, // URL public (có thể từ presigned FE hoặc tự build)

      // images
      images,
      previewImagePath: previewPath,

      // flags
      displayhome: displayHome,

      // customId & tên gốc preview
      customId: customIdFromPreview || null,
      previewOriginalName: previewOriginalName || null,
    });

    // ---------- Cập nhật đếm category ----------
    try {
      await incCategoryCounts(categoryIds, +1);
    } catch (e) {
      await Product.findByIdAndDelete(product._id).catch(() => {});
      await cleanup();
      throw e;
    }

    // Thành công ⇒ không xóa model
    createdModelKey = null;

    if (clientAborted) { await cleanup(); return; }
    return safeJson(201, { message: "Tạo sản phẩm thành công", product });
  } catch (err) {
    console.error("Create product-scenes error:", err);
    try { await cleanup(); } catch {}
    return safeJson(500, { message: err.message || "Lỗi server" });
  }
}




// PATCH /api/product-scenes/:id (update)
async function updateProductScene(req, res) {
  let newPreviewAbs = null;
  const newExtraAbsList = [];

  const cleanup = async () => {
    if (newPreviewAbs) { try { fs.unlinkSync(newPreviewAbs); } catch {} }
    for (const abs of newExtraAbsList) { try { fs.unlinkSync(abs); } catch {} }
  };

  const readStr = (v) => (v === undefined || v === null ? undefined : String(v).trim());

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID không hợp lệ" });

    const doc = await Product.findById(id);
    if (!doc) return res.status(404).json({ message: "Không tìm thấy sản phẩm" });

    const name        = readStr(req.body.name) ?? "";
    const description = req.body.description !== undefined ? String(req.body.description).trim() : undefined;
    const priceNumber = req.body.price === undefined ? undefined : Number(req.body.price);

    if (name) doc.name = name;
    if (description !== undefined) doc.description = description;
    if (priceNumber !== undefined) {
      if (!Number.isFinite(priceNumber) || priceNumber < 0) {
        return res.status(400).json({ message: "Giá không hợp lệ" });
      }
      doc.price = priceNumber;
    }

    // NEW: cập nhật render/lighting/cameraType nếu truyền lên (cho phép set "")
    if (req.body.render !== undefined)      doc.render = String(req.body.render).trim();
    if (req.body.lighting !== undefined)    doc.lighting = String(req.body.lighting).trim();
    if (req.body.cameraType !== undefined || req.body.camera_type !== undefined) {
      doc.cameraType = String(req.body.cameraType ?? req.body.camera_type).trim();
    }

    // categories (optional) — nếu client gửi categoryIds thì cũng đảm bảo chứa ID mặc định
    const rawCat = parseIdList(req.body.categoryIds || req.body["categoryIds[]"]);
    let oldCats = null;
    if (rawCat.length > 0) {
      let catIds = asIdArray(rawCat);
      const defId = String(DEFAULT_SCENE_CATEGORY_ID).trim();
      if (mongoose.Types.ObjectId.isValid(defId) && !catIds.includes(defId)) {
        catIds.push(defId);
      }
      if (!catIds.length) return res.status(400).json({ message: "Chọn ít nhất 1 category" });
      oldCats = (doc.categoryIds || []).map(String);
      doc.categoryIds = catIds;
    }

    // styles (optional)
    const rawStyles = parseIdList(req.body.styles || req.body["styles[]"]);
    if (rawStyles.length > 0) {
      doc.styles = asIdArray(rawStyles);
    }

    // files
    const files = req.files || {};
    const previewImage = files.previewImage?.[0] || null;
    const extraImage   = files.extraImage?.[0] || null;

    // replace preview
    if (previewImage) {
      const { rel, abs } = await saveLocalFileFromBuffer(previewImage, "previews");
      newPreviewAbs = abs;
      doc.previewImagePath = rel;

      const cleared = (doc.images || []).map((im) => ({ ...im, isCover: false }));
      cleared.unshift({
        path: rel, alt: doc.name, isCover: true, order: 0,
        width: null, height: null, size: previewImage.size ?? null,
      });
      doc.images = cleared.map((im, idx) => ({ ...im, order: idx }));
    }

    // add extra
    if (extraImage) {
      const { rel, abs } = await saveLocalFileFromBuffer(extraImage, "products");
      newExtraAbsList.push(abs);
      const imgs = Array.isArray(doc.images) ? doc.images.slice() : [];
      imgs.push({
        path: rel, alt: doc.name, isCover: false, order: imgs.length,
        width: null, height: null, size: extraImage.size ?? null,
      });
      doc.images = imgs;
    }

    await doc.save();

    // update category counts if changed
    if (oldCats) {
      const oldSet = new Set(oldCats);
      const newSet = new Set(doc.categoryIds.map(String));
      const addIds = [...newSet].filter((x) => !oldSet.has(x));
      const delIds = [...oldSet].filter((x) => !newSet.has(x));
      if (addIds.length) await incCategoryCounts(addIds, +1);
      if (delIds.length) await incCategoryCounts(delIds, -1);
    }

    res.json({ message: "Cập nhật thành công", product: doc.toObject() });
  } catch (e) {
    console.error("Update product-scenes error:", e);
    await cleanup();
    res.status(500).json({ message: e.message || "Lỗi server" });
  }
}

// DELETE /api/product-scenes/:id
async function deleteProductScene(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "ID không hợp lệ" });

    const doc = await Product.findById(id).lean();
    if (!doc) return res.status(404).json({ message: "Không tìm thấy sản phẩm" });

    await Product.findByIdAndDelete(id);

    // giảm count category
    const cats = (doc.categoryIds || []).map(String);
    if (cats.length) await incCategoryCounts(cats, -1);

    // xoá local files (de-dup)
    const toDelete = new Set();
    if (doc.previewImagePath) toDelete.add(doc.previewImagePath);
    if (Array.isArray(doc.images)) for (const im of doc.images) if (im?.path) toDelete.add(im.path);

    for (const rel of toDelete) {
      try {
        const abs = path.join(process.cwd(), rel.replace(/^\//, ""));
        if (abs.startsWith(process.cwd())) fs.unlinkSync(abs);
      } catch {}
    }

    // xoá object S3
    if (doc.modelKey) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.WASABI_BUCKET,
          Key: doc.modelKey,
        }));
      } catch {}
    }

    res.json({ message: "Đã xoá sản phẩm" });
  } catch (e) {
    console.error("Delete product-scenes error:", e);
    res.status(500).json({ message: e.message || "Lỗi server" });
  }
}

module.exports = {
  listProductScenes,
  listProductScenesClient,
  getProductSceneById,
  createProductScene,
  updateProductScene,
  deleteProductScene,
};
