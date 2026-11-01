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
- [x] **Giao diện P3.1 trong `apps/store-web`** (mục "Kết nối Drive" của admin, route `/admin`): trạng thái khóa (không nhập/không hiển thị khóa), form thư mục gốc, bảng nguồn, "Kiểm tra truy cập" hiện từng mục. 9 test jsdom + 1 test route; thử phá **18/18** đột biến bị bắt; `vite build` ok; **store-web 79/79 pass**. Đã mở trên trình duyệt thật (chủ dự án): màn hiển thị đúng; "Kiểm tra truy cập" lộ lỗi tìm file mẫu một cấp, đã sửa ba lần; lần 3 lấy file mẫu từ `drive_inventory` (kiểm trên dữ liệu thật: tải 100 byte JPEG thành công), **chưa bấm lại trên giao diện sau lần sửa 3**. Chưa chạy Playwright e2e.
- [ ] P3.1 chưa thử với Google thật qua endpoint admin (mới chạy với Drive giả).
- [ ] P3.2 và P3.3 phía giao diện (`apps/store-web`): chưa làm.
- [ ] P3.4 Mục cần duyệt (`/admin/catalog/review*`): chưa làm; cần chủ dự án duyệt 4 quyết định thiết kế trước.
- [ ] P3.5 Thiết bị và quyền, P3.6 Đơn hàng: chưa làm (phụ thuộc P4, P5).
- [ ] P3.7 Cài đặt và bảng model (`/admin/models`, `/admin/settings`): chưa làm.
- [ ] API admin P3 **chưa chạy trên server thật với token admin thật**; mới chạy qua test với xác thực giả cộng `requireAdmin` thật.
- [ ] Mã lỗi `JOB_NOT_FOUND` (422) là mã tôi thêm, plan không nêu; chờ chủ dự án xác nhận.

## P4 – P7
- [ ] Chưa bắt đầu (API khách + plugin, đơn hàng, vận hành, dọn mã cũ). Plugin 3ds Max chưa bị chạm tới trong P2/P3.

---

## Việc còn mở cần chủ dự án quyết định hoặc làm
- [ ] Duyệt 4 quyết định thiết kế ở P2.5 (mô hình mồ côi, đổi ánh xạ → cần duyệt, file ở gốc → "Uncategorized", đồng bộ danh mục) và chỗ lệch ở migration 018.
- [ ] **Tạo lại API key Drive** (khóa cũ từng bị lộ).
- [ ] Xác nhận nhánh làm P3: plan ghi `v3/p1-drive-oauth`, P2 đã tách `v3/p2-sync-worker` theo yêu cầu; hiện P3 làm tiếp trên nhánh P2.
- [ ] Nguyên nhân Google chặn tải ảnh **chưa xác nhận** (chỉ có báo cáo cộng đồng; quan sát thực tế: tải được khoảng 57–191 ảnh liên tiếp thì bị chặn chừng một giờ rồi tự gỡ).

## Lưu ý vận hành đã gặp
- `.env` mặc định trỏ database `store`; dữ liệu P2 ở `store_p2`. Terminal mới mà không đặt `DATABASE_URL` sẽ gặp lỗi Postgres `42P01` (không có bảng).
- `npm run sync:drive` chỉ **xếp job vào hàng đợi**; phải chạy `node --env-file-if-exists=.env src/worker.js` để xử lý.

## Quy trình đang áp dụng
Mỗi bước: ghi log vào `STATUS.md` → viết test (PostgreSQL thật) → thử phá bằng đột biến → chạy cả bộ `npm test` → commit **local**. Không push, không tạo PR, không commit secret.
