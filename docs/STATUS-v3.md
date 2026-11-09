# STATUS v3 — đã làm tới đâu từ lúc bắt đầu kế hoạch v3

> Cập nhật lần cuối: **2026-11-05** · nhánh `v3/p2-sync-worker` · P0–P7 đã có phần trong repo; **các thay đổi Drive key slots bên dưới chưa test / chưa nghiệm thu**.
> Plan: [`v3-implementation-plan.md`](v3-implementation-plan.md). **D28.5 (2026-11-04) đã gỡ** `STATUS.md`, `p4-open-issues.md`, `offline-library.md`, `r2-catalog.md`, `license-payos-*` và các tài liệu hướng cũ khác; các tham chiếu tới chúng bên dưới tra bằng `git show d7d24b3:docs/<tên-file>`.
> **File này chỉ ghi trạng thái còn hiệu lực với code hiện tại.** Các kết quả đã bị thay thế (route/tên trường cũ, số test cũ, lần chạy hỏng giữa chừng, nhận định đã rút lại) không có ở đây; muốn xem lịch sử thì đọc `STATUS.md` cũ (xem trên).

Chú giải: `[x]` xong và đã kiểm tra · `[~]` xong một phần / chưa kiểm tra đủ · `[ ]` chưa làm.

**Tổng quan kiểm chứng gần nhất (2026-11-04, sau D28.5):** `npm test` trong `apps/store-api` → **426/426 pass**, `apps/store-web` → **128/128 pass** + `vite build` ok. Diễn tập deploy Docker 30/30 là số của 2026-11-03, **chưa chạy lại** sau D28.5. Có thay đổi Drive key slots ngày 2026-11-05; chưa chạy test/build/deploy cho thay đổi đó.

---

## D30 — MZP, thư mục tải và Import riêng (2026-11-05)

- [x] Build công khai một file `installer/release/out/3dsmood-library.mzp` (v1.1.0), không đóng EXE hoặc bản payload cài thủ công trùng lặp. Web/nginx/workflow release đã đổi sang đường dẫn `.mzp` trong source.
- [x] Installer MZP dùng thư mục user của Max hiện tại, đăng ký macro cho Customize User Interface; runtime theo phiên bản để tránh ghi đè DLL đang được nạp. Khi đã nạp bản khác, yêu cầu khởi động lại Max.
- [x] Settings chọn thư mục lưu model qua hộp thoại native. Thư mục mới áp dụng cho lượt tải sau; model cũ giữ nguyên đường dẫn. Chỉ mục model và quyền gần nhất được bảo vệ bằng DPAPI, tồn tại sau khi mở lại Max.
- [x] Download chỉ tải, kiểm tra và giải nén một lần; bỏ archive sau thành công, giữ model/texture ở vị trí ổn định. Tab Đã tải đọc chỉ mục native; Import chỉ đọc file cục bộ, không tải hoặc giải nén lại. File thiếu không tự tải lại.
- [x] Import offline theo quyền đã xác minh gần nhất; lưu trạng thái từ chối khi đã nhận thu hồi/chặn. Cập nhật quyền chạy riêng, không bắt Import chờ mạng. Giữ kiểm tra đúng scene đích và kiểm tra đường dẫn ở agent.
- [x] Kiểm tra phiên này: web **157/157 pass**; native mới **24 checks pass**; native security **35 checks + Node RSA proof pass**; WebView transport **25 pass**; packaged runtime **13 pass**; packaged WebView browser regression pass. Model downloader, target selection và archive **15 checks** cũng pass. Full build web/net48 và runtime giải nén ZIP/RAR/7z trong staging pass; MZP validator có test thiếu control/traversal/runtime trùng và build guard pass.
- [x] Artifact cuối: **9.30 MiB (9,755,657 bytes)**; SHA256 `7A65318FF6D08285D27E35A828D358D116741C4C09AC50A1314DC0C9F2C51DF7`. ZIP v1.0.0 cũ khoảng 18.54 MiB. Build cuối với dependency đã có sẵn khoảng 6 giây; không coi đây là benchmark trên máy khách.
- [ ] Chưa chạy installer MZP bằng Run Script hoặc nghiệm thu tải/import/texture trên 3ds Max thật của phiên này. Checklist: [`windows-build-and-test.md`](windows-build-and-test.md). Phiên Max đang mở được giữ nguyên.
- [ ] Chưa phát hành artifact mới hoặc deploy website/nginx. Cần cập nhật Content-Disposition trên nginx cùng đường dẫn `.mzp` khi phát hành.
- Giới hạn chuyển đổi: cache GUID của bản cũ không có chỉ mục model UUID nên không tự đưa vào danh sách mới một cách đáng tin cậy. Dữ liệu cũ được giữ nguyên; model tải bằng bản mới được lưu bền vững.

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
- [x] **P3.1 Kết nối Drive — backend nền (hoàn tất 2026-11-04; lúc đó khóa chỉ ở `.env`).** `GET /drive/status` → `{configured, missingConfig, connection:null, sources}` (thiếu khóa chỉ báo TÊN biến `DRIVE_API_KEY`); `POST /drive/sources` → 201 `{id,rootFolderName,sourceType}`, idempotent, nhận resource key từ body hoặc URL; `POST /drive/test-access` kiểm liệt kê + tải thử bằng khóa. Khóa không nằm trong response/DB; thiếu khóa thì không gọi Google. 10 test trên PostgreSQL thật + Drive giả; thử phá **10/10** bắt được. Đã sửa luôn lỗi có từ P1: `sourceId` sai định dạng trả 500, nay 400.
- [x] **Giao diện P3.1 ban đầu trong `apps/store-web`** (mục "Kết nối Drive" của admin, route `/admin`): trạng thái khóa (không nhập/không hiển thị khóa), form thư mục gốc, bảng nguồn, "Kiểm tra truy cập" hiện từng mục. 9 test jsdom + 1 test route; thử phá **18/18** đột biến bị bắt; `vite build` ok; **store-web 144/144 pass**. Đã mở trên trình duyệt thật (chủ dự án): màn hiển thị đúng; "Kiểm tra truy cập" lộ lỗi tìm file mẫu một cấp, đã sửa ba lần; lần 3 lấy file mẫu từ `drive_inventory` (kiểm trên dữ liệu thật: tải 100 byte JPEG thành công), **đã kiểm chứng trên giao diện thật: cả hai mục "Đạt"**; đã thử trên trình duyệt thật cả 4 trường hợp (ô trống, nhập sai, dán lại link gốc không tạo trùng, thiếu khóa) — đều đạt. **P3.1 nền xong.** Đã kiểm tab Network: phản hồi `status` không chứa khóa API và không chứa ID thư mục Drive.. Chưa chạy Playwright e2e.
- [~] **P3.1.1 — 5 slot API key Drive (2026-11-05):** thêm mã hóa credential trong DB, nhóm quota theo Project ID, chuyển sang project khác khi gặp rate limit và worker kiểm tra key active mỗi 10 phút. Thêm giao diện 5 slot, trạng thái, lưu/xóa/kiểm tra. Đang sửa; **chưa chạy test, build hoặc deploy**.
- [ ] P3.1 chưa thử với Google thật qua endpoint admin (mới chạy với Drive giả).
- [~] **P3.2 giao diện "Quét đồng bộ" (`AdminSync.jsx`)**: lượt trước đã nghiệm thu luồng FULL/SSE/Hủy/Thử lại trên giao diện thật. Cập nhật 2026-11-05: FULL quét Drive và lưu snapshot bất biến ZIP/RAR/7Z; INCREMENTAL ghép catalog theo snapshot FULL thành công gần nhất, không gọi Drive và không phát hiện file Drive mới/xóa/đổi tên. INCREMENTAL yêu cầu baseline; snapshot cũ được giữ nếu FULL mới lỗi, snapshot dở dang và snapshot cũ được dọn sau khi FULL sạch hoàn tất. `GET /summary` trả số preview VPS, archive snapshot, model sẵn sàng và số đang chờ. UI giải thích hai chế độ, hiển thị ba chỉ số chính và bỏ dung lượng tải khỏi tiến độ/lịch sử. `vite build`, `node --check` cho API và `git diff --check` đã qua; **chưa chạy test suite, chưa áp migration lên DB, chưa deploy/nghiệm thu trên web thật**.
- [~] **P3.3 giao diện (`AdminSyncHistory.jsx`, cùng trang "Quét đồng bộ")**: bảng lịch sử các lượt có phân trang "Xem thêm", "Xem lỗi" mở danh sách file lỗi (tên + đường dẫn, không ID), tự tải lại khi lượt kết thúc. 14 test jsdom; thử phá **21/21**; web **110/110**; build ok. **Đã mở trên trình duyệt thật với dữ liệu thật: các dòng khớp thao tác trong ngày (kể cả lượt hủy khi chờ hiện giờ kết thúc và lần tải đầu 48,4 MB).** Tự tải lại khi lượt kết thúc (không F5) đã kiểm trên trình duyệt thật. "Xem thêm" đã kiểm trên dữ liệu thật (11 lượt: nối đúng dòng cũ nhất, nút biến mất). Chưa kiểm bằng mắt (chỉ test tự động): "Xem lỗi" (chưa có lượt nào lỗi). **P3.3 xong về chức năng.** (`apps/store-web`): chưa làm.
- [~] **P3.4 Cần duyệt (code xong, đã kiểm trên trình duyệt thật với dữ liệu thật).** Chủ dự án đã duyệt 4 quyết định: Chấp nhận ghép gợi ý = xử lý + duyệt model đang chờ; Bỏ qua = không đụng model; Xác nhận remap = gộp vào model cũ (giữ ID/giá/tên, xóa model mới trùng); các loại khác chỉ "Đã xem" (ghép tay + chọn ảnh chính để phase sau, `choice` bị từ chối). API `GET/POST /api/admin/catalog/review` (khóa dòng chống hai admin cùng xử lý; mã lỗi mới `REVIEW_NOT_FOUND`, `REVIEW_ALREADY_RESOLVED`, `REVIEW_NOT_APPLICABLE`) và giao diện mục "Cần duyệt" (nhóm theo loại, bước xác nhận khi gộp). Test: API **416/416**, web **144/144**; đột biến API 33/35, giao diện 25/26 (còn lại là tương đương). **Đã kiểm trên trình duyệt thật với 2 mục thật** (hiển thị đúng; Chấp nhận → RESOLVED, Bỏ qua → DISMISSED, nhật ký đúng, phiên bản catalog không đổi). Hai mục **không mở lại** sau một lượt Quét đồng bộ thật (`OPEN=0`, không mục trùng) và **giá model đã sửa tay không bị ghi đè** (đã kiểm trên dữ liệu thật). **Chưa kiểm chứng:** gộp remap và Chấp nhận trên model chờ duyệt thật (chỉ có dữ liệu giả); còn thiếu ghép tay và chọn ảnh chính (phase sau). Bộ đếm "Cần duyệt" của khung tiến độ đã được sửa thành số mục **đang chờ** (giảm khi admin duyệt); chỉ có hiệu lực từ lượt quét chạy sau khi khởi động lại worker.
- [ ] P3.5 Thiết bị và quyền, P3.6 Đơn hàng: chưa làm (phụ thuộc P4, P5).
- [~] **P3.7 Cài đặt + bảng model (code xong, đã kiểm phần lớn trên trình duyệt thật).** Migration 017 chỉ `app_settings` (lệch plan có chủ đích đã duyệt: 6 bảng còn lại của 017 đi migration sau, số ≥ 021), bắt đầu rỗng; API `GET/PUT /api/admin/settings`, `GET /api/admin/models`, `PATCH /api/admin/models/:id` (audit không chép thông tin ngân hàng, tăng phiên bản catalog khi đổi dữ liệu công khai, cờ `name_overridden`/`price_overridden` chỉ bật khi giá trị thật sự đổi); worker đọc giá mặc định từ `app_settings` lúc công bố (chưa có thì dùng biến môi trường; lỗi DB khác thì job FAILED, không công bố giá sai). Giao diện mục "Cài đặt" (form + bảng model). Test: API **413/413**, web **134/134**; đột biến migration 12/12, router 30/31, worker 6/6, giao diện 37/39 (còn lại là tương đương). **Đã kiểm trên trình duyệt thật với dữ liệu thật:** migration 017 áp vào `store_p2`; form cài đặt (lưu thành công, nhật ký không chứa thông tin ngân hàng); bảng model (360 kết quả/18 trang, tìm, `%` là chữ thường); sửa giá một model (cờ `price_overridden`, catalogVersion 1→2, nhật ký đúng). Quét đồng bộ sau khi sửa giá: **giá không bị ghi đè** (đã kiểm trên dữ liệu thật). **Chưa kiểm:** ẩn model qua giao diện, màn hình hẹp. **Nhận xét giao diện chưa sửa:** ô tìm/lọc xếp dọc.
- [ ] API admin P3 **chưa chạy trên server thật với token admin thật**; mới chạy qua test với xác thực giả cộng `requireAdmin` thật.
- [ ] Mã lỗi `JOB_NOT_FOUND` (422) là mã tôi thêm, plan không nêu; chờ chủ dự án xác nhận.

