# v3 — Kết quả kiểm chứng P2 → P3 (chỉ phần còn hiệu lực)

Cập nhật: 2026-11-01 · nhánh `v3/p2-sync-worker` · commit mới nhất tại thời điểm viết: `329afd9`.

**Cách đọc.** File này chỉ liệt kê điều đã được **chạy và thấy kết quả**, theo trạng thái code hiện tại. Không ghi lại các kết quả đã bị thay thế (route/tên trường cũ, số test cũ, các lần chạy thất bại giữa chừng, các nhận định sau đó phải rút lại). Lịch sử đầy đủ nằm ở bảng "Nhật ký P2" trong [`STATUS.md`](STATUS.md). Mục "Chưa kiểm chứng" ở cuối là phần quan trọng nhất để đọc.

---

## 1. Bộ test tự động

| Chỉ số | Giá trị |
|---|---|
| Tổng số test (`npm test` trong `apps/store-api`) | **356 / 356 pass**, 0 fail, 0 cancelled, 0 skipped |
| Môi trường | Node 26 (`node:test`), PostgreSQL 16 thật (Docker), `TEST_DATABASE_URL` trỏ `store_test`; mỗi file test dùng một database cô lập |
| Baseline trước v3 | 194 test |

Số test trong từng file của P2/P3 (đếm khối `test(`; `migration.test.js` của Drive và `server.test.js` còn chứa cả test có từ trước):

| Khu vực | File | Số test |
|---|---|---|
| Schema, seed | `worker/migration.test.js`, `worker/seed.test.js`, `drive/migration.test.js` | 11 · 5 · 3 |
| Hàng đợi, vòng lặp worker | `worker/queue.test.js`, `worker/runner.test.js`, `worker/runner-log.test.js` | 10 · 7 · 2 |
| Quét, ghép cặp, so sánh | `worker/scan.test.js`, `worker/mapper.test.js`, `worker/diff.test.js` | 14 · 17 · 14 |
| Ảnh preview, công bố | `worker/previews.test.js`, `worker/publish.test.js` | 18 · 17 |
| Ghép nối, cấu hình, điểm vào | `worker/process.test.js`, `worker/config.test.js`, `worker/entry.test.js` | 12 · 5 · 3 |
| Client Drive bằng API key | `drive/client-apikey.test.js` | 5 |
| API catalog công khai | `catalog-v1/routes.test.js` | 12 |
| API admin lượt đồng bộ (P3) | `drive/sync-routes.test.js` | 9 |
| Server | `server.test.js` | 3 |

## 2. Thử phá biện pháp an toàn (đột biến)

Cách làm: sửa một chỗ trong code sản xuất cho nó sai, chạy test, kỳ vọng test **thất bại**; mutant "sống" nghĩa là test còn thiếu.

| Phạm vi | Kết quả |
|---|---|
| Sửa 3 phát hiện của review P2 (đếm byte, log worker, trần SSE theo IP) | 7/7 mutant bị bắt |
| API admin lượt đồng bộ P3 (`sync-routes.js`) | **14/14 bị bắt** — gồm lộ Drive ID, lộ checkpoint, lặp trang, bỏ trần SSE, hủy job đã xong, nguồn bị tắt (POST và retry), retry đổi mode, tên trường sai, thêm trường ngoài plan |

## 3. Chạy với Google Drive thật (P2.8, DB `store_p2`, 2026-11-01)

Nguồn: thư mục gốc của dự án, quét bằng **API key** (D26), không OAuth.

| Tiêu chí | Kết quả quan sát được |
|---|---|
| Job FULL chạy hết và công bố | `COMPLETED`, **0 lỗi**; 126 thư mục, 720 file quét; **360 model, 79 danh mục, 720 preview**; 720 file WebP trên đĩa khớp 720 dòng trong DB; thư mục `tmp` rỗng; catalog version 1 |
| Chạy lại lần 2 (Drive không đổi) | `new=0, updated=0, unchanged=360, review=2`; **`bytes_downloaded=0`**; `active_version` và checksum không đổi |
| Tiếp tục sau khi dừng | Dừng bằng Ctrl+C (SIGINT) khi đang tải ảnh; job về `QUEUED`, `attempt 0`, giữ checkpoint; chạy lại tiếp tục đến đủ 360 |
| Gặp trang chặn của Google (HTTP 403 dạng HTML) | Worker nhận diện là giới hạn tốc độ, **nghỉ rồi thử lại đúng ảnh**, không ghi là lỗi của ảnh; cuối cùng hoàn tất 0 lỗi |
| Ảnh hiển thị | Mở `/previews/<sha256>.webp` trên trình duyệt thấy ảnh đúng |

