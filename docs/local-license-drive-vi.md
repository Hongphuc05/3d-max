# Chạy local và kích hoạt license MXL1

## Luồng khách hàng

Khách mở plugin, sao chép mã máy và gửi riêng cho admin. Admin dùng tool license hiện tại để ký MXL1 cho đúng mã máy, rồi gửi token cho khách. Khách dán token vào plugin. Plugin xác minh chữ ký, máy và xác nhận với backend; quyền `ALL_MODELS` cho phép tải các model đã công bố, kể cả model được thêm sau. Tải model yêu cầu backend và Drive hoạt động.

Tool cấp license có thể ký nhiều token cho cùng mã máy; backend chỉ gắn token đầu tiên được chấp nhận. Giữ lại thông tin cấp license để hỗ trợ khách. Mã máy là thông tin do client gửi, không phải chứng thực phần cứng; cài lại Windows hoặc thay đổi danh tính thiết bị có thể cần hỗ trợ thủ công. Không tự xóa quyền khách cũ.

## Môi trường local trên máy này

PostgreSQL riêng chạy trong Docker container `3dmood-local-postgres`, chỉ nghe `127.0.0.1:55433`, dữ liệu ở volume `3dmood-local-pgdata`. Bật lại bằng `docker start 3dmood-local-postgres`. Không dùng database production cho test. Cấu hình local riêng ở `apps/store-api/.env.local`, đã được gitignore; không thay file `.env` sẵn có.

Trong PowerShell mở ba terminal:

```powershell
cd D:\Projects\3d-max\apps\store-api
node --env-file=.env.local --watch src/server.js
```

```powershell
cd D:\Projects\3d-max\apps\store-api
node --env-file=.env.local src/worker.js
```

```powershell
cd D:\Projects\3d-max\apps\store-web
npm run dev
```

Mở `http://localhost:5173`. API là `http://localhost:4000/api/health`. Local khởi động tự chạy migration trên database local; worker cần API đã chạy trước. Chế độ catalog cũ `CATALOG_PROVIDER=local` không tự nạp thư viện Drive: catalog v3 được tạo bằng quét Drive vào database.

## Cấu hình Drive private và license

1. Chia sẻ thư mục Drive cho tài khoản Google operator quyền xem và tải. Bật Drive API và tạo OAuth Web client; thêm redirect chính xác `http://localhost:4000/api/admin/drive/oauth/callback`. Xem [drive-setup.md](drive-setup.md).
2. Trong `.env.local`, điền `GOOGLE_OAUTH_CLIENT_ID` và `GOOGLE_OAUTH_CLIENT_SECRET`; giữ `DRIVE_AUTH_MODE=oauth`. `DRIVE_TOKEN_KEY` đã tạo riêng cho local và phải được giữ ổn định khi dùng lại database.
3. Điền `LICENSE_PUBLIC_KEY_B64`: base64 của toàn bộ XML RSA public key khớp private key đang dùng trên tool license-admin. Không đưa private key vào backend hoặc plugin. Cấu hình bộ cài online với cùng public key qua `-LicensePublicKeyPath` và `-ApiBaseUrl`; build local loopback theo hướng dẫn của script.
4. Đăng ký tài khoản admin local, tìm UUID theo hướng dẫn [license-payos-setup.md](license-payos-setup.md#trang-quản-trị), đặt `LICENSE_ADMIN_USER_IDS` trong `.env.local` và khởi động lại API. Kết nối Google ở trang admin, thêm nguồn, kiểm tra truy cập và chạy quét.

OAuth và thư mục private cần được kiểm chứng bằng tài khoản và dữ liệu thật. Không sử dụng các khóa đã chia sẻ trong chat làm bí mật production; cấp lại khóa phù hợp và quản lý riêng. Không đổi các khóa mã hóa đang dùng trên môi trường có dữ liệu nếu chưa có kế hoạch bảo toàn dữ liệu.

## Giới hạn và chuyển dữ liệu cũ

Mặc định tối đa 120 phiên tải mỗi giờ cho một thiết bị và ba lượt tải đồng thời trên API; có thể điều chỉnh `DOWNLOAD_SESSIONS_PER_HOUR` và `DOWNLOAD_MAX_CONCURRENT`. Đây là giới hạn tốc độ, không giới hạn số model mà license được quyền sử dụng.

Nếu database đã có catalog đồng bộ từ một nguồn API key, không tạo thêm nguồn OAuth cho cùng thư mục trên database đó rồi quét ngay: source mới có thể tạo model trùng và ID mới. Cần lập và kiểm thử kế hoạch chuyển nguồn trên bản sao database, giữ model ID và quyền hiện có, trước khi áp dụng. Cấu hình Nginx trong repo tắt access log cho URL phiên tải; cấu hình proxy khác và error log cũng cần được kiểm tra để không ghi token phiên.
