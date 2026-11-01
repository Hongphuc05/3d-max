# STATUS v3 — đã làm tới đâu từ lúc bắt đầu kế hoạch v3

> Cập nhật lần cuối: **2026-11-01** · nhánh `v3/p2-sync-worker` · có kiểm chứng đến P3.1 (backend + giao diện).
> Plan: [`v3-implementation-plan.md`](v3-implementation-plan.md) · Nhật ký chi tiết từng bước: [`STATUS.md`](STATUS.md), mục "Nhật ký P2".
> **File này chỉ ghi trạng thái còn hiệu lực với code hiện tại.** Các kết quả đã bị thay thế (route/tên trường cũ, số test cũ, lần chạy hỏng giữa chừng, nhận định đã rút lại) không có ở đây; muốn xem lịch sử thì đọc `STATUS.md`.

Chú giải: `[x]` xong và đã kiểm tra · `[~]` xong một phần / chưa kiểm tra đủ · `[ ]` chưa làm.

**Tổng quan:** `npm test` trong `apps/store-api` → **374/374 pass** (baseline trước v3 là 194), chạy trên PostgreSQL 16 thật, mỗi file test dùng database cô lập.

---

## P0 — Chốt kế hoạch (2026-10-29)
- [x] Audit repo, kiến trúc, ERD, hợp đồng API, plan từng phase; chủ dự án chốt Q1–Q8. *(ghi nhận từ `STATUS.md`, không phải phần tôi làm lại trong phiên này)*

## P1 — Kết nối Drive bằng OAuth (2026-10-29)
- [x] Code OAuth + client Drive + API admin + `drive-probe`, 194/194 test lúc đó. *(chi tiết ở `STATUS.md`; mã OAuth được giữ lại, không dùng trong luồng quét chính vì D26)*
- [ ] **Chưa chạy với Google OAuth thật**, chưa chốt Q4.

## P2 — Worker đồng bộ Drive và catalog v3 (2026-10-30 → 2026-11-01)

Quét bằng **API key** (D26), không OAuth. Đã chạy trên Drive thật, DB `store_p2`.

- [x] **Schema.** Migration 015 (hàng đợi job, mục job, inventory), 016 (danh mục, model, file model, preview, mục cần duyệt, `catalog_state`), 018 (chỉ `audit_events`), 019 (nguồn quét bằng API key), 020 (preview dùng chung file) + rollback từ chối khi đã có dữ liệu. 017 thuộc P4/P5 nên chưa tạo.
- [x] **Seed catalog cũ.** 79 danh mục, 360 model vào `store_p2`, khớp theo `drive_file_id`.
- [x] **Hàng đợi job trong PostgreSQL.** `FOR UPDATE SKIP LOCKED`, lease + heartbeat, chống ghi chồng khi mất lease, giới hạn thử lại 5 lần, nhả job êm khi nhận SIGINT/SIGTERM.
- [x] **Quét Drive.** Duyệt theo chiều rộng, lưu checkpoint theo từng trang; thật: 126 thư mục, 720 file, 0 lỗi.
- [x] **Ghép cặp ảnh và file nén, so sánh với DB.** Không đoán theo vị trí; trường hợp mơ hồ chuyển vào mục cần duyệt; chỉ đổi tên khi tên file nén thật sự đổi và admin chưa sửa tay.
- [x] **Tải preview.** Tên file = mã băm nội dung (`<sha256>.webp`), hai cỡ 480 và 1400, kiểm byte đầu và giới hạn pixel, ghi `.part` rồi đổi tên nguyên tử, kiểm dung lượng đĩa; thật: 720 file khớp 720 dòng DB, `tmp` rỗng.
- [x] **Công bố catalog.** Một transaction; version chỉ tăng khi checksum manifest công khai đổi; phát `pg_notify`.
- [x] **API catalog công khai** `/api/v1` (`catalog/version`, `categories`, `catalog`, `previews/manifest`, `catalog/events`) và `/previews/<sha256>.webp`: ETag + 304, SSE có trần tổng và trần theo IP. Thật: 79 danh mục, 360 model, 720 preview, ảnh `image/webp` + `nosniff` + `immutable`, đường dẫn lạ trả 404.
- [x] **Điểm vào worker** `src/worker.js` và CLI `npm run sync:drive`, `npm run seed:legacy`.
- [x] **Chịu giới hạn của Google khi tải ảnh.** Trang chặn HTTP 403 dạng HTML được hiểu là giới hạn tốc độ; worker nghỉ rồi thử lại **đúng ảnh đó**, không ghi lỗi oan. Cấu hình: `PREVIEW_DELAY_MS` (1500), `PREVIEW_CONCURRENCY` (1), `PREVIEW_COOLDOWN_MS` (600000).
- [x] **Nghiệm thu P2.8 trên Drive thật.**
  - Job FULL: `COMPLETED`, 0 lỗi, catalog version 1.
  - Chạy lại lần 2: `new=0, updated=0, unchanged=360, review=2`, `bytes_downloaded=0`, version và checksum giữ nguyên.
  - Dừng bằng Ctrl+C rồi chạy lại: tiếp tục đến đủ 360.
