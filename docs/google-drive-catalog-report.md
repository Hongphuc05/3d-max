# Báo cáo triển khai catalog Google Drive — 2026-10-25

Code đã triển khai và kiểm thử bằng mock Drive + PostgreSQL thật trong schema test riêng. **Drive thật đã list được root 3DSMOOD, 126 thư mục, 845 mục và 360 model; JPG và RAR thật tải thành công.** Initial sync chưa publish: sau 93 preview đã cache, Google trả HTML 403 báo mạng gửi automated queries. Không bypass; giữ snapshot và chờ lần sync theo lịch. Không có dữ liệu demo trong catalog thật. Mục tiêu vận hành còn mở cho đến khi có snapshot thành công đầy đủ.

## 1. Source files trong phạm vi thay đổi

- Backend mới: `apps/store-api/src/drive/{config,provider,pairing,preview-cache,repository,sync}.js` và các `.test.js`; `src/catalog-runtime.js`, `src/catalog-runtime.test.js`, `src/download-stream.js`, `src/download-stream.test.js`; `scripts/check-drive.js`, `scripts/sync-drive.js`.
- Backend tích hợp: `src/server.js`, `src/server.test.js`, `src/catalog.js`, `src/catalog.test.js`, `src/assets.js`, `src/assets.test.js`, `package.json`, `package-lock.json`, `.env.example`; `.env` chỉ trên máy và được gitignore.
- Frontend mới: `catalog-refresh.js`, `catalog-refresh.test.js`, `catalog-view.js`, `useCatalog.js`, `useCatalog.test.jsx`, `bridge-progress.test.js`, `e2e/catalog.spec.js`.
- Frontend tích hợp: `App.jsx`, `components.jsx`, `api.js`, `queue.js`, `Queue.jsx`, `integrations/3dsmax/bridge.js`; bổ sung catalog-version fixture cho `license-ui.test.jsx` và `e2e/payment.spec.js`.
- Native: `ArchivePackage.cs`, `MaxWebViewForm.cs`, `.csproj`, `packages.config`, `ThirdPartyNotices.txt`, archive tests/fixtures/test runner; `run-webview-tests.ps1` bổ sung source extractor và reference; `maxscript/PlatformBridge.ms` thêm kiểm tra bảo vệ script; `MergeWorkflowTests.ms` là kiểm thử batch riêng.
- Packaging/docs: `installer/build-installer.ps1` kèm attribution; `README.md`, `apps/README.md`, `docs/STATUS.md`, hướng dẫn và báo cáo này.

Worktree đã có nhiều thay đổi license/payOS trước khi bắt đầu; báo cáo này không coi toàn bộ `git diff HEAD` là thay đổi catalog. Không commit, push, chạy installer hoặc deploy production.

## 2. Database

Migration `008_drive_catalog.sql` đã có trong `schema_migrations` của database phát triển. Xác nhận đủ bảng `catalog_sources`, `catalog_sync_runs`, `catalog_folders`, `catalog_models`. Chạy lại migrator trả `Applied migrations: none`, chứng minh migration đã được đánh dấu áp dụng. Integration tests tạo schema ngẫu nhiên trong database test riêng rồi dọn schema; không reset public hoặc dữ liệu tài khoản/license/payment.

## 3–5. Provider, môi trường và folder

Abstraction `CatalogProvider`, `GoogleDriveCatalogProvider` dùng SDK chính thức `googleapis` v188 và `LocalCatalogProvider` chỉ khi đặt rõ `local`. `.env`/`.env.example` có các biến Drive yêu cầu, interval 30 phút, cache directory; payOS variables được giữ nguyên. API key được người dùng cung cấp và lưu vào `.env`, không có trong source/build frontend/plugin. `.env` được xác nhận ignored và không tracked.

Folder cấu hình: `1qQgoy1yLQuaO9S-yT_ZT7nai6EAA4OwA`. API thật xác nhận tên root là **3DSMOOD**, gồm 126 thư mục, 845 mục và 360 model. Đây là kết quả API, không phải suy đoán từ URL.

