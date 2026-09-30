// routes/download.routes.js
const router = require("express").Router();
const mongoose = require("mongoose");
const { HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3"); // HeadObject + GetObject
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { pipeline } = require("stream/promises");
const User = require("../models/Users");
const Product = require("../models/Product");
const s3 = require("../s3");
const verifyToken = require("../middlewares/verifyToken");
const Category = require("../models/Category");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mime = require("mime-types");
const Order = require("../models/Order");

const WASABI_BUCKET = process.env.WASABI_BUCKET;
const PUBLIC_BASE   = process.env.WASABI_PUBLIC_BASE || process.env.PUBLIC_BASE || "";

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || path.join(__dirname, "..", "uploads");
const DOWNLOAD_TOKEN_TTL = Number(process.env.DOWNLOAD_TOKEN_TTL || 300); // giây
// Router này thường mount ở "/api/downloads"
const DOWNLOADS_BASE_PATH = process.env.DOWNLOADS_BASE_PATH || "/api/downloads";

/** ==================== Token store (one-shot) ==================== */
const tokenStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, v] of tokenStore.entries()) {
    if (v.expireAt <= now) tokenStore.delete(t);
  }
}, 60_000);

function createToken(payload) {
  const token = crypto.randomBytes(24).toString("base64url");
  tokenStore.set(token, payload);
  return token;
}

/** ==================== Helpers ==================== */
function isHttpUrl(s) {
  return /^https?:\/\//i.test(String(s || ""));
}

// Local path helpers (an toàn)
function resolveLocalPath(relOrAbs) {
  if (!relOrAbs) return null;
  if (isHttpUrl(relOrAbs)) return null;

  const base = path.resolve(LOCAL_STORAGE_DIR);
  let rel = String(relOrAbs).trim().replace(/^\\+|^\/+/, ""); // bỏ slash đầu

  // Nếu dữ liệu lưu kèm prefix 'uploads/', đừng nhân đôi thư mục
  if (rel.toLowerCase().startsWith("uploads/")) {
    rel = rel.slice("uploads/".length);
  }

  const abs = path.resolve(base, rel);

  // Chống traversal
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;

  try {
    const st = fs.statSync(abs);
    return st.isFile() ? abs : null;
  } catch {
    return null;
  }
}

/**
 * Trả về:
 *  - { key: 'uploads/abc.jpg' } nếu URL/đường dẫn thuộc chính bucket
 *  - { passthrough: 'https://...' } nếu là URL ngoài (CDN/bucket khác)
 *  - { localAbs: '/abs/file' } nếu là file local
 */
function resolveKeyOrPassthrough(pathOrUrl) {
  if (!pathOrUrl) return { key: null, passthrough: null };
  const s = String(pathOrUrl).trim();

  // URL tuyệt đối?
  if (isHttpUrl(s)) {
    // 1) virtual-host: https://<bucket>.s3.ap-...wasabisys.com/<key>
    const vh = s.match(/^https?:\/\/([^/.]+)\.s3\.[^/]+\.wasabisys\.com\/(.+)$/i);
    if (vh) {
      const [, bucket, key] = vh;
      if (bucket === WASABI_BUCKET) return { key };
      return { passthrough: s };
    }
    // 2) path-style: https://s3.ap-...wasabisys.com/<bucket>/<key>
    const ps = s.match(/^https?:\/\/s3\.[^/]+\.wasabisys\.com\/([^/]+)\/(.+)$/i);
    if (ps) {
      const [, bucket, key] = ps;
      if (bucket === WASABI_BUCKET) return { key };
      return { passthrough: s };
    }
    // 3) PUBLIC_BASE
    if (PUBLIC_BASE && s.startsWith(PUBLIC_BASE)) {
      const key = s.slice(PUBLIC_BASE.length).replace(/^\/+/, "");
      return { key };
    }
    // 4) URL ngoài hoàn toàn
    return { passthrough: s };
  }

  // Không phải URL -> có thể là local file hoặc S3 key
  const absLocal = resolveLocalPath(s);
  if (absLocal) return { localAbs: absLocal };

  // Mặc định coi như S3 key (loại bỏ leading slash và '<bucket>/')
  let key = s.replace(/^\/+/, "");
  if (key.startsWith(`${WASABI_BUCKET}/`)) {
    key = key.slice(WASABI_BUCKET.length + 1);
  }
  return { key };
}