## 4. API công khai `/api/v1` (kiểm bằng `curl`, server cổng 4010, DB `store_p2`)

| Kiểm tra | Kết quả |
|---|---|
| `GET /api/v1/catalog/version` | `200`, `ETag: "1-<checksum>"`, `catalogVersion 1`; checksum **khớp** bảng `catalog_state` |
| `GET /api/v1/categories` | 79 mục |
| `GET /api/v1/catalog` | 360 model |
| `GET /api/v1/previews/manifest` | 720 ảnh, URL dạng `/previews/<64 ký tự>.webp` |
| `GET /previews/<sha256>.webp` | `200`, `image/webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable` |
| `If-None-Match` đúng ETag | `304 Not Modified` |
| `/previews/..%2f..%2f.env` và `/previews/abc.webp` | cả hai `404` |

## 5. Hợp đồng API admin lượt đồng bộ (P3) — đối chiếu plan §2.2

Đã khóa bằng test (so khớp danh sách khóa JSON chính xác): `Job` với `counters.{scannedFolders,scannedFiles,new,updated,unchanged,missing,review,skipped,errors}` và `heartbeatAt`; `POST /sync-jobs` 202 `{jobId}`; `GET /sync-jobs` phân trang `{items,nextCursor}`; `GET /sync-jobs/:id`; `GET /sync-jobs/:id/items?status=FAILED` trả mảng `{driveFileName,path,action,status,errorCode,errorMessage}` không có Drive ID; `POST /sync-jobs/:id/cancel` 202; `POST /sync-jobs/:id/retry` 202 `{jobId}`, 409 khi đang chạy; `GET /sync-jobs/:id/events` (SSE `progress`/`done`, trần số luồng). Guard: chưa đăng nhập 401, người dùng thường 403, không ghi gì vào DB.

---

## 6. Chưa kiểm chứng (đọc kỹ)

- **RAM của worker suốt cả job: chưa đo.** Tiêu chí plan là dưới 400 MB; chỉ có số đỉnh khoảng 94 MB ở giai đoạn quét.
- **Dừng đột ngột (kill cứng, mất lease) trên Drive thật: chưa thử.** Mới thử Ctrl+C (dừng êm). Việc nhận lại job hết lease chỉ được kiểm bằng test với Drive giả.
- **Nguyên nhân Google chặn tải ảnh: chưa xác nhận.** Quan sát thực tế: tải được khoảng 57–191 ảnh liên tiếp thì bị chặn khoảng một giờ rồi tự gỡ. Chỉ có báo cáo cộng đồng, không có tài liệu chính thức; ngưỡng thật chưa biết.
- **API admin P3 chưa chạy trên server thật với token admin thật**, chỉ chạy qua test với xác thực giả cộng `requireAdmin` thật.
- **Chưa làm của P3:** cấu hình nguồn bằng API key trong `GET /drive/status` và `POST /drive/sources` (P3.1), duyệt mục cần xem (P3.4), `admin/models` và `admin/settings` (P3.7), toàn bộ giao diện `store-web`. P3.4 còn chờ chủ dự án duyệt 4 quyết định thiết kế (mục "Việc còn mở sau P2" trong `STATUS.md`).
- **Chưa xử lý bảo mật:** API key Drive từng bị lộ cần tạo lại (regenerate).
- **Chưa kiểm chứng ở phía plugin 3ds Max:** P2/P3 chưa chạm tới plugin; việc đọc catalog từ plugin là P4.

## 7. Lưu ý vận hành đã gặp

- Tệp `.env` mặc định trỏ database `store`; dữ liệu P2 nằm ở `store_p2`. Mở terminal mới mà không đặt `DATABASE_URL` sẽ gặp lỗi Postgres `42P01` (không có bảng) vì quét nhầm database.
- `npm run sync:drive` chỉ **xếp job vào hàng đợi**; phải chạy `node --env-file-if-exists=.env src/worker.js` để job được xử lý.
- Biến cấu hình giãn tải ảnh: `PREVIEW_DELAY_MS` (1500), `PREVIEW_CONCURRENCY` (1), `PREVIEW_COOLDOWN_MS` (600000).
