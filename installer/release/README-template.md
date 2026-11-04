# Đóng gói và phát hành `3dsmood-library.zip`

## 1. Nội dung zip (tên file bắt buộc: `3dsmood-library.zip`)

- [ ] `PlatformSetup.exe` (build bằng `installer\build-installer.ps1`)
- [ ] `HUONG-DAN-CAI-DAT.txt` (mẫu: `installer\release\HUONG-DAN-CAI-DAT.txt`, điền `<LIEN HE>`)
- [ ] `CHANGELOG.txt` (tùy chọn)

Tạo zip: `powershell -ExecutionPolicy Bypass -File installer\release\make-release-zip.ps1` -> `installer\release\out\3dsmood-library.zip`.

## 2. Phát hành

1. Trên GitHub tạo Release trên nhánh `v3/p2-sync-worker`, tag dạng `v1.0.0`.
2. Đính kèm file `3dsmood-library.zip` làm asset (đúng tên này).
3. Bấm Publish. Workflow `release` tự đưa file lên VPS; nút trên web chuyển từ "Bản cài đặt sắp có" sang "Tải xuống thư viện".
4. Chạy lại thủ công: Actions -> release -> Run workflow, nhập tag.

## 3. Kiểm tra

- Mở https://3dsmood.io.vn/download/3dsmood-library.zip : trình duyệt tải về zip.
- Giải nén, chạy thử `PlatformSetup.exe` trên máy sạch có Max 2022.
