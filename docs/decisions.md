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

## D2 — Web platform: có source trong `web/` (superseded bởi D6)

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

**Vẫn ngoài phạm vi MVP:** marketplace nhiều người bán, multi-DCC. Payment và license đã
**vào phạm vi** theo D5. Xem spec §3.

## D4 — WebView2 Runtime: Evergreen + bootstrapper trong installer
**Quyết định:** dùng Evergreen Runtime, installer detect và chạy bootstrapper nếu thiếu.

**Lý do:** Fixed Version tự cập nhật được nhưng phình installer ~150MB và tự gánh
trách nhiệm vá lỗ hổng Chromium. Với sản phẩm thương mại, Evergreen an toàn hơn.

**Hệ quả:** phải test khi Runtime vắng mặt — plugin không được crash Max, phải báo lỗi rõ.

## D5 — Mô hình kinh doanh: bán license từng sản phẩm, dùng trong 3ds Max (locked 2026-10-06)

**Quyết định:** thôi bán file nén để tải trên web. Mỗi sản phẩm chỉ gồm 1 ảnh preview,
1 file nén và giá (mặc định 15.000 VND). User thanh toán xong thì được cấp license, và import
thẳng vào 3ds Max qua plugin.

**Hệ quả:**
- Thanh toán và license **chuyển vào phạm vi MVP** (trước đây spec §3 để ngoài phạm vi).
- Domain cũ (màu, style, vật liệu, 3D scenes, coin/điểm, discount, collection) không còn dùng.
- Dữ liệu catalog lấy từ `source/3DSMOOD/` (thay cho MongoDB cũ đã sập).
- Roadmap chia hai phase: A (web store) rồi B (kết nối Max). Xem
  [`product-roadmap.md`](product-roadmap.md).
- D2 (giữ `web/` làm source of truth) **đã bị thay thế bởi D6**.

## D6 — Codebase web: app mới gọn, cùng stack JS (locked 2026-10-06)

**Đề xuất:** viết `apps/store-web` (React/Vite) và `apps/store-api` (Express) mới, copy có chọn
lọc logic từ web cũ (SePay, stream, auth). `web/` **đã xóa** khỏi repo; tra lại bằng
`git show main:web/<path>`. Fonts và icon category đã chuyển sang
`apps/store-web/public/`. Phase B chỉ bắt đầu sau khi Phúc review giao diện app mới (A2).

**Lý do:** model dữ liệu đổi hẳn, DB cũ đã mất (không phải migrate), code cũ lớn và có debt
bảo mật đã xác nhận ([roadmap §2.4](product-roadmap.md#24-không-mang-sang-từ-code-cũ-debt-đã-xác-nhận-trong-source)).
So sánh các lựa chọn: [roadmap §2.1](product-roadmap.md#21-quyết-định-lớn-dùng-lại-web-hay-làm-app-mới-gọn).

## D7 — Database: PostgreSQL (locked 2026-10-06)

**Quyết định:** dùng PostgreSQL với `pg` và SQL migration, Docker khi dev. Order, payment và
license cần transaction, unique constraint và foreign key.

**Thay thế:** giữ MongoDB nếu ưu tiên dùng lại model Mongoose. Khi đó transaction bắt buộc
phải chạy trên replica set.

## D9 — Đăng nhập: session cookie HttpOnly, lưu phía server (locked 2026-10-06)

**Quyết định:** cookie `sid` ngẫu nhiên (HttpOnly, SameSite=Lax, Secure khi production), server
lưu **hash sha256** của session trong bảng `sessions` (có hạn dùng, thu hồi được). Mật khẩu băm
bằng `crypto.scrypt` của Node. Chống CSRF bằng SameSite + kiểm `Origin` + chỉ nhận JSON.

**Khác roadmap ban đầu** (JWT access + refresh): session phía server **thu hồi được ngay**
(logout, đổi mật khẩu, khóa tài khoản), không cần thư viện JWT/bcrypt, và cookie HttpOnly thì JS
trong trang (kể cả khi bị XSS) không đọc được token. Đổi lại cần một lần truy vấn DB mỗi request
cần đăng nhập — chấp nhận ở quy mô này.

**Phase B:** native/WebView2 dùng chung cookie của WebView; việc xác thực của plugin với backend
(device key, import ticket) là cơ chế riêng ở B3, không dùng lại `sid`.

## D8 — License = entitlement phía server, plugin miễn phí (đề xuất, chờ chốt)

**Đề xuất:** license là quyền vĩnh viễn `(user, product)` lưu ở server, chỉ được tạo khi
payment đã xác minh. Import qua ticket ngắn hạn, dùng 1 lần, gắn với device. Plugin không thu
phí và không có license key. Chi tiết: [roadmap §3](product-roadmap.md#3-mô-hình-license).

**Giới hạn đã chấp nhận:** không chặn được việc copy geometry sau khi đã merge vào scene (R5).

## Quyết định chưa khóa

| # | Câu hỏi | Chặn cái gì |
|---|---------|-------------|
| O1 | Production WebView load remote website hay bundled build? Dev đã chốt dùng localhost. Đề xuất: remote HTTPS. | CSP, offline behaviour, update flow |
| O2 | Google OAuth có cần không? Nếu cần thì phải test trong WebView2. Đề xuất: email/password trước. | Auth acceptance trong Max |
| O3 | Format import: dữ liệu thật là rar/zip/7z chứa nhiều `.max` (theo version/renderer) + FBX/OBJ. Đề xuất: chuẩn hóa thành `.zip` khi ingest, import `.max`, fallback FBX. | Ingest, import adapter |
| O4 | Kênh phân phối plugin: Autodesk App Store hay tự host? | Installer format, signing, review process |
| O5 | Mức bảo vệ asset: chỉ entitlement + device limit, hay thêm mã hóa cache/watermark? Đề xuất MVP: entitlement + device limit + ticket one-time. | Phase B3–B5 |
| O6 | Cổng thanh toán: SePay (code cũ có sẵn) hay PayOS/VNPay/MoMo? Chưa so sánh phí/hợp đồng. | Phase A4 |
| O7 | Số device tối đa mỗi tài khoản. (**Đã chốt 2026-10-06: không cho tải file nén trong browser.**) | Phase B3 |
| ~~O8~~ | ~~Token auth~~ → **đã chốt 2026-10-06: cookie HttpOnly**, xem D9. | — |

O1–O3 phải được chốt bằng chạy thật. O4–O7 là quyết định kinh doanh. Kế hoạch tổng:
[`product-roadmap.md`](product-roadmap.md). Chi tiết phần Max:
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

### R4–R8 — rủi ro theo mô hình license
Quyền phân phối thương mại của model trong `source/` (R4 — **Phúc xác nhận đã có quyền, 2026-10-06**), copy sau import (R5), webhook
thanh toán (R6), RAR/7z (R7), phụ thuộc renderer/version (R8). Chi tiết:
[roadmap §6](product-roadmap.md#6-rủi-ro-chính).
