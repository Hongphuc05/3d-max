# Phase 4 — việc chưa kiểm chứng, lỗi đã gặp, trạng thái dữ liệu thử

Ghi lúc kết thúc phiên test P4.5 trên 3ds Max 2022 thật (01–02/11/2026). Đọc cùng `docs/STATUS.md` (dòng "P4.5") và
`docs/STATUS-v3.md`. Mục tiêu: phiên sau biết **chính xác** cái gì đã được thấy tận mắt, cái gì chỉ có test tự động, cái gì còn mở.

## 1. Đã kiểm trên máy thật (có bằng chứng: ảnh chụp hoặc kết quả truy vấn của chủ dự án)

| # | Nội dung | Bằng chứng |
|---|---|---|
| 1 | Cài `PlatformSetup-Test.exe` (48 MB, seed 720 ảnh), mở panel: 360 model, ảnh đủ, `ONLINE`, không còn màn đăng nhập/license | ảnh panel |
| 2 | Thiết bị tự đăng ký: 1 dòng `devices` (key_protection `TPM`, ACTIVE) + `DEVICE_REGISTERED` | truy vấn DB |
| 3 | Chưa có quyền → mọi thẻ "Mua · giá"; bấm Mua → banner "Thanh toán đang được hoàn thiện" | ảnh |
| 4 | Cấp quyền bằng SQL + Làm mới → "Download", tab "Đã tải (n)" | ảnh |
| 5 | Download `19113 wall lamp` → import vào scene Max (chủ dự án xác nhận); phiên `COMPLETED`, `bytes_sent=268917`, sha256 được lưu | truy vấn DB + xác nhận |
| 6 | Thu hồi quyền khi UI còn hiện Download → bấm tải bị từ chối "Thiết bị này chưa có quyền tải model này"; số phiên giữ nguyên 3 | thông báo + `count(*)=3` |
| 7 | Offline (tắt API): 360 model và ảnh vẫn đủ, banner "Đang offline…", nút "Cần Internet để xác minh quyền"; bật lại API thì banner tự biến mất | ảnh + xác nhận |
| 8 | Đổi tên model ở admin web → tên mới tự hiện trong lưới Max (`629606.57d330d35fee0` → `…-test`) | xác nhận |

## 2. CHƯA kiểm chứng được — cần làm ở phiên sau

### 2.1 Không lộ Drive ID (bước 12) — chưa có bằng chứng đầy đủ
- Quét `%LOCALAPPDATA%\3dMood` và `%LOCALAPPDATA%\MaxWebViewHost` bằng `Select-String` **không báo gì cho file đọc được**, nhưng các file của cache WebView2 **đang bị Max khóa nên không đọc được**:
  `...\MaxWebViewHost\WebView2UserData\EBWebView\lockfile`, `...\Default\Cache\Cache_Data\data_0..data_3`, `...\Cache_Data\index`, `...\Default\DawnGraphiteCache\data_0` (và có thể thêm).
- Ban đầu kết quả chỉ in dòng "33 ký tự" nên tôi từng ghi nhận nhầm là đạt; đã sửa trong STATUS.
- **Làm lại:** đóng hẳn 3ds Max (kiểm Task Manager không còn `3dsmax.exe`), rồi:
  ```powershell
  $id = docker exec -i 3d-max-postgres-1 psql -U store -d store_p2 -At -c "select f.drive_file_id from models m join model_files f on f.id=m.primary_file_id where m.name like '19113 wall lamp%';"
  $files = Get-ChildItem "$env:LOCALAPPDATA\3dMood","$env:LOCALAPPDATA\MaxWebViewHost" -Recurse -File -ErrorAction SilentlyContinue
  $unreadable = 0
  $hits = foreach ($f in $files) { try { if (Select-String -LiteralPath $f.FullName -SimpleMatch $id -List -ErrorAction Stop) { $f.FullName } } catch { $unreadable++ } }
  "scanned $($files.Count) files, unreadable $unreadable, hits: $(@($hits).Count)"; $hits
  ```
  Kết quả đạt = `unreadable 0` và không có hit. Tìm thêm cả Drive ID của `80891x Muro Lightstar` (`1WCDp9cXC7ASuvRLvUGKowKL1Sge-IRMc`, copy từ DB để chắc chắn đúng ký tự).
- Suy luận (chưa đo): web chỉ nhận JSON không có Drive ID; native không gửi ID cho web; `V3Routes` chặn mọi endpoint khác.