## 6. API

Thêm `GET /api/catalog/version`, `GET /api/catalog/status`, `GET /api/catalog/models/:id/preview`, `POST /api/admin/catalog/sync`. Giữ các API categories/products/detail/import-ticket/download stream. Metadata public không chứa Drive IDs, key hoặc URL tải nguồn; tải model dựa trên mapping ID nội bộ ở backend.

## 7. Preview

Sync tải preview, kiểm tra MIME/byte/pixel/checksum/decoder, tạo WebP và lưu atomic bằng adapter storage. Cache reuse khi metadata không đổi. API chỉ đọc cache, versioned URL + ETag; ảnh bị xóa được bỏ reference sau successful scan, URL cũ trả 404. Orphan cleanup có grace period. Automated tests xác nhận ảnh thật tạo bằng Sharp, đọc lại cache WebP, byte/pixel/MIME/corrupt/checksum rejection và preview deletion qua HTTP.

## 8. Download security

Giữ JWT HttpOnly, proof thiết bị, Lifetime ACTIVE và hai slot cố định. Ticket tối đa 5 phút gắn auth/license/device, dùng atomic một lần và revalidate khi redeem. Invalid/expired/revoked/device-mismatched session không fetch archive. Backend stream từ Drive có backpressure, timeout, cancellation, concurrency cap và kiểm tra số byte; không giữ archive. Có kiểm thử stream 32 MiB, disconnect, admission limit, timeout, duplicate redemption và model bị gỡ trước download. Không công bố resume/Range; `Accept-Ranges: none`.

## 9. Sync worker

Startup async + lịch 30 phút + manual admin. Promise trong instance và PostgreSQL advisory lock giữa instances. Chỉ transaction publish/reconcile deletion sau complete tree/pagination + cache preparation; lỗi 403/429/timeout/partial scan không xóa snapshot. Version chỉ tăng khi nội dung đổi. Có số liệu additions/updates/removals/previews/duration và code lỗi an toàn. `lastAttempt` gồm duration/error của lần thất bại; startup tôn trọng retry interval đã lưu để restart không dồn request khi Google đang chặn.

## 10. React refresh

Poll 120 giây, refresh focus/foreground, abort và cleanup khi unmount. Giữ snapshot cũ nếu refresh lỗi, kiểm tra version giữa các page, giữ login/license/selection còn tồn tại/queue. “Đã tải” giữ snapshot của job đã hoàn tất dù Online xóa model; không đụng scene Max. Renderer filters chỉ hiện metadata thực tế. Preview thiếu dùng placeholder, không suy đoán renderer.

## 11–13. Kết quả kiểm thử/build

| Kiểm chứng | Kết quả |
| --- | --- |
| Backend toàn bộ suite với database test riêng | **113 passed, 0 failed, 0 skipped** |
| Coverage module backend Drive/catalog runtime/stream | **98.91% lines, 84.35% branches, 86.51% functions** |
| Frontend unit/React tests | **31 passed** sau bổ sung regression status/recovery |
| Coverage catalog refresh/view/hook | **100% lines, 92.59% branches, 95.65% functions** |
| Playwright Chromium E2E | **5 passed**, gồm catalog foreground refresh và giữ local history/login |
| Frontend production build | **PASS**, Vite build |
| C# net48 Release | **PASS**, `bin/Release/MaxWebViewHost.dll`, dependency DLLs + notices |
| Native security/CNG proof | **28 passed** + Node cryptographic interoperability |
| Actual WebView2 transport | **11 passed** |
| ZIP/RAR/7z archive security | **15 passed**, gồm malformed ZIP local-header/manifest bypass |
| Backend startup/API smoke | **PASS**: health, version/status, empty products/categories; source error được báo riêng; UI với backend thật không có console warnings/errors |
| Real 3ds Max2022 merge | **PASS** trong process riêng: tạo fixture MAX, merge một object, và mô phỏng guard false để xác nhận không mutate scene; không thay scene của process người dùng |
| CodeGraph | Không có `.codegraph/`; bỏ qua, không tự index theo chỉ dẫn repo |

