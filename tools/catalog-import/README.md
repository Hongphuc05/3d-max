# Chuẩn bị catalog từ Google Drive

Công cụ Node.js 20+ dành cho người chuẩn bị bản phát hành, không đóng gói cho khách. Nó đọc Drive và tạo catalog cùng preview cục bộ; không chạy tự động từ admin. Sau khi kiểm tra kết quả, phải build và gửi bộ cài plugin mới cho khách.

Trước khi chạy, xác minh quyền Viewer cho từng file model, tự đếm model trong cây Drive và sao lưu catalog hiện tại. Cache phải ở ngoài `library/public`, trên ổ đủ chỗ. Công cụ tải model để tính SHA-256; lần đầu có thể dùng nhiều băng thông và quota.

```powershell
node tools/catalog-import/import.mjs `
  --folder '1qQgoy1yLQuaO9S-yT_ZT7nai6EAA4OwA' `
  --cache 'C:\LibraryImportCache' `
  --out 'D:\Projects\3d-max\library\public\catalog.json' `
  --expected-models COUNT
```

Thay `COUNT` bằng số đã xác minh. Công cụ ghép model với ảnh cùng tên gốc trong cùng thư mục; kiểm tra các cảnh báo thiếu ảnh và đối chiếu thủ công nếu tên khác. Không tự cho rằng ảnh placeholder là ảnh thật. Danh sách HTML Drive không phải API ổn định và có thể bị cắt; đối chiếu số lượng, tên, danh mục và ảnh trước khi phát hành. Không xóa `import.lock` khi tiến trình đang chạy.

Nếu không tìm thấy ảnh trùng tên, công cụ giữ ảnh đã có của model có cùng Drive file ID; nếu ảnh cũ thiếu hoặc hỏng thì dừng để sửa, không tự đoán ảnh khác. Với model mới chưa có ảnh, công cụ dùng ảnh placeholder và cảnh báo để người chuẩn bị bổ sung ảnh đúng trước khi phát hành. Ảnh đã đối chiếu thủ công vẫn được giữ trong các lần quét sau.

Chạy `node --test tools/catalog-import/import.test.mjs tools/catalog-import/drive-api.test.mjs` và `node library/validate-catalog.mjs`; xem [hướng dẫn thư viện](../../docs/offline-library.md) để build và bàn giao. Chỉ thay file trên Drive không làm thay đổi thư viện đã cài.