### 2.2 License MXL1 cũ → ALL_MODELS
- Chưa thử trên máy thật. Cần: `LICENSE_PUBLIC_KEY_B64` (base64 của khóa công khai XML RSAKeyValue) trong môi trường API, và `%LOCALAPPDATA%\MaxWebViewHost\OfflineLibrary\License\license.txt` hợp lệ cho đúng mã máy.
- Kỳ vọng: khởi động API → mở panel mới → `select scope, source, mxl1_license_id from entitlements;` có `ALL_MODELS | MXL1`; `license.txt` còn nguyên; audit có `MXL1_GRANTED`.
- Rủi ro biết trước (plan chấp nhận): `machine_code` là nhãn do máy khách khai; token MXL1 của người khác + biết mã máy đó có thể xin ALL_MODELS.

### 2.3 Quyền bị thu hồi GIỮA lúc đã có phiên (trước khi bắt đầu tải)
- Chỉ có test tự động (`downloads/routes.test.js`: "entitlement revoked between session and stream"). Test tay bước 6 chỉ phủ trường hợp bị từ chối ngay lúc tạo phiên.
- Cách thử tay (khó): cần chèn phiên rồi xóa quyền trong 5 phút trước khi `GET /api/v1/model-downloads/<id>`.

### 2.4 Tải file lớn qua trang xác nhận "virus scan" của Google
- Mọi test dùng `fetch` giả. Chỉ thử thật với 2 file nhỏ (133 KB, 263 KB) — trường hợp Google trả file trực tiếp.
- Định dạng form xác nhận (`drive.usercontent.google.com/download`, trường `confirm`, `uuid`) **chỉ theo mã C# cũ**, chưa gặp thật. Thử với 1 file ≥ 100 MB và xem log API (lỗi sẽ là `STORAGE_DOWNLOAD_FAILED`, log DB `model_download_logs.error_code`).
- Chưa biết 360 file đều đã bật "Anyone with the link" hay chưa (chỉ 2 file đã thử). Cách kiểm hàng loạt: viết script gọi `public-link.open()` cho từng `drive_file_id` (chưa có).

### 2.5 Build installer với môi trường thật
- Mới chạy `build-installer.ps1 -ApiBaseUrl http://127.0.0.1:4000 -TestBuild` (loopback). Chưa chạy với URL HTTPS thật, chưa ký/phát hành.
- `-TestBuild` ghi `allowLoopbackForTesting` vào `plugin-config.json`; bản phát hành **không** có cờ này (đã có test cấu hình từ chối loopback khi không có cờ).

### 2.6 Bước 11 (tự cập nhật) — thiếu số liệu trên máy thật
- Tên mới có hiện tự động, nhưng **chưa ghi** thời gian từ lúc lưu đến lúc đổi và việc ô tìm / model đang chọn có giữ nguyên trong Max thật hay không (đã có test tự động `plugin-app.test.jsx`).

### 2.7 43 / 360 file nguồn chưa biết định dạng bên trong
- Khi liệt kê bằng `tar` của Windows (bsdtar), 43 file lỗi (có thể do RAR5/7z không hỗ trợ, hoặc tên `...rar.rar`). **Chưa kết luận** là hỏng; SharpCompress trong plugin có thể đọc được.
- Cách kiểm: viết script C# nhỏ dùng `ArchivePackage.Extract` (hoặc chạy import thử từng model nhỏ) để liệt kê. Nguồn: `source\3DSMOOD\**\*.{rar,zip,7z}`.

### 2.8 Phần web chưa có đột biến / chưa có Playwright
- 21 test web mới (`v3-catalog`, `plugin-catalog`, `plugin-app`, `queue`) đều xanh nhưng **chưa chạy thử đột biến**.
- Chưa thử `npm run dev` + `?mockMax=1` bằng mắt; `devMockHost.js` chưa mô phỏng `library.updated`, `library.offline`, `library.previewProgress`.

### 2.9 Không thể kiểm trong phiên này
- Nút **Mua** → hộp thoại QR + đơn hàng + Telegram: P5 chưa làm.
- Tải đồng thời nhiều thiết bị / nhiều tiến trình API: bộ đếm `maxConcurrent` và giới hạn phiên theo giờ là **trong tiến trình**.
- Dung lượng cache đầy (`MODEL_CACHE_MAX_BYTES` nhỏ) trên môi trường thật: chỉ có test tự động.