## P4 – P7
- [~] **P4.1 API thiết bị/quyền (code xong, chưa thử với plugin hoặc server thật).** Migration 021 (`devices`, `device_auth_challenges`, `device_tokens`, `entitlements`, `purchase_orders`, `purchase_order_items`; tên lệch plan vì trùng bảng cũ, đã duyệt), `POST /api/v1/device/challenge`, `POST /api/v1/device/verify` (đăng ký bằng chữ ký RSA, token 15 phút, nhận MXL1), `GET /api/v1/me/entitlements`, middleware `requireDevice`. Thiết bị chỉ đăng ký sau khi ký đúng (lệch plan có chủ đích). 4 mã lỗi mới 403. Test: API **445/445**; đột biến 38/42 (4 tương đương). **Rủi ro biết trước:** `machine_code` là nhãn do máy khách khai nên token MXL1 của người khác có thể bị dùng lại nếu biết mã máy; plan chấp nhận. **Chưa:** áp 021 vào `store_p2`, khóa MXL1 thật (đang dùng khóa test), thử với plugin thật.
- [~] **P4.2 backend tải model (code xong, chưa thử với Google thật hoặc plugin).** Migration 022 (phiên + nhật ký tải; số lệch plan vì 018 đã dùng), provider link công khai kiểm từng bước (allowlist host, form xác nhận file lớn, chặn trang HTML), cache đĩa VPS (tải đủ + kiểm size/md5/sha256 rồi mới phát, chống tải trùng, LRU, kiểm dung lượng trống), `POST /api/v1/models/:id/import-session` + `GET /api/v1/model-downloads/:sessionId` (phiên dùng một lần 5 phút, kiểm lại quyền lúc mở, 10 phiên/giờ/thiết bị, 3 luồng đồng thời, nhật ký). API **504/504**; đột biến: migration 16/16, public-link 22/22, cache 26/28, route 33/37 (còn lại tương đương). **Chưa:** tải thử link công khai thật (cần 360 file "Anyone with the link" — chủ dự án xác nhận), áp 022 vào `store_p2`, plugin C# + UI-1 (cần Windows + Max 2022), bộ đếm giới hạn là theo tiến trình.
- [x] **P4.3 plugin native + P4.4 giao diện — ĐÃ NGHIỆM THU TRÊN 3ds Max 2022 THẬT (xem dòng P4.5 trong STATUS.md).** Luồng chính đạt: catalog + ảnh + seed, đăng ký thiết bị bằng TPM, nút theo quyền, tải qua backend và import vào scene, thu hồi quyền bị chặn, offline, tự cập nhật, không lộ Drive ID (quét chưa trọn vẹn: cache WebView2 đang bị Max khóa, cần quét lại khi đóng Max). **Còn mở:** 3 model là RAR lồng chưa import được (cần quyết định), 43 file chưa kiểm được định dạng, MXL1 và thanh toán chưa thử. Mô tả code bên dưới giữ nguyên: Plugin C# build thật `Release x64` thành công; 12 bộ test native xanh; web 165/165. Gồm: phiên thiết bị (ký thách thức `3DM-DEVICE-V2`), cache catalog nguyên khối, cache preview + seed cài đặt + tải nền 4 luồng, bộ theo dõi cập nhật (poll 5 phút + SSE), tải model qua backend, UI chỉ đọc dữ liệu cục bộ đã kiểm (endpoint thiết bị/tải bị chặn với JS), đọc license MXL1 cũ và gửi lên server (giữ nguyên file), `asset.import {modelId}`, `build-installer.ps1 -ApiBaseUrl` kéo seed (build thất bại nếu thiếu ảnh), giao diện UI-1 trên dữ liệu v3 (nút theo quyền, tab Đã tải, tự làm mới giữ bộ lọc, thiết bị thay tài khoản). **Chưa kiểm chứng (P4.5 — cần Max 2022 thật):** WebView2 + `PackagedAppRuntime` trả `/api/v1` & `/previews` từ cache, mở lại khi mất mạng, merge model vào scene, thiếu quyền báo rõ, grep `%LOCALAPPDATA%\3dMood` không có Drive ID; chạy `build-installer.ps1 -ApiBaseUrl` đầy đủ; Google thật cho đường tải; áp migration 021/022 vào `store_p2`. **Nợ biết trước (đã xử lý ở 02/11):** 3 bộ test native cũ từng hỏng sẵn nay đã xanh; nút Mua chờ P5; chế độ offline cũ (`assetId` + license thủ công) và cookie-session cũ vẫn còn trong mã, dọn ở P7.
- [ ] **P5 — code + test + đột biến xong (2026-11-02), CHƯA nghiệm thu thật**: đơn hàng, VietQR, bot Telegram (backend), hộp thoại mua trong plugin (web + native). Chi tiết, các chỗ lệch plan và việc chưa kiểm chứng: hai dòng P5 trong `STATUS.md`. Cần chủ dự án: tạo bot (P5.1), nhập thông tin ngân hàng ở admin, quét thử VietQR bằng app ngân hàng thật, chạy nghiệm thu thật.
- [ ] **P6 — mới làm phần trong repo (2026-11-02):** cấu hình Nginx (đã kiểm hành vi bằng container) và systemd (đã verify cú pháp), giám sát, backup + diễn tập restore (PASS trên DB dev), rollback migration, runbook `docs/p6-runbook.md`. **Chưa có VPS nên chưa deploy, chưa chạy failure test và E2E.** Cần chủ dự án: VPS + domain, và gửi 18 tiêu chí nghiệm thu gốc (không có trong repo).
- [~] **P7 — dọn code cũ xong theo D28.5 (2026-11-04)**, chưa build được C# trên Windows (xem mục C ở cuối file).

---

## Việc còn mở cần chủ dự án quyết định hoặc làm
- [ ] Duyệt 4 quyết định thiết kế ở P2.5 (mô hình mồ côi, đổi ánh xạ → cần duyệt, file ở gốc → "Uncategorized", đồng bộ danh mục) và chỗ lệch ở migration 018.
- [ ] **Tạo lại API key Drive** (khóa cũ từng bị lộ).
- [ ] Xác nhận nhánh làm P3: plan ghi `v3/p1-drive-oauth`, P2 đã tách `v3/p2-sync-worker` theo yêu cầu; hiện P3 làm tiếp trên nhánh P2.
- [~] **INCREMENTAL ở worker:** đã triển khai ghép từ snapshot FULL gần nhất theo xác nhận của chủ dự án; cần chạy test suite, áp migration 026 và nghiệm thu sau deploy.
- [ ] Nguyên nhân Google chặn tải ảnh **chưa xác nhận** (chỉ có báo cáo cộng đồng; quan sát thực tế: tải được khoảng 57–191 ảnh liên tiếp thì bị chặn chừng một giờ rồi tự gỡ).

## Lưu ý vận hành đã gặp
- `.env` mặc định trỏ database `store`; dữ liệu P2 ở `store_p2`. Terminal mới mà không đặt `DATABASE_URL` sẽ gặp lỗi Postgres `42P01` (không có bảng).
- `npm run sync:drive` chỉ **xếp job vào hàng đợi**; phải chạy `node --env-file-if-exists=.env src/worker.js` để xử lý.

