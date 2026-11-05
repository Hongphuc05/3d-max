# Thiết lập quét Google Drive (API key)

Theo D26 hệ thống chỉ **đọc** Drive bằng **API key** trên thư mục chia sẻ công khai ("Anyone with the link"); không có OAuth, không có Gmail liên kết.
VPS quét danh sách file + tải ảnh preview; file model được VPS tải hộ từ link công khai khi khách mua (xem `v3-architecture.md`).

## 1. Chuẩn bị thư mục
1. Thư mục root `3DSMOOD` (và mọi file model/ảnh bên trong) chia sẻ **Anyone with the link: Viewer**.
2. Không tắt "Người xem có thể xem tùy chọn tải xuống": nếu tắt, Drive trả `canDownload=false` và hệ thống không tìm cách vượt qua.

## 2. Tạo API key
1. Google Cloud Console → tạo project → bật **Google Drive API**.
2. *Credentials → Create credentials → API key*. Giới hạn key theo API (chỉ Drive API); với VPS, dùng giới hạn theo IP nếu cấu hình địa chỉ IP ổn định.
3. Có thể khai báo tối đa 5 key tại admin → **Kết nối Drive**. Điền đúng Google Cloud Project ID cho từng key; các key cùng project phải dùng cùng Project ID để quota được gom chung. Có thể giữ `DRIVE_API_KEY` trong env làm key tương thích cũ.

## 3. Kết nối và thử
1. Tạo tài khoản admin: `ADMIN_PASSWORD=<mật khẩu> npm run create-admin -- <tên-đăng-nhập>` (trong `apps/store-api`).
2. Đăng nhập `/admin` → **Kết nối Drive**: lưu ít nhất một key rồi dán link thư mục root để thêm nguồn.
3. **Kiểm tra ngay** với key và **Kiểm tra truy cập** với thư mục: kỳ vọng kiểm tra key thành công, `canList` và `canDownloadSample` đều đạt.
4. Mở **Quét đồng bộ** → chạy FULL. Thư viện thật: ~126 thư mục / ~845 file / 360 model.

## 4. Bảo mật
* Key nhập từ admin được mã hóa trong PostgreSQL bằng khóa suy ra từ `JWT_SECRET`; API admin chỉ trả trạng thái và Project ID, không bao giờ trả giá trị key. Giữ nguyên `JWT_SECRET` khi các key đã lưu; thay secret cần giải mã/mã hóa lại key trước khi đổi.
* Key gửi tới Google bằng header, không nằm trong URL. API admin và plugin không trả Drive ID của model.
* Worker kiểm tra key đang dùng mỗi 10 phút. Khi quota của một project bị giới hạn tốc độ, toàn bộ slot cùng Project ID được tạm nghỉ; router thử project khác đã khai báo.
* Quét bị giới hạn số file/thư mục mỗi lần (`SCAN_LIMIT_EXCEEDED`) và tốc độ (xem `apps/store-api/.env.example`).
