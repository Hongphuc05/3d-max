# DECISIONS — Quyết định đã khóa

> Mỗi mục: quyết định, lý do, hệ quả. Đổi quyết định = sửa file này trước, sửa code sau.
> Ngày khóa: 2026-09-23.

## D1 — Target: 3ds Max 2022 (locked)
**Quyết định:** version đầu tiên và duy nhất cho MVP là 3ds Max 2022.

**Hệ quả khóa theo:**
- Target framework: **.NET Framework 4.8** (không phải .NET 8 / .NET Core).
- C++ toolset nếu cần native shim: VS 2019 (v142).
- UI stack của Max: Qt 5.15.2.
- Mọi NuGet package phải hỗ trợ `net48`.

**Risk đã biết (chấp nhận có chủ ý):** Max 2022 nằm ngoài vòng hỗ trợ hiện tại của Autodesk.
Khách hàng mới không mua được license 2022. Quyết định này chỉ đúng nếu user base mục tiêu
đang kẹt ở 2022. → xem [R1](#r1--max-2022-eol).

**Mitigation bắt buộc:** `Platform.Max.Bridge` và `Platform.Max.Adapter` phải tách interface
khỏi mọi type của `Autodesk.Max`. Nâng lên 2025+ (.NET 8) chỉ được phép chạm tầng Adapter,
không được viết lại Bridge/SDK.

## D2 — Web platform: có source trong `web/` (amended, locked)

**Quyết định ban đầu (2026-09-23):** platform đã chạy thật, source ở repo tách biệt,
team có quyền sửa frontend.

**Cập nhật theo cấu trúc repo được xác nhận ngày 2026-09-30:** source platform hiện nằm
trong chính project này tại `web/front-3dsmood-main` và `web/back-3dsmood-main`. Ranh giới
giữa web platform và native PoC vẫn phải được giữ ở cấp kiến trúc.

**Hệ quả:**
- Được phép thêm route `/extension/3dsmax` và host-detection vào frontend → xem spec §5.2.
- Bridge SDK trước mắt có thể nằm trong frontend hiện tại; chỉ tách package khi có nhu cầu
  reuse thật.
- Audit source ban đầu đã được ghi tại [`current-platform-audit.md`](current-platform-audit.md).
- Chưa được viết `asset.import` production trước khi chạy local, chốt format MVP và thiết kế
  backend import authorization.

## D3 — Mục tiêu: sản phẩm thương mại (locked)
**Quyết định:** đây là sản phẩm bán/phát hành cho studio, không phải PoC.

**Hệ quả — các mục sau CHUYỂN TỪ "nếu cần" SANG BẮT BUỘC:**
- Installer + bundle/bootstrap WebView2 Runtime (D4).
- Code signing cho DLL và installer.
- Compatibility matrix có test thật, không suy đoán.
- Update/rollback mechanism.
- Support/diagnostic log user gửi được.
- CI build reproducible.

**Vẫn ngoài phạm vi MVP:** marketplace, payment, multi-DCC. Xem spec §3.

## D4 — WebView2 Runtime: Evergreen + bootstrapper trong installer
**Quyết định:** dùng Evergreen Runtime, installer detect và chạy bootstrapper nếu thiếu.

**Lý do:** Fixed Version tự cập nhật được nhưng phình installer ~150MB và tự gánh
trách nhiệm vá lỗ hổng Chromium. Với sản phẩm thương mại, Evergreen an toàn hơn.

**Hệ quả:** phải test khi Runtime vắng mặt — plugin không được crash Max, phải báo lỗi rõ.

## Quyết định chưa khóa

| # | Câu hỏi | Chặn cái gì |
|---|---------|-------------|
| O1 | Production WebView load remote website hay bundled build? Dev đã chốt dùng localhost. | CSP, offline behaviour, update flow |
| O2 | Email/password đã rõ là JWT Bearer; Google OAuth redirect vẫn phải test trong WebView2. | Auth acceptance trong Max |
| O3 | Asset upload chấp nhận nhiều format nhưng format import đầu tiên chưa chốt. | Import adapter |
| O4 | Kênh phân phối: Autodesk App Store hay tự host? | Installer format, signing, review process |
| O5 | Có cần licensing/DRM cho plugin không? | Kiến trúc host, không thêm sau dễ |

O1–O3 phải được chốt bằng chạy local, WebView2 spike và asset mẫu thật. O4–O5 là quyết
định kinh doanh, cần chốt trước productization. Xem kế hoạch chi tiết tại
[`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md).

## Risks

### R1 — Max 2022 EOL
Ngoài vòng support Autodesk. Chấp nhận theo D1, mitigate bằng tách tầng Adapter.

### R2 — Assembly conflict trong AppDomain của Max
Max nạp plugin .NET vào AppDomain dùng chung. Nếu Max đã nạp sẵn một version của
`Newtonsoft.Json` (hoặc lib khác) khác với version plugin cần, sẽ xung đột và rất khó
binding-redirect vì file config thuộc về Max.

**Cần verify trong Phase 1 spike**, đừng chờ đến lúc gãy. Nếu đúng: JSON layer của bridge
phải dùng serializer không phụ thuộc lib bên ngoài, hoặc ILMerge/ILRepack + internalize.

### R3 — Dockable panel trên Qt 5.15
Max 2022 dùng Qt cho UI chính. Host một WinForms/WPF control vào dock widget của Max
qua `MaxCustomControls` là đường đi phổ biến nhưng có quirk về focus, DPI và resize.
**Cần spike thật ở Phase 1**, không giả định API nào hoạt động trước khi chạy được.
