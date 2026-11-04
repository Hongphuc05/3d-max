# 3ds Max Platform Extension (3DS Mood)

Plugin cho Autodesk 3ds Max 2022 (C#/.NET Framework 4.8 + WebView2) hiển thị thư viện 3D model 3DS Mood và import thẳng vào scene.
Khách mua **license cả thư viện, vĩnh viễn, 1 máy**; đơn hàng xác nhận qua Telegram/admin web.

**Luồng:** worker quét Google Drive (API key) → PostgreSQL + ảnh preview trên VPS → plugin đọc `/api/v1`, tải model qua VPS, import bằng bridge có allowlist.
Bộ cài không đóng sẵn catalog hay ảnh: lần chạy đầu plugin tải từ VPS (có tiến độ, chạy tiếp được khi ngắt).

## Chạy API + admin web
Xem [`apps/README.md`](apps/README.md) (Node 22.9+, PostgreSQL 16, `npm run create-admin` để tạo admin).

## Build plugin + installer (Windows)
```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -ApiBaseUrl https://<domain>
installer\PlatformSetup.exe
```
Đóng Max trước khi cài. Trong Max: `Customize > Customize User Interface > Toolbars`, Category `Platform`, kéo nút mở panel vào toolbar.

## Cấu trúc
| Thư mục | Nội dung |
|---|---|
| `apps/store-api/` | API + worker quét Drive (Express, PostgreSQL) |
| `apps/store-web/` | UI plugin (WebView2) và trang `/admin` (React/Vite) |
| `plugin-csharp/` | Plugin host: WebView2 + bridge. Không tham chiếu `Autodesk.Max` |
| `maxscript/` | Handler phía Max + macroscript cho nút toolbar |
| `installer/` | Đóng thành `PlatformSetup.exe` |
| `deploy/` | Nginx, systemd, backup/restore, diễn tập deploy Docker |
| `docs/` | Mục lục: [`docs/README.md`](docs/README.md) · trạng thái: [`docs/STATUS-v3.md`](docs/STATUS-v3.md) |
