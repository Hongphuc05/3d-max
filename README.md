# 3ds Max Platform Extension (3DS Mood)

Plugin cho Autodesk 3ds Max 2022 (C#/.NET Framework 4.8 + WebView2) hiển thị thư viện 3D model 3DS Mood và import thẳng vào scene.
Khách mua **license cả thư viện, vĩnh viễn, 1 máy**; đơn hàng xác nhận qua Telegram/admin web.

**Luồng:** worker quét Google Drive (API key) → PostgreSQL + ảnh preview trên VPS → plugin đọc `/api/v1`, tải model qua VPS, import bằng bridge có allowlist.
Bộ cài không đóng sẵn catalog hay ảnh: lần chạy đầu plugin tải từ VPS (có tiến độ, chạy tiếp được khi ngắt).

**Download** chỉ tải và giải nén model một lần. Mục **Đã tải** lưu danh sách qua các lần mở Max; chọn **Import** để đọc model từ ổ đĩa, không tải hay giải nén lại. **Cài đặt** cho đổi thư mục lưu model tải sau, giữ nguyên vị trí model cũ và texture. Import offline dùng quyền đã xác minh gần nhất; thông tin thu hồi quyền đã nhận được lưu lại để chặn import.

## Chạy API + admin web
Xem [`apps/README.md`](apps/README.md) (Node 22.9+, PostgreSQL 16, `npm run create-admin` để tạo admin).

## Build plugin MZP (Windows)
```powershell
powershell -ExecutionPolicy Bypass -File installer\build-mzp.ps1 -ApiBaseUrl https://<domain>
installer\release\out\3dsmood-library.mzp
```
Trong Max: `Scripting > Run Script`, chọn file `.mzp`. Sau đó vào `Customize > Customize User Interface > Toolbars`, Category `Platform`, kéo nút mở panel vào toolbar.

## Cấu trúc
| Thư mục | Nội dung |
|---|---|
| `apps/store-api/` | API + worker quét Drive (Express, PostgreSQL) |
| `apps/store-web/` | UI plugin (WebView2) và trang `/admin` (React/Vite) |
| `plugin-csharp/` | Plugin host: WebView2 + bridge. Không tham chiếu `Autodesk.Max` |
| `maxscript/` | Handler phía Max + macroscript cho nút toolbar |
| `installer/` | Đóng thành một file `3dsmood-library.mzp` |
| `deploy/` | Nginx, systemd, backup/restore, diễn tập deploy Docker |
| `docs/` | Mục lục: [`docs/README.md`](docs/README.md) · trạng thái: [`docs/STATUS-v3.md`](docs/STATUS-v3.md) |
