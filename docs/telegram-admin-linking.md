# Liên kết nhiều tài khoản Telegram cho admin

## Cách hoạt động

- Mỗi admin đăng nhập vào web rồi chọn **Cài đặt → Kết nối Telegram bot**. Telegram Login mở trong tab mới và xin quyền `telegram:bot_access` để bot có thể nhắn trực tiếp.
- API kiểm tra `state`, PKCE, `nonce` và chữ ký ID token; mỗi lần liên kết chỉ dùng được một lần và hết hạn sau 10 phút. PKCE verifier được mã hóa trong PostgreSQL bằng khóa suy ra từ `JWT_SECRET`.
- Danh tính Telegram được lưu riêng theo admin. Admin có thể liên kết nhiều tài khoản và tự ngắt từng liên kết. Telegram ID chỉ được liên kết với tối đa một admin tại một thời điểm.
- Khi khách báo đã chuyển khoản, bot gửi tin tới mọi tài khoản Telegram đang liên kết admin và các chat ID cũ trong `TELEGRAM_OWNER_CHAT_IDS`. Các bản sao tin nhắn được lưu để thao tác từ web có thể đóng nút trên toàn bộ bản sao.
- Telegram Login chỉ xác thực Telegram và cấp quyền nhắn tin cho bot. Admin vẫn cần đăng nhập vào tài khoản admin trên website trước khi bắt đầu liên kết.

## Thiết lập production một lần

1. Trong cài đặt Telegram Login của bot ở BotFather, cấu hình website `https://3dsmood.io.vn` và callback được phép:
   `https://3dsmood.io.vn/api/telegram/login/callback`
2. Lấy Login Client ID và Client Secret từ BotFather. Không đặt chúng trong mã frontend, Git, hoặc gửi qua chat.
3. Thêm các biến sau vào `/etc/3dsmood/store.env`:

   ```dotenv
   TELEGRAM_LOGIN_CLIENT_ID=<client-id>
   TELEGRAM_LOGIN_CLIENT_SECRET=<client-secret>
   TELEGRAM_LOGIN_REDIRECT_URI=https://3dsmood.io.vn/api/telegram/login/callback
   ```

   `TELEGRAM_LOGIN_REDIRECT_URI` có thể để trống nếu `TELEGRAM_WEBHOOK_BASE_URL` đã là `https://3dsmood.io.vn`.
4. Giữ nguyên `JWT_SECRET` hiện tại. Đổi khóa này sẽ làm các phiên admin hết hạn và khiến những Telegram Login attempt đang mở không dùng được.
5. Deploy bản mới để migration `029_telegram_admin_links.sql` được áp dụng, sau đó khởi động lại `store-api` để nạp biến môi trường.
6. Đăng nhập từng admin vào web và dùng nút kết nối. Mỗi tài khoản phải tự đồng ý quyền Telegram Login.

Nếu chưa cấu hình Client ID/Secret, phần quản trị vẫn mở được nhưng sẽ báo rõ biến còn thiếu và không bắt đầu luồng kết nối.