/**
 * Issue link nội bộ dạng /api/downloads/stream/:token
 * - URL ngoài: trả nguyên (passthrough)
 * - Local: tạo token 'local'
 * - S3 key: tạo token 's3'
 */
async function issueStreamLink(pathOrUrl, filenameSuggest, userId) {
  if (!pathOrUrl) return null;

  const safeName = (filenameSuggest || "file").replace(/[^\w.\-]+/g, "_") || "file";
  const { localAbs, key, passthrough } = resolveKeyOrPassthrough(pathOrUrl);

  // 1) URL ngoài -> trả trực tiếp
  if (passthrough) {
    return { url: passthrough, filename: safeName };
  }

  // 2) Local file -> token
  if (localAbs) {
    const contentType = mime.lookup(localAbs) || "application/octet-stream";
    const token = createToken({
      kind: "local",
      absPath: localAbs,
      filename: safeName,
      contentType,
      userId: String(userId || ""),
      expireAt: Date.now() + DOWNLOAD_TOKEN_TTL * 1000,
    });
    return { url: `${DOWNLOADS_BASE_PATH}/stream/${token}`, filename: safeName };
  }

  // 3) S3 key -> token
  if (key) {
    const token = createToken({
      kind: "s3",
      key,
      filename: safeName,
      userId: String(userId || ""),
      expireAt: Date.now() + DOWNLOAD_TOKEN_TTL * 1000,
    });
    return { url: `${DOWNLOADS_BASE_PATH}/stream/${token}`, filename: safeName };
  }

  return null;
}

/** ==================== API: xin link tải ==================== */
/**
 * GET /api/downloads/product/:id?type=image|file
 * -> Trả { url, filename } (url nội bộ /stream/:token hoặc URL ngoài)
 */
router.get("/product/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const type = String(req.query.type || "file");

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Product.findById(id).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });

    const price = Number(product.price || 0);

    // Sản phẩm trả phí -> phải sở hữu
    if (price > 0) {
      const user = await User.findById(req.user._id, { purchased: 1 }).lean();
      if (!user) return res.status(404).json({ message: "User not found" });

      const owned = (user.purchased || []).some(
        (p) => String(p.productId) === String(id)
      );
      if (!owned) {
        return res.status(403).json({ message: "Bạn chưa mua sản phẩm này" });
      }
    }

    // Lấy đường dẫn nguồn
    const imagePath =
      product.previewImagePath || product.image || product.preview || null;
    const filePath =
      product.modelFilePath ||
      product.modelPath ||
      product.fileKey ||
      product.filePath ||
      null;

    const pathChosen = type === "image" ? imagePath : filePath;
    if (!pathChosen) {
      return res.status(404).json({ message: "Tệp không tồn tại" });
    }

    // ======== Lấy tên gốc để gợi ý tải xuống ========
    // Ưu tiên: field tên gốc trong DB -> nếu không có thì suy từ path -> cuối cùng là tên sản phẩm
    const getBasenameFromPath = (p) => {
      try {
        // nếu là URL presign S3, lấy pathname; nếu là path thuần, URL(...) sẽ fail -> fallback
        const u = new URL(p, "http://dummy.base"); // base để tránh throw với path tương đối
        const raw = u.pathname.split("/").pop() || "";
        return raw;
      } catch {
        // path tương đối / cục bộ
        const segs = String(p).split("?")[0].split("#")[0].split("/");
        return segs[segs.length - 1] || "";
      }
    };

    const sanitizeFilenameMinimal = (name) =>
      // Loại control chars & thay \/:*?"<>| bằng _
      String(name).replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, "_").trim();

    const originalFromDB =
      type === "image"
        ? (product.previewOriginalName || null)
        : (product.modelOriginalName || null); // nhớ lưu trường này khi upload model

    // tên theo path (basename của object/key), ví dụ models/custom-id.glb
    const basenameFromPath = getBasenameFromPath(pathChosen);

    // Nếu có tên gốc trong DB -> dùng nó; nếu không, dùng basename path; nếu vẫn rỗng, dùng tên SP
    let finalName = originalFromDB || basenameFromPath || (product.name || `model-${id}`);

    // Bảo toàn extension:
    const ensureExt = (nameCandidate) => {
      const hasDot = /\.[A-Za-z0-9]{1,8}$/.test(nameCandidate);
      if (hasDot) return nameCandidate;

      // nếu thiếu đuôi, lấy đuôi từ basename của pathChosen (nếu có)
      const m = basenameFromPath.match(/(\.[A-Za-z0-9]{1,8})$/);
      if (m) return nameCandidate + m[1];
      return nameCandidate; // không cố ép đuôi
    };

    finalName = ensureExt(finalName);
    finalName = sanitizeFilenameMinimal(finalName);

    // Phát link tải kèm tên gợi ý là tên gốc đã xử lý
    const out = await issueStreamLink(pathChosen, finalName, req.user._id);
    if (!out) return res.status(404).json({ message: "Tệp không tồn tại" });

    return res.json(out); // { url, filename }
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


