# Hướng dẫn chủ sở hữu 3DSMOOD

Mở [trang admin 3DSMOOD](https://3dsmood-license-admin.vercel.app/), đăng nhập theo cấu hình của trang và nhập mật khẩu admin. Không gửi mật khẩu hoặc khóa ký riêng cho khách.

## Cấp license

1. Sau khi thanh toán, khách gửi **Mã máy** từ plugin.
2. Dán mã vào **Mã máy khách gửi**; có thể nhập **Mã ghi chú nội bộ** để nhận diện khách.
3. Bấm **Ký và tạo license**, sao chép token và gửi riêng cho khách. Khách dán vào plugin và kích hoạt một lần.

Trang không thay thế sổ theo dõi khách hàng. Hãy lưu thông tin cần thiết ở nơi riêng tư. Nếu mã máy khách thay đổi, cấp license mới. License vĩnh viễn kiểm tra offline không có chức năng thu hồi từ xa.

## Thay đổi thư viện

Trang admin chỉ dùng để đăng nhập và cấp license. Để thêm hoặc đổi model hay ảnh, cập nhật dữ liệu thư viện trong mã nguồn, kiểm tra rồi build và bàn giao **bộ cài plugin mới** cho khách. Chỉ tải file lên Drive sẽ không tự làm thư viện trong plugin thay đổi. Xem [hướng dẫn kỹ thuật](offline-library.md).

Danh sách và ảnh đã đóng gói xem được offline. Khi khách import và plugin cần tải model từ Google Drive, máy khách cần Internet và file Drive phải cho phép tải. Khóa ký riêng chỉ được giữ phía server; không đưa vào plugin, repo hoặc bộ cài. Giữ nguyên khóa công khai khi build để license đã cấp vẫn được xác minh.