- [x] **Thử phá biện pháp an toàn.** Sửa 3 phát hiện của review (đếm byte, log worker, trần SSE theo IP): 7/7 mutant bị bắt.
- [ ] **Chưa đo RAM của worker suốt cả job** (tiêu chí plan: dưới 400 MB); chỉ có đỉnh khoảng 94 MB ở giai đoạn quét.
- [ ] **Chưa thử dừng đột ngột (kill cứng) trên Drive thật**, mới thử dừng êm; nhận lại job hết lease chỉ kiểm bằng Drive giả.
- [ ] **Test không ổn định:** `disk guard` trong `worker/previews.test.js` fail 1 lần trong cả bộ (373/374), không tái hiện ở 7 lần chạy lại; nguyên nhân chưa rõ, cần điều tra nếu tái diễn.
- [ ] Nợ kỹ thuật P2-1 … P2-8 và 4 quyết định thiết kế chờ chủ dự án duyệt: xem `STATUS.md`.

## P3 — Web Admin (bắt đầu 2026-11-01)

- [x] **API lượt đồng bộ cho admin (phần backend của P3.2/P3.3), khớp plan §2.2.** `POST /sync-jobs` (202 `{jobId}`, 409 khi đang chạy), `GET /sync-jobs` (phân trang `{items,nextCursor}`), `GET /sync-jobs/:id`, `GET /sync-jobs/:id/items?status=FAILED` (tên + đường dẫn, không Drive ID), `POST /sync-jobs/:id/cancel` (202), `POST /sync-jobs/:id/retry` (202 `{jobId}`), `GET /sync-jobs/:id/events` (SSE `progress`/`done`). Hình dạng `Job` được khóa bằng test (so khớp danh sách khóa chính xác). Guard: chưa đăng nhập 401, người dùng thường 403, không ghi gì vào DB.
  - 9 test trên PostgreSQL thật; thử phá **14/14** mutant bị bắt (lộ Drive ID, lộ checkpoint, lặp trang, bỏ trần SSE, hủy job đã xong, nguồn bị tắt ở POST và retry, retry đổi mode, tên trường sai, thêm trường ngoài plan).