/** ==================== API: stream token (one-shot) ==================== */
/**
 * GET /api/downloads/stream/:token
 * KHÔNG cần Authorization header; bảo vệ bằng token 1 lần + TTL.
 * Trả về stream có Content-Length/Range để trình duyệt hiện tiến độ.
 */
// ===== Stream token (one-shot, ràng buộc user) =====
router.get("/stream/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const data = tokenStore.get(token);
    if (!data) return res.status(404).json({ message: "Link tải không còn hiệu lực" });

    const now = Date.now();
    if (data.expireAt <= now) {
      tokenStore.delete(token);
      return res.status(410).json({ message: "Link tải đã hết hạn" });
    }

    // Xoá token sau khi hoàn tất response (single-use)
    const cleanupToken = () => tokenStore.delete(token);
    res.on("finish", cleanupToken);
    res.on("close", cleanupToken);

    const filename = data.filename || "download";
    const encoded  = encodeURIComponent(filename);
    res.setHeader("Content-Disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

    const range = req.headers.range; // "bytes=start-end"
    let start = 0, end = null, size = null;

    // Helper: pipe an toàn, tránh lỗi premature close
    const safePipe = (readable, contentType, contentLength) => {
      if (contentType)  res.setHeader("Content-Type", contentType);
      if (contentLength != null) res.setHeader("Content-Length", String(contentLength));

      // nếu client đóng, huỷ source
      res.on("close", () => {
        try { readable.destroy(); } catch {}
      });

      // lỗi từ source
      readable.on("error", (e) => {
        // nếu client đã đóng thì bỏ qua
        if (res.headersSent && (res.writableEnded || res.destroyed)) return;
        console.error("STREAM PIPE ERROR:", e);
        if (!res.headersSent) res.status(500).end("Server error");
        try { readable.destroy(); } catch {}
      });

      readable.pipe(res);
    };

    if (data.kind === "local") {
      const st = await fs.promises.stat(data.absPath);
      size = st.size;

      if (range) {
        const m = /bytes=(\d+)-(\d+)?/i.exec(range);
        if (m) {
          start = parseInt(m[1], 10);
          end   = m[2] ? parseInt(m[2], 10) : (size - 1);
          if (start >= size) return res.status(416).set("Content-Range", `bytes */${size}`).end();
          res.status(206);
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          safePipe(fs.createReadStream(data.absPath, { start, end }), data.contentType || "application/octet-stream", (end - start + 1));
          return;
        }
      }
      // no-range
      safePipe(fs.createReadStream(data.absPath), data.contentType || "application/octet-stream", size);
      return;
    }

    if (data.kind === "s3") {
      // lấy size để set Content-Length
      const head = await s3.send(new HeadObjectCommand({ Bucket: WASABI_BUCKET, Key: data.key }));
      size = Number(head.ContentLength || 0);

      let s3CmdOpts = { Bucket: WASABI_BUCKET, Key: data.key };
      let lengthForHeader = null;

      if (range) {
        const m = /bytes=(\d+)-(\d+)?/i.exec(range);
        if (m) {
          start = parseInt(m[1], 10);
          end   = m[2] ? parseInt(m[2], 10) : (size ? size - 1 : undefined);
          res.status(206);
          if (size && end != null) {
            res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
            lengthForHeader = (end - start + 1);
          }
          s3CmdOpts.Range = `bytes=${start}-${end != null ? end : ""}`;
        }
      } else if (size) {
        lengthForHeader = size;
      }

      const obj = await s3.send(new GetObjectCommand(s3CmdOpts));
      const ct  = obj.ContentType || head.ContentType || "application/octet-stream";

      // nếu client đóng thì dừng stream S3
      res.on("close", () => {
        try { obj.Body?.destroy(); } catch {}
      });

      safePipe(obj.Body, ct, lengthForHeader);
      return;
    }

    if (data.kind === "remote" && data.url) {
      // (Tuỳ chọn) proxy URL ngoài → hỗ trợ dừng khi client đóng
      const controller = new AbortController();
      res.on("close", () => controller.abort());

      let r;
      try {
        r = await fetch(data.url, { signal: controller.signal });
      } catch (e) {
        // client đã hủy -> không trả lỗi
        if (e.name === "AbortError") return;
        throw e;
      }
      if (!r.ok) {
        return res.status(r.status).send(await r.text().catch(() => "Upstream error"));
      }

      const contentLength = r.headers.get("content-length");
      const contentType   = r.headers.get("content-type") || "application/octet-stream";
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Content-Type", contentType);

      // stream thủ công với reader + tôn trọng huỷ
      const reader = r.body.getReader();
      try {
        while (true) {
          if (res.destroyed) break;
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch (e) {
        // nếu đã abort do client đóng thì bỏ qua
        if (e.name !== "AbortError") console.error("REMOTE STREAM ERROR:", e);
      } finally {
        try { await reader.cancel(); } catch {}
        res.end();
      }
      return;
    }

    return res.status(400).json({ message: "Token không hợp lệ" });
  } catch (err) {
    // tránh log ồn khi client chủ động hủy
    if (err && (err.code === "ERR_STREAM_PREMATURE_CLOSE" || err.name === "AbortError")) {
      return; // im lặng
    }
    console.error("STREAM TOKEN ERROR:", err);
    if (!res.headersSent) res.status(500).json({ message: "Server error", error: err.message });
  }
});


/** ==================== API: danh sách đã mua (giữ nguyên logic của bạn) ==================== */
const PRODUCTS = Product.collection.name;     // ví dụ "products"
const CATEGORIES = Category.collection.name;  // ví dụ "categories"

async function findCategoryByAny(idOrSlug) {
  if (!idOrSlug) return null;
  if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
    return Category.findById(idOrSlug).lean();
  }
  return Category.findOne({ slug: idOrSlug }).lean();
}