Các tỷ lệ coverage trên là phạm vi module được nêu ở lần đo cuối, không phải tuyên bố coverage toàn bộ codebase. E2E dùng mocked API/host. Runtime merge dùng file MAX fixture riêng; chưa phải import archive thương mại từ catalog đã publish.

Runtime Max2022 xác nhận bốn SSSE Current flags đều true. API `IsSafeScriptAssetExecutionEnabled()` không có trong phiên bản này; [Autodesk bổ sung bảo vệ script file assets ở Max2023](https://help.autodesk.com/cloudhelp/2023/ENU/3DSMax-What-s-New/files/GUID-F5D297BB-5141-4395-9FFE-3CAD86204D64.htm). Guard giữ tương thích riêng build family 24000–24999, vẫn yêu cầu đủ bốn cờ. Bản mới thiếu API hoặc flag false đều fail closed. Không tự sửa thiết lập bảo mật. Log fixture: `storage/drive-merge-runtime-result.txt` ghi `PASS protected merge and fail-closed security guard`.

Review độc lập đã tìm và xác nhận sửa: mapping ID nội bộ/Drive, texture retention khi mất reply merge, ZIP local-header bypass, và phân loại lỗi streaming Gaxios. Không còn lỗi HIGH/CRITICAL đã được reviewer xác minh trong các đường code được review.

## 14. Drive thật

Sau khi chủ sở hữu bật API và sửa key restrictions, đã gọi Drive API v3 bằng key thật:

- Listing metadata cây thật: **PASS**, root 3DSMOOD/126 folders/845 files/360 models.
- Download một JPG thật: **PASS**, validate decoder/MIME và cache WebP.
- Download một ZIP/RAR thật: **PASS**, RAR **133.270 bytes**, streamed tới discard sink, không giữ archive.
- Initial PostgreSQL snapshot từ Drive thật và preview hiển thị trong frontend thật: **chưa đạt**.

Initial sync cache được **93 preview**, rồi metadata của `1825135.5ac4fd837e20b.jpg` vẫn báo `capabilities.canDownload=true` nhưng tải content trả Google HTML 403: mạng có thể gửi automated queries. Phân loại mới là `DRIVE_AUTOMATED_REQUESTS_BLOCKED`; không retry nhanh, không đổi endpoint/IP/key để lách chặn và không publish catalog dở dang. Các lần sync trước khi có phân loại mới ghi `DRIVE_PERMISSION_DENIED`; bản ghi lịch sử giữ nguyên. Cần chờ Google bỏ chặn/kiểm tra hạn mức theo phương thức hỗ trợ rồi để sync hoàn tất.

## 15. Việc còn lại để vận hành

1. API/key restrictions đã được chủ sở hữu sửa và kiểm chứng bằng SDK. Key từng được gửi vào chat cần được chủ sở hữu thay và giới hạn trước production; không dùng đổi key để vượt chặn hiện tại.
2. Chờ Google bỏ chặn automated queries hoặc xử lý hạn mức qua kênh Google hỗ trợ; hoàn tất initial sync và kiểm tra frontend preview/licensed download trên snapshot thật. `npm run sync:drive` dùng cùng worker/lock/snapshot, nhưng không nên bấm lặp khi Google đang chặn.
3. `MergeWorkflowTests.ms` đã PASS trong Max2022 riêng. Sau khi catalog publish, kiểm thử download/import model thật vào scene thử riêng; không thay cảnh người dùng đang làm.
4. Production cần DATABASE_URL/role, secret JWT/license bền vững, API key backend-only, HTTPS/reverse proxy/origins, persistent shared preview volume hoặc object storage. Đảm bảo deploy toàn bộ DLL dependencies/notices và MAXScript mới; không chỉ DLL chính.
5. Không thay PayOS environment/payment flow hay thực hiện giao dịch, commit/push/deploy trong tác vụ này.

Chi tiết lệnh/cấu hình: [google-drive-catalog.md](google-drive-catalog.md).
