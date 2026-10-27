# Công cụ license nội bộ

License dùng định dạng MXL1 và xác minh offline theo mã máy. Trang admin ký license trên server; xem [hướng dẫn admin](../../docs/admin-web-handoff-vi.md). Plugin và bộ cài chỉ chứa khóa công khai, không chứa khóa riêng hay công cụ này. Khóa riêng chỉ được lưu phía server; không dùng CLI tại máy khách hoặc đưa khóa riêng vào repo, Drive công khai hay bộ cài.

Giữ nguyên public key giữa các bản phát hành để license cũ tiếp tục hoạt động. Nếu mất khóa riêng tương ứng, không thể cấp license mới cho bộ cài cũ; nếu khóa bị lộ, cần thay khóa và phát hành lại plugin. License offline vĩnh viễn không có chức năng thu hồi từ xa.

Các lệnh kiểm tra mã license:

```powershell
node --test tools/license-owner/owner.test.mjs
powershell -ExecutionPolicy Bypass -File plugin-csharp/tests/run-offline-license-tests.ps1
```