## 3. Lỗi / hạn chế phát hiện khi test thật

### 3.1 RAR lồng — 3 / 360 model không import được (CHƯA SỬA, chờ quyết định)
- `80891x Muro Lightstar` (và `01H75FPCJ2EPCBJV3TKJEJRG4XO7NHE562`, `173 Cabinet Furniture 04 Minimal Wardrobe Kit P02 Island`): RAR ngoài chứa `max/80891x_Muro_Lightstar2015corona.rar` (một RAR khác, 134 469 byte), bên trong mới có `.max`.
- Hiện tượng: tải + xác minh đúng (`COMPLETED`, 133270 byte), plugin báo **"Gói không có file .fbx/.obj/.max"** (`ASSET_NO_IMPORTABLE_FILE`) vì `ArchivePackage.Extract` chỉ giải nén một lớp.
- Phương án: (a) giải nén lồng một lớp, giới hạn tổng dung lượng/số file/độ sâu, chống zip-slip, có test; (b) đóng gói lại 3 file trên Drive. Chưa chọn.
- Thống kê trên 360 file: 314 có `.fbx/.obj/.max` trực tiếp, 3 lồng, 43 không liệt kê được (mục 2.7).

### 3.2 Độ trễ lần đầu tải một model
- Server tải **đủ** file từ Google, kiểm size/md5/sha256 rồi mới phát. Plugin không nhận byte nào cho tới khi xong, giao diện chỉ thấy "Đang tải…" không có phần trăm. Với file lớn lần đầu có thể rất lâu (tối đa theo timeout 30 phút của `createArchiveSender`).
- Đã giảm nhẹ: tạo phiên kích hoạt tải nền ngay. Chưa đo thời gian thật với file lớn.

### 3.3 Quyền bị giữ bản cũ — ĐÃ SỬA (commit `67e4ea4`)
- Trước: sau khi cấp quyền bằng SQL, bấm Làm mới vẫn dùng quyền từ lúc đăng nhập (tới 15 phút). Sửa: `V3Library.GetEntitlementsAsync` luôn hỏi server, chỉ dùng bản cũ khi mất mạng.

