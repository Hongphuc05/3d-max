# 3DS Mood v3 — Plan triển khai chi tiết từng phase

> Viết 2026-10-29 · nhánh nền: `phuc_arch_v3` (= `origin/nam-lisence` @ `ba41518` + tài liệu v3).
> **Dành cho người/model triển khai.** Đọc theo thứ tự: tài liệu này → [`v3-architecture.md`](v3-architecture.md)
> → [`v3-database.md`](v3-database.md). Kiến trúc và lý do nằm ở hai file kia; file này nói **làm gì, ở đâu, kiểm thế nào**.

## 0. Luật cho model triển khai (đọc trước khi code)

1. **Phase 0 phải xong** (chủ dự án trả lời Q1–Q5) trước khi code Phase 1. Chưa chốt → dừng và hỏi, không tự chọn.
2. **Mỗi phase một nhánh** tách từ `phuc_arch_v3`: `v3/p1-drive-oauth`, `v3/p2-sync-worker`, … Không push lên `main`.
3. **Không viết lại thứ đang chạy.** Tái dùng: `apps/store-api/src/db.js`, `scripts/migrate.js`, `download-stream.js`
   (`createArchiveSender`), `licensing/device-crypto.js`, `security.js` (`originGuard`, `requireJson`, `errorHandler`),
   `rateLimit`, `admin/access.js`; plugin: `DeviceIdentityService.cs`, `ArchivePackage.cs`, `ImportTargetSelection.cs`,
   `BridgePolicy.cs`, `PackagedAppRuntime.cs`, `maxscript/PlatformBridge.ms`.
4. **Không dùng** Cloudflare R2, payOS, Redis, RabbitMQ. Không thêm NuGet cho plugin (net48, rủi ro R2 trong `decisions.md`).
5. **Không bao giờ** đưa Drive File ID, URL Drive, OAuth token, device token vào response cho plugin/web khách, log, hay URL.
6. **Test trước, code sau** cho mọi chỗ đụng tiền, quyền, job, giải nén. Dùng `node:test` + PostgreSQL thật (`store_test`) như repo đang làm.
   Mỗi test bảo mật phải **thử phá code** một lần để chắc test bắt được lỗi.
7. **Không chạy migration lên production.** Chỉ DB dev/test.
8. **Cuối mỗi phase** cập nhật `docs/STATUS.md` (mục "v3") và ghi báo cáo: file đã đổi, lệnh đã chạy, kết quả thật,
   điều chưa kiểm chứng, bước tiếp. Không tuyên bố "đã chạy trên Max" nếu chưa chạy trên Max thật.
