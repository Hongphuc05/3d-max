# Liên kết Telegram cho admin

## Cách hoạt động

- Mỗi tài khoản admin chỉ liên kết một Telegram. Admin chưa kết nối bấm **Kết nối Telegram bot**; trang mở bot bằng deep link.
- Admin nhấn **Start**. Webhook nhận mã dùng một lần, kiểm tra hạn 10 phút và liên kết chat đó với admin đã tạo mã.
- Nếu hệ thống cũ có nhiều Telegram liên kết với cùng một admin, migration giữ liên kết cũ nhất và ngắt các liên kết còn lại.
- Bot gửi thông báo đơn tới các Telegram admin đã liên kết và các chat ID cũ trong `TELEGRAM_OWNER_CHAT_IDS`. Admin bấm nút trong tin nhắn để xác nhận hoặc từ chối; quyết định vẫn idempotent.
- Không cần Telegram Login Client ID/Secret hay cấu hình URL trong BotFather. Cần bot token và webhook hiện có.

## Quản lí tài khoản admin

- Admin hiện có đầu tiên được chọn làm **admin chủ quản** khi migration chạy; nếu chưa có admin thì tài khoản đầu tiên tạo bằng `create-admin.js` sẽ là chủ quản.
- Chỉ admin chủ quản được tạo, khóa/mở khóa và đặt lại mật khẩu admin khác. Tên đăng nhập, họ tên, vai trò, trạng thái và ngày tạo hiển thị trong bảng quản lý. Admin khác chỉ xử lý nghiệp vụ.
- Tài khoản mới phải đổi mật khẩu ở lần đăng nhập đầu. Khóa tài khoản sẽ thu hồi các phiên đăng nhập và dừng nhận thông báo Telegram.

## Cấu hình webhook

Giữ các biến bot hiện có trong `/etc/3dsmood/store.env`. `TELEGRAM_WEBHOOK_BASE_URL` cần là origin HTTPS của website, ví dụ `https://3dsmood.io.vn`. Khi API khởi động, bot tự cập nhật webhook để nhận cả tin `/start` và callback nút duyệt đơn.

Sau deploy, vào **Cài đặt → Kết nối Telegram bot** để liên kết. Admin chủ quản tạo hoặc khóa admin tại **Thông tin đăng nhập → Quản lý tài khoản**.
