# Web store (Phase A) — hướng dẫn chạy

Tiến độ và việc còn lại: [`../docs/STATUS.md`](../docs/STATUS.md).

License Lifetime + payOS: xem [setup](../docs/license-payos-setup.md) và [API](../docs/license-payos-api.md).
Catalog mặc định lấy từ Cloudflare R2 private qua PostgreSQL; backend quét metadata khi khởi động và mỗi 10 phút, rồi gửi thay đổi qua SSE. Xem [cấu hình và vận hành](../docs/r2-catalog.md).
API tài khoản/license chạy khi R2 chưa sẵn sàng; status catalog phân biệt thiếu cấu hình, chưa sync, lỗi R2 và snapshot cũ.
Tải/import yêu cầu license ACTIVE và phiên thiết bị đã chứng minh khóa CNG. Cấu hình hai secret license trước khi kích hoạt.

## Yêu cầu

| | macOS | Windows |
|---|---|---|
| Node | 22.9+ (cần `--env-file-if-exists`) | 22.9+ |
| Công cụ đọc file nén | `bsdtar` (có sẵn) | `tar.exe` (có sẵn từ Windows 10 1803, là libarchive) |
| Dữ liệu Online | Private R2 + Object Read credentials chỉ trên backend | như vậy |
| Ổ đĩa trống | ≥ 1 GB cho `storage/` | như vậy |

`source/` và `storage/` đều bị gitignore. R2 mode dùng database và metadata object;
không copy toàn bộ model về server. Phần ingest/source/tar bên dưới chỉ dành cho development khi đặt rõ `CATALOG_PROVIDER=local`.

## Database (PostgreSQL 16, từ A3)

API cần `DATABASE_URL` của Postgres trong `.env`; test dùng
database `store_test`. Chọn **một** cách:

**Cách 1 — Docker** (mọi hệ điều hành; tự tạo sẵn user `store` và 2 database):
```bash
docker compose up -d        # chạy ở gốc repo
```

**Cách 2 — Postgres cài sẵn** (macOS: `brew install postgresql@16`; Windows: bản cài của postgresql.org):
```bash
psql -U <superuser> -d postgres -c "create role store login password 'store'"
psql -U <superuser> -d postgres -c "create database store owner store"
psql -U <superuser> -d postgres -c "create database store_test owner store"
```

Bảng được tạo khi API khởi động ở development (`migrations/*.sql`). Production chạy migration riêng
bằng `node --env-file=.env scripts/migrate.js` với role phù hợp; runtime mặc định không chạy DDL.

## Chạy lần đầu

Làm xong phần **Database** ở trên trước. Mở 2 terminal, đứng ở gốc repo.

**macOS / Linux**

```bash
# terminal 1 — API
cd apps/store-api
npm install
cp .env.example .env  # tạo cấu hình (mặc định đã khớp Postgres ở trên)
# Điền R2_READ_* và R2_ENDPOINT; API tự chạy initial sync khi khởi động.
npm run dev           # http://localhost:4000 (tự tạo bảng trong Postgres)

# terminal 2 — giao diện
cd apps/store-web
npm install
npm run dev           # http://localhost:5173
```

**Windows (PowerShell)**

```powershell
# terminal 1 — API
cd apps\store-api
npm install
copy .env.example .env   # tạo cấu hình (mặc định đã khớp Postgres ở trên)
# Điền R2_READ_* và R2_ENDPOINT; API tự chạy initial sync khi khởi động.
npm run dev

# terminal 2 — giao diện
cd apps\store-web
npm install
npm run dev
```

Mở **http://localhost:5173**. Những lần sau chỉ cần `npm run dev` ở cả hai thư mục. Backend sẽ liệt kê lại metadata R2 theo chu kỳ, không cần Event Notifications, Queue, Worker hoặc Tunnel. Khi một lần quét phát hiện thay đổi, SSE cập nhật cây category, model, preview và số lượng mà không cần reload trang.

Không có tài khoản/mật khẩu admin mặc định. Đăng ký tài khoản chủ sở hữu trước, lấy UUID đã xác minh từ
PostgreSQL rồi thêm UUID đó vào `LICENSE_ADMIN_USER_IDS` trong môi trường backend; khởi động lại API và
đăng nhập lại. Xóa UUID khỏi cấu hình sẽ thu hồi quyền admin. Sau đó có thể quản lý tài khoản, license,
thiết bị, thanh toán và lịch sử trong mục quản trị. Production cần chạy migrations 011–013 trước khi dùng.
Chi tiết tại [Trang quản trị](../docs/license-payos-setup.md#trang-quản-trị).

## Xem giao diện như đang ở trong 3ds Max (chỉ khi dev)

Mở **http://localhost:5173/?mockMax=1**: giả lập host 3ds Max để xem nút Download, hàng đợi và thanh trạng thái
ngay trên trình duyệt (cần đăng nhập; ~25% job giả lập cố ý lỗi để xem trạng thái "Thử lại"). Không có trong bản build.

## Test

```bash
cd apps/store-api && npm test      # TEST_DATABASE_URL riêng, tên database chứa test
cd apps/store-web && npm test      # queue, license flow, React UI với jsdom
```

## Lưu ý theo hệ điều hành

- **macOS:** port 5000 bị AirPlay Receiver chiếm, nên API dùng **4000**.
- **Docker Compose và Postgres trên Windows chưa chạy thử.** Máy dev macOS đang dùng Postgres cài
  sẵn (cách 2); `docker-compose.yml` chưa được chạy vì Docker chưa bật.
- **Windows — chưa chạy thử.** Mọi thứ trong dự án này mới được chạy trên macOS. Script đã xử lý
  hai điểm khác biệt đã biết (lệnh `tar` thay `bsdtar`, dòng kết thúc `\r\n`), nhưng
  **`tar.exe` có đọc được RAR hay không chưa được xác minh**. Nếu `storage/ingest-report.json` báo
  gần như mọi file nén đều lỗi thì đó là nguyên nhân; giải pháp là cài 7-Zip và đổi lệnh trong
  `scripts/ingest.js`.
- **24 file `.rar` dạng solid** không đọc được bằng `bsdtar`/`tar` ở cả hai hệ điều hành. Sản phẩm
  vẫn hiện bình thường, chỉ thiếu thông tin chi tiết về gói. Xem `storage/ingest-report.json`.

## Đổi cấu hình

Cấu hình nằm trong `apps/store-api/.env` (bị gitignore). Máy mới: copy `.env.example` thành `.env`
(`cp .env.example .env`, Windows: `copy .env.example .env`). Các script `npm run dev|start|ingest|test`
tự nạp file này; không có file thì dùng giá trị mặc định ở bảng dưới. **Không commit `.env`.**

| Biến môi trường | Mặc định | Dùng cho |
|---|---|---|
| `PORT` | `4000` | port API |
| `API_URL` | `http://localhost:4000` | nơi Vite proxy `/api` và `/previews` tới |
| `DATABASE_URL` | `postgres://store:store@localhost:5432/store` | kết nối Postgres |
| `TEST_DATABASE_URL` | `postgres://store:store@localhost:5432/store_test` | database dùng cho test |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | các origin được gửi request ghi (chống CSRF); production phải đặt đúng domain |
| `NODE_ENV` | — | `production` thì cookie đăng nhập có cờ `Secure` (bắt buộc HTTPS) |
| `SOURCE_DIR` | `<repo>/source/3DSMOOD` | thư mục dữ liệu gốc khi ingest |
| `STORAGE_DIR` | `<repo>/storage` | nơi ghi/đọc `catalog.json` và thumbnail |