- [x] **P3.1 Kết nối Drive — phần backend, theo API key (chốt với chủ dự án: khóa chỉ ở `.env`).** `GET /drive/status` → `{configured, missingConfig, connection:null, sources}` (thiếu khóa chỉ báo TÊN biến `DRIVE_API_KEY`); `POST /drive/sources` → 201 `{id,rootFolderName,sourceType}`, idempotent, nhận resource key từ body hoặc URL; `POST /drive/test-access` kiểm liệt kê + tải thử bằng khóa. Khóa không nằm trong request/response/DB; thiếu khóa thì không gọi Google. 10 test trên PostgreSQL thật + Drive giả; thử phá **10/10** bắt được. Đã sửa luôn lỗi có từ P1: `sourceId` sai định dạng trả 500, nay 400.
- [x] **Giao diện P3.1 trong `apps/store-web`** (mục "Kết nối Drive" của admin, route `/admin`): trạng thái khóa (không nhập/không hiển thị khóa), form thư mục gốc, bảng nguồn, "Kiểm tra truy cập" hiện từng mục. 9 test jsdom + 1 test route; thử phá **18/18** đột biến bị bắt; `vite build` ok; **store-web 144/144 pass**. Đã mở trên trình duyệt thật (chủ dự án): màn hiển thị đúng; "Kiểm tra truy cập" lộ lỗi tìm file mẫu một cấp, đã sửa ba lần; lần 3 lấy file mẫu từ `drive_inventory` (kiểm trên dữ liệu thật: tải 100 byte JPEG thành công), **đã kiểm chứng trên giao diện thật: cả hai mục "Đạt"**; đã thử trên trình duyệt thật cả 4 trường hợp (ô trống, nhập sai, dán lại link gốc không tạo trùng, thiếu khóa) — đều đạt. **P3.1 xong.** Đã kiểm tab Network: phản hồi `status` không chứa khóa API và không chứa ID thư mục Drive.. Chưa chạy Playwright e2e.
- [ ] P3.1 chưa thử với Google thật qua endpoint admin (mới chạy với Drive giả).
- [~] **P3.2 giao diện "Quét đồng bộ" (`AdminSync.jsx`)**: nút quét FULL/INCREMENTAL khóa khi đang chạy, tiến độ SSE, thanh không xác định, Hủy, Thử lại, SSE lỗi thì polling 3 giây. 15 test jsdom + thử phá **22/22**; web **144/144**; build ok. **Đã chạy thật qua giao diện: chờ → Hủy → Thử lại → chạy → Hoàn tất (126/720, Không đổi 360, Cần duyệt 2, Lỗi 0, 0 MB).** Hủy khi đang chạy đã kiểm trên trình duyệt thật (Đang hủy → Đã hủy, dừng sau 15 giây). F5 giữa chừng đã kiểm trên trình duyệt thật (gắn lại đúng job, không tạo job mới); thanh chuyển động trượt đã được chủ dự án quan sát trực tiếp (và khớp ba ảnh ở ba vị trí). SSE thật đã kiểm trong tab Network (5,8 kB trong 24 giây, nhiều tin liên tục; đã loại trừ polling bằng bộ lọc `sync-jobs` (chỉ có POST và `events`, không có yêu cầu `sync-jobs/<mã>` lặp lại)). Chưa kiểm: thử lại sau FAILED (chỉ có test tự động). **P3.2 xong về chức năng.** INCREMENTAL: worker chưa hỗ trợ (luôn quét đầy đủ); giao diện đã ghi chú rõ, cài đặt thật là việc còn mở.**
- [~] **P3.3 giao diện (`AdminSyncHistory.jsx`, cùng trang "Quét đồng bộ")**: bảng lịch sử các lượt có phân trang "Xem thêm", "Xem lỗi" mở danh sách file lỗi (tên + đường dẫn, không ID), tự tải lại khi lượt kết thúc. 14 test jsdom; thử phá **21/21**; web **110/110**; build ok. **Đã mở trên trình duyệt thật với dữ liệu thật: các dòng khớp thao tác trong ngày (kể cả lượt hủy khi chờ hiện giờ kết thúc và lần tải đầu 48,4 MB).** Tự tải lại khi lượt kết thúc (không F5) đã kiểm trên trình duyệt thật. "Xem thêm" đã kiểm trên dữ liệu thật (11 lượt: nối đúng dòng cũ nhất, nút biến mất). Chưa kiểm bằng mắt (chỉ test tự động): "Xem lỗi" (chưa có lượt nào lỗi). **P3.3 xong về chức năng.** (`apps/store-web`): chưa làm.
- [~] **P3.4 Cần duyệt (code xong, đã kiểm trên trình duyệt thật với dữ liệu thật).** Chủ dự án đã duyệt 4 quyết định: Chấp nhận ghép gợi ý = xử lý + duyệt model đang chờ; Bỏ qua = không đụng model; Xác nhận remap = gộp vào model cũ (giữ ID/giá/tên, xóa model mới trùng); các loại khác chỉ "Đã xem" (ghép tay + chọn ảnh chính để phase sau, `choice` bị từ chối). API `GET/POST /api/admin/catalog/review` (khóa dòng chống hai admin cùng xử lý; mã lỗi mới `REVIEW_NOT_FOUND`, `REVIEW_ALREADY_RESOLVED`, `REVIEW_NOT_APPLICABLE`) và giao diện mục "Cần duyệt" (nhóm theo loại, bước xác nhận khi gộp). Test: API **416/416**, web **144/144**; đột biến API 33/35, giao diện 25/26 (còn lại là tương đương). **Đã kiểm trên trình duyệt thật với 2 mục thật** (hiển thị đúng; Chấp nhận → RESOLVED, Bỏ qua → DISMISSED, nhật ký đúng, phiên bản catalog không đổi). Hai mục **không mở lại** sau một lượt Quét đồng bộ thật (`OPEN=0`, không mục trùng) và **giá model đã sửa tay không bị ghi đè** (đã kiểm trên dữ liệu thật). **Chưa kiểm chứng:** gộp remap và Chấp nhận trên model chờ duyệt thật (chỉ có dữ liệu giả); còn thiếu ghép tay và chọn ảnh chính (phase sau). Bộ đếm "Cần duyệt" của khung tiến độ đã được sửa thành số mục **đang chờ** (giảm khi admin duyệt); chỉ có hiệu lực từ lượt quét chạy sau khi khởi động lại worker.
- [ ] P3.5 Thiết bị và quyền, P3.6 Đơn hàng: chưa làm (phụ thuộc P4, P5).
- [~] **P3.7 Cài đặt + bảng model (code xong, đã kiểm phần lớn trên trình duyệt thật).** Migration 017 chỉ `app_settings` (lệch plan có chủ đích đã duyệt: 6 bảng còn lại của 017 đi migration sau, số ≥ 021), bắt đầu rỗng; API `GET/PUT /api/admin/settings`, `GET /api/admin/models`, `PATCH /api/admin/models/:id` (audit không chép thông tin ngân hàng, tăng phiên bản catalog khi đổi dữ liệu công khai, cờ `name_overridden`/`price_overridden` chỉ bật khi giá trị thật sự đổi); worker đọc giá mặc định từ `app_settings` lúc công bố (chưa có thì dùng biến môi trường; lỗi DB khác thì job FAILED, không công bố giá sai). Giao diện mục "Cài đặt" (form + bảng model). Test: API **413/413**, web **134/134**; đột biến migration 12/12, router 30/31, worker 6/6, giao diện 37/39 (còn lại là tương đương). **Đã kiểm trên trình duyệt thật với dữ liệu thật:** migration 017 áp vào `store_p2`; form cài đặt (lưu thành công, nhật ký không chứa thông tin ngân hàng); bảng model (360 kết quả/18 trang, tìm, `%` là chữ thường); sửa giá một model (cờ `price_overridden`, catalogVersion 1→2, nhật ký đúng). Quét đồng bộ sau khi sửa giá: **giá không bị ghi đè** (đã kiểm trên dữ liệu thật). **Chưa kiểm:** ẩn model qua giao diện, màn hình hẹp. **Nhận xét giao diện chưa sửa:** ô tìm/lọc xếp dọc.
- [ ] API admin P3 **chưa chạy trên server thật với token admin thật**; mới chạy qua test với xác thực giả cộng `requireAdmin` thật.
- [ ] Mã lỗi `JOB_NOT_FOUND` (422) là mã tôi thêm, plan không nêu; chờ chủ dự án xác nhận.

