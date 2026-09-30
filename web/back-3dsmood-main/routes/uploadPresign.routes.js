const express = require("express");
const router = express.Router();

const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ===========================
   ENV & S3 CLIENT
=========================== */
const BUCKET   = process.env.WASABI_BUCKET;
const REGION   = process.env.WASABI_REGION || "ap-southeast-1";
const ENDPOINT = (process.env.WASABI_ENDPOINT || "https://s3.wasabisys.com").replace(/\/+$/, "");
const EXPIRES  = Number(process.env.WASABI_PRESIGN_EXPIRES || 3600); // giây

if (!BUCKET) console.warn("[uploadPresign] Missing WASABI_BUCKET");

const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
  },
});

/* ===========================
   UTILS
=========================== */
function safeName(name) {
  const s = String(name || "");
  const idx = s.lastIndexOf(".");
  const ext = idx >= 0 ? s.slice(idx).toLowerCase() : "";
  const base = (idx >= 0 ? s.slice(0, idx) : s)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\-_\.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "file"}${ext}`;
}

function assertEnv(res) {
  if (!BUCKET || !process.env.WASABI_ACCESS_KEY_ID || !process.env.WASABI_SECRET_ACCESS_KEY) {
    res.status(500).json({ message: "Wasabi config is missing (bucket/credentials)." });
    return false;
  }
  return true;
}

async function headOrNull(key) {
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return h || true; // tồn tại
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
    // lỗi khác: để propagate
    throw e;
  }
}

/* ===========================
   AUTH (tuỳ bạn thay bằng middleware thật)
=========================== */
// function authMiddleware(req, res, next) { next(); }
router.use((req, _res, next) => next());

/* ===========================
   1) INIT MULTIPART
   POST /api/uploads/init
   body: { filename, contentType?, prefix?, namePolicy? }
   namePolicy: "exact-overwrite" | "exact-error" | "dedupe-suffix"
   -> { uploadId, key }
=========================== */
router.post("/uploads/init", async (req, res, next) => {
  try {
    if (!assertEnv(res)) return;

    const {
      filename,
      contentType,
      prefix = "models",
      namePolicy = "exact-overwrite", // mặc định: giữ tên gốc, ghi đè nếu có
    } = req.body || {};

    if (!filename) return res.status(400).json({ message: "filename required" });

    // Giữ NGUYÊN tên file (sau khi safe)
    const cleanPrefix = String(prefix).replace(/^\/+|\/+$/g, "");
    const keyBase = `${cleanPrefix}/${safeName(filename)}`;

    let key = keyBase;

    // xử lý trùng tên theo policy
    if (namePolicy === "exact-error") {
      const exist = await headOrNull(keyBase);
      if (exist) {
        return res.status(409).json({ code: "KEY_EXISTS", message: "Object already exists", key: keyBase });
      }
    } else if (namePolicy === "dedupe-suffix") {
      const dot = keyBase.lastIndexOf(".");
      const ext = dot >= 0 ? keyBase.slice(dot) : "";
      const base = dot >= 0 ? keyBase.slice(0, dot) : keyBase;

      let i = 0;
      while (i < 1000) {
        const testKey = i === 0 ? keyBase : `${base}-${i}${ext}`;
        const exist = await headOrNull(testKey);
        if (!exist) { key = testKey; break; }
        i++;
      }
      if (i >= 1000) {
        return res.status(500).json({ message: "Cannot dedupe filename after many attempts" });
      }
    }
    // exact-overwrite => giữ nguyên, không kiểm tra (sẽ ghi đè)

    const out = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType || "application/octet-stream",
      })
    );

    res.json({ uploadId: out.UploadId, key });
  } catch (e) {
    next(e);
  }
});

/* ===========================
   2) GET PRESIGNED URLS FOR PARTS
   POST /api/uploads/parts
   body: { key, uploadId, partNumbers: number[] }
   -> { urls: [{ partNumber, url }] }
=========================== */
router.post("/uploads/parts", async (req, res, next) => {
  try {
    if (!assertEnv(res)) return;

    const { key, uploadId, partNumbers } = req.body || {};
    if (!key || !uploadId || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      return res.status(400).json({ message: "key, uploadId, partNumbers[] required" });
    }

    if (partNumbers.some((n) => !Number.isInteger(n) || n <= 0 || n > 10000)) {
      return res.status(400).json({ message: "partNumbers must be 1..10000 integers" });
    }

    const urls = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const cmd = new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber });
        const url = await getSignedUrl(s3, cmd, { expiresIn: EXPIRES });
        return { partNumber, url };
      })
    );

    res.json({ urls });
  } catch (e) {
    next(e);
  }
});

/* ===========================
   3) COMPLETE MULTIPART
   POST /api/uploads/complete
   body: { key, uploadId, parts: [{ PartNumber, ETag }] }
   -> { ok, key, url, etag, size, contentType, location }
=========================== */
router.post("/uploads/complete", async (req, res, next) => {
  try {
    if (!assertEnv(res)) return;

    const { key, uploadId, parts } = req.body || {};
    if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ message: "key, uploadId, parts required" });
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);

    const out = await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );

    // Head để lấy size/etag/contentType
    let size = null, etag = null, contentType = "application/octet-stream";
    try {
      const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      const len = h.ContentLength;
      size = typeof len === "number" ? len : Number(len) || null;
      contentType = h.ContentType || contentType;
      if (h.ETag) etag = String(h.ETag).replace(/"/g, "");
    } catch {}

    const encodedKey = String(key).split("/").map(encodeURIComponent).join("/");
    const url = `${ENDPOINT.replace(/^https?:\/\//, "https://")}/${BUCKET}/${encodedKey}`;

    res.json({ ok: true, key, url, etag, size, contentType, location: out.Location });
  } catch (e) {
    next(e);
  }
});

/* ===========================
   4) ABORT MULTIPART
   POST /api/uploads/abort
   body: { key, uploadId }
=========================== */
router.post("/uploads/abort", async (req, res, next) => {
  try {
    if (!assertEnv(res)) return;

    const { key, uploadId } = req.body || {};
    if (!key || !uploadId) return res.status(400).json({ message: "key, uploadId required" });

    await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ===========================
   5) HEAD OBJECT (optional debug)
   GET /api/uploads/head?key=<key>
=========================== */
router.get("/uploads/head", async (req, res, next) => {
  try {
    if (!assertEnv(res)) return;

    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ message: "key required" });

    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({
      ok: true,
      key,
      size: h.ContentLength ?? null,
      contentType: h.ContentType ?? null,
      etag: h.ETag ? String(h.ETag).replace(/"/g, "") : null,
      lastModified: h.LastModified || null,
    });
  } catch (e) {
    next(e);
  }
});

/* ===========================
   Error handler
=========================== */
router.use((err, _req, res, _next) => {
  console.error("[uploadPresign]", err);
  const code = err?.$metadata?.httpStatusCode || err.status || 500;
  res.status(code).json({
    message: err?.message || "Unknown error",
    ...(err?.$metadata ? { meta: err.$metadata } : {}),
  });
});

module.exports = router;
