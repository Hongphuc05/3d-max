# Build installer + nghiệm thu plugin trên Windows

> Dành cho người build trên máy Windows có 3ds Max 2022. Nhánh: `v3/p2-sync-worker` (KHÔNG dùng `main`).
> Backend đã chạy thật ở `https://3dsmood.io.vn` (deploy tự động bằng GitHub Actions khi push nhánh này).
> Phần C# gần đây được sửa trên macOS nên **chưa build, chưa chạy test lần nào** — việc của bạn là build, chạy test, sửa lỗi nếu có, rồi nghiệm thu trong Max.

## 0. Cài đặt máy (một lần)

| Cần | Ghi chú |
|---|---|
| Windows 10/11 x64 | |
| 3ds Max 2022 **bản tiếng Anh (ENU)** | Mở Max ít nhất 1 lần để tạo `%LOCALAPPDATA%\Autodesk\3dsMax\2022 - 64bit\ENU` |
| Git | |
| Node.js **26** | Cùng bản với CI/VPS (`node -v` → `v26.x`) |
| Visual Studio 2022 **Build Tools** | Workload ".NET desktop build tools", thêm ".NET Framework 4.8 targeting pack" + "NuGet targets and build tasks" |
| WebView2 Runtime | Win 10/11 thường có sẵn; thiếu thì cài "Evergreen" của Microsoft |

```powershell
git clone https://github.com/Hongphuc05/3d-max.git
cd 3d-max
git checkout v3/p2-sync-worker
```

## 1. Chạy test C# (bắt buộc trước khi build)

Đóng 3ds Max. Chạy từng bộ, bộ nào lỗi thì sửa rồi chạy lại:

```powershell
Get-ChildItem plugin-csharp\tests\run-*.ps1 | ForEach-Object {
  Write-Host "=== $($_.Name)"
  powershell -ExecutionPolicy Bypass -File $_.FullName
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: $($_.Name)" -ForegroundColor Red }
}
powershell -ExecutionPolicy Bypass -File installer\tests\run-build-guard-tests.ps1
```

Các chỗ đã sửa mà **chưa ai build** (ưu tiên soi khi lỗi biên dịch):
- Dọn code cũ D28: bỏ `GoogleDriveDownloader`, `StaticCatalogService`, `OfflineLicenseService`, chế độ offline/đóng gói; thêm `MachineCode.cs`; sửa `MaxWebViewForm`, `PluginConfiguration`, `PackagedAppRuntime`, `DeviceSessionService`, `V3Library`, `PreviewCacheService`, `BridgePolicy`, `.csproj`.
- Tải lần đầu từ VPS: `CatalogUpdateWatcher.FetchCatalogAsync` / `CheckInBackground`, `V3Library.EnsureCatalogAsync`, `PreviewCacheService` kiểm size khi resume.
- `OrdersClient.cs`: tạo đơn luôn gửi `{}` (license cả thư viện).
- `ImportPipelineTests.cs` đã bị xóa (test luồng tải cũ) → import chưa có test end-to-end, kiểm bằng tay ở bước 3.

## 2. Build installer

```powershell
# Đóng 3ds Max trước (Max khóa DLL)
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -ApiBaseUrl https://3dsmood.io.vn
```

Script tự làm: `npm ci` + build giao diện → restore NuGet → build plugin Release x64 → gom file → test gói (ZIP/RAR/7z) → nén → build `installer\PlatformSetup.exe`.
Kết quả: **`installer\PlatformSetup.exe`** — đây là file đưa cho khách. Không commit `.exe`, `stage\`, `bin\`, `obj\`.

Installer chép plugin vào thư mục user của Max 2022 (không cần quyền admin), không chứa sẵn catalog/ảnh: lần mở đầu plugin tự tải từ VPS.

## 3. Nghiệm thu trong Max (checklist)

Chuẩn bị trên `https://3dsmood.io.vn/admin` (chủ dự án làm): đã điền ngân hàng trong **Cài đặt**, đặt **giá thấp để test** (vd 2.000đ), đã **Kết nối Drive** và **Quét đồng bộ** xong, **Tổng quan → Gửi tin thử** Telegram nhận được.

| # | Bước | Kỳ vọng |
|---|---|---|
| 1 | Xóa `%LOCALAPPDATA%\3dMood` (nếu có), chạy `PlatformSetup.exe` | Báo cài xong; Max đang mở thì báo đóng Max |
| 2 | Mở Max → Customize > Customize User Interface > Toolbars > category **Platform** → kéo nút ra toolbar → bấm | Panel tối (UI-1) mở ra |
| 3 | Lần đầu mở | Danh sách model hiện ngay, thanh "Đang tải ảnh xem trước x/y" chạy, ảnh hiện dần |
| 4 | Tắt Max giữa lúc tải ảnh, mở lại | Chỉ tải tiếp phần thiếu |
| 5 | Tắt mạng, xóa `%LOCALAPPDATA%\3dMood`, mở panel | Màn báo lỗi + nút **Thử lại**; bật mạng, bấm → chạy tiếp |
| 6 | Chưa mua | Mọi model hiện khóa, có nút **Mua thư viện** |
| 7 | Bấm Mua thư viện | Hiện VietQR + số tiền + mã đơn; quét bằng app ngân hàng thật, chuyển tiền |
| 8 | Bấm **Tôi đã chuyển khoản** | Chủ nhận tin Telegram có mã đơn + số tiền |
| 9 | Chủ bấm ✅ trên Telegram | Trong vài giây plugin mở khóa toàn bộ model (ghi lại mất bao nhiêu giây) |
| 10 | Tải + import 1 model `.zip`, 1 `.rar`, 1 `.7z` | Có hàng đợi tải, import vào scene đúng |
| 11 | Admin → **Thiết bị & license** → Thu hồi | Plugin khóa lại (ghi lại sau bao lâu; chắc chắn khi mở lại panel) |
| 12 | Admin → Chuyển license sang máy khác (cần máy thứ 2 hoặc VM) | Máy cũ khóa, máy mới mở |
| 13 | Rút mạng khi đang dùng | Vẫn xem catalog đã lưu; tải model báo cần Internet |

Ghi kết quả từng dòng (đạt / lỗi + ảnh chụp + MAXScript Listener) vào `docs/STATUS-v3.md`, commit + push lên nhánh.

## 4. Những điều cần biết khi đưa cho khách

- **Chưa ký số (code signing)** → Windows SmartScreen sẽ cảnh báo "Windows protected your PC": khách bấm *More info → Run anyway*. Muốn hết cảnh báo phải mua chứng chỉ ký code (trả phí hằng năm) — chưa làm.
- Installer chỉ hỗ trợ **Max 2022 bản ENU** (đường dẫn cố định `2022 - 64bit\ENU`). Max bản ngôn ngữ khác sẽ báo không tìm thấy thư mục — nợ kỹ thuật.
- 1 license = 1 máy. Khách cài lại Windows / đổi máy → nhắn chủ để chuyển license trong admin.