## Quy trình đang áp dụng
Mỗi bước: ghi log vào `STATUS.md` → viết test (PostgreSQL thật) → thử phá bằng đột biến → chạy cả bộ `npm test` → commit **local**. Không push, không tạo PR, không commit secret.

---

## TÓM GỌN CUỐI — mọi thứ CHƯA test và CHƯA nghiệm thu (cập nhật 2026-11-02)

> Đọc phần này trước khi tin rằng "phase X xong". **Có test tự động xanh ≠ đã nghiệm thu.** Số liệu tự động hiện tại: API **555/555**, web **158/158**, ~17 bộ test native xanh (mã thoát 0), diễn tập deploy bằng Docker **30/30**. Toàn bộ test native dùng HTTP/Drive/Telegram **giả**.
> Chi tiết từng mục: `STATUS.md` (nhật ký), `p4-open-issues.md` (P4), `p6-runbook.md` (P6).

### A. Việc cần CHỦ DỰ ÁN làm hoặc quyết định (chặn nghiệm thu)
1. **Tạo lại API key Drive** (khóa cũ từng lộ, và một lần in ra log hội thoại).
2. **Gửi 18 tiêu chí nghiệm thu gốc** ("master prompt §14", không có trong repo; chỉ biết tiêu chí #17). Checklist trong `p6-runbook.md` §9 chỉ là bản nháp 21 dòng.
3. **Thuê VPS + domain** (P6 cần), và một máy sạch thứ hai để diễn tập restore.
4. **P5.1 thủ công:** tạo bot @BotFather, lấy chat_id, điền `TELEGRAM_*`, dựng HTTPS (tunnel/domain), chạy `scripts/telegram-set-webhook.js`, nhập thông tin ngân hàng ở admin → Cài đặt.
5. **Quyết định thiết kế đang chờ:** (a) đơn đã báo chuyển tiền mà chủ bấm quá hạn thì cấp tay hay kéo dài TTL; (b) 3 model RAR lồng (3/360) — giải nén lồng hay đóng gói lại; (c) 4 quyết định ở P2.5 + chỗ lệch migration 018; (d) nguồn thông tin ngân hàng (plan tự mâu thuẫn: env `PAYMENT_BANK_*` hay `app_settings` — đang dùng `app_settings`); (e) xác nhận mã lỗi `JOB_NOT_FOUND` 422; (f) có bỏ chế độ đóng gói/offline của plugin hay không (quyết định P7 native).

### B. Theo phase — chưa kiểm chứng / chưa nghiệm thu

**P1** — OAuth + Drive client: chưa chạy với Google OAuth thật; Q4 chưa chốt (OAuth không còn là luồng chính, D26).

**P2** — Worker & catalog: RAM worker suốt cả job (tiêu chí < 400 MB) chưa đo; kill cứng giữa job trên Drive thật chưa thử (chỉ Drive giả); 1 test không ổn định (`disk guard`) từng fail 1 lần chưa rõ nguyên nhân; INCREMENTAL snapshot-based đã code nhưng chưa chạy test suite/deploy; dọn ảnh preview mồ côi (P2-6) chưa làm; nguyên nhân Google chặn tải ảnh chưa xác nhận; nợ P2-1…P2-8.

**P3** — Web admin: P3.1 chưa thử với Google thật qua endpoint admin; **P3.5 (quản lý thiết bị / cấp–thu hồi quyền / ký MXL1 có ghi DB + audit — tiêu chí #17) CHƯA LÀM**, hiện cấp quyền bằng SQL; **P3.6 (màn đơn hàng cho admin) chưa có giao diện** (API `/api/admin/orders` có và có test, UI thì chưa); P3.4 gộp remap/Chấp nhận trên model chờ duyệt thật chưa thử, ghép tay + chọn ảnh chính chưa làm; P3.3 "Xem lỗi" của job lỗi chưa nhìn bằng mắt; P3.7 ẩn model qua giao diện và màn hình hẹp chưa thử; API admin chưa chạy trên server thật với token admin thật; Playwright e2e chưa chạy lần nào.

**P4** — API thiết bị + tải + plugin (đã nghiệm thu trên Max 2022 thật cho luồng chính): **MXL1 cũ → ALL_MODELS chưa thử thật**; **không lộ Drive ID chưa đủ bằng chứng** (cache WebView2 bị Max khóa, quét lại khi đã đóng Max); thu hồi quyền *giữa* lúc đã có phiên chỉ có test tự động; file lớn qua trang xác nhận virus-scan của Google chưa gặp thật (chỉ thử 2 file nhỏ); chưa biết 360 file đều "Anyone with the link"; 3 model RAR lồng không import được; 43 file chưa biết định dạng; độ trễ lần tải đầu chưa đo; giới hạn tải đồng thời/phiên theo giờ là **trong tiến trình** (nhiều tiến trình API sẽ không dùng chung); cache đầy chưa thử thật; thời gian tự cập nhật trên Max thật chưa ghi; `devMockHost` chưa mô phỏng `library.*`; **bộ cài production** (HTTPS thật, ký số, cập nhật/rollback) chưa hoàn thiện, mới build `-TestBuild` loopback; áp migration 021/022 lên DB production.

**P5** — Đơn hàng + Telegram: toàn bộ **chưa nghiệm thu thật** (cần mục A.4): chưa tạo bot, chưa gửi/nhận Telegram thật, **VietQR chưa quét bằng app ngân hàng thật** ([CHƯA KIỂM CHỨNG] của plan còn nguyên), chưa đo "bấm ✅ → Download ≤ 10 giây"; `OrdersClient` (native) chưa chạy trong Max thật; chưa biết gửi `inline_keyboard: []` có làm nút biến mất không (tài liệu Telegram không nói); nhiều owner chỉ lưu 1 mã tin nhắn; đơn giá 0 bị từ chối và mã `ORDER_NOT_FOUND` do tôi thêm (plan không định nghĩa).

**P6** — VPS / E2E / deploy: **chưa có VPS nên chưa deploy.** Đã kiểm trên máy dev: cấu hình Nginx (18 ca hành vi), cú pháp systemd, backup + diễn tập restore, giám sát, rollback migration, **diễn tập deploy production bằng Docker 30/30**. **Chưa:** systemd thật (`MemoryMax=900M`, hardening, tự lên sau reboot), TLS Let's Encrypt, `TRUST_PROXY=127.0.0.1` (diễn tập dùng CIDR Docker), `limit_conn`/`limit_req`, tải model 30 phút qua Nginx, worker xử lý ảnh với Drive thật (RAM đỉnh), restore trên máy sạch khác, chép backup ra ngoài VPS, **8 failure test** (chỉ F5 đã đạt trên Max thật), checklist E2E 21 dòng chưa chạy dòng nào, đo tải (autocannon/k6), hành vi khi quên chạy migrate ở production, đĩa đầy thật, giám sát từ bên ngoài, dọn ảnh preview mồ côi.

**P7** — Dọn code cũ: chỉ làm một phần (payOS, OfflineLibrary); phần còn lại cố ý giữ — xem mục C ngay bên dưới.

### C. P7 / D28.5 — dọn code cũ (làm ngày 2026-11-04)
**Đã gỡ:** R2/Cloudflare (`src/r2`, `r2-http.js`, `catalog-runtime.js`, `assets.js`, `catalog.js`, `cloudflare/`), `licensing/` cũ, MXL1 (API + `tools/license-owner` + `apps/license-admin`), OAuth Drive (`drive/oauth.js`, `service-account.js`, `crypto.js`, `probe.js`, `DRIVE_TOKEN_KEY`), đăng ký khách + `StoreApp` + giao diện license trên web, màn admin cũ (tổng quan doanh thu, tài khoản & license, thanh toán, lịch sử), `library/` + `frontend/` (PoC), chế độ thư viện offline trong plugin (`StaticCatalogService`, `OfflineLicenseService`, `GoogleDriveDownloader`), seed ảnh trong installer (`Get-PreviewSeed.ps1`).
**Giữ lại có chủ đích:** `users` + `sessions` (đăng nhập admin, tạo bằng `npm run create-admin`), `drive_connections` + `oauth_states` (bảng rỗng; `drive_sources` và chuỗi rollback 014/019 còn tham chiếu), `download-stream.js` (`createArchiveSender`, luồng tải đang dùng), tài liệu `v3-implementation-plan.md`.
**Migration 023** xóa 13 bảng cũ (license, payOS, R2, catalog cũ, import ticket); rollback của nó **từ chối** (khôi phục bằng backup).
**Chưa kiểm chứng sau D28.5:** build C#/installer trên Windows (máy dev macOS không biên dịch được); trang đăng nhập admin bằng mắt; `ImportPipelineTests.cs` (kiểm tra import end-to-end trong WebView) đã xóa cùng đường tải cũ — cần viết lại cho đường v3 (đường tải v3 có `ModelDownloaderTests.cs`). Playwright đã gỡ hẳn.

### D. Rủi ro xuyên suốt
- Test native hiện **không** chạm API/Telegram/Drive thật; lỗi ghép nối chỉ lộ khi chạy end-to-end.
- Mọi kết quả "sau 2 tuần ổn định" của plan (điều kiện cho P7) **chưa có** vì chưa deploy.
- Nhánh `v3/p2-sync-worker` đã gom P2→P7; plan ghi nhánh khác cho từng phase — chưa xác nhận cách đặt nhánh khi merge.
- Đã **push** lên origin tới commit `24197b1`; mọi commit sau đó (P5, P6, P7) **chỉ ở local**.

---

## HƯỚNG GIẢI QUYẾT THEO PLAN — các bước cần làm để đóng từng phần còn mở

> Gắn nhãn: **[plan]** = đúng mục/ghi chú của `v3-implementation-plan.md` hoặc `v3-architecture.md`; **[đề xuất]** = tôi đề xuất, plan không nói, cần chủ dự án duyệt.
> Người làm: **CDA** = chủ dự án (việc chỉ bạn làm được hoặc phải quyết định); **CODE** = việc code do tôi/agent làm (vẫn theo quy trình: test trước → code → đột biến → chạy cả bộ → ghi log → commit local, push khi được yêu cầu).
> Thứ tự đã xếp theo **đường găng**: (1) mở khóa → (2) code còn thiếu → (3) nghiệm thu thật P2–P5 → (4) P6 trên VPS → (5) P7 làm nốt.

### Bước 1 — Mở khóa (CDA, làm trước, không cần code)
| # | Việc | Mục đích / nguồn |
|---|---|---|
| 1.1 | Tạo lại **API key Drive**, cập nhật `.env` | Khóa cũ đã lộ (STATUS, `p4-open-issues.md` §3.5) |
| 1.2 | Gửi **18 tiêu chí nghiệm thu gốc** ("master prompt §14") | **[plan]** P6.5 yêu cầu E2E theo 18 tiêu chí; repo chỉ có #17. Khi có, thay bảng nháp ở `p6-runbook.md` §9 |
| 1.3 | **Chốt các quyết định đang chờ** (bảng dưới) | Nhiều bước code bên dưới bị chặn bởi đây |
| 1.4 | Đóng hẳn 3ds Max rồi **quét lại Drive ID** trong cache WebView2 (lệnh ở `p4-open-issues.md` §2.1) | Hoàn tất bằng chứng "không lộ Drive ID" (mục nghiệm thu P4.5, chưa đủ bằng chứng) |

Các quyết định cần chốt (mỗi dòng: lựa chọn đề xuất → bước nào được mở khóa):
| Quyết định | Đề xuất của tôi | Mở khóa |
|---|---|---|
| Đơn đã báo chuyển tiền nhưng chủ bấm ✅ **sau khi hết hạn** | Giữ đúng plan ("không cấp"), thêm quy trình cấp tay ở trang thiết bị (P3.5) + nhắc đơn `AWAITING_OWNER` (đã có cảnh báo > 60 phút) | 2.3, 3.5 |
| Chỗ lưu **khóa riêng ký MXL1** (server hay giữ ở máy chủ dự án) | **[plan]** ghi "private key nếu ký MXL1 trên server — Q P0": cần chốt; nếu để trên server thì nằm trong `/etc/3dsmood/store.env`, không commit | 2.1 |
| **3 model RAR lồng** | (a) giải nén lồng 1 lớp có giới hạn (**[plan]** nêu cả hai phương án ở `p4-open-issues.md` §3.1) | 2.7 |
| **Bỏ chế độ đóng gói** (bundled/offline) của plugin? | **[plan]** kiến trúc §10.2.4: phát hành 2 bước — (a) bản có cả hai chế độ, (b) bỏ bundled khi đa số khách đã cập nhật. Giữ cả hai ở bản đầu | 5.5 |
| Nguồn thông tin ngân hàng: `app_settings` hay env `PAYMENT_BANK_*` | Giữ `app_settings` (đã duyệt ở P3.7); sửa chỗ mâu thuẫn trong plan P5.1/P6.2 | — |
| 4 quyết định P2.5 + lệch migration 018 | Duyệt như đã trình ở `STATUS.md` | — |
| INCREMENTAL ở worker | Đã chốt: ghép với snapshot FULL thành công gần nhất; không gọi Drive, thay đổi Drive cần FULL | Cần test + deploy |
| Mã lỗi `JOB_NOT_FOUND` 422, `ORDER_NOT_FOUND` 404 (plan không định nghĩa) | Chấp nhận | — |

### Bước 2 — Code còn thiếu theo plan (CODE)
| # | Việc | Chi tiết theo plan | Nghiệm thu |
|---|---|---|---|
| 2.1 | **P3.5 Thiết bị & quyền** (**chặn việc gỡ `apps/license-admin`**) | **[plan]** §2.7: `GET /api/admin/devices?q=` (tìm theo machine code/tên), `GET /api/admin/devices/:id` (thiết bị + entitlements + đơn + log tải), `POST /api/admin/entitlements` `{deviceId, scope, modelId?}` (có audit), `POST /api/admin/entitlements/:id/revoke` (audit), `POST /api/admin/licenses/mxl1` `{machineCode, licenseId?}` (ký MXL1 **như `apps/license-admin`, có ghi DB + audit**). Giao diện trong `apps/store-web` (giữ theme UI-1, không tạo app admin mới). Dùng lại logic ký ở `apps/license-admin/server/license-core.mjs` | Cấp tay hoạt động (**tiêu chí #17**); thu hồi chặn tải ngay (A6); ghi DB + audit; test guard 401/403; đột biến |
| 2.2 | **P3.6 Đơn hàng — giao diện** | **[plan]** danh sách đơn chờ + xác nhận/từ chối từ web (API `/api/admin/orders` đã có và có test) | Admin xác nhận được đơn `AWAITING_OWNER` từ web khi Telegram lỗi |
| 2.3 | Quy trình cho đơn **quá hạn đã báo tiền** | **[đề xuất]** nút "cấp quyền thủ công theo đơn" ở màn đơn (dùng 2.1) | Khách trả tiền mà chủ bấm trễ vẫn được xử lý, có audit |
| 2.4 | **P3.4 phần còn thiếu**: chọn ảnh chính, ghép tay | **[plan]** P3.4 ("chọn ảnh chính; xác nhận remap"); hiện API từ chối `choice` | Admin chọn được ảnh chính; test + đột biến |
| 2.5 | **INCREMENTAL** ở worker | Đã code theo xác nhận: dùng snapshot FULL sạch gần nhất để ghép preview, không gọi Drive và không đánh dấu file mất | Chạy test + deploy; xác nhận FULL lỗi không làm mất baseline |
| 2.6 | **Dọn ảnh preview mồ côi** | **[plan]** nợ P2-6 ghi "job GC an toàn — P6": chỉ xóa file không còn `model_previews` trỏ tới và đủ cũ | Test: không xóa ảnh đang dùng; không xóa ảnh mới tải dở |
| 2.7 | **RAR lồng** (3/360) | Theo quyết định ở bước 1.3: giải nén lồng 1 lớp với giới hạn dung lượng/số file/độ sâu + chống zip-slip + test (`ArchivePackage`), hoặc đóng gói lại 3 file | Import `80891x Muro Lightstar` thành công trên Max |
| 2.8 | **Script kiểm hàng loạt 360 file "Anyone with the link"** | **[đề xuất]** (gợi ý ở `p4-open-issues.md` §2.4): gọi `public-link.open()` cho từng `drive_file_id`, báo file nào không tải được | Danh sách file lỗi trước khi mở bán |
| 2.9 | Script tạo admin đầu tiên | **[đề xuất]** để không còn phụ thuộc "đăng ký khách rồi cấp `LICENSE_ADMIN_USER_IDS`" | Mở khóa việc gỡ đăng ký khách (5.2) |
| 2.10 | Giới hạn tải theo **nhiều tiến trình** | **[đề xuất]** (`p4-open-issues.md` §2.9): hiện đếm trong tiến trình; nếu chạy >1 tiến trình API thì chuyển đếm vào DB; nếu không thì ghi rõ "chạy 1 tiến trình" trong runbook | Giới hạn đúng khi có nhiều tiến trình |
| 2.11 | Nợ nhỏ | `devMockHost` thiếu sự kiện `library.*` (P4.4); test `disk guard` không ổn định cần điều tra nếu tái diễn; dọn cảnh báo khởi động của code cũ (OAuth/R2/Licensing) khi làm 5.x | — |

### Bước 3 — Nghiệm thu thật P2–P5 (CDA chạy, CODE hỗ trợ)
| # | Việc | Theo plan | Tiêu chí |
|---|---|---|---|
| 3.1 | **P5.1**: tạo bot @BotFather, lấy chat_id; điền `TELEGRAM_*`; dựng HTTPS (tunnel/domain); chạy `node --env-file-if-exists=.env scripts/telegram-set-webhook.js`; nhập thông tin ngân hàng ở admin → Cài đặt | **[plan]** P5.1, P5.7 | Chỉ chủ bấm được; người lạ bị bỏ qua |
| 3.2 | **Quét VietQR** bằng ≥ 2 app ngân hàng thật; xác nhận số tiền + nội dung | **[plan]** P5.3 ([CHƯA KIỂM CHỨNG]) | QR hợp lệ; nếu sai định dạng thì sửa `orders/qr.js` theo tài liệu NAPAS |
| 3.3 | **Nghiệm thu P5**: 1 model, chủ nhận tin, bấm ✅, plugin sang Download **≤ 10 giây (đo thật)**, tải và merge được | **[plan]** "Nghiệm thu (thật)" P5 | Đạt thời gian + import thành công |
| 3.4 | Thử trên bot thật: `inline_keyboard: []` có làm nút biến mất không; nhiều owner | tài liệu Telegram không nói rõ | Nếu nút còn → đổi cách sửa tin theo kết quả |
| 3.5 | **P4 còn lại**: MXL1 thật (cần `LICENSE_PUBLIC_KEY_B64` + `license.txt` hợp lệ), thu hồi giữa phiên, file lớn qua trang virus-scan, bộ cài HTTPS thật + ký số + cập nhật/rollback | `p4-open-issues.md` §2.2–2.6; **[plan]** D6 (tương thích ngược) | Mỗi mục ghi pass/fail + bằng chứng |
| 3.6 | **P2 còn lại**: đo RAM worker suốt job (< 400 MB), kill cứng giữa job trên Drive thật, thử Google OAuth thật nếu còn dùng | **[plan]** P2.8 | Số liệu vào `STATUS.md` |
| 3.7 | **P3 còn lại** (chạy trên server thật với token admin thật): P3.1 qua endpoint admin với Google thật; P3.4 gộp remap trên model chờ duyệt thật; "Xem lỗi" của job lỗi; ẩn model qua UI; màn hẹp; Playwright viết lại cho admin | **[plan]** P3.x | Bằng chứng ảnh chụp/log |
| 3.8 | Chạy **43 file không liệt kê được** qua `ArchivePackage` (SharpCompress) | `p4-open-issues.md` §2.7 | Biết file nào thật sự hỏng |

### Bước 4 — P6 trên VPS (CDA thuê VPS, làm theo `p6-runbook.md`)
Thứ tự **[plan]** P6 + kiến trúc §10.2:
1. Thuê VPS ~2 GB + domain; cài Node, PostgreSQL 16 (chỉ localhost), `postgresql-client`, nginx, certbot, rsync (`p6-runbook.md` §1).
2. Cấp TLS Let's Encrypt; cài `deploy/nginx/3dsmood.conf` và unit systemd (§3); đặt `TRUST_PROXY=127.0.0.1`.
3. **Staging trước** (cùng cấu hình 2 GB): khôi phục bản sao DB, migrate trên bản sao, smoke test (§4.1).
4. Production: backup → `npm run migrate` → restart API → worker → admin web (§4.2); kiểm `/api/health`.
5. **Bộ cài:** `installer\build-installer.ps1 -ApiBaseUrl https://<domain>` kéo seed preview (**[plan]** P6.0).
6. **8 failure test** F1–F8 (§8) — ghi pass/fail.
7. **E2E 18 tiêu chí** (sau bước 1.2) + luồng Telegram — mỗi tiêu chí pass/fail + bằng chứng.
8. **Diễn tập restore trên máy sạch khác** + chép backup ra ngoài VPS (`BACKUP_RSYNC_TARGET`) + **diễn tập rollback** (**[plan]** E3, E5).
9. Đo tải (k6/autocannon) cho `503 DOWNLOAD_BUSY` và RSS (**[plan]** kiến trúc §10.1 "Tải"); RAM worker với Drive thật so với `MemoryMax=900M`.
10. Thêm giám sát từ bên ngoài (ping `/api/health`) **[đề xuất]**.
11. Phát hành plugin **2 bước** (kiến trúc §10.2.4): (a) bản có cả hai chế độ, (b) bỏ bundled khi đa số khách đã cập nhật.
Mọi sai khác với diễn tập Docker (systemd, `MemoryMax`, `ProtectSystem=strict`, `TRUST_PROXY`) được ghi vào `STATUS.md` và sửa file trong `deploy/`.

### Bước 5 — P7
Đã làm trọn theo D28.5 (xem mục C). Còn lại: chạy build + bộ test native trên Windows, rồi nghiệm thu trên Max.

### Quy tắc áp dụng cho mọi bước
Mỗi bước code: viết test trước (PostgreSQL thật) → code → **đột biến** → chạy **cả bộ** `npm test` (api + web) và native liên quan, kiểm mã thoát thật → ghi `STATUS.md` (bảng "Nhật ký P2") + `STATUS-v3.md` → commit **local**. Push chỉ khi chủ dự án yêu cầu. Không commit bí mật hay thông tin ngân hàng thật. Việc "chưa kiểm chứng" phải ghi rõ, không ghi là xong.

## Việc chưa kiểm chứng từ phiên test P4.5 (gộp từ `p4-open-issues.md` cũ, nay đã gỡ)
Đã kiểm trên Max 2022 thật (01–02/11): đăng ký thiết bị bằng TPM, catalog + ảnh, nút theo quyền, tải + import `19113 wall lamp`, thu hồi quyền thì bị chặn, offline, tự cập nhật tên model. Còn mở:
1. **Không lộ Drive ID trong cache WebView2:** lần quét chưa trọn vì Max khóa file. Đóng hẳn 3ds Max rồi `Select-String` ID (lấy từ DB, không ghi vào tài liệu) trong `%LOCALAPPDATA%\3dMood` và `%LOCALAPPDATA%\MaxWebViewHost`; đạt = 0 file không đọc được và 0 hit.
2. **File lớn qua trang xác nhận "virus scan" của Google:** mới thử 2 file nhỏ (133–263 KB). Thử 1 file ≥ 100 MB; lỗi sẽ là `STORAGE_DOWNLOAD_FAILED`. Chưa biết 360 file đã bật "Anyone with the link" hết chưa (cần script gọi `public-link.open()` cho từng `drive_file_id`).
3. **RAR lồng:** 3/360 model (`80891x Muro Lightstar`, `01H75FPCJ2EPCBJV3TKJEJRG4XO7NHE562`, `173 Cabinet Furniture 04 Minimal Wardrobe Kit P02 Island`) báo `ASSET_NO_IMPORTABLE_FILE` vì `ArchivePackage.Extract` chỉ giải nén một lớp. Chờ quyết định: giải nén lồng một lớp có giới hạn (độ sâu, dung lượng, zip-slip) hoặc đóng gói lại trên Drive. 43/360 file chưa biết định dạng bên trong (bsdtar không liệt kê được; SharpCompress có thể đọc được) — kiểm bằng `ArchivePackage.Extract`.
4. **Độ trễ lần đầu tải một model:** VPS tải đủ + kiểm size/md5/sha256 rồi mới phát; plugin chỉ thấy "Đang tải…" không có phần trăm, tối đa theo timeout 30 phút. Chưa đo với file lớn.
5. **Quyền bị thu hồi giữa lúc đã có phiên tải** (trước khi bắt đầu tải): chỉ có test tự động.
6. **Đa tiến trình:** `maxConcurrent` và giới hạn phiên/giờ nằm trong tiến trình API; cache đầy (`MODEL_CACHE_MAX_BYTES` nhỏ) mới có test tự động.
7. **Tự cập nhật (bước 11):** chưa đo thời gian từ lúc lưu đến lúc đổi trong Max thật, chưa kiểm ô tìm/model đang chọn có giữ nguyên.
8. **Web:** chưa chạy `npm run dev` + `?mockMax=1` bằng mắt; `devMockHost.js` chưa mô phỏng `library.updated`, `library.offline`, `library.previewProgress`.
9. **Build installer với URL HTTPS thật:** mới chạy `-ApiBaseUrl http://127.0.0.1:4000 -TestBuild`; chưa ký/phát hành.
10. **Bí mật lộ trong log phiên:** `DRIVE_API_KEY` từng in ra màn hình ở phiên P4.5 — tạo lại khóa trước khi deploy.
Lỗi môi trường hay gặp: `AUTH_CONFIGURATION_REQUIRED` = thiếu `JWT_SECRET`; `/admin` không vào được = chưa có tài khoản admin (`npm run create-admin`); `installer\stage` bị `Access denied` = `takeown`/`icacls` rồi xóa; script test C# tìm `csc.exe` qua `plugin-csharp/tests/find-csc.ps1`.

## D29 (2026-11-05): ảnh tải lên thay cho ảnh Drive
Đã làm: migration 025, API tải/xóa ảnh, ghép theo stem, UI admin (tải theo danh mục / cả thư mục, lọc Đủ / Thiếu zip / Thiếu ảnh / Lệch danh mục). Chưa kiểm: tải thật ~320 ảnh qua nginx trên VPS; dọn tay ~46 file .webp cũ nguồn Drive trong `previews-v3`.

## Gói phát hành `3dsmood-library.zip` (05/11)
Đã viết: `installer/release/make-release-zip.ps1` (zip = exe + `HUONG-DAN-CAI-DAT.html` + `THONG-TIN-PHIEN-BAN.txt` kèm SHA256 + `Cai-thu-cong\ENU\` dựng từ `installer\stage`), hướng dẫn HTML có mục SmartScreen/cài thủ công/gỡ, README-template. 
**Đã kiểm trên Windows (chủ dự án, 05/11):** `build-installer.ps1 -ApiBaseUrl https://3dsmood.io.vn` thành công (exe 9,5 MB, test ZIP/RAR/7z PASS); `make-release-zip.ps1` ra zip 18,5 MB; cài vào Max 2022 ENU sạch: "Cài đặt xong — 103 file" (101 trong `scripts\Platform` + agent + macro); `plugin-config.json` = `https://3dsmood.io.vn/`; nút Platform xuất hiện trên toolbar; chủ dự án báo mở panel ổn (chưa có ảnh/log kèm).
**Chưa kiểm chứng:** ảnh hướng dẫn (`installer/release/images/`) chưa có; cài thủ công (`Cai-thu-cong`) chưa thử; SmartScreen chưa chụp (file build tại máy không có dấu tải từ Internet); tải/import model, mua license trong Max thật chưa thử.

**Phát hành v1.0.0 (05/11):** GitHub Release `v1.0.0` (commit `0456c7c`, asset `3dsmood-library.zip`, 18,5 MB) → workflow `release` chạy đủ 6 bước thành công (Upload + Verify) → `https://3dsmood.io.vn/download/3dsmood-library.zip`. Chủ dự án tải zip từ web, `Get-FileHash` của `PlatformSetup.exe` trong zip = `7168CF4B5434A0445B8AE5692CED1B1A7D021FEF7F223497CC6CFD5C66D22538`, trùng với exe lúc build. Còn thiếu: ảnh SmartScreen/toolbar/panel cho guide (→ v1.0.1), chỗ liên hệ trong plugin/web gallery, catalog VPS còn trống.

## D31 — Bộ chọn mẫu import (2026-11-05)

- [x] Xác minh 360 archive cục bộ: tar đọc 317; 284 có nhiều file import được, 128 có nhiều .max; tối đa 7 lựa chọn, gồm màu/mẫu, renderer, phiên bản và định dạng.
- [x] Chỉ mục nhiều file được lưu khi tải mới; chỉ mục D30 tự bổ sung từ thư mục cục bộ khi cần. Mã lựa chọn ổn định, không gửi đường dẫn tuyệt đối từ web. Một file import trực tiếp; nhiều file cần khách chọn và xác nhận. Hủy/Escape không import; file mất không tự đổi mẫu hoặc tải lại.
- [x] Web 161/161 pass; test kho model native 55 checks pass; native security 35 checks + RSA/Node proof pass; WebView transport 25 pass. Full web/net48 build và runtime ZIP/RAR/7z pass. MZP validator có thêm từ chối call-chain MAXScript và tên entry chứa dấu backslash; build guard pass.
- [x] Sửa ZIP entry của builder thành dấu / để tương thích workflow release trên Linux. Artifact v1.2.0: installer/release/out/3dsmood-library.mzp, 9,759,940 bytes (~9.31 MiB), SHA256 C813BCDEBD63BA96ADD120EAB33BE5CBFB20A32AF975E50037FA26544AFE18FE.
- [ ] Chưa nghiệm thu bộ chọn mẫu và cài MZP mới trên Max thật; chưa phát hành/deploy.
## D32 — Plugin riêng theo từng Max (2026-11-05)

- [x] Form gắn PID + thời điểm khởi động của Max mở nó, tiêu đề gồm scene + PID; bỏ bộ chọn đích và đường import sang tiến trình khác. Đổi scene trong cùng Max tự cập nhật; snapshot cũ hoặc owner không sẵn sàng phải bị chặn.
- [x] Test native/WebView 46 checks pass: hai form gắn hai owner độc lập, tên scene giống nhau vẫn phân biệt PID, không đọc/validate/dispatch vào owner khác, không fallback, PID tái sử dụng và metadata sai bị chặn. Bridge thực xác nhận processId thuộc tiến trình đang chạy. Các fixture hai owner là mô phỏng; WebView2 dùng runtime thật.
- [x] Full web/net48 build, staged ZIP/RAR/7z, MZP validator và test cập nhật pointer pass. Artifact v1.3.0: installer/release/out/3dsmood-library.mzp, 9759588 bytes, SHA256 44F2333771133195CE7D9FF48A07D0E3EE2919D7BD3FD79FBD974192F7D79A15.
- [ ] Chưa nghiệm thu import trên hai tiến trình 3ds Max thật. Chưa phát hành/deploy.
## D33 — Đổi tên hiển thị thành 3dsmood (2026-11-05)

- [x] Đổi tên nút, tooltip và Category từ Platform sang 3dsmood; tên cửa sổ vẫn gồm scene/PID. Đồng bộ header, HTML title, thông báo MZP/loader và product metadata; file version 1.3.1.0.
- [x] Giữ action name/internalCategory cũ để hỗ trợ toolbar đã lưu; installer cập nhật các bản macro tự sinh đã biết. Không đổi thư mục dữ liệu hay khóa thiết bị.
- [x] Web 161/161 pass; full Vite/net48 build pass; staged ZIP/RAR/7z, kiểm tra MZP và pointer swap pass. Đã mở chính artifact để xác nhận category/button/tooltip 3dsmood và phiên bản 1.3.1.
- [x] Artifact local: installer/release/out/3dsmood-library.mzp, 9759757 bytes, SHA256 5DC1AA0AFB58D7800922B91ED009602C654EE48195D200AB2D088C36274E2030. Binary không commit vào Git.
- [ ] Chưa nghiệm thu hiển thị/toolbar trên Max thật. File MZP trên website vẫn cần phát hành qua workflow release riêng.
## Sửa nút tải gallery khi Nginx còn header ZIP (2026-11-06)

- Xác minh production /download/3dsmood-library.mzp trả HTTP 200 nhưng Content-Disposition vẫn ép filename=3dsmood-library.zip, Content-Type application/zip. File tải thực tế khớp SHA256 asset MZP v1.3.1 (5DC1AA0AFB58D7800922B91ED009602C654EE48195D200AB2D088C36274E2030), không phải archive source của repo.
- Nút gallery tải bytes rồi tạo Blob URL và đặt tên lưu 3dsmood-library.mzp rõ ràng; không giải nén hay ghép thêm file. Có trạng thái đang tải, chặn nhấp trùng, lỗi/thử lại và hủy request khi rời trang. Phản hồi HTTP lỗi/không có ZIP signature không được lưu thành bộ cài.
- Web 164/164 pass; production Vite build pass. Test tái hiện Content-Disposition ZIP sai, xác nhận một file MZP với bytes không đổi, lỗi HTML/503, retry và hủy khi unmount.
- Sửa này bảo vệ thao tác bấm nút gallery. Header của đường URL tải trực tiếp trên Nginx vẫn cần operator sửa/reload; SSH hiện chưa sử dụng được. Không cần build/upload lại asset MZP.
### 2026-11-06 — Một panel chọn nhiều Max, MZP 1.3.2

Thay giới hạn owner-bound bằng dropdown native scene/đường dẫn/PID. Mỗi Max chạy agent Startup, chỉ cần mở một panel. Chọn max_c thì import qua pipe của max_c; Max chứa panel dùng adapter local. Đích được chụp ngay lúc bấm Import trước khi chờ metadata; đổi dropdown khi đang xử lý không chuyển lệnh cũ sang scene mới. Focus/thứ tự liệt kê không đổi lựa chọn; process đóng/khởi động lại hoặc đổi document thì phải chọn lại. Max chưa có agent vẫn liệt kê nhưng không chọn import được.

Đã kiểm: target-selection 19 kiểm tra; WebView2/pipe/UI 38 kiểm tra (gửi import thật qua pipe tới agent giả lập adapter, không merge vào scene Max thật); downloaded-library 55 kiểm tra; MZP validator và 6 gói hỏng bị từ chối. Build Release x64 + frontend + staged ZIP/RAR/7z thành công; artifact local installer/release/out/3dsmood-library.mzp, version 1.3.2, SHA256 EBD1182BCCBFACA6A5899DCA734182C91788B8B13C01577EDEEA67EE903CC900. Chưa nghiệm thu merge trong 3 cửa sổ Max thật; chưa phát hành artifact mới lên gallery. Hai lỗi cài/khởi tạo người dùng báo trước đó chưa được sửa trong thay đổi chọn đích này.

### 2026-11-06 — Giao diện thanh kết nối theo ảnh tham chiếu

Thanh native nền tối, Connected: <scene> | 3ds Max 2022, dropdown monospace viền xanh với popup tối và PID trong từng mục, nút Focus 3ds Max. Focus xác minh PID/thời điểm khởi chạy trước khi tìm cửa sổ chính; khôi phục cửa sổ thu nhỏ, không đổi trạng thái phóng to. Báo lỗi nếu Windows từ chối focus. Header web tăng khoảng thở/nhận diện 3dsmood và bỏ Connected/renderer trùng khi native hỗ trợ chọn đích. Đã xem ảnh render thật của thanh native và popup trong tests/bin, không tác động scene người dùng. Web 164/164, WebView2/pipe 38/38, target-selection/focus 21/21; build Release x64 và gói MZP 1.3.2 thành công. Artifact local mới thay bản test trước: SHA256 1E6355C777589A24E17E2FDB857887E1B42EB331851946B81ED8B652345C906F. Chưa nghiệm thu UI/focus/merge trong Max thật; chưa phát hành lên gallery.

### 2026-11-06 — Sửa popup chọn Max tràn khi thu nhỏ

Bỏ DropDownWidth cố định 850px: popup luôn bằng chiều rộng ô chọn, cập nhật khi resize và trước khi mở. Dưới 800px, Connected lên hàng riêng; selector và Focus vẫn cùng hàng, mở rộng trở lại tự khôi phục layout một hàng. Đã xem ảnh render 600/420px; 43/43 WebView2/pipe/layout kiểm tra pass (gồm resize 1100→600→420→1100), build/staged archive tests/MZP structure pass. Artifact test local 1.3.2 được đóng lại, SHA256 BB886AF5FCC4AB9EF4C81FFB6744815AEC08DE21F8D3B3028BF3026DDFEE2E93; chưa phát hành gallery, chưa nghiệm thu resize trong Max thật.

### 2026-11-06 — Tự nối đường dẫn texture khi import, MZP 1.3.3

TexturePathResolver lập index giới hạn 20.000 entry trong đúng model-root từ index DPAPI; không viết cố định tên ảnh/model, không quét toàn SSD, không tải/giải nén lại. Ưu tiên relative từ entry/root → hậu tố thư mục cũ → basename duy nhất, phân biệt trùng tên, giữ asset local absolute hợp lệ, không dò UNC. pbHandleImportFile dùng cùng helper cho Max local và agent đích: copy material incoming, duyệt map/material lồng nhau, base object/modifier, asset đăng ký qua ATS và property filename (gồm array); gán absolute và reload. Merge MAX đổi sang renameMtlDups để không thay material trùng tên có sẵn. Texture thiếu/ambiguous/không retarget được hiện cảnh báo và chi tiết Listener; không lấy ảnh ngẫu nhiên.

Đã kiểm: texture resolver 14/14; downloaded-library 59/59 (gồm root lookup bảo vệ và đổi thư mục tải); WebView2/pipe/layout 43/43. Bộ resolver kiểm tra 19 texture thật trong cả 3 model đã tải trên máy đều tìm được absolute path. Build Release x64 + frontend + staged ZIP/RAR/7z và MZP structure thành công; artifact local installer/release/out/3dsmood-library.mzp, version 1.3.3, SHA256 FA8E8E7F66610F4CE0FDC0F95B08A4B54F11F5AB4822AD164CC1381E5540E463. Đã thêm test Max Batch riêng với INI/startup/macros tách biệt để kiểm tra material thật, giữ material cũ và save/reopen; tiến trình mới bị Autodesk từ chối license (ServiceErrorUserCancel / ADLSDK_STATUS_LICENSE_NOT_CHECKED_OUT), nên test MAXScript/material integration CHƯA CHẠY. Không thay scene Max đang mở. Cần nghiệm thu Standard/MultiSub/Corona/V-Ray/modifier trong Max có license, không khẳng định hỗ trợ mọi renderer bên thứ ba chưa kiểm. Chưa phát hành gallery.

### 2026-11-07 — Tối ưu nguồn Drive sau khi gom vào 3DMODELS

Drive API thật xác nhận gốc 3DSMOOD có hai nhánh 3DMODELS/3DSCENES; helper mới đọc đúng 11 nhóm danh mục trong 3DMODELS. Giữ root/source ID, chỉ đổi effective scan root và không tạo cấp danh mục 3DMODELS. Lỗi thiếu/trùng nhánh dừng trước publish. Checkpoint scoped được giữ khi resume; snapshot trước policy không dùng cho incremental. Worker tự xếp một FULL sau deploy cho nguồn 3DSMOOD/3DMODELS, không trùng job đang chạy và không tự thử lại mãi nếu fail/hủy.

Đã kiểm 402/402 API tests trên PostgreSQL thật, không skip. Regression gồm move Furniture dưới 3DMODELS giữ source/model/file/category ID; không liệt kê 3DSCENES; FULL không tải media; INCREMENTAL sau đó không gọi Drive; quét thiếu wrapper giữ nguyên catalog/missing_scans; resume đúng nhánh; nhiều worker chỉ xếp một FULL. Không cần migration hoặc build MZP. Chưa xác minh lượt FULL scoped trên production ở thời điểm ghi.

### 2026-11-07 — Models/Scenes riêng biệt, MZP 1.4.0

Thêm contentDomain 3dmodels/3dscenes xuyên suốt catalog, admin, plugin, downloaded snapshots và Drive jobs/snapshots. Giữ IDs Models; Scenes có nhiều danh mục, archive trùng chỉ gộp khi MD5+dung lượng đều khớp. Preview mới nằm trong thư mục riêng từng domain; có CLI copy+verify ảnh Models cũ, giữ URL cũ. Admin có hai cách upload, chọn phân vùng trong đồng bộ/cần duyệt. Plugin cũ nhận Models-only; plugin mới opt-in mixed catalog bằng capability header và ETag riêng. License dùng chung, import giữ merge vào Max đang chọn.

Kiểm tra: API407/407 không skip, web174/174, tooling4/4; native/build/package checks đạt. MZP1.4.0 local SHA256 F0AF6971D566AC74CA791806FEC4215C247F83A13AC7A94E0463DA96E824EF2E. Audit Drive14folder49archive và49preview local ghép đủ48stem; bản trùng1116753112 hiện ở hai danh mục. Production đã xác minh: FULL Models/Scenes đều hoàn tất, 49/49 ảnh upload thành công, 640 blob Models đã copy+verify sang thư mục riêng; catalog mới có 318 Models+48 Scenes, bản cũ giữ 318 Models. Đã kiểm hash 96 preview Scenes qua HTTPS, gallery phục vụ đúng MZP1.4.0 và filename.mzp. Chưa merge/render trong Max có license. Quy trình và trạng thái: [scenes-preview-rollout.md](scenes-preview-rollout.md).

### 2026-11-07 — Thư mục tải Scenes riêng, MZP 1.4.1

Cài đặt có hai thư mục Models/Scenes độc lập, chọn bằng hộp thoại native. Native chọn đúng thư mục theo contentDomain trong catalog. Index cũ giữ nguyên thư mục Models và khởi tạo mặc định Scenes; lựa chọn mới tồn tại sau restart. Model/scene đã tải giữ nguyên vị trí và tiếp tục import local, không tải/giải nén lại. Bridge chỉ nhận domain hợp lệ, không nhận đường dẫn từ JS. Kiểm tra: web175/175, downloaded-library71, WebView43; build Release x64, frontend, archive staging và MZP structure đạt. MZP1.4.1 SHA256 15A06566C8D4039A96B2BC080E8D06104352C1852D9FC92370B97D859D44F3CA.

### 2026-11-07 — Tên thư mục theo file Drive, MZP 1.4.2

Import-session trả thêm filename của archive nguồn. Native tải/giải nén trong thư mục tạm rồi đổi tên nguyên tử sang tên Drive bỏ đuôi nén trước khi lập index, áp dụng cả Models/Scenes. Trùng file/folder thêm (2), (3), không ghi đè. Giữ tên Unicode và khoảng trắng, xử lý ký tự Windows không hợp lệ/tên thiết bị/độ dài. Dữ liệu đã tải giữ nguyên vị trí và không tải lại để đổi tên. Kiểm tra API download21, thư viện80, downloader46; build Release x64/frontend, archive staging và MZP structure đạt. MZP1.4.2 SHA256 F754301A0A3D682CE65C961F5FD3329984E61014226FB4AF72D383AB1F985D06.

### 2026-11-07 — Giữ file nén gốc sau khi giải nén, MZP 1.4.3

Sau khi giải nén thành công, native không xoá archive nữa mà đổi `package.bin` thành `<tên thư mục>.<rar|zip|7z>`, đặt cạnh `content/` (ví dụ `1106880206/1106880206.rar`), ngoài cây import nên không thành tuỳ chọn import. Thay đổi hành vi "bỏ archive sau thành công" của D30; tốn thêm dung lượng bằng file nén. Đường dẫn vượt MAX_PATH thì bỏ archive thay vì làm hỏng lượt tải. Model đã tải bằng bản cũ không có file nén. Kiểm tra: downloaded-library 81/81 pass; build Release x64/frontend, ZIP/RAR/7z staging, MZP structure đạt (`-SkipDependencyRestore` vì `npm ci` bị EPERM khoá node_modules). Chưa test trong Max thật. MZP1.4.3 SHA256 82DEDD49570A1162E14342D85AEED26EB13D4F453F1040CA8A9F93B2F69228C5.

### 2026-11-07 — Yêu thích (Models/Scenes), MZP 1.4.4

Mỗi thẻ model/scene và khung chi tiết có nút sao; tab "Yêu thích" nằm cạnh "Đã tải", tách riêng theo Models/Scenes (chỉ trong plugin Max, trình duyệt không hiện). Danh sách lưu trong chỉ mục DPAPI native trên máy khách (`favorites`, UUID viết thường, tối đa 5000), qua hai method allowlist mới `library.favorites` và `library.setFavorite {modelId, favorite:bool}`; không đổi API/VPS/DB. Index cũ không có trường này vẫn đọc được. UI cập nhật trước, lỗi lưu thì hoàn tác và báo lỗi. Model đã bị gỡ khỏi catalog vẫn nằm trong index nhưng không hiện. Kiểm tra: web 177/177, downloaded-library 89 checks, WebView 43, native security 35, vite build ra thư mục tạm thành công (`dist` bị EPERM khóa nên không build đè được). MZP 1.4.4 (gồm cả sửa popup chọn cửa sổ Max và nút Thiết bị dưới Cài đặt) build local, SHA256 70CC12B3E528A3497FD2E5908C1A58381969D823FCE94A2B21E36D97930A7333, ZIP/RAR/7z staging và MZP structure đạt. Chưa thử trong Max thật, chưa phát hành.


### 2026-11-09 — Nút Cập nhật plugin trong panel Thiết bị (chưa phát hành)

Panel Thiết bị tự kiểm tra phiên bản khi mở: bằng bản mới nhất thì hiện "Phiên bản hiện tại là mới nhất", cũ hơn thì hiện nút Cập nhật. API: `GET /api/v1/plugin/latest` (công khai) đọc `version.txt` trong chính file `3dsmood-library.mzp` ở `PLUGIN_RELEASE_FILE` (mặc định `/var/www/3dsmood-download/`), trả `{version, sha256, size}`, cache theo mtime+size. Hai method allowlist mới, không tham số: `host.checkUpdate` và `host.applyUpdate` (web không gửi URL/đường dẫn). Khi bấm Cập nhật: hộp thoại xác nhận (đóng TẤT CẢ Max) -> host tải mzp từ `/download/` vào temp, kiểm size + SHA256 + version trong gói, giải nén chống zip-slip -> MAXScript `update.install` từ chối nếu scene chưa lưu, chạy `install.ms` im lặng (cờ `gPlatformSilentInstall`; cài side-by-side nên lỗi thì bản cũ vẫn active) -> host chạy script PowerShell tách rời chờ mọi `3dsmax.exe` thoát rồi mở Max trống, và gửi CloseMainWindow tới mọi Max (mỗi Max vẫn tự hỏi lưu). `make-release-mzp.ps1` giờ ghi thêm `payload/version.txt` (đưa version vào payload-id) để plugin đang chạy biết version của mình; bản cũ không có file này thì dùng AssemblyFileVersion. Kiểm tra: API 3 test mới đạt (các test cần Postgres không chạy được trên máy này: ECONNREFUSED), PluginUpdate 24 checks, downloaded-library 91, WebView 43, packaged runtime 13, native security 35, web 182/182, build MZP thử 1.4.5 qua verify-mzp + run-mzp-tests, API đọc đúng version/SHA256 từ MZP thật. **Chưa thử trong Max thật**: fileIn install.ms từ luồng host, CloseMainWindow của nhiều Max, script mở lại Max. Bản cài hiện tại (<= 1.4.4) chưa có tính năng này nên phải cài tay một lần bản mới. Triển khai cần nginx/VPS: user chạy API phải đọc được thư mục `3dsmood-download`.


### 2026-11-09 — Popup ảnh khi rê chuột, tim yêu thích, thư mục yêu thích, MZP 1.4.6 (chưa phát hành)

Thẻ model/scene: rê chuột vào ảnh hiện popup ảnh lớn (chỉ ảnh, lật trái/phải cho vừa cửa sổ); bấm thẻ vẫn mở panel phải, riêng Scenes hiện ảnh đúng tỉ lệ gốc và ảnh thẻ Scenes phủ kín ô vuông (`object-cover`, Models giữ nguyên). Ngôi sao thành trái tim: đã yêu thích thì luôn hiện (tim đặc đỏ) và bấm là bỏ ngay; chưa yêu thích thì chỉ hiện khi rê chuột và bấm mở bảng chọn thư mục (radio, ô tìm kiếm, "+ Tạo thư mục mới", nút Thêm). Mỗi model nằm đúng 1 thư mục; "Default" có sẵn (không đổi tên/xóa), model chưa chọn vào Default; đổi thư mục = bỏ yêu thích rồi yêu thích lại. Tab Yêu thích có chip Tất cả | Default | thư mục người dùng | +; thư mục đổi tên/xóa được, xóa thì bỏ yêu thích các model trong đó (có xác nhận). Thư mục tách riêng Models/Scenes, tối đa 50 thư mục/loại, tên 1–40 ký tự, không trùng (không phân biệt hoa thường), không dùng tên Default/Tất cả. Native: index DPAPI thêm `favoriteFolders` + `favoriteFolderOf` (index cũ đọc được, yêu thích cũ vào Default); 4 method allowlist mới `library.setFavoriteFolder/createFavoriteFolder/renameFavoriteFolder/deleteFavoriteFolder` (typed, không nhận path), `library.favorites`/`setFavorite` giờ trả `{favorites, folders, assignments}`. Kiểm tra: web 186/186, downloaded-library 111 checks (gồm thư mục/giới hạn/trùng tên/xóa), WebView 43, packaged runtime 13, native 35, vite build, MZP 1.4.6 qua verify-mzp + run-mzp-tests. Chưa thử trong Max thật (popup hover, vị trí popup theo kích thước cửa sổ plugin, bảng thư mục).


### 2026-11-09 — Bỏ icon danh mục, sắp xếp Mới nhất/Cũ nhất, picker chỉ .max, ô chọn cửa sổ Max mượt hơn, MZP 1.4.7 (chưa phát hành)

(1) Bỏ icon khối lập phương ở đầu mỗi dòng danh mục (dùng chung Models/Scenes, kể cả gallery công khai vì dùng chung component). (2) Thêm "Mới nhất"/"Cũ nhất" vào danh sách sắp xếp (giữ 3 kiểu cũ, mặc định vẫn Tên A→Z). API: manifest thêm trường tùy chọn `modifiedAt` = ngày sửa file trên Drive (join `drive_inventory` theo source+drive_file_id+content_domain), chỉ có khi đã quét ngày; client Models-only cũ không thấy trường này (đã lọc trong legacyManifest, checksum cũ không đổi); native chỉ đọc id/name nên bỏ qua trường lạ. Model chưa có ngày xếp cuối ở cả hai chiều. **Cần deploy API** thì sắp xếp mới mới có tác dụng; test DB mới (`routes.test.js`) viết nhưng CHƯA chạy được vì máy dev không có Postgres (Docker Desktop chưa bật). (3) Bảng chọn file import: `library.importOptions` chỉ trả file `.max` nếu gói có `.max` (index vẫn lưu cả .fbx/.obj); gói không có `.max` vẫn hiện .fbx/.obj; còn đúng 1 file thì web import thẳng như cũ. (4) Ô chọn cửa sổ Max: chỉ dựng lại danh sách khi dữ liệu hiển thị đổi (trước đây Items.Clear + dựng lại mỗi 1 giây làm chữ nháy), mở dropdown không còn quét cửa sổ đồng bộ trên UI thread, bỏ polling khi panel thu nhỏ/ẩn. Chưa đo thực tế trong Max; chỉ có test hành vi (mutation: tắt kiểm tra chữ ký thì test bắt được). Kiểm tra: web 188/188, downloaded-library 111, WebView 48, packaged runtime 13, native 35, PluginUpdate đạt, MZP 1.4.7 qua verify-mzp + run-mzp-tests.


### 2026-11-09 — Nút Làm mới hỏi máy chủ trước, MZP 1.4.8 (chưa phát hành)

Trước đây nút Làm mới ở thanh trên chỉ đọc lại dữ liệu cục bộ do host giữ (host tự hỏi VPS mỗi 5 phút), nên catalog vừa sync trên VPS không hiện ngay. Giờ trong 3ds Max nút gọi `library.refresh` (host kiểm tra VPS và tải preview mới) rồi mới tải lại giao diện; đang chạy thì nút bị khóa, icon quay, `aria-busy`, tooltip "Đang làm mới…", bấm chồng bị bỏ qua. Offline/lỗi mạng: lỗi được nuốt, vẫn đọc lại bản lưu và nút trở lại bình thường (trạng thái offline vẫn do host báo). Trình duyệt thường chỉ tải lại như cũ. Chỉ đổi web (HostBar, PluginApp), không đổi native/API. Kiểm tra: web 189/189 (có test mới, mutation: bỏ lời gọi `refreshLibrary` thì test bắt được), vite build, MZP 1.4.8 qua verify-mzp + run-mzp-tests. Chưa thử trong Max thật.


### 2026-11-09 — Cập nhật plugin không còn tự đóng/mở Max, MZP 1.4.9 (chưa phát hành)

Bỏ luồng tự đóng tất cả Max + script mở lại Max (hay lỗi). Luồng mới: Thiết bị báo có bản mới -> bấm Cập nhật -> hộp thoại xác nhận nhắc "sau khi cập nhật phải đóng và mở lại 3ds Max, hãy lưu công việc" -> host tải + kiểm SHA256 + giải nén -> Max chạy `install.ms` im lặng (vẫn cài side-by-side, lỗi thì bản cũ vẫn dùng) -> hiện popup "Đã cập nhật lên bản X, hãy đóng và khởi động lại 3ds Max". Không đóng/mở Max nào, bản cũ chạy tiếp cho tới khi người dùng tự khởi động lại. Bỏ `WriteRestartScript`/`StartDetached`/`RestartMaxForUpdate` và kiểm tra scene chưa lưu (không còn đóng Max nên không cần). Mới: `PluginUpdateService.MarkInstalled` (static, nhớ qua việc đóng/mở panel) để lần kiểm tra sau trả `restartRequired:true` thay vì mời cập nhật lại (DLL đang nạp vẫn báo version cũ); lệnh MAXScript `update.install` trả `{restartRequired:true}` rồi gọi `NotifyUpdateInstalled()` (popup native). Web: trạng thái "Đã cài bản mới. Hãy đóng và khởi động lại 3ds Max để dùng bản mới." và nút Cập nhật biến mất. **Lưu ý triển khai:** cập nhật do chính bản đang chạy thực hiện, nên máy đang chạy bản <= 1.4.8 vẫn dùng luồng cũ (tự đóng) khi cập nhật lên 1.4.9; cần cài tay 1.4.9 một lần, từ các bản sau mới theo luồng mới. Kiểm tra: web 190/190 (test mới cho restartRequired), PluginUpdate (thêm trạng thái chờ khởi động lại), WebView 48, downloaded-library 111, packaged runtime 13, MZP 1.4.9 qua verify-mzp + run-mzp-tests. Chưa thử trong Max thật (popup native, install im lặng từ panel).


### 2026-11-09 — Giao diện theo thương hiệu 3dsMood (logo đỏ, nền đen) cho plugin, gallery, admin; MZP 1.5.0 (chưa phát hành)

Theme: nền đen gần thuần, màu nhấn **đỏ logo `#8f120d`** (nền tab/nút/ô logo, `bg-accent`), đỏ sáng `#e5484d` (`text-brand`/`border-brand`) cho chữ và viền vì `#8f120d` trên nền đen tương phản thấp, xanh `--color-ok` giữ cho trạng thái thành công (ONLINE, Connected, ACTIVE/PAID). Logo `public/logo.svg` là `LOGO-WEB.svg` của khách cắt lại viewBox (`280 1020 1980 500`), component `Logo` dùng chung cho plugin (HostBar), gallery, admin (đầu trang + đăng nhập); font vẫn Codec Pro (đã có, cùng họ chữ với ảnh mẫu, đóng gói sẵn nên chạy offline). Bố cục plugin theo ảnh mẫu: icon Models/Scenes/Cài đặt/Thiết bị nằm ngang cạnh logo (bỏ cột dọc), popup Thiết bị mở dưới nút, sidebar hẹp (`lg:w-48`), thẻ nhỏ (8 cột ở 1250px), nút Import/Download trên thẻ đen viền trắng bo tròn (nút chính ở panel chi tiết, Mua thư viện, Cập nhật dùng đỏ), bỏ khối tiêu đề "3DS MOOD MODELS" (số model còn ở thanh phân trang). Giữ hết tính năng gần đây (tim, popup hover, thư mục yêu thích, sắp xếp, Làm mới, cập nhật). Native: thanh chọn cửa sổ Max và nút Focus đổi sang màu thương hiệu (nền `#121214`, viền đỏ, chữ chọn đỏ sáng); **chưa đổi bố cục native** (vẫn nhãn + ô chọn + nút Focus như cũ vì test bố cục phụ thuộc cấu trúc này). Màu/kích thước ước chừng từ ảnh mẫu (JPG nén), cần vòng chỉnh sau khi khách xem. Kiểm tra: web 190/190, build vite, WebView 48, packaged runtime 13, downloaded-library 111, PluginUpdate, MZP 1.5.0 qua verify-mzp + run-mzp-tests; đã chụp giao diện plugin (mock), gallery và đăng nhập admin bằng Edge headless để so với ảnh mẫu. Chưa xem trong Max thật (thanh native) và chưa xem các trang admin sau đăng nhập.


### 2026-11-09 — Icon thương hiệu (M) cho favicon, cửa sổ plugin và nút toolbar Max, MZP 1.5.1 (chưa phát hành)

Từ phần icon trong `LOGO-W.svg` (ô đỏ bo góc + chữ M; phần chữ "3dsMood" trong file nằm ngoài viewBox nên không hiện) sinh bằng `tools/make-brand-icons.cjs`: `favicon.svg` + `favicon.ico` (web, gắn trong `index.html` nên áp cho gallery, admin, trang plugin), `Resources/3dsmood.ico` nhúng vào DLL làm icon cửa sổ plugin (`LoadWindowIcon`, resource `MaxWebViewHost.Resources.3dsmood.ico`, đã kiểm tra DLL trong MZP chứa resource và icon tải được), và `installer/mzp/icons/3dsmood_{16,24}{i,a}.bmp` (24-bit, ảnh + mặt nạ alpha) cho nút toolbar. Macro `OpenPlatformPanel` thêm `icon:#("3dsmood", 1)`; `install.ms` chép 4 file bmp vào `getDir #userIcons` (trong try/catch, không làm hỏng cài đặt). **Chưa kiểm chứng trong Max 2022**: tên file/định dạng icon macro (`_24i`/`_24a` BMP), `getDir #userIcons`, và nút toolbar đã kéo trước đó đang ở chế độ hiển thị chữ nên phải chuột phải > Edit Button Appearance > Image hoặc kéo lại nút từ Customize User Interface. Giữ nguyên tên macro nội bộ. Kiểm tra: web 190/190, WebView 48, packaged runtime 13, MZP 1.5.1 qua verify-mzp (thêm icons vào danh sách bắt buộc) + run-mzp-tests.
