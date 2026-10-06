# Web store (Phase A) — hướng dẫn chạy

Tiến độ và việc còn lại: [`../docs/STATUS.md`](../docs/STATUS.md).

## Yêu cầu

| | macOS | Windows |
|---|---|---|
| Node | 22.9+ (cần `--env-file-if-exists`) | 22.9+ |
| Công cụ đọc file nén | `bsdtar` (có sẵn) | `tar.exe` (có sẵn từ Windows 10 1803, là libarchive) |
| Dữ liệu | `source/3DSMOOD/` ở gốc repo (~10 GB, **không có trong git**) | như vậy |
| Ổ đĩa trống | ≥ 1 GB cho `storage/` | như vậy |

`source/` và `storage/` đều bị gitignore. Máy mới phải **tự copy `source/3DSMOOD/`** vào và chạy
ingest để sinh `storage/`.

## Database (PostgreSQL 16, từ A3)

API cần Postgres. Mặc định kết nối `postgres://store:store@localhost:5432/store`; test dùng
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

Bảng được tạo tự động khi API khởi động (`migrations/*.sql`). Không cần chạy lệnh migrate riêng.

## Chạy lần đầu

Làm xong phần **Database** ở trên trước. Mở 2 terminal, đứng ở gốc repo.

**macOS / Linux**

```bash
# terminal 1 — API
cd apps/store-api
npm install
cp .env.example .env  # tạo cấu hình (mặc định đã khớp Postgres ở trên)
npm run ingest        # quét source/3DSMOOD -> storage/ (khoảng 10-40 giây)
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
npm run ingest
npm run dev

# terminal 2 — giao diện
cd apps\store-web
npm install
npm run dev
```

Mở **http://localhost:5173**. Những lần sau chỉ cần `npm run dev` ở cả hai thư mục (ingest chỉ chạy
lại khi `source/` đổi).

## Test

```bash
cd apps/store-api && npm test      # cần Postgres đang chạy (database store_test)
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
