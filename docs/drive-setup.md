# Thiết lập quét Google Drive (API key)

Theo D26 hệ thống chỉ **đọc** Drive bằng **API key** trên thư mục chia sẻ công khai ("Anyone with the link"); không có OAuth, không có Gmail liên kết.
VPS quét danh sách file + tải ảnh preview; file model được VPS tải hộ từ link công khai khi khách mua (xem `v3-architecture.md`).

## 1. Chuẩn bị thư mục
1. Thư mục root `3DSMOOD` (và mọi file model/ảnh bên trong) chia sẻ **Anyone with the link: Viewer**.
2. Không tắt "Người xem có thể xem tùy chọn tải xuống": nếu tắt, Drive trả `canDownload=false` và hệ thống không tìm cách vượt qua.

## 2. Tạo API key
1. Google Cloud Console → tạo project → bật **Google Drive API**.
2. *Credentials → Create credentials → API key*. Nên giới hạn key theo API (chỉ Drive API); không đặt giới hạn theo referrer vì VPS gọi trực tiếp.
3. Đặt vào `apps/store-api/.env` (hoặc `/etc/3dsmood/store.env` trên VPS): `DRIVE_API_KEY=<key>`. **Không commit.** Nếu key từng lộ ra log/chat, tạo lại.

## 3. Kết nối và thử
1. Tạo tài khoản admin: `ADMIN_PASSWORD=<mật khẩu> npm run create-admin -- <tên-đăng-nhập>` (trong `apps/store-api`).
2. Đăng nhập `/admin` → **Kết nối Drive**: trạng thái phải là "Đã cấu hình khóa API". Dán link thư mục root để thêm nguồn.
3. **Kiểm tra truy cập**: kỳ vọng `canList` và `canDownloadSample` đều đạt.
4. Mở **Quét đồng bộ** → chạy FULL. Thư viện thật: ~126 thư mục / ~845 file / 360 model.

## 4. Bảo mật
* `DRIVE_API_KEY` chỉ nằm trong env của server; API admin và plugin không bao giờ nhận hay trả key, cũng không trả Drive ID của model.
* Quét bị giới hạn số file/thư mục mỗi lần (`SCAN_LIMIT_EXCEEDED`) và tốc độ (xem `apps/store-api/.env.example`).
