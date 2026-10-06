# Web store (Phase A) — hướng dẫn chạy

Tiến độ và việc còn lại: [`../docs/STATUS.md`](../docs/STATUS.md).

## Yêu cầu

| | macOS | Windows |
|---|---|---|
| Node | 22+ | 22+ |
| Công cụ đọc file nén | `bsdtar` (có sẵn) | `tar.exe` (có sẵn từ Windows 10 1803, là libarchive) |
| Dữ liệu | `source/3DSMOOD/` ở gốc repo (~10 GB, **không có trong git**) | như vậy |
| Ổ đĩa trống | ≥ 1 GB cho `storage/` | như vậy |

`source/` và `storage/` đều bị gitignore. Máy mới phải **tự copy `source/3DSMOOD/`** vào và chạy
ingest để sinh `storage/`.

## Chạy lần đầu

Mở 2 terminal, đứng ở gốc repo.

**macOS / Linux**

```bash
# terminal 1 — API
cd apps/store-api
npm install
npm run ingest        # quét source/3DSMOOD -> storage/ (khoảng 10-40 giây)
npm run dev           # http://localhost:4000

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
cd apps/store-api && npm test
```

## Lưu ý theo hệ điều hành

- **macOS:** port 5000 bị AirPlay Receiver chiếm, nên API dùng **4000**.
- **Windows — chưa chạy thử.** Mọi thứ trong dự án này mới được chạy trên macOS. Script đã xử lý
  hai điểm khác biệt đã biết (lệnh `tar` thay `bsdtar`, dòng kết thúc `\r\n`), nhưng
  **`tar.exe` có đọc được RAR hay không chưa được xác minh**. Nếu `storage/ingest-report.json` báo
  gần như mọi file nén đều lỗi thì đó là nguyên nhân; giải pháp là cài 7-Zip và đổi lệnh trong
  `scripts/ingest.js`.
- **24 file `.rar` dạng solid** không đọc được bằng `bsdtar`/`tar` ở cả hai hệ điều hành. Sản phẩm
  vẫn hiện bình thường, chỉ thiếu thông tin chi tiết về gói. Xem `storage/ingest-report.json`.

## Đổi cấu hình

| Biến môi trường | Mặc định | Dùng cho |
|---|---|---|
| `PORT` | `4000` | port API |
| `API_URL` | `http://localhost:4000` | nơi Vite proxy `/api` và `/previews` tới |
| `SOURCE_DIR` | `<repo>/source/3DSMOOD` | thư mục dữ liệu gốc khi ingest |
| `STORAGE_DIR` | `<repo>/storage` | nơi ghi/đọc `catalog.json` và thumbnail |
