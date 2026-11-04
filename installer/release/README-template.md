# Đóng gói và phát hành `3dsmood-library.zip`

## 1. Nội dung zip (tên file bắt buộc: `3dsmood-library.zip`, vì nginx và `release.yml` gắn cứng tên này)

```
PlatformSetup.exe              bộ cài (build bằng installer\build-installer.ps1)
HUONG-DAN-CAI-DAT.html         hướng dẫn từng bước (mẫu: installer\release\HUONG-DAN-CAI-DAT.html)
THONG-TIN-PHIEN-BAN.txt        phiên bản + SHA256 của exe (sinh tự động từ mẫu cùng tên)
images\                        ảnh cho hướng dẫn (tùy chọn, xem mục 2)
CHANGELOG.txt                  (tùy chọn)
Cai-thu-cong\ENU\              chép đè vào %LOCALAPPDATA%\Autodesk\3dsMax\2022 - 64bit\ENU
  scripts\Platform\  scripts\Startup\  usermacros\
```

## 2. Tạo zip (Windows)

1. `installer\build-installer.ps1 -ApiBaseUrl https://3dsmood.io.vn` (tạo `PlatformSetup.exe` và `installer\stage\`).
2. Chép ảnh vào `installer\release\images\`: `smartscreen-1.png` (More info), `smartscreen-2.png` (Run anyway), `toolbar.png`, `panel.png`. Thiếu ảnh thì guide hiện khung chữ thay thế.
3. ```powershell
   powershell -ExecutionPolicy Bypass -File installer\release\make-release-zip.ps1 -Contact "<zalo/sdt/email>" [-Version 1.0.0]
   ```
   Kết quả: `installer\release\out\3dsmood-library.zip`. Script thay `{{VERSION}}`, `{{SHA256}}`, `{{CONTACT}}`, `{{DATE}}` trong guide và file phiên bản.
4. Giải nén thử, mở `HUONG-DAN-CAI-DAT.html`, chạy `PlatformSetup.exe` trên máy sạch (có Max 2022 ENU, Max đã đóng).

## 3. Phát hành

1. Trên GitHub tạo Release trên nhánh `v3/p2-sync-worker`, tag dạng `v1.0.0`.
2. Đính kèm file `3dsmood-library.zip` làm asset (đúng tên này).
3. Bấm Publish. Workflow `release` tự đưa file lên VPS; nút trên web chuyển từ "Bản cài đặt sắp có" sang "Tải xuống thư viện".
4. Chạy lại thủ công: Actions -> release -> Run workflow, nhập tag.

## 4. Kiểm tra

- Mở https://3dsmood.io.vn/download/3dsmood-library.zip : trình duyệt tải về zip.
- Đối chiếu SHA256 trong `THONG-TIN-PHIEN-BAN.txt` với `Get-FileHash PlatformSetup.exe`.
