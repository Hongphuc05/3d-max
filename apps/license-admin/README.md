# Quản trị license 3DSMOOD

Trang quản trị chỉ dùng để đăng nhập và tạo license cho mã máy khách. Danh sách model và ảnh preview được đóng gói trong plugin: xem được khi không có mạng; bấm Import cần mạng để tải model từ Google Drive. Thêm hoặc đổi model, đường dẫn Drive hay ảnh preview cần build và bàn giao bản plugin mới.

## Cấu hình Vercel

Dự án `3dsmood-license-admin` dùng thư mục gốc `apps/license-admin` và Node.js 24. Giữ bảo vệ triển khai Vercel và mật khẩu quản trị. Cấu hình những biến Production sau:

| Biến | Nội dung |
| --- | --- |
| `ADMIN_PASSWORD` | Mật khẩu riêng, tối thiểu 16 byte UTF-8. |
| `ADMIN_SESSION_SECRET` | Ít nhất 32 byte ngẫu nhiên, khác mật khẩu. |
| `LICENSE_PRIVATE_KEY_B64` | Khóa ký riêng dạng PEM mã hóa Base64, chỉ lưu trong môi trường server Vercel. |
| `LICENSE_PUBLIC_KEY_B64` | Khóa công khai XML tương ứng, mã hóa Base64; server kiểm tra khớp cặp khóa. |

Không đưa khóa riêng vào repo, plugin, bộ cài, máy khách, chat hoặc log. Giữ khóa riêng hiện tại chỉ trong môi trường server Vercel và giữ nguyên cặp khóa để plugin xác minh được license. Không cần sao chép hay tải khóa riêng về máy khi vận hành. Tạo session secret bằng `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.

Cấu hình quy tắc Vercel Firewall `admin-session-login` giới hạn 10 yêu cầu/phút/mỗi địa chỉ IP. Khi dịch vụ giới hạn không hoạt động, đăng nhập Production trả lỗi 503 để bảo vệ tài khoản.

Ứng dụng không còn dùng `GITHUB_ACTIONS_TOKEN`, `DRIVE_WORKFLOW_REPOSITORY`, hoặc `DRIVE_WORKFLOW_ID`. Workflow đồng bộ cũ từng dùng GitHub Actions secret `GOOGLE_DRIVE_API_KEY` và các biến `DRIVE_FOLDER_ID`, `CATALOG_MINIMUM_MODEL_COUNT`; chúng không còn cần cho trang admin hay xuất bản catalog tự động. Không tự xóa các biến hoặc secret: trước tiên xác minh không có hệ thống khác sử dụng chúng. Không thay đổi các biến license ở trên.

## Tạo license

Đăng nhập trang admin, nhập mã máy khách gửi, tùy chọn nhập mã ghi chú, chọn **Ký và tạo license**, rồi sao chép token gửi riêng cho khách. Plugin xác minh license bằng khóa công khai và không cần mạng để xác minh.

## Kiểm tra

```powershell
npm test
```
