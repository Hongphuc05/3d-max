# Build MZP và nghiệm thu trên Windows

Target: 3ds Max 2022, .NET Framework 4.8, WebView2 Evergreen. Máy build cần Node.js 26, Visual Studio Build Tools với .NET Framework 4.8 targeting pack/NuGet. Nhánh hiện hành: `v3/p2-sync-worker`.

## Build và đóng gói

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-mzp.ps1 -ApiBaseUrl https://3dsmood.io.vn -Version 1.3.3
```

Kết quả duy nhất cho khách: `installer\release\out\3dsmood-library.mzp`. Build gồm web, native, staging, test gói ZIP/RAR/7z và kiểm cấu trúc MZP. Không cần build EXE hay nén thêm folder. Khi dependency đã khớp lockfile, thêm `-SkipDependencyRestore` để bỏ bước npm ci. Build dùng thư mục output mới, không xóa dist hay ghi đè DLL của bản đang mở.

Chi tiết phát hành: [installer/release/README-template.md](../installer/release/README-template.md).

```powershell
powershell -ExecutionPolicy Bypass -File installer\tests\run-build-guard-tests.ps1
powershell -ExecutionPolicy Bypass -File installer\tests\verify-mzp.ps1 -PackagePath installer\release\out\3dsmood-library.mzp
```

Không commit `stage/`, `bin/`, `obj/` hoặc file build. Chỉ phát hành artifact sau khi kiểm Max thật.

## Cài và cập nhật

Trong Max 2022: **Scripting > Run Script > chọn .mzp**. Installer tự lấy đường dẫn user của Max đang chạy, đăng ký macro ngay; vào **Customize > Customize User Interface > Toolbars > 3dsmood**, kéo nút 3dsmood ra toolbar. Không cần giải nén thủ công hoặc tìm file hướng dẫn ngoài.

Mỗi payload nằm trong một thư mục phiên bản riêng. Cài bản mới không ghi đè DLL đang được Max sử dụng và không đụng model đã tải. Nếu Max đang nạp DLL của bản khác, loader yêu cầu khởi động lại trước khi mở bản mới. Không tự xóa runtime cũ; một phiên Max khác có thể còn dùng nó.

## Nghiệm thu Max thật

### Texture tự nối đường dẫn (1.3.3)

Import mọi model dùng bộ tìm đường dẫn theo thư mục gói trong index Đã tải: ưu tiên đường dẫn tương đối với file import/gốc gói, rồi hậu tố thư mục cũ, cuối cùng tên file duy nhất. Material/map lồng nhau, map đăng ký qua Asset Tracking và property filename được xử lý; modifier/base object được kiểm tra trong phạm vi node mới. Gán đường dẫn tuyệt đối và reload map. Thiếu file, trùng tên không phân biệt được hoặc plugin map từ chối đổi đường dẫn thì cảnh báo, không tự lấy ảnh ở model khác. Material mới được copy trước relink, merge MAX dùng renameMtlDups để tránh thay thế material trùng tên có sẵn.

```powershell
powershell -ExecutionPolicy Bypass -File plugin-csharp\tests\run-texture-resolver-tests.ps1
# Cần license Max Batch hợp lệ; chỉ dùng tiến trình batch riêng, không chạy test MS trong scene đang làm việc.
powershell -ExecutionPolicy Bypass -File plugin-csharp\tests\run-texture-max-tests.ps1
```

Nghiệm thu `.max`/FBX/OBJ, Standard/Multi-Sub/Corona/V-Ray map nếu cài renderer, bitmap trong modifier, thư mục texture cùng cấp hoặc lồng sâu, tên ảnh trùng giữa biến thể, ảnh thiếu, import offline và import sang Max khác. Kiểm tra material cũ giữ nguyên; lưu/mở lại scene và xác minh ảnh đọc được. Thư mục tải mới không làm đổi texture đã import từ thư mục cũ. Bộ relink không khôi phục vật liệu vốn đã mất khi export FBX/OBJ và không sinh file ảnh không có trong gói.

1. Cài MZP trên Max 2022, kiểm macro xuất hiện trong Customize; mở panel, tải catalog/ảnh.
2. Cài lại cùng gói; không mất cấu hình hay model đã tải. Cài bản khác khi panel đã mở: có yêu cầu khởi động lại, không lỗi ghi đè DLL.
3. Cài trên Max có đường dẫn user tùy chỉnh; file phải theo getDir, không hard-code ENU.
4. Settings chọn thư mục trên SSD. Download ZIP/RAR/7z chỉ tải và chuẩn bị file, **không thay đổi scene**.
5. Tab Đã tải có model sau khi đóng/mở panel và khởi động lại Max. Import từ đây không tải lại, không giải nén lại.
6. Đổi thư mục tải; model cũ vẫn import từ vị trí cũ, model mới vào thư mục mới. Kiểm texture sau khi lưu/mở lại scene.
7. Ngắt mạng: import model đã tải bằng quyền đã xác minh gần nhất. Khi online và nhận thu hồi license, import phải bị chặn, kể cả sau khi khởi động lại rồi offline.
8. Máy chưa mua: Mua thư viện → VietQR → Tôi đã chuyển khoản → chủ xác nhận Telegram/admin → được tải. Không tự tạo giao dịch thật trong test tự động.
9. Nhiều Max: chọn đúng scene đích; scene đổi/đóng giữa thao tác phải báo lỗi, không import nhầm.
10. Thiếu WebView2: hiện hướng dẫn cài runtime chính thức, không crash Max.

Ghi pass/fail, ảnh và log cho các mục đã kiểm. Test tự động/build thành công không thay thế nghiệm thu trong Max.
## Kiểm tra chọn mẫu trong gói nhiều file

- Dùng gói có 6–7 file import được: Đã tải → Import phải hiện đủ tên/thư mục/định dạng, không tự merge trước khi xác nhận.
- Chọn một file khác file ưu tiên, kiểm đúng mẫu/màu/renderer được import; thử Hủy và Escape, scene phải giữ nguyên.
- Mở model đã tải bằng bản D30: danh sách lựa chọn phải được bổ sung từ thư mục sẵn có, không tải lại. Thử lại khi offline và sau khi khởi động lại Max.
- Xóa một file đã chọn ở bản sao dữ liệu test: phải báo thiếu file, không chuyển sang mẫu khác hoặc tự tải lại.
## Kiểm tra một plugin chọn nhiều cửa sổ Max (thay hành vi D32)

1. Cài bản MZP mới rồi lưu scene, khởi động lại mọi phiên Max đang nạp DLL cũ.
2. Mở ba tiến trình Max với max_a/max_b/max_c; chỉ mở một panel. Dòng 3ds Max là dropdown tên scene/đường dẫn/PID. Mỗi Max cần agent nền cùng bản (Startup tự nạp sau khởi động lại), không cần mở panel riêng.
3. Chọn max_c rồi import model đã tải: chỉ max_c nhận model, dù focus đang ở max_a. Đổi chọn max_b rồi thử lại. Hai scene cùng tên hoặc Untitled vẫn phân biệt bằng PID/đường dẫn.
4. Polling/focus/thứ tự liệt kê không thay lựa chọn đã xác nhận. Chỉ một Max sẵn sàng được tự chọn lúc đầu; nhiều Max yêu cầu chọn rõ. Cửa sổ thiếu agent hiện trạng thái chưa sẵn sàng và không import được.
5. Đổi/reset/mở lại scene hoặc đóng Max đích giữa thao tác: báo lỗi, không chuyển sang Max khác. Chọn lại scene mới để tiếp tục. Nếu đổi dropdown khi một import đã bắt đầu, lệnh đó vẫn giữ đích đã chụp và chỉ lệnh sau dùng lựa chọn mới.
6. Plugin vẫn nằm trong tiến trình Max đã mở nó; đóng Max chứa panel sẽ đóng panel đó. Khác biệt quyền chạy Windows/user có thể khiến agent không truy cập được; dùng cùng user và mức quyền cho các Max.
