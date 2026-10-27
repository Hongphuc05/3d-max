# Thư viện đóng gói và license offline

Plugin 3ds Max 2022 đóng gói `library/public/catalog.json` và các ảnh trong `library/public/previews/`. Khách xem danh sách và ảnh ngay cả khi chưa từng kết nối mạng. Mỗi mục lưu ID của **file model** trên Google Drive và SHA-256; khi import, native host tải file tương ứng, kiểm tra checksum và đưa model vào scene. Không tải ảnh preview từ Drive. Nếu model chưa có bản cache dùng được, import cần Internet. File Drive phải có quyền tải công khai; Drive có thể thay đổi hạn mức hoặc quyền truy cập.

Snapshot hiện có 360 mục với ảnh xem trước tương ứng. Ngày 2026-10-27, đối chiếu root Drive xác nhận 360 ID và tên model; 70 ảnh trước đây bị bỏ sót vì tên khác nhẹ đã được đối chiếu và bổ sung. Folder Downloads cục bộ chỉ là một phần nguồn. Công cụ [nhập catalog](../tools/catalog-import/README.md) có thể hỗ trợ chuẩn bị dữ liệu cục bộ; kiểm tra lại kết quả trước khi phát hành.

## Cập nhật và phát hành

1. Chuẩn bị file model và ảnh mới. Đặt quyền xem/tải cho từng file model trên Drive và kiểm tra bằng trình duyệt không đăng nhập.
2. Cập nhật `library/public/catalog.json` và ảnh trong `library/public/previews/`. Mỗi mục cần ID file Drive đúng, tên file, đường dẫn ảnh hợp lệ và SHA-256 của file model tải về. Khi thay file model, cập nhật ID và checksum tương ứng. Dùng `entryFile` khi cần chọn chính xác scene trong archive.
3. Chạy `node --test library/catalog.test.mjs` và `node library/validate-catalog.mjs`. Kiểm tra tên, danh mục và ảnh; thử import model đã đổi.
4. Build installer với public key hiện có, kiểm tra bộ cài và bàn giao lại cho khách. **Mọi thay đổi danh sách, model hoặc ảnh trong thư viện đều cần build và gửi plugin mới.** Đưa file lên Drive không tự cập nhật plugin đã phát hành.

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 `
  -LicensePublicKeyPath 'C:\LibraryOwnerKeys\library-public.xml'
```

Không đưa archive model hoặc private key vào repo hay bộ cài. URL Drive công khai có thể được người biết link tải trực tiếp; license kiểm soát plugin, không phải cơ chế bảo vệ file Drive. Không dùng GitHub Pages, GitHub Actions hoặc Cloudflare R2 để cập nhật thư viện.

## License và an toàn

Trang admin ký license trên server; plugin chỉ chứa RSA public key để xác minh offline theo mã máy. Giữ nguyên public key khi phát hành bản mới; thay cặp khóa sẽ làm license cũ không còn xác minh được. Không gửi khóa riêng, mật khẩu hoặc license công khai.

Với file `.max`, giữ các tùy chọn bảo vệ script của 3ds Max được bật; host có thể từ chối merge nếu chúng chưa được bật. Khi tải lỗi, kiểm tra mạng, quyền Drive, hạn mức và checksum. Xem [hướng dẫn cho khách](customer-handoff-vi.md) và [hướng dẫn admin](admin-web-handoff-vi.md).