9. Phần plugin (C#) **chỉ build/test được trên Windows + Visual Studio Build Tools + 3ds Max 2022**.

---

## 1. Tổng quan phase

```text
P0 Chốt quyết định ─► P1 Drive OAuth + thử thật ─► P2 DB + worker đồng bộ ─┬─► P3 Web Admin (sync)
                                                                         ├─► P4 API khách + plugin (catalog, preview, tải model)
                                                                         └─► P5 Đơn hàng + Telegram (cần P4 phần thiết bị)
                                                     ─► P6 E2E + deploy VPS ─► P7 Dọn code cũ
```

| Phase | Mục tiêu | Ai làm (team) | Máy cần | Ước lượng độ lớn |
|---|---|---|---|---|
| P0 | Chốt Q1–Q5, chốt contract §2 | Chủ dự án + Tech lead | — | nhỏ |
| P1 | Kết nối Drive private bằng OAuth, **chứng minh** list + tải được | B (+A) | máy dev + tài khoản Gmail A/B | nhỏ–vừa |
| P2 | Migration + hàng đợi job + quét/so sánh/preview/publish | A + B | máy dev + Postgres | **lớn** |
| P3 | Màn admin: kết nối, quét, tiến độ, lịch sử, review | C | máy dev | vừa |
| P4 | API thiết bị/catalog/tải + plugin cache preview + tải model qua backend | A + D | **Windows + Max 2022** cho D | **lớn** |
| P5 | Đơn hàng + bot Telegram + cấp quyền | F (+A, D) | máy dev + bot test | vừa |
| P6 | VPS, Nginx, giám sát, backup, E2E, deploy | E | VPS | vừa |
| P7 | Gỡ payOS/R2/tài khoản khách/bảng cũ | A | — | nhỏ |

P3, P4 và P5 làm **song song được** sau khi P2 có migration + API catalog (bước P2.1, P2.7).

---

## 2. API contract (chốt ở P0, mọi team dùng chung)

### 2.1 Quy ước chung
* Prefix: admin `/api/admin/...` (cookie phiên admin hiện có), khách `/api/v1/...` (header `Authorization: Device <token>` — **do native gắn**, JS không thấy).
* Lỗi: `{"error":{"code":"STRING_CODE","message":"Thông điệp tiếng Việt cho người dùng","requestId":"uuid"}}`. Không stack trace.
* ID công khai: UUID. Thời gian: ISO-8601 UTC. Tiền: số nguyên VND.
* Mã lỗi dùng chung: `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `INVALID_PARAMS` 400 · `RATE_LIMITED` 429 · `INTERNAL` 500.
* **Mã lỗi Drive (đã cài ở P1, `src/drive/errors.js`):** `DRIVE_OAUTH_NOT_CONFIGURED` 503 · `DRIVE_NOT_CONNECTED` 409 · `DRIVE_AUTH_REVOKED` 409 · `OAUTH_STATE_INVALID` 400 · `OAUTH_NO_REFRESH_TOKEN` 400 · `DRIVE_SCOPE_MISSING` 400 · `DRIVE_PERMISSION_DENIED` 422 · `DRIVE_NOT_FOUND` 422 · `DRIVE_NOT_A_FOLDER` 422 · `DRIVE_QUOTA_EXCEEDED` 429 · `DRIVE_UPSTREAM_ERROR` 502. Lỗi Drive cố ý **không** dùng 401/403/404 để không bị nhầm với "chưa đăng nhập / không phải admin / sai route".

### 2.2 Admin — Drive (P1, P2, P3)

| Method + path | Request | Response | Lỗi riêng |
|---|---|---|---|
| `GET /api/admin/drive/status` | — | `{configured:bool, missingConfig:[tên biến], connection:{id,status,email,authKind,connectedAt,lastTokenRefreshAt,lastErrorCode}\|null, sources:[{id,connectionId,rootFolderName,sourceType,enabled,lastSuccessfulSyncAt}]}` (P1 thêm `configured`/`missingConfig`/`id`/`lastErrorCode`) | — |
| `GET /api/admin/drive/oauth/start` | — | `302` sang Google (có `state`, PKCE) | `DRIVE_OAUTH_NOT_CONFIGURED` |
| `GET /api/admin/drive/oauth/callback` | `?code&state` từ Google | `302` về trang admin `?drive=connected\|error` | `OAUTH_STATE_INVALID` |
| `POST /api/admin/drive/test-access` | `{sourceId?}` | `{canList:bool, sampleCount, canDownloadSample:bool, account, details:[{check,ok,count?,code?,reason?}]}` | `DRIVE_AUTH_REVOKED`, `DRIVE_PERMISSION_DENIED` |
| `POST /api/admin/drive/sources` | `{rootFolderUrlOrId, resourceKey?}` | `201 {id, rootFolderName, sourceType}` | `DRIVE_NOT_FOUND`, `DRIVE_PERMISSION_DENIED` |
| `GET /api/admin/drive/sources` | — | `[{id,...}]` | — |
| `POST /api/admin/drive/sync-jobs` | `{sourceId, mode:"FULL"\|"INCREMENTAL"}` | `202 {jobId}` | `409 SYNC_ALREADY_RUNNING`, `DRIVE_AUTH_REVOKED`, `DISK_SPACE_LOW` |
| `GET /api/admin/drive/sync-jobs?limit&cursor` | — | `{items:[JobSummary], nextCursor}` | — |
| `GET /api/admin/drive/sync-jobs/:id` | — | `Job` (dưới) | — |
| `GET /api/admin/drive/sync-jobs/:id/events` | SSE | event `progress` (Job), `done` (Job) | — |
| `GET /api/admin/drive/sync-jobs/:id/items?status=FAILED` | — | `[{driveFileName,path,action,status,errorCode,errorMessage}]` (**tên/đường dẫn, không Drive ID**) | — |
| `POST /api/admin/drive/sync-jobs/:id/cancel` | — | `202` | `409 JOB_NOT_CANCELLABLE` |
| `POST /api/admin/drive/sync-jobs/:id/retry` | — | `202 {jobId}` (job mới) | `409 SYNC_ALREADY_RUNNING` |
| `GET /api/admin/catalog/review` | — | `[{id,kind,summary,candidates:[...]}]` | — |
| `POST /api/admin/catalog/review/:id` | `{action:"ACCEPT"\|"DISMISS", choice?}` | `200` | `409 REVIEW_ALREADY_RESOLVED` |

`Job = {id,sourceId,mode,status,stage,counters:{scannedFolders,scannedFiles,new,updated,unchanged,missing,review,skipped,errors},bytesDownloaded,startedAt,finishedAt,heartbeatAt,errorCode,errorMessage}`.
`status ∈ QUEUED|RUNNING|CANCELLING|CANCELLED|COMPLETED|COMPLETED_WITH_ERRORS|FAILED`; `stage ∈ SCANNING|COMPARING|DOWNLOADING_PREVIEWS|PUBLISHING|null`.
**Không có tổng** khi đang SCANNING → UI hiện thanh không xác định.

### 2.3 Khách — catalog và preview (P2, P4)

Ba endpoint này **công khai** (không cần token), để duyệt catalog khi chưa mua.

| Method + path | Response |
|---|---|
| `GET /api/v1/catalog/version` | `{catalogVersion, manifestChecksum, publishedAt}` + `ETag`. `If-None-Match` khớp → `304` |
| `GET /api/v1/categories` | `[{id,parentId,name,fullPath,modelCount}]` |
| `GET /api/v1/catalog` | `{catalogVersion, models:[{id,name,categoryId,priceVnd,sizeBytes,fileType,status:"PUBLISHED"}]}` |
| `GET /api/v1/previews/manifest` | `{catalogVersion, previews:[{modelId,variant:"sm"\|"lg",url:"/previews/<sha256>.webp",sha256,version,fileSize,width,height}]}` |
| `GET /previews/<sha256>.webp` | Nginx phục vụ file tĩnh, `Cache-Control: public, max-age=31536000, immutable` |
| `GET /api/v1/catalog/events` | SSE: event `catalog.updated {catalogVersion}` khi publish xong. Plugin mất kết nối thì tự quay về kiểm mỗi 5 phút. Giới hạn số kết nối đồng thời (cấu hình) để giữ RAM VPS |

### 2.4 Khách — thiết bị và quyền (P4)

| Method + path | Request | Response | Lỗi riêng |
|---|---|---|---|
| `POST /api/v1/device/challenge` | `{deviceUuid, publicKey(JWK), keyProtection, machineCode, deviceName}` | `{challengeId, message, expiresAt}` | `DEVICE_BLOCKED` |
| `POST /api/v1/device/verify` | `{challengeId, signature, legacyLicense?}` (`legacyLicense` = token MXL1 cũ, tùy chọn) | `{deviceToken, expiresAt, entitlements:{allModels:bool, modelIds:[uuid]}}` | `CHALLENGE_INVALID`, `SIGNATURE_INVALID`, `LEGACY_LICENSE_INVALID` (không chặn verify, chỉ bỏ qua license) |
| `GET /api/v1/me/entitlements` | — | `{allModels, modelIds:[uuid]}` | `UNAUTHENTICATED` |

Lần đầu `challenge` với `deviceUuid` mới → tạo `devices` (đăng ký). `publicKey` khác với bản đã đăng ký cùng `deviceUuid` → `DEVICE_KEY_MISMATCH` (403).

### 2.5 Khách — tải model (P4)

| Method + path | Request | Response | Lỗi riêng |
|---|---|---|---|
| `POST /api/v1/models/:modelId/import-session` | — | `201 {sessionId, expiresAt, sizeBytes, md5, sha256\|null, fileType, entryFile\|null}` | `NOT_ENTITLED` 403, `MODEL_NOT_AVAILABLE` 409, `MODEL_DOWNLOAD_RESTRICTED` 409, `RATE_LIMITED` |
| `GET /api/v1/model-downloads/:sessionId` | — | `200` stream nhị phân, `Content-Length`, `Content-Type: application/octet-stream` | `SESSION_INVALID` 404 (hết hạn/đã dùng/sai thiết bị), `DOWNLOAD_BUSY` 503, `STORAGE_DOWNLOAD_FAILED` 502 |

Phiên: hết hạn 5 phút nếu chưa bắt đầu, **dùng một lần**, gắn `device_id` + `model_id`. Kiểm lại entitlement khi mở stream.

### 2.6 Khách — đơn hàng (P5)

| Method + path | Request | Response | Lỗi riêng |
|---|---|---|---|
| `POST /api/v1/orders` | `{items:[{modelId}]}` (1..n model; **chỉ bán theo model** — D18) | `201 {orderId, code, amountVnd, status:"PENDING_PAYMENT", expiresAt, payment:{bankName,accountNo,accountName,transferContent,qrPayload}}` (lấy từ `bank_snapshot`) | `ALREADY_ENTITLED` 409, `TOO_MANY_PENDING_ORDERS` 429, `PAYMENT_NOT_CONFIGURED` 503 |
| `POST /api/v1/orders/:id/claim-paid` | — | `200 {status:"AWAITING_OWNER"}` | `409 ORDER_STATE_INVALID` |
| `GET /api/v1/orders/:id` | — | `{orderId, code, amountVnd, status, expiresAt, decidedAt}` | — |
| `POST /api/v1/orders/:id/cancel` | — | `200` | `409 ORDER_STATE_INVALID` |
| `POST /api/telegram/webhook/<path-bí-mật>` | Update của Telegram | `200` (luôn, để Telegram không gửi lại) | kiểm header secret, sai → `401` |

Giá **luôn tính ở server**. Client gửi giá → bỏ qua.

### 2.7 Admin — quyền và đơn (P3, P5)

| Method + path | Mục đích |
|---|---|
| `GET /api/admin/devices?q=` | Tìm thiết bị theo machine code / tên |
| `GET /api/admin/devices/:id` | Thiết bị + entitlements + đơn + log tải |
| `POST /api/admin/entitlements` | `{deviceId, scope, modelId?}` cấp thủ công (audit) |
| `POST /api/admin/entitlements/:id/revoke` | Thu hồi (audit) |
| `POST /api/admin/licenses/mxl1` | `{machineCode, licenseId?}` → ký MXL1 như `apps/license-admin` hiện tại, **có ghi DB + audit** (tiêu chí #17) |
| `GET /api/admin/orders?status=` / `POST /api/admin/orders/:id/confirm` / `.../reject` | Xử lý đơn từ web (phòng khi Telegram lỗi) |
| `GET /api/admin/settings` · `PUT /api/admin/settings` | Đọc/sửa `app_settings`: ngân hàng (tên, BIN, số TK, chủ TK), giá mặc định, TTL đơn, số đơn chờ tối đa (audit) |
| `GET /api/admin/models?q=&status=` · `PATCH /api/admin/models/:id` | Danh sách model; sửa `name`, `priceVnd`, `status` (`PUBLISHED`/`HIDDEN`). Lần đồng bộ sau **không ghi đè** tên/giá admin đã sửa (cột `name_overridden`, `price_overridden`) |

---

## P0 — Chốt quyết định ✅ XONG (2026-10-29)

| Câu hỏi | Đã chốt |
|---|---|
| Q1 | **Bán theo từng model, license vĩnh viễn.** Giá mặc định + giá từng model sửa trong admin |
| Q2 | Không push; **plugin tự phát hiện và tự cập nhật** (khi mở, mỗi 5 phút, SSE) |
| Q3 | Danh tính = thiết bị, khách không có tài khoản |
| Q4 | OAuth Gmail B; P1 đánh giá thêm Service Account rồi chốt |
| Q5 | Có module đơn hàng + Telegram |
| Q6 | Thông tin ngân hàng **nhập/sửa trong admin** (chưa có thì không tạo được đơn — báo lỗi rõ) |
| Q7 | **Bộ cài mang sẵn ảnh preview**; file zip/rar trên Drive; thông tin model trên VPS |
| Q8 | Giao diện plugin = **UI-1 tối, commit `13ad8f4`** |

Quyết định ghi trong `docs/decisions.md` D17–D25. Contract §2 = **frozen v1**.
Còn mở, **không chặn** code: số tài khoản ngân hàng thật (nhập sau ở admin); kết luận Q4 (cuối P1).

---

## P1 — Google Drive OAuth + thử thật (Team B, hỗ trợ A)

**Mục tiêu:** chứng minh Gmail B đọc được thư mục private của Gmail A và tải được file **qua API**, trước khi xây gì thêm.

### P1.1 Chuẩn bị (thủ công, chủ dự án làm)
1. Tạo Google Cloud project; bật **Google Drive API**; tạo OAuth client loại *Web application*; redirect URI = `https://<domain>/api/admin/drive/oauth/callback` (dev: `http://localhost:4000/...`).
2. OAuth consent screen: thêm Gmail B vào *Test users*. Ghi lại trạng thái *Testing/Production*.
3. Gmail A chia sẻ thư mục root `3DSMOOD` cho Gmail B quyền **Viewer**. Kiểm: owner **không** tắt "Viewers can download".
4. (Song song, cho Q4) Tạo Service Account, chia sẻ cùng thư mục cho email service account.

### P1.2 Code
| Bước | File | Nội dung |
|---|---|---|
| 1 | `migrations/014_drive_connections.sql` + `rollback/014_*.sql` | Bảng `drive_connections`, `drive_sources`, `oauth_states` (database doc §3.1) |
| 2 | `src/drive/crypto.js` | AES-256-GCM mã hóa refresh token, khóa `DRIVE_TOKEN_KEY` (32 byte base64, thiếu → API khởi động báo lỗi rõ). Có thể tái dùng mẫu `licensing/crypto.js` |
| 3 | `src/drive/oauth.js` | start (state + PKCE, lưu hash state), callback (đổi code, lưu token mã hóa), refresh khi cần, `invalid_grant` → `RECONNECT_REQUIRED` |
| 4 | `src/drive/client.js` | Hàm thuần: `listChildren(folderId,{pageToken,resourceKey})`, `getFile(id)`, `openMedia(id,{signal})` trả stream. Dùng `fetch` + REST v3 (**không thêm SDK** nếu `fetch` đủ; nếu thêm `googleapis` phải ghi lý do). Tham số: `supportsAllDrives=true`, `includeItemsFromAllDrives=true`, fields gồm `id,name,mimeType,parents,size,modifiedTime,md5Checksum,resourceKey,capabilities/canDownload,shortcutDetails`. Header resource key khi cần [kiểm cú pháp với tài liệu Drive v3] |
| 5 | `src/drive/backoff.js` | Retry 429/5xx/403-rate-limit với backoff mũ + jitter; **không** retry 403 permission, 404 |
| 6 | `src/drive/routes.js` (admin) | `status`, `oauth/start`, `oauth/callback`, `test-access`, `sources` (§2.2) |
| 7 | `scripts/drive-probe.js` | CLI chạy tay: đếm folder/file đệ quy, tải thử 3 file (nhỏ nhất, trung vị, lớn nhất) ra `/dev/null` có đo tốc độ, in `canDownload` |

### P1.3 Test
* Unit: mã hóa/giải mã token (sai AAD → lỗi), state hết hạn/đã dùng, backoff (không retry 403-permission).
* Integration: route admin bị chặn khi không phải admin.
* **Thật (bắt buộc, có biên bản trong STATUS):** chạy `drive-probe` → kỳ vọng ~126 folder / 845 file / 360 model (số của nhánh nam); tải file lớn nhất (~200 MB) thành công; ghi tốc độ, lỗi gặp phải.
* **Thật cho Q4:** để refresh token tồn tại > 7 ngày (hoặc đọc tài liệu Google hiện hành) xem có hết hạn không ở chế độ Testing; so sánh với Service Account.

### P1.4 Nghiệm thu
Admin bấm Connect → Google → quay lại `CONNECTED`; `test-access` trả `canList=true, canDownloadSample=true`; refresh token **không** xuất hiện trong log/DB dạng rõ; biên bản probe + kết luận Q4.

---

## P2 — Database + worker đồng bộ (Team A + B)

**Mục tiêu:** bấm một nút → catalog trong PostgreSQL phản ánh đúng Drive, preview WebP nằm trên đĩa, an toàn khi crash.

### P2.1 Migration (Team A)
`015_drive_sync_jobs.sql`, `016_catalog.sql`, `018_download_audit.sql` (017 để P4/P5) + rollback. Theo `v3-database.md` §3.2, §3.3, §3.5.
Kiểm: chạy trên DB trống và trên DB dev có dữ liệu 001–013; rollback chạy được.

### P2.2 Seed từ catalog cũ (Team A)
`scripts/seed-legacy-catalog.js`: đọc `library/public/catalog.json` → `categories` (tách `"Parent / Child"`), `models` (`legacy_id` = id cũ, `status=PUBLISHED`), `model_files` (`drive_file_id`, `sha256` có sẵn). **Không** copy ảnh (preview do worker sinh lại).
Nghiệm thu: 360 model, chạy lại không nhân đôi (khóa theo `legacy_id`).

### P2.3 Hàng đợi job (Team B)
`src/worker/queue.js`: `claimJob(workerId)` = một câu `UPDATE ... WHERE id = (SELECT id ... WHERE status='QUEUED' OR (status='RUNNING' AND lease_expires_at < now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`; `heartbeat()` mỗi 15s gia hạn lease 60s; `saveCheckpoint()`; `finish()`.
`src/worker.js`: vòng lặp chờ job (poll 5s hoặc `LISTEN` kênh `drive_jobs`), xử lý SIGTERM: dừng ở điểm an toàn, lưu checkpoint.
Test: hai worker cùng lúc chỉ một nhận job; giết worker giữa chừng → worker khác nhận sau khi lease hết; unique một job/nguồn.

### P2.4 Scanning (Team B)
`src/worker/scan.js`: BFS từ root, `folderQueue` + `pageToken` trong checkpoint; ghi `drive_inventory` theo lô 200 dòng; theo shortcut (chống vòng lặp); bỏ Google Docs (ghi `skipped`).
Test với Drive giả (stub HTTP): >1000 file một thư mục (phân trang), lồng 6 cấp, shortcut vòng, folder bị xóa giữa chừng (404 → ghi lỗi, tiếp tục), 429 → backoff.

### P2.5 Mapping + so sánh (Team B)
`src/worker/mapper.js` — **hàm thuần, không I/O**: vào danh sách file trong một thư mục, ra `{models:[...], reviews:[...]}` theo `v3-architecture.md` §6. Đây là chỗ dễ sai nhất → **viết bảng test trước**:

| Ca | Vào | Ra |
|---|---|---|
| L1 cặp chuẩn | `A.jpg, A.rar` | 1 model |
| L1 tên bẩn | `A .jpg, Arar.rar` | 1 model |
| L1 dư 1–1 | `X.jpg, Y-yzbmix.rar` (chỉ còn 2 file chưa ghép) | 1 model `SUGGESTED_PAIR` |
| L2 | `Model_A/model.max, Model_A/preview_01.jpg, preview_02.jpg` | 1 model, 2 ảnh, ảnh 01 primary |
| Mơ hồ | `A.jpg, A.rar, A.zip` | review `AMBIGUOUS_PAIR` |
| Thiếu ảnh | `B.rar` | model `NEEDS_REVIEW` hoặc review `ORPHAN_MODEL` (chốt ở P0) |
| Ảnh lẻ | `C.jpg` | review `ORPHAN_IMAGE` |
| Đổi tên | file id giữ nguyên, tên mới | cùng model, tên mới |
| Thay file | id mới, cùng md5+size, id cũ biến mất | review `REMAP_CANDIDATE` |

`src/worker/diff.js`: so `drive_inventory` (job hiện tại) với `model_files`/`model_previews` → NEW/MODIFIED/UNCHANGED/MISSING. **Chỉ chạy khi SCANNING hoàn tất.** MISSING chỉ tăng `missing_scans`, không xóa. Cập nhật tên/giá **bỏ qua** model có `name_overridden`/`price_overridden`.
Test riêng: dữ liệu seed 360 mục → lần quét đầu khớp theo `drive_file_id`, **0 model mới bị tạo trùng**.

### P2.6 Preview (Team B)
`src/worker/previews.js`: chỉ ảnh NEW/MODIFIED; stream `openMedia` → `PREVIEW_DIR/tmp/<uuid>.part`; giới hạn 20 MB/ảnh; kiểm magic bytes; Sharp → 2 biến thể `sm` 480px, `lg` 1400px WebP q80 (thông số như `apps/store-api/scripts/ingest.js` đang dùng); tên = `<sha256>.webp`; `rename` nguyên tử; song song ≤ 2; Sharp `concurrency(1)`, `limitInputPixels`.
Kiểm disk trống ≥ 2 GB (cấu hình `MIN_FREE_DISK_BYTES`) trước stage và mỗi 100 ảnh → thiếu thì `FAILED DISK_SPACE_LOW`.
Khi worker khởi động: xóa `*.part` cũ hơn 1 giờ.
Test: ảnh hỏng/giả đuôi, ảnh quá lớn, ngắt giữa chừng → không file nửa vời, chạy lại idempotent.

### P2.7 Publish + API catalog (Team A + B)
`src/worker/publish.js`: một transaction (`v3-database.md` §4); `catalog_state.active_version += 1`; `manifest_checksum` = sha256 của manifest JSON chuẩn hóa.
`src/catalog-v1/routes.js`: các endpoint §2.3 (đọc DB, ETag theo `manifest_checksum`).
Test: publish lỗi giữa chừng (ném lỗi sau 1 nửa upsert) → version không đổi, catalog cũ còn nguyên; response **không chứa** chuỗi Drive ID nào (test quét toàn bộ JSON).

### P2.8 Nghiệm thu P2
Từ Drive thật: job FULL chạy hết, 360 model công bố, ~720 WebP; chạy lại lần 2 → `new=0, updated=0`, không tải ảnh nào; kill worker giữa DOWNLOADING_PREVIEWS → tự tiếp tục; RSS worker < 400 MB suốt job (ghi số đo).

---

## P3 — Web Admin (Team C)

Làm trong `apps/store-web` (admin hiện có: `AdminDashboard.jsx`, `AdminShared.jsx`…). **Giữ theme tối UI-1.** Không tạo app admin mới.

| Bước | Màn | Chi tiết | Dep |
|---|---|---|---|
| P3.1 | Kết nối Drive | Trạng thái `CONNECTED/EXPIRED/RECONNECT_REQUIRED`, email Gmail B, root folder, nút Connect/Reconnect, Test Access (hiện kết quả từng mục) | P1 |
| P3.2 | Quét đồng bộ | Nút "Quét đồng bộ" (FULL/INCREMENTAL), khóa nút khi đang chạy; SSE `events` → stage, số liệu, dung lượng; **thanh không xác định khi chưa có tổng**; Cancel/Retry; tự chuyển sang polling 3s nếu SSE lỗi | P2.3 |
| P3.3 | Lịch sử + lỗi | Bảng job (thời gian, kết quả, số liệu), mở job → danh sách file lỗi (tên + đường dẫn, không Drive ID) | P2.4 |
| P3.4 | Cần duyệt | Danh sách `review_items` theo loại; chấp nhận/bỏ qua; chọn ảnh chính; xác nhận remap | P2.5 |
| P3.5 | Thiết bị & quyền | Tìm thiết bị, cấp/thu hồi entitlement, ký MXL1 (thay trang Vercel) | P4.1 |
| P3.6 | Đơn hàng | Danh sách đơn chờ, xác nhận/từ chối từ web | P5 |
| P3.7 | Cài đặt | Thông tin ngân hàng nhận tiền, giá mặc định, TTL đơn; bảng model sửa tên/giá/ẩn | P2.1, migration 017 |

Test: unit component (jsdom như repo đang dùng), Playwright cho luồng "bấm quét → thấy tiến độ → hoàn tất" với API giả. Kiểm không có refresh token trong bất kỳ response admin nào.
**Nghiệm thu:** admin không biết code vẫn kết nối được Drive, quét, đọc được lỗi, duyệt được mục mơ hồ.

---

## P4 — API khách + Plugin (Team A + D)

### P4.1 Backend thiết bị và quyền (Team A)
* `migrations/017_devices_entitlements_orders.sql` (cả bảng đơn hàng, dù P5 mới dùng).
* `src/devices/routes.js`: §2.4. Tái dùng `licensing/device-crypto.js` (kiểm chữ ký RSA JWK, nonce một lần). Device token: 32 byte ngẫu nhiên, DB lưu sha256, TTL 15 phút. Middleware `requireDevice`.
* MXL1 cũ: đưa `issueLicense`/xác minh từ `apps/license-admin/server/license-core.mjs` vào backend (public key `LICENSE_PUBLIC_KEY_B64`); token hợp lệ + `machineCode` khớp thiết bị → entitlement `ALL_MODELS source=MXL1`.
* Test: chữ ký sai, replay challenge, challenge hết hạn, đổi public key cùng deviceUuid, MXL1 của máy khác, MXL1 bị sửa 1 byte, thiết bị BLOCKED.

### P4.2 Backend tải model (Team A)
* `src/drive/provider.js`: cài `openDownload(model,{signal})` cho `createArchiveSender` (dùng `client.openMedia`).
* `src/downloads/routes.js`: §2.5. Rate limit theo thiết bị (ví dụ 10 phiên/giờ — cấu hình) + toàn cục `maxConcurrent=3`.
* Tính sha256 trong lúc stream lần đầu, lưu `model_files.sha256` khi hoàn tất.
* Ghi `model_download_logs`.
* Test: không entitlement → 403; entitlement bị thu hồi giữa lúc có phiên → mở stream bị từ chối; phiên dùng 2 lần; thiết bị khác dùng phiên; client ngắt giữa chừng → upstream bị abort (kiểm bằng stub); RSS không tăng theo kích thước file (stream 500 MB giả).

### P4.3 Plugin (Team D — **Windows**)
| Bước | File | Nội dung |
|---|---|---|
| 1 | `PluginConfiguration.cs`, `plugin-config.json` | Chế độ online: `apiBaseUrl` HTTPS (bỏ bắt buộc `catalogUrl`); giữ khả năng đọc catalog đóng gói làm **dự phòng** cho bản chuyển tiếp |
| 2 | `CatalogCacheService.cs` (mới, thay vai trò `StaticCatalogService`) | Lưu `catalog.json` + `manifest.json` ở `%LOCALAPPDATA%\3dMood\Catalog\`; `version` + ETag; ghi file tạm → rename |
| 3 | `PreviewCacheService.cs` (mới) | `%LOCALAPPDATA%\3dMood\Previews\<sha256>.webp`. **Lần mở đầu: chép `seed/` từ thư mục cài** (kiểm sha256 từng file). Sau đó hàng đợi tải nền phần chênh lệch, ưu tiên category đang mở, 4 song song, kiểm sha256, `.part` → rename; pause/resume/retry; event `library.previewProgress` |
| 3b | `CatalogUpdateWatcher.cs` (mới) | Kiểm `catalog/version` khi mở + **mỗi 5 phút** khi panel đang mở + nghe SSE `catalog/events`; có bản mới → tải catalog + manifest + preview chênh lệch **tự động**, rồi báo UI (event `library.updated`) để lưới tự làm mới. Không làm gián đoạn job Download đang chạy |
| 4 | `PackagedAppRuntime.cs` | Phục vụ `/previews/<hash>` từ cache local (thay vì từ thư mục cài); proxy `/api/v1/*` tới server và **tự gắn** `Authorization: Device …` (JS không có token) |
| 5 | `DeviceSessionService.cs` (mới) | Dùng `DeviceIdentityService` ký challenge → token; tự làm mới trước khi hết hạn; lần đầu gửi kèm license MXL1 đang lưu (nếu có) |
| 6 | `BackendModelDownloader.cs` (mới, thay `GoogleDriveDownloader`) | `import-session` → stream về `.part` → kiểm size + md5/sha256 → giao `ArchivePackage` + pipeline import **hiện có**. Xóa allowlist `drive.google.com` |
| 7 | `BridgePolicy.cs` | `asset.import` nhận `{modelId}` (UUID hoặc `legacy_id` trong giai đoạn chuyển tiếp) |
| 8 | Migration khách cũ | Khi chạy bản mới: đọc `license.txt` MXL1 cũ → gửi ở verify lần đầu; giữ nguyên file |
| 9 | Test native | Thêm vào bộ PowerShell runner hiện có: cache hỏng, mất mạng giữa tải preview, sha256 sai, server trả 403/409/503, seed thiếu/hỏng 1 file |
| 10 | `installer/build-installer.ps1` | Thêm bước **kéo seed**: gọi `GET /api/v1/previews/manifest` của môi trường đích, tải mọi ảnh, kiểm sha256, đặt vào `stage/Platform/seed/` + `seed-manifest.json`. Build thất bại nếu thiếu ảnh. Bỏ bước đóng gói `library/public` cũ |

### P4.4 Frontend plugin (Team D/C — `apps/store-web`) — **dùng giao diện UI-1 (D24)**

**Nguồn giao diện:** commit `13ad8f4` (nhánh `hung-connection_to_3dsmax`). Lấy đúng các file này về nhánh phase, **giữ nguyên
bố cục và theme**, chỉ đổi nguồn dữ liệu:

```bash
git checkout 13ad8f4 -- apps/store-web/src/index.css apps/store-web/src/icons.jsx \
  apps/store-web/src/HostBar.jsx apps/store-web/src/Queue.jsx apps/store-web/src/queue.js \
  apps/store-web/src/queue.test.js apps/store-web/src/components.jsx apps/store-web/src/App.jsx \
  apps/store-web/src/integrations/3dsmax/devMockHost.js
```

| File UI-1 | Giữ | Đổi cho v3 |
|---|---|---|
| `index.css`, `icons.jsx`, `HostBar.jsx` | nguyên | — |
| `App.jsx` | bố cục 3 cột, bộ lọc cây, tìm kiếm, sắp xếp, phân trang, tab Online / Đã tải | `getAllProducts` → `GET /api/v1/catalog` + `categories` (cây theo `parentId`, không còn chuỗi `"A / B"`). Tab "Đã tải" = model có entitlement. **Bỏ** cột icon "Tài khoản" và `AuthModal` (khách không có tài khoản — D17); thay bằng mã máy + trạng thái thiết bị |
| `components.jsx` | `Filters`, `Card`, `DetailPanel`, `DownloadButton` | Nút theo quyền: **Mua** (chưa có entitlement) → mở hộp thoại QR (P5) · **Download** (đã có) · trạng thái hàng đợi. Ảnh lấy `/previews/<sha256>.webp` (host phục vụ từ cache). Bỏ nhãn "Mua license — sắp có" |
| `queue.js`, `Queue.jsx` | hàng đợi tuần tự, chống trùng, thử lại | `asset.import {modelId}` (không còn `importTicket` từ web — native tự xin phiên). Nhận event `asset.progress` để hiện % (native nhánh nam đã gửi `receivedBytes/totalBytes`) |
| `devMockHost.js` | giả lập host | Thêm giả lập `library.updated`, `asset.progress`, đơn hàng |
| `main.jsx` | — | Mount `App` (UI-1) cho plugin; **không** mount `OfflineLibrary` |

* Hộp thoại thanh toán: có thể tái dùng `PaymentDialog.jsx` + `qrcode.react` của nhánh nam (đã viết theo cùng theme tối), đổi API sang §2.6.
* Trang admin (P3) nằm cùng app, route `/admin`, dùng các màn `Admin*.jsx` của nhánh nam + cùng token màu của UI-1.
* Khi catalog tự cập nhật (`library.updated`): lưới làm mới **giữ nguyên** bộ lọc, trang, model đang chọn.
* Test: giữ `queue.test.js`; thêm test jsdom cho nút theo quyền và tự làm mới; Playwright với `?mockMax=1`.

### P4.5 Nghiệm thu P4 (trên Max 2022 thật)
Cài bản mới → mở plugin → catalog + preview tải về cache; đóng mạng → mở lại vẫn xem được; mở mạng, admin quét thêm 1 model → plugin thấy model mới **không cài lại**; thiết bị có quyền bấm Download → model merge vào scene; thiết bị không quyền → thông báo rõ; plugin không có Drive ID trong bất kỳ file cache/log nào (grep thư mục `%LOCALAPPDATA%\3dMood`).

---

## P5 — Đơn hàng + Telegram (Team F, hỗ trợ A/D)

| Bước | File | Nội dung |
|---|---|---|
| P5.1 | Thủ công | Tạo bot với @BotFather, lấy token; lấy `chat_id` của chủ; cấu hình `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_PATH` (chuỗi ngẫu nhiên), `PAYMENT_BANK_*` |
| P5.2 | `src/orders/service.js` | Máy trạng thái §2.6; giá từ `models.price_vnd`; mã đơn ngắn không trùng; giới hạn đơn chờ/thiết bị; hết hạn (job định kỳ 1 phút, `UPDATE ... WHERE expires_at < now()`) |
| P5.3 | `src/orders/qr.js` | Sinh `transferContent` = mã đơn và `qrPayload` VietQR. **[CHƯA KIỂM CHỨNG]** định dạng chuẩn VietQR/EMVCo — phải đối chiếu tài liệu NAPAS/VietQR và quét thử bằng app ngân hàng thật trước khi phát hành |
| P5.4 | `src/telegram/client.js` | `sendMessage` (inline keyboard ✅/❌), `editMessageText`, `answerCallbackQuery`, `setWebhook` (có `secret_token`). Gọi Bot API bằng `fetch` [đối chiếu tài liệu Telegram Bot API hiện hành] |
| P5.5 | `src/telegram/routes.js` | Webhook: kiểm header secret; chỉ nhận `callback_query` từ chat_id trong allowlist; `callback_data` = `o:<orderId>:ok\|no` (kiểm độ dài giới hạn); xử lý idempotent; luôn trả 200 |
| P5.6 | Transaction xác nhận | `AWAITING_OWNER → CONFIRMED` + insert entitlements + audit trong **một** transaction; `UPDATE ... WHERE status='AWAITING_OWNER'` để hai lần bấm chỉ một lần thắng |
| P5.7 | `scripts/telegram-set-webhook.js` | Operator chạy tay sau khi có domain HTTPS |
| P5.8 | Plugin UI | Hộp thoại QR (repo đã có `qrcode.react` + `PaymentDialog.jsx` để tái dùng giao diện), "Tôi đã chuyển khoản", đếm ngược, poll 4s, kết quả |

**Test:** webhook không secret / sai secret / chat lạ → không đổi gì; bấm ✅ hai lần đồng thời → 1 entitlement; ✅ sau khi đơn hết hạn → không cấp, sửa tin nhắn báo "đơn đã hết hạn"; client gửi giá giả → bị bỏ qua; DB ngắt giữa transaction → không có entitlement mồ côi; vượt giới hạn đơn chờ → 429.
**Nghiệm thu (thật):** đơn 1 model, chủ nhận tin trên điện thoại, bấm ✅, plugin chuyển sang Download trong ≤ 10 giây (đo thật), tải và merge được.

---

## P6 — VPS, E2E, deploy (Team E)

0. **Bộ cài:** chạy `build-installer.ps1` trỏ tới VPS đích để kéo seed preview (P4.3 bước 10); phát hành lại bộ cài khi muốn khách **mới** có sẵn ảnh mới hơn (khách cũ vẫn tự đồng bộ).
1. **VPS:** Nginx (TLS Let's Encrypt, `client_max_body_size` nhỏ, `limit_conn` cho `/api/v1/model-downloads`, phục vụ `/previews/` trực tiếp từ đĩa với cache dài); systemd cho `store-api` và `store-worker` (`Restart=always`, `MemoryMax`); PostgreSQL chỉ nghe localhost.
2. **Biến môi trường:** `DATABASE_URL`, `DRIVE_*`, `DRIVE_TOKEN_KEY`, `LICENSE_PUBLIC_KEY_B64` (và private key nếu ký MXL1 trên server — Q P0), `TELEGRAM_*`, `PAYMENT_BANK_*`, `PREVIEW_DIR`, `MIN_FREE_DISK_BYTES`, `CORS_ORIGINS`, `NODE_ENV=production`. Không commit.
3. **Giám sát:** disk %, RSS từng tiến trình, số lỗi Drive/giờ, băng thông, job FAILED, đơn `AWAITING_OWNER` quá 1 giờ → cảnh báo (có thể gửi qua chính bot Telegram).
4. **Backup:** `pg_dump` hằng ngày, giữ 14 bản, chép ra ngoài VPS; **diễn tập restore** lên máy sạch. Preview không cần backup (sinh lại bằng FULL sync).
5. **E2E checklist** = 18 tiêu chí nghiệm thu của master prompt (§14) + luồng Telegram; mỗi tiêu chí ghi pass/fail + bằng chứng.
6. **Failure test:** thu hồi quyền Viewer của Gmail B giữa job; revoke OAuth; reboot VPS giữa sync; đầy disk (giả lập); rút mạng plugin giữa tải; license/entitlement thu hồi giữa phiên.
7. **Deploy + rollback:** theo `v3-architecture.md` §10.2.

---

## P7 — Dọn code cũ (Team A, chỉ khi P6 ổn định ≥ 2 tuần)

Gỡ `src/payments/`, `src/r2/`, `cloudflare/`, `scripts/*payos*`, `scripts/*r2*`, auth khách (`auth.js` phần register/login khách), `apps/license-admin` (sau khi P3.5 thay thế), `GoogleDriveDownloader.cs`, `StaticCatalogService.cs` (nếu bỏ chế độ đóng gói), migration drop bảng cũ (backup trước, chủ dự án duyệt). Cập nhật `docs/decisions.md`, `README.md`, `CLAUDE.md`.

---

## 3. Mẫu prompt giao việc cho model triển khai

```text
Bạn triển khai phase <Px> của dự án 3DS Mood. Repo: <đường dẫn>, nhánh nền phuc_arch_v3.
Đọc docs/v3-implementation-plan.md (mục 0, mục 2 và mục <Px>), docs/v3-architecture.md, docs/v3-database.md, CLAUDE.md.
Tạo nhánh v3/<px-ten>. Chỉ làm đúng phạm vi <Px>. Viết test trước cho phần tiền/quyền/job/giải nén.
Không thay đổi contract ở mục 2; nếu bắt buộc phải đổi, dừng lại và báo.
Không chạy migration production, không commit secret, không push main.
Kết thúc: chạy toàn bộ test, cập nhật docs/STATUS.md mục v3, báo cáo file đã đổi + lệnh đã chạy + điều chưa kiểm chứng.
```
