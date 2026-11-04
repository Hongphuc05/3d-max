# Chạy hệ thống v3 (API, worker, admin web)

Luồng v3: worker quét Google Drive (API key) → PostgreSQL (catalog) + ảnh preview trên VPS → plugin trong 3ds Max đọc `/api/v1`
(catalog, thiết bị, đơn hàng + Telegram, tải model qua VPS) → admin quản trị qua web `/admin`.
Tiến độ: [`../docs/STATUS-v3.md`](../docs/STATUS-v3.md). Triển khai: [`../docs/p6-runbook.md`](../docs/p6-runbook.md).

| Thư mục | Vai trò |
|---|---|
| `store-api/` | Express 5 + PostgreSQL: `/api/v1` (plugin), `/api/admin` (admin), worker quét Drive (`npm run worker`) |
| `store-web/` | React/Vite: giao diện plugin (chạy trong WebView2) và `/admin` |

## Yêu cầu
Node 22.9+ (cần `--env-file-if-exists`), PostgreSQL 16 (hoặc `docker compose up -d` ở gốc repo — tạo sẵn DB `store` và `store_test`).

## Chạy lần đầu (macOS/Linux; Windows: `copy` thay `cp`)
```bash
cd apps/store-api
npm install
cp .env.example .env      # điền JWT_SECRET (32 byte base64) và DRIVE_API_KEY; mặc định khớp docker-compose
npm run dev               # http://localhost:4000, tự tạo bảng ở môi trường dev
ADMIN_PASSWORD='<mật khẩu>' npm run create-admin -- <tên-đăng-nhập>   # tạo/đặt lại admin (chạy lại được)
npm run worker            # (terminal khác) worker quét Drive

cd ../store-web && npm install && npm run dev    # http://localhost:5173/admin
```
Production không tự migrate: `npm run migrate` (xem runbook). Không có tài khoản mặc định; admin chỉ tạo bằng `create-admin`
(email nội bộ `<tên>@admin.local`, mật khẩu 8–128 ký tự). Xem giao diện plugin trên trình duyệt: `http://localhost:5173/?mockMax=1`.

## Test
```bash
cd apps/store-api && npm test    # cần TEST_DATABASE_URL (tên DB chứa "test"); mỗi file test dùng schema cô lập
cd apps/store-web && npm test && npx vite build
```

## Cấu hình
`apps/store-api/.env` (gitignore, **không commit**); mẫu và ý nghĩa từng biến: `.env.example`. macOS: port 5000 bị AirPlay chiếm nên API dùng 4000.