### 3.4 Lỗi môi trường / thao tác đã gặp (không phải lỗi mã, nhưng dễ vấp lại)
| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| API không khởi động, `AUTH_CONFIGURATION_REQUIRED` | `JWT_SECRET` không có trong `.env`, mất khi mở terminal mới | đặt lại mỗi lần: `$b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $env:JWT_SECRET=[Convert]::ToBase64String($b)` (PowerShell 5.1 **không có** `RandomNumberGenerator.GetBytes(int)` tĩnh), hoặc ghi vào `.env` |
| `/admin` ra giao diện cửa hàng cũ + lỗi "Cloudflare R2" | tài khoản `test1@test.com` không phải admin: quyền admin cấp bằng biến **`LICENSE_ADMIN_USER_IDS`** (không phải cột `role`) | `$env:LICENSE_ADMIN_USER_IDS="41f80de7-9b2c-4a4a-b8ea-f42d394223ab"` rồi khởi động lại API, đăng nhập lại |
| `localhost:5173` từ chối kết nối | web admin (Vite) chạy riêng | `cd apps\store-web; npm run dev` |
| `build-installer.ps1` lỗi `Remove-Item ... Access denied` ở `installer\stage` | thư mục `stage` cũ có ACL hạn chế | PowerShell Administrator: `takeown /f ...\stage /r /d y`; `icacls ...\stage /grant "${env:USERNAME}:(OI)(CI)F" /t /c`; xóa; build lại bằng terminal thường |
| script test C# không tìm thấy `csc.exe` | máy dùng Visual Studio 18, script cũ trỏ cứng BuildTools 2022 | đã thêm `plugin-csharp/tests/find-csc.ps1` (vswhere) và đổi 10 script |
| `run-archive` / `run-import-pipeline` lỗi `SharpCompress.dll not found` | thư mục `packages/` chưa restore | `MSBuild MaxWebViewHost.csproj /t:Restore /p:RestorePackagesConfig=true /p:SolutionDir=...\MaxWebViewHost\` (đã chạy trên máy này) |
| `run-packaged-runtime`, `run-webview`, `run-packaged-webview` không biên dịch | danh sách file thiếu `SecureHttpTransport.cs` (có sẵn từ trước) và các file v3 mới | đã bổ sung; cả 3 xanh |
| `.csproj` không thấy file mới (`V3Library` not found) | csproj kiểu cũ liệt kê `<Compile Include>` từng file | đã thêm 8 file mới |
| `Select-String` lỗi "file being used by another process" | cache WebView2 bị Max giữ khóa | xem 2.1 |
| Git cảnh báo `LF will be replaced by CRLF` | `core.autocrlf` | bỏ qua |

### 3.5 Bí mật đã lộ ra log phiên làm việc
- Trong phiên này, một lệnh `grep` trên `apps/store-api/.env` đã in ra màn hình giá trị `DRIVE_API_KEY` (khóa API Drive). File `.env` không bị commit và không có trong kho, nhưng khóa nằm trong log hội thoại. STATUS đã ghi sẵn việc **tạo lại khóa API Drive** (khóa cũ từng lộ); nên làm luôn: tạo khóa mới rồi cập nhật `.env`.

## 4. Trạng thái dữ liệu thử trong `store_p2` (để dọn nếu cần)
- `devices`: 1 dòng (`DESKTOP-UVU9MH0`, TPM). `audit_events`: có `DEVICE_REGISTERED` và các sự kiện admin cũ.
- `entitlements`: **đã xóa hết** ở bước 6 (`delete from entitlements`). Muốn thử lại phải cấp lại bằng SQL (xem hướng dẫn test trong hội thoại / mục 5).
- `model_download_sessions`: 3 dòng `COMPLETED`; `model_download_logs`: 3 dòng.
- `model_files.sha256` đã được học cho `80891x Muro Lightstar` và `19113 wall lamp`.
- `models`: `629606.57d330d35fee0` đã đổi tên về gốc, cờ `name_overridden` đã gỡ về `false`. Model `012 ikea olivblad` vẫn giá 20.000 (đã sửa tay từ trước, cờ `price_overridden` bật).
- `storage\model-cache\`: 2 file `.bin` (Muro, wall lamp). `%LOCALAPPDATA%\3dMood\` (Catalog, Previews 720 ảnh) và `Autodesk\3dsMax\2022 - 64bit\ENU` (820 file plugin) trên máy test.
- `installer\PlatformSetup-Test.exe`, `installer\stage\`, `installer\Setup\payload.zip` là build output (đã có trong `.gitignore`, một số từng bị theo dõi từ trước — đừng commit).

## 5. Lệnh hữu ích để lặp lại bài test
```powershell
# API (terminal A)
cd D:\Project\3d-max\apps\store-api
$env:DATABASE_URL="postgres://store:store@localhost:5432/store_p2"
$b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $env:JWT_SECRET=[Convert]::ToBase64String($b)
$env:LICENSE_ADMIN_USER_IDS="41f80de7-9b2c-4a4a-b8ea-f42d394223ab"   # tùy chọn: để vào /admin
npm run dev

# Cấp quyền một model cho thiết bị mới nhất
docker exec -i 3d-max-postgres-1 psql -U store -d store_p2 -c "insert into entitlements(device_id,scope,model_id,source) select d.id,'MODEL',m.id,'ADMIN' from devices d, models m where m.name like '19113 wall lamp%' order by d.first_seen_at desc limit 1;"
# hoặc cấp tất cả
docker exec -i 3d-max-postgres-1 psql -U store -d store_p2 -c "insert into entitlements(device_id,scope,source) select id,'ALL_MODELS','ADMIN' from devices;"

# Build + cài plugin (đóng Max trước, API đang chạy)
cd D:\Project\3d-max
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -ApiBaseUrl http://127.0.0.1:4000 -TestBuild
```

## 6. Kết quả test tự động tại thời điểm này
- API 504/504, web 165/165 (mã thoát 0).
- Native (`plugin-csharp/tests`): 14 bộ xanh — device-session, catalog-cache, preview-cache, catalog-watcher, model-downloader, v3-routes, device-identity (12), offline-integration (31), target-selection, static-catalog, offline-license, seed, archive (15), import-pipeline (8), packaged-runtime (13), webview (25), packaged-webview (mã thoát 0).
- Đột biến: migration 022 16/16, public-link 22/22, cache 26/28, route tải 33/37, native v3 ~36/51 sau hai lượt (phần còn lại đã phân tích là tương đương hoặc chỉ ảnh hưởng hiệu năng); xem STATUS để biết từng con.