async function getDescendantIdsSafe(rootId) {
  if (!mongoose.Types.ObjectId.isValid(rootId)) return [];
  const ids = new Set([String(rootId)]);
  const queue = [String(rootId)];
  while (queue.length) {
    const parentId = queue.shift();
    const children = await Category.find({ parent: parentId }, { _id: 1 }).lean();
    for (const c of children) {
      const id = String(c._id);
      if (!ids.has(id)) {
        ids.add(id);
        queue.push(id);
      }
    }
  }
  return Array.from(ids).map((x) => new mongoose.Types.ObjectId(x));
}

// ---- Route chính ----
router.get("/me/downloads", verifyToken, async (req, res) => {
  try {
    const uid = req.user?._id;
    if (!uid || !mongoose.Types.ObjectId.isValid(uid)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "24", 10)));
    const q = (req.query.q || "").trim();
    const topParam = (req.query.top || "").trim();
    const catParam = (req.query.cat || "").trim();

    const [topCat, leafCat] = await Promise.all([
      findCategoryByAny(topParam),
      findCategoryByAny(catParam),
    ]);

    // tập category để lọc (gồm mọi hậu duệ)
    let filterCategoryIds = null;
    if (leafCat?._id) {
      filterCategoryIds = await getDescendantIdsSafe(String(leafCat._id));
    } else if (topCat?._id) {
      filterCategoryIds = await getDescendantIdsSafe(String(topCat._id));
    }

    const nameMatch = q
      ? { "product.name": { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
      : {};

    const pipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(uid) } },
      { $project: { purchased: 1 } },
      { $unwind: "$purchased" },

      // Join Product
      {
        $lookup: {
          from: PRODUCTS,
          localField: "purchased.productId",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },

      // (Tối ưu) nếu có lọc theo category thì match theo product.categoryIds trước
      ...(filterCategoryIds?.length
        ? [{ $match: { "product.categoryIds": { $in: filterCategoryIds } } }]
        : []),

      // Lọc theo tên nếu có
      ...(q ? [{ $match: nameMatch }] : []),

      // Join Categories (mảng)
      {
        $lookup: {
          from: CATEGORIES,
          localField: "product.categoryIds",
          foreignField: "_id",
          as: "categories",
        },
      },

      // Lấy primaryCategory = categories[0] (giữ để thuận FE cũ)
      {
        $addFields: {
          primaryCategory: {
            $cond: [
              { $gt: [{ $size: "$categories" }, 0] },
              { $arrayElemAt: ["$categories", 0] },
              null
            ]
          }
        }
      },

      // Sort theo thời điểm mua
      { $sort: { "purchased.purchasedAt": -1 } },

      // Facet
      {
        $facet: {
          // ✅ Trả đầy đủ mảng categories
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: "$product._id",
                name: "$product.name",
                cover: "$product.previewImagePath",
                price: "$product.price",
                purchasedAt: "$purchased.purchasedAt",

                // Giữ primaryCategory (compat)
                category: {
                  _id: "$primaryCategory._id",
                  name: "$primaryCategory.name",
                  parent: "$primaryCategory.parent",
                },

                // ✅ MẢNG category đầy đủ (chỉ lấy field cần thiết)
                categories: {
                  $map: {
                    input: "$categories",
                    as: "c",
                    in: {
                      _id: "$$c._id",
                      name: "$$c.name",
                      parent: "$$c.parent",
                    }
                  }
                },

                // (tùy chọn) ids nguyên thủy cho FE
                categoryIds: "$product.categoryIds",
              },
            },
          ],

          totalCount: [{ $count: "n" }],

          // Counts cho sidebar: đếm theo mọi category xuất hiện (nằm trong nhánh lọc nếu có)
          counts: [
            { $unwind: "$categories" },
            ...(filterCategoryIds?.length
              ? [{ $match: { "categories._id": { $in: filterCategoryIds } } }]
              : []),
            {
              $group: {
                _id: "$categories._id",
                count: { $sum: 1 },
                name: { $first: "$categories.name" },
                parent: { $first: "$categories.parent" },
              },
            },
            { $sort: { name: 1 } },
          ],
        },
      },
    ];

    const data = await User.aggregate(pipeline);
    const facet = data?.[0] || { items: [], totalCount: [], counts: [] };
    const total = facet.totalCount?.[0]?.n || 0;

    return res.json({
      items: facet.items,
      page,
      limit,
      total,
      hasMore: page * limit < total,
      counts: facet.counts,
    });
  } catch (e) {
    console.error("[downloads] error", {
      uid: req.user?._id,
      topParam: req.query.top,
      catParam: req.query.cat,
      message: e?.message,
      stack: e?.stack,
    });
    return res.status(500).json({ message: e?.message || "Server error" });
  }
});
router.get("/recent", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 24));

    // Chỉ lấy đơn đã thanh toán; nếu có user thì lọc theo user
    const match = { status: "paid" };
    // if (req.user?.id) {
    //   match.user = new mongoose.Types.ObjectId(req.user.id);
    // }

    // Aggregate:
    // 1) match đơn paid (+user nếu có)
    // 2) sort mới nhất
    // 3) unwind items
    // 4) group theo product để bỏ trùng, lấy thời điểm mua gần nhất + giá đã trả
    // 5) sort theo purchasedAt
    // 6) lookup product
    // 7) project ProductLean
    const pipeline = [
      { $match: match },
      { $sort: { createdAt: -1, _id: -1 } },
      // (tùy chọn) chặn depth quá lớn khi global feed:
      { $limit: 2000 },

      { $unwind: "$items" },

      {
        $group: {
          _id: "$items.product",
          purchasedAt: { $first: "$createdAt" },      // thời điểm mua gần nhất
          paidPrice:   { $first: "$items.price" },    // giá đã trả lúc mua
        },
      },

      { $sort: { purchasedAt: -1 } },
      { $limit: limit },

      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },

      // (tuỳ schema) có thể lọc sản phẩm đã bị ẩn/xoá mềm:
      // { $match: { "product.status": { $in: ["active", null] } } },

      {
        $project: {
          _id: 0,
          purchasedAt: 1,
          paidPrice: 1,
          product: {
            _id: "$product._id",
            name: "$product.name",
            price: "$product.price",
            // các field ảnh UI đang dùng:
            previewImagePath: "$product.previewImagePath",
            image: "$product.image",
            cover: "$product.cover",
            // (tuỳ bạn) slug/category...
            // slug: "$product.slug",
          },
        },
      },
    ];

    const rows = await Order.aggregate(pipeline);

    // Chuẩn lại format về đúng với frontend normalize()
    const items = rows.map((r) => ({
      product: r.product,           // { _id, name, price, previewImagePath, ... }
      purchasedAt: r.purchasedAt,   // ISO date
      paidPrice: r.paidPrice,       // số tiền đã trả ở thời điểm mua
    }));

    res.json({ items });
  } catch (err) {
    console.error("downloads/recent error:", err);
    res.status(500).json({ message: "Không thể lấy sản phẩm từ đơn gần nhất" });
  }
});
module.exports = router;