## P4 – P7
- [~] **P4.1 API thiết bị/quyền (code xong, chưa thử với plugin hoặc server thật).** Migration 021 (`devices`, `device_auth_challenges`, `device_tokens`, `entitlements`, `purchase_orders`, `purchase_order_items`; tên lệch plan vì trùng bảng cũ, đã duyệt), `POST /api/v1/device/challenge`, `POST /api/v1/device/verify` (đăng ký bằng chữ ký RSA, token 15 phút, nhận MXL1), `GET /api/v1/me/entitlements`, middleware `requireDevice`. Thiết bị chỉ đăng ký sau khi ký đúng (lệch plan có chủ đích). 4 mã lỗi mới 403. Test: API **445/445**; đột biến 38/42 (4 tương đương). **Rủi ro biết trước:** `machine_code` là nhãn do máy khách khai nên token MXL1 của người khác có thể bị dùng lại nếu biết mã máy; plan chấp nhận. **Chưa:** áp 021 vào `store_p2`, khóa MXL1 thật (đang dùng khóa test), thử với plugin thật.
- [~] **P4.2 backend tải model (code xong, chưa thử với Google thật hoặc plugin).** Migration 022 (phiên + nhật ký tải; số lệch plan vì 018 đã dùng), provider link công khai kiểm từng bước (allowlist host, form xác nhận file lớn, chặn trang HTML), cache đĩa VPS (tải đủ + kiểm size/md5/sha256 rồi mới phát, chống tải trùng, LRU, kiểm dung lượng trống), `POST /api/v1/models/:id/import-session` + `GET /api/v1/model-downloads/:sessionId` (phiên dùng một lần 5 phút, kiểm lại quyền lúc mở, 10 phiên/giờ/thiết bị, 3 luồng đồng thời, nhật ký). API **504/504**; đột biến: migration 16/16, public-link 22/22, cache 26/28, route 33/37 (còn lại tương đương). **Chưa:** tải thử link công khai thật (cần 360 file "Anyone with the link" — chủ dự án xác nhận), áp 022 vào `store_p2`, plugin C# + UI-1 (cần Windows + Max 2022), bộ đếm giới hạn là theo tiến trình.
- [~] **P4.3 plugin native + P4.4 giao diện (code xong và đã build, CHƯA chạy trong 3ds Max thật).** Plugin C# build thật `Release x64` thành công; 12 bộ test native xanh; web 165/165. Gồm: phiên thiết bị (ký thách thức `3DM-DEVICE-V2`), cache catalog nguyên khối, cache preview + seed cài đặt + tải nền 4 luồng, bộ theo dõi cập nhật (poll 5 phút + SSE), tải model qua backend, UI chỉ đọc dữ liệu cục bộ đã kiểm (endpoint thiết bị/tải bị chặn với JS), đọc license MXL1 cũ và gửi lên server (giữ nguyên file), `asset.import {modelId}`, `build-installer.ps1 -ApiBaseUrl` kéo seed (build thất bại nếu thiếu ảnh), giao diện UI-1 trên dữ liệu v3 (nút theo quyền, tab Đã tải, tự làm mới giữ bộ lọc, thiết bị thay tài khoản). **Chưa kiểm chứng (P4.5 — cần Max 2022 thật):** WebView2 + `PackagedAppRuntime` trả `/api/v1` & `/previews` từ cache, mở lại khi mất mạng, merge model vào scene, thiếu quyền báo rõ, grep `%LOCALAPPDATA%\3dMood` không có Drive ID; chạy `build-installer.ps1 -ApiBaseUrl` đầy đủ; Google thật cho đường tải; áp migration 021/022 vào `store_p2`. **Nợ biết trước:** 3 bộ test native cũ hỏng sẵn (`packaged-runtime`, `archive`, `import-pipeline`); nút Mua chờ P5; chế độ offline cũ (`assetId` + license thủ công) và cookie-session cũ vẫn còn trong mã, dọn ở P7.
- [ ] P5–P7: chưa làm.

---

## Việc còn mở cần chủ dự án quyết định hoặc làm
- [ ] Duyệt 4 quyết định thiết kế ở P2.5 (mô hình mồ côi, đổi ánh xạ → cần duyệt, file ở gốc → "Uncategorized", đồng bộ danh mục) và chỗ lệch ở migration 018.
- [ ] **Tạo lại API key Drive** (khóa cũ từng bị lộ).
- [ ] Xác nhận nhánh làm P3: plan ghi `v3/p1-drive-oauth`, P2 đã tách `v3/p2-sync-worker` theo yêu cầu; hiện P3 làm tiếp trên nhánh P2.
- [ ] **INCREMENTAL ở worker:** hiện luôn quét đầy đủ (không đọc `job.mode`); cần thiết kế và chủ dự án duyệt trước khi làm.
- [ ] Nguyên nhân Google chặn tải ảnh **chưa xác nhận** (chỉ có báo cáo cộng đồng; quan sát thực tế: tải được khoảng 57–191 ảnh liên tiếp thì bị chặn chừng một giờ rồi tự gỡ).

## Lưu ý vận hành đã gặp
- `.env` mặc định trỏ database `store`; dữ liệu P2 ở `store_p2`. Terminal mới mà không đặt `DATABASE_URL` sẽ gặp lỗi Postgres `42P01` (không có bảng).
- `npm run sync:drive` chỉ **xếp job vào hàng đợi**; phải chạy `node --env-file-if-exists=.env src/worker.js` để xử lý.

## Quy trình đang áp dụng
Mỗi bước: ghi log vào `STATUS.md` → viết test (PostgreSQL thật) → thử phá bằng đột biến → chạy cả bộ `npm test` → commit **local**. Không push, không tạo PR, không commit secret.
