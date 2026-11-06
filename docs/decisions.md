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

## D11 — Lifetime theo tài khoản + payOS (2026-10-24)

> Đã được thay thế cho plugin khách hàng bởi D15 bên dưới. Giữ nội dung này để tra cứu hệ thống cũ.

Theo yêu cầu triển khai trong `goal.md`, **thay thế D5/D8 về license từng sản phẩm**:
mỗi tài khoản có tối đa một license Lifetime, tối đa hai slot thiết bị cố định. Không có
reset, deactivate, transfer hoặc tự chuyển slot khi mất khóa/cài lại Windows. payOS là
cổng thanh toán được chọn (chốt O6); chỉ webhook/truy vấn provider đã xác minh mới cấp
license tự động. Admin được cấu hình phía server có thể cấp license thử.

Thiết bị dùng UUID và khóa RSA CNG không export trong C# net48, ưu tiên TPM; fallback
software CNG được thông báo rõ. Challenge một lần gắn phiên đăng nhập; phiên thiết bị
ngắn hạn được kiểm tra khi cấp và dùng import ticket. Không có offline licensing V1.
PostgreSQL giữ metadata và giao dịch; lưu trữ model/catalog/import engine không thay đổi.
Cookie HttpOnly hiện hữu tiếp tục giữ đăng nhập. Không tự tạo thanh toán thật trong test.

## D12 — Tải và import chỉ cho tài khoản sở hữu license (2026-10-25)

> Đã được thay thế cho plugin khách hàng bởi D15 bên dưới.

**Quyết định mới của người dùng, thay thế chính sách D12 trước đó:** tài khoản đang đăng nhập phải
sở hữu license ACTIVE mới được tải archive hoặc import model. Xác minh được một thiết bị đã gắn với
license của tài khoản khác chỉ khôi phục thông tin thiết bị; điều đó không cấp quyền tải/import.
Preview catalog vẫn xem được, và tài khoản có thể mua license riêng.

`VERIFY` tiếp tục chứng minh device UUID và public-key hash bằng challenge của phiên hiện tại; nó
không tạo slot. `ACTIVATE` yêu cầu key thuộc tài khoản đang đăng nhập. Mỗi license giữ tối đa hai
slot cố định; không chuyển quyền sở hữu, reset hoặc giải phóng slot.

Các route tải và cấp import ticket yêu cầu đồng thời device session hợp lệ, license ACTIVE trong
tài khoản hiện tại và ID license khớp với session. Khi dùng ticket, backend kiểm tra lại license
thuộc đúng user để ticket cũ không vượt qua chính sách mới. Key đầy đủ chỉ hiển thị cho tài khoản sở hữu;
admin được tra cứu last4 và metadata slot theo D14. Logout thu hồi phiên/ticket, revoke/suspend chặn tải.

## D14 — Tài khoản admin và giao diện quản trị (2026-10-25)

> Luồng backend cũ, không dùng để cấp license của plugin D15.

Không phát hành tài khoản hoặc mật khẩu admin mặc định. Operator cấp quyền cho tài khoản chủ sở hữu đã xác minh
bằng UUID trong `LICENSE_ADMIN_USER_IDS`; thay đổi cấu hình này có hiệu lực sau khi API khởi động lại.
Migration 013 hạ quyền tài khoản bootstrap cũ có credential dùng chung và thu hồi session. Đổi username/password
cần mật khẩu hiện tại, thu hồi toàn bộ session cũ trong transaction và cấp session mới.

Admin đăng nhập mở dashboard riêng cho tài khoản/license, thiết bị, thanh toán, nhật ký và đồng bộ R2.
Role DB được đối chiếu trên mỗi request; `LICENSE_ADMIN_USER_IDS` vẫn là cơ chế cấp quyền operator.
Đổi thông tin đăng nhập không biến admin allowlist thành role vĩnh viễn. Public registration luôn tạo khách hàng.
License có thể cấp thủ công, SUSPENDED rồi mở khóa; REVOKED giữ tính vĩnh viễn. Slot chỉ xem, không reset/chuyển.
Quyền admin không miễn kiểm tra license chính chủ/thiết bị khi gọi download và import API.

## D5 — Mô hình kinh doanh: bán license từng sản phẩm (đã thay thế bởi D11)

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

## D9 — Đăng nhập: session cookie HttpOnly, lưu phía server (2026-10-06; thay bởi D13)

**Quyết định:** cookie `sid` ngẫu nhiên (HttpOnly, SameSite=Lax, Secure khi production), server
lưu **hash sha256** của session trong bảng `sessions` (có hạn dùng, thu hồi được). Mật khẩu băm
bằng `crypto.scrypt` của Node. Chống CSRF bằng SameSite + kiểm `Origin` + chỉ nhận JSON.

**Khác roadmap ban đầu** (JWT access + refresh): session phía server **thu hồi được ngay**
(logout, đổi mật khẩu, khóa tài khoản), không cần thư viện JWT/bcrypt, và cookie HttpOnly thì JS
trong trang (kể cả khi bị XSS) không đọc được token. Đổi lại cần một lần truy vấn DB mỗi request
cần đăng nhập — chấp nhận ở quy mô này.

**Phase B:** native/WebView2 dùng chung cookie của WebView; việc xác thực của plugin với backend
(device key, import ticket) là cơ chế riêng ở B3, không dùng lại `sid`.

## D13 — JWT trong cookie HttpOnly, giữ thu hồi session (2026-10-25)

Theo yêu cầu của chủ dự án, thay opaque token trong `sid` bằng JWT HS256 qua `jose`.
JWT có `sub` (user UUID), `jti` (session ID 32 byte), `iat`, `exp`, issuer `3dsmood-api`,
audience `3dsmood-web`; thời hạn tối đa 30 ngày như phiên đăng nhập trước đây.
`JWT_SECRET` là secret server riêng, đúng 32 byte ngẫu nhiên dạng base64; thiếu/sai thì auth không hoạt động.
Cookie giữ HttpOnly, SameSite=Lax, Secure trong production; không trả JWT trong JSON hoặc lưu localStorage.

Mỗi request vẫn kiểm tra session PostgreSQL khớp cả `jti` và `sub`, còn hạn và chưa bị xóa.
Logout xóa session, vô hiệu hóa device session và import ticket liên quan; JWT chưa hết hạn cũng không dùng lại được.
Schema và session ID bytea giữ nguyên để bảo toàn liên kết license/thiết bị. Database không lưu nguyên JWT.
Cookie opaque cũ cần đăng nhập lại một lần; license và slot thiết bị không bị thay đổi.
Không triển khai refresh token trong thay đổi này. Giữ secret qua restart; đổi secret sẽ yêu cầu đăng nhập lại.

## D10 — Download = tải về máy trong plugin rồi import (locked 2026-10-19)

**Quyết định:** sau khi khách trả phí và license được cấp, khách phải **Download** sản phẩm (plugin tải gói về
máy) rồi mới **import** vào 3ds Max. Giao diện gộp hai bước vào **một nút "Download"** (lựa chọn a): bấm là
tải xong import luôn; hàng đợi để theo dõi. Native vẫn giữ hai bước tách riêng để sau tách được thành hai nút.

**Hệ quả:**
- O7 giữ nguyên: **trình duyệt không có Download.** Nút "Download" chỉ xuất hiện khi chạy trong plugin.
- Endpoint `GET /api/products/:slug/download` (tải trên trình duyệt, nhánh `hung-connection_to_3dsmax`) trái
  O7 → phải gỡ (nợ BE2).
- Hàng đợi, % tiến độ, hủy, cache lâu dài: plan ở [`download-queue-plan.md`](download-queue-plan.md).

## D8 — License = entitlement từng sản phẩm (đã thay thế bởi D11)

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

## D15 — License offline theo máy, GitHub Pages + Google Drive (2026-10-26)

**Lịch sử:** Phần catalog/preview Pages dưới đây được thay thế bởi D16.

Theo yêu cầu mới của chủ sở hữu, luồng plugin khách hàng thay D11/D12/D14: không tài khoản,
mật khẩu, backend, R2 hoặc payOS. Chủ sở hữu xác nhận chuyển khoản bên ngoài plugin rồi
ký license vĩnh viễn gắn mã máy bằng công cụ riêng. Plugin chỉ giữ khóa công khai,
xác minh offline và kiểm tra lại quyền tại native import. Khóa bí mật nằm ngoài repo và
bộ cài; cấp lại khi mã máy đổi, không có thu hồi từ xa cho license offline vĩnh viễn.

GitHub Pages phục vụ catalog JSON version 1 và preview tĩnh. Google Drive phục vụ file
model chia sẻ công khai; native host tải, kiểm tra SHA-256, giải nén an toàn và dùng
luồng import/scene hiện có. Catalog và preview gần nhất được cache cho khi mất mạng.
Thay catalog/preview không cần build lại plugin. URL Drive không hiển thị trong UI,
nhưng tải trực tiếp từ link công khai không phải kiểm soát truy cập thực sự.

Giữ D1 (.NET Framework 4.8 / Max 2022), ranh giới bridge và bộ cài hiện có.
Hướng dẫn vận hành: [offline-library.md](offline-library.md).

## D16 — Đóng gói thư viện trong plugin (2026-10-27)

Danh sách model và ảnh preview được đóng gói trong plugin để xem offline ngay sau khi cài. File model được tải từ Google Drive khi import và kiểm tra checksum. Mọi thay đổi catalog hoặc ảnh cần build và bàn giao plugin mới. Admin giữ đăng nhập và ký license phía server, không còn chức năng quét hoặc xuất bản catalog. Không dùng GitHub Actions, Pages hay R2 cho việc cập nhật thư viện.


## D17–D25 — Kiến trúc v3: Drive private → VPS → plugin (locked 2026-10-29)

Chủ dự án chốt ngày 2026-10-29. **Thay thế cho luồng khách hàng** của D11–D16 (giữ các mục đó làm lịch sử).
Chi tiết: [`v3-architecture.md`](v3-architecture.md), [`v3-database.md`](v3-database.md),
[`v3-implementation-plan.md`](v3-implementation-plan.md).

| ID | Quyết định |
|---|---|
| D17 | Danh tính khách = **thiết bị** (khóa CNG/TPM của `DeviceIdentityService`), ký challenge để lấy token ngắn hạn. Khách **không có tài khoản** |
| D18 | **Bán theo từng model, license vĩnh viễn** cho model đó. Quyền lưu ở bảng `entitlements`; `ALL_MODELS` chỉ dành cho khách có license MXL1 cũ và admin cấp tay |
| D19 | Catalog = **PostgreSQL** trên VPS (Model ID = UUID). File model gốc trên **Google Drive private** (OAuth Gmail B, Viewer); backend **stream** model cho plugin, không bao giờ lộ Drive ID/URL. Preview WebP lưu trên VPS, Nginx phục vụ |
| D20 | **Không push** tới plugin. Plugin **tự phát hiện và tự cập nhật** catalog + preview: khi mở, mỗi 5 phút, và qua SSE |
| D21 | Thu tiền: chuyển khoản theo QR; khách bấm "đã chuyển" → **bot Telegram** báo chủ → chủ bấm "Đã nhận tiền" → cấp quyền. **Không** payOS, **không** R2. Không có đối soát ngân hàng tự động (chủ tự kiểm sao kê) |
| D22 | Web Admin duy nhất = admin của `store-api`/`store-web`; ngừng `apps/license-admin` (Vercel) sau khi thay thế xong |
| D23 | **Bộ cài mang sẵn preview** (kéo từ manifest VPS lúc build); sau đó plugin chỉ đồng bộ phần chênh lệch |
| D24 | Giao diện plugin v3 = **UI-1 tối**, commit `13ad8f4` |
| D25 | Thông tin ngân hàng nhận tiền, giá mặc định và giá từng model **sửa trong trang admin** (`app_settings`); mỗi đơn lưu bản chụp thông tin ngân hàng |

## D26 — Lấy file model: VPS tải hộ link công khai + lưu bản sao (locked 2026-10-30)

Chủ dự án chọn để tránh OAuth. **Thay phần "Drive private + OAuth" của D19.** VPS giữ link, kiểm license, tải từ Drive một lần, lưu đĩa rồi phục vụ khách; plugin không nhận link hay Drive ID. Quét thư mục dùng Drive API key. Rủi ro đã chấp nhận và chi tiết: mục "Bàn giao" trong [`v3-implementation-plan.md`](v3-implementation-plan.md).

## D27 — Dọn code cũ P7: làm một phần, phần còn lại có điều kiện (2026-11-03)

Plan ghi P7 chỉ làm "khi P6 ổn định ≥ 2 tuần"; P6 chưa deploy nên điều kiện này **chưa đạt**. Theo yêu cầu của chủ dự án, đã làm
phần **không làm hỏng chức năng đang dùng**, phần còn lại giữ nguyên kèm lý do:

| Hạng mục | Quyết định | Lý do |
|---|---|---|
| payOS (API `src/payments`, `/api/payments`, `/api/webhooks/payos`, 2 script, `@payos/node`, `PAYOS_*`) và giao diện thanh toán web | **Đã gỡ** (2026-11-03) | Thay bằng luồng đơn hàng + Telegram (D21) |
| `OfflineLibrary.jsx` (giao diện thư viện offline cũ) | **Đã gỡ** | Không còn được mount từ `main.jsx` |
| Bảng DB cũ (`orders`, `payment_events`, …) | **Giữ** | Admin cũ còn đọc `orders` (doanh thu, danh sách `legacy-orders`); xóa bảng cần gỡ các màn đó, sao lưu và chủ dự án duyệt |
| `src/r2/`, `r2-http.js`, `cloudflare/`, `assets.js`, catalog cũ | **Giữ** | `catalog-runtime`, `/api/admin/overview`, tải asset cũ vẫn phụ thuộc; cần gỡ cả cụm cùng admin dashboard cũ |
| Đăng ký/đăng nhập khách (`auth.js`), `StoreApp` trong `App.jsx` | **Giữ** | Hiện là **cách duy nhất tạo tài khoản admin đầu tiên** (đăng ký rồi cấp quyền bằng `LICENSE_ADMIN_USER_IDS`); cần script tạo admin trước khi gỡ |
| `apps/license-admin` (Vercel) | **Giữ** | Plan: chỉ gỡ sau khi P3.5 thay thế; **P3.5 chưa làm** → đây là công cụ ký MXL1 duy nhất (tiêu chí #17) |
| `GoogleDriveDownloader.cs`, `StaticCatalogService.cs`, chế độ đóng gói | **Giữ** | Plan: "nếu bỏ chế độ đóng gói" — chủ dự án chưa quyết định |
| `licensing/` (license Lifetime theo tài khoản, phiên thiết bị cũ) | **Giữ** | Plan không liệt kê; plugin cũ và `devices/` còn dùng |

Điều kiện để làm nốt: (1) P3.5 xong → gỡ `apps/license-admin`; (2) script tạo admin → gỡ đăng ký khách + `StoreApp`;
(3) gỡ các màn admin đọc payOS/R2 → backup rồi xóa bảng cũ; (4) quyết định chế độ đóng gói → dọn C#; (5) P6 deploy ổn ≥ 2 tuần.

## D28 — License cả thư viện, tải lần đầu từ VPS, dọn sạch code cũ (locked 2026-11-04)

Chủ dự án chốt, **thay D18 (license từng model), D24 (seed ảnh trong installer) và phần "giữ" của D27**:

| # | Quyết định |
|---|---|
| D28.1 | Mua 1 lần = **license cả thư viện, vĩnh viễn, gồm cả model thêm sau**. Xác nhận đơn → cấp `ALL_MODELS` cho thiết bị. Một giá duy nhất (sửa trong admin) |
| D28.2 | **1 license = 1 máy**. Đổi/cài lại máy → chủ chuyển license sang thiết bị mới trong admin |
| D28.3 | Installer **không** đóng sẵn catalog/ảnh. Lần chạy đầu plugin tải toàn bộ catalog + preview từ VPS (có tiến độ, chạy tiếp khi bị ngắt); sau đó cập nhật qua ETag + SSE như cũ |
| D28.4 | File model giữ nguyên D26: VPS tải hộ từ Drive, khách không thấy link |
| D28.5 | Gỡ hết code của hướng đã bỏ: R2/Cloudflare, payOS còn sót, đăng ký khách/StoreApp, `apps/license-admin`, MXL1, `licensing/` cũ, OAuth Drive, chế độ đóng gói (`library/`, `GoogleDriveDownloader.cs`, `StaticCatalogService.cs`), tài liệu lỗi thời. Admin đầu tiên tạo bằng script |
| D28.6 | Deploy lên VPS Vietnix `14.225.224.169`, domain `3dsmood.io.vn` |

## D29 — Ảnh preview do admin tải lên VPS, ghép cặp theo tên file (locked 2026-11-05)

Google Drive giới hạn tải ảnh nên **worker không còn tải ảnh từ Drive** (bỏ giai đoạn `DOWNLOADING_PREVIEWS`; code sharp dùng chung giữ lại trong `worker/previews.js`). Drive chỉ cung cấp file nén `.zip/.rar/.7z`.

| Mục | Quyết định |
|---|---|
| D29.1 | Admin tải ảnh ở mục Model: nút "Tải ảnh lên" theo từng danh mục, hoặc "Tải cả thư mục" (`Danh mục/Con/ảnh.jpg`, bỏ tên thư mục đã chọn, tự tạo danh mục thiếu). VPS lưu `sha256.webp` (sm 480 / lg 1400), ≤ 15 MB, jpeg/png/webp, `POST /api/admin/previews` |
| D29.2 | Khóa ghép = tên file chuẩn hóa (`models.stem`): chữ thường, bỏ khoảng trắng cuối và đuôi ảnh/nén lặp lại (`x .jpg`, `x.rar.rar`), **không phụ thuộc thư mục**. Hai ảnh hoặc hai zip cùng stem = mục "Cần duyệt", không tự ghép |
| D29.3 | Trạng thái suy ra, không lưu: **Đủ** (ảnh + zip) là loại duy nhất vào catalog công khai (gallery và plugin); **Thiếu zip** / **Thiếu ảnh** chỉ hiện ở admin |
| D29.4 | Danh mục của model = danh mục nơi ảnh được tải lên. Zip nằm thư mục Drive khác: giữ danh mục của ảnh, cờ "Lệch danh mục" (`drive_category_id`), không chặn. Tên model = stem file ảnh, admin sửa được (PATCH cũ) |
| D29.5 | Mọi thay đổi (tải ảnh, xóa ảnh, quét Drive) tính lại ghép cặp và `refreshCatalogState` trong cùng transaction; chỉ tăng phiên bản khi tập công khai đổi |
| D29.6 | Migration 025: xóa các hàng `model_previews` nguồn `DRIVE_IMAGE` (file .webp trên đĩa giữ nguyên, dọn tay). Model cũ (stem NULL) được lần quét sau nhận lại theo `drive_file_id` |

Số liệu kiểm trên dữ liệu thật: 320 ảnh cục bộ / 360 zip Drive → 318 khớp theo stem, danh mục trùng cả 318.

## D30 — Một gói MZP, kho model cục bộ và tách tải/import (locked 2026-11-05)

Chủ dự án xác nhận trong phiên triển khai: thay luồng Download tự import của D10 bằng hai thao tác riêng.

| Mục | Quyết định |
|---|---|
| D30.1 | File tải công khai là `3dsmood-library.mzp`: Run Script trong Max 2022, đăng ký macro để thêm nút qua Customize User Interface. Payload chỉ xuất hiện một lần; không kèm EXE, bộ cài thủ công hoặc hướng dẫn rời trong gói phát hành mới. Giữ các dependency và thông báo bản quyền cần thiết bên trong. |
| D30.2 | Download chỉ tải và giải nén an toàn vào kho model bền vững. Chỉ ghi nhận thành công sau khi dữ liệu sẵn sàng; xóa archive sau thành công. Giữ file model và texture ở vị trí ổn định để import lại trực tiếp từ SSD, không tải/giải nén lại. |
| D30.3 | Settings cho chọn thư mục tải bằng hộp thoại native. Thay đổi chỉ áp dụng cho model tải sau; model cũ giữ đường dẫn đã lưu để không làm hỏng tham chiếu texture của scene. |
| D30.4 | Mục Đã tải đọc chỉ mục lưu trên đĩa, tồn tại sau khi đóng panel/Max; Import chỉ dùng model đã lưu và không tự tải khi file thiếu. Web chỉ gửi model UUID, không gửi đường dẫn tùy ý. |
| D30.5 | Import cục bộ không chờ mạng. Cho phép offline theo quyền đã được server xác minh gần nhất và lưu có bảo vệ trên thiết bị; khi đã nhận thông tin thu hồi/chặn phải lưu trạng thái từ chối, không dùng quyền cho phép cũ để vượt qua. |

Triển khai theo ba phần tách biệt: native/kho model, web/Settings–Đã tải, đóng gói/phát hành MZP. Tích hợp và chạy kiểm tra trước khi bàn giao; nghiệm thu trong 3ds Max thật phải phân biệt với kiểm tra tự động.

## D31 — Chọn mẫu/file trong model đã tải (2026-11-05)

Đã kiểm 360 archive cục bộ trong source/3DSMOOD bằng tar: 317 đọc được, 284 có nhiều file .max/.fbx/.obj, 128 có nhiều file .max; tối đa 7 file import được (6 file .max). 43 archive chưa kết luận bằng công cụ này. Các lựa chọn có thể là màu/mẫu khác, regular/lowpoly, renderer hoặc phiên bản Max, không tự coi mọi file là sản phẩm khác nhau.

- Download lưu chỉ mục toàn bộ file import được sau giải nén. Model đã tải bằng bản D30 được quét thư mục đã giải nén một lần để bổ sung chỉ mục, không tải/giải nén lại.
- Đã tải → Import: một file thì import trực tiếp; nhiều file phải hiện danh sách và khách chọn rồi xác nhận. Hiển thị tên, đường dẫn tương đối, định dạng và gợi ý renderer/năm từ tên file. Không chọn mặc định thay khách.
- Bridge library.importOptions chỉ nhận modelId. asset.import nhận modelId và optionId bất định danh đường dẫn; native chỉ cho chọn file trong chỉ mục của model. Không có lựa chọn khi nhiều file thì báo IMPORT_SELECTION_REQUIRED. Lựa chọn/file mất phải báo lỗi, không tự import file khác hoặc tải lại.
- Phạm vi lựa chọn là file .max/.fbx/.obj trong gói; không tách từng object bên trong một file .max.
## D32 — Một plugin gắn cố định với Max sở hữu (2026-11-05)

- Mỗi tiến trình 3ds Max có một cửa sổ plugin riêng. Singleton chỉ nằm trong từng tiến trình; mở plugin ở Max A/B sẽ có hai cửa sổ độc lập.
- Tiến trình sở hữu được chốt bằng PID và thời điểm khởi động, không thay theo focus hay thứ tự liệt kê cửa sổ. Tiêu đề plugin có tên scene và PID; thanh trên hiển thị đường dẫn scene của Max sở hữu.
- Bỏ bộ chọn Max đích. Native chỉ đọc metadata của Max sở hữu và dispatch import vào adapter trong cùng tiến trình, không chuyển lệnh import tới pipe của Max khác.
- Mở/reset scene mới trong cùng Max cập nhật đích cho lần import tiếp theo. Nếu scene đổi sau khi đã chụp đích của một thao tác đang chạy, kiểm tra document token và đường dẫn scene phải chặn thao tác đó. Chủ sở hữu không sẵn sàng thì báo lỗi, không chuyển sang Max khác.
## D33 — Tên hiển thị plugin là 3dsmood (2026-11-05)

Tên hiển thị thống nhất là 3dsmood: cửa sổ native (vẫn kèm scene/PID), header giao diện, toolbar/tooltip, Category trong Customize User Interface, thông báo cài/loader và metadata sản phẩm. Giữ macroScript OpenPlatformPanel và internalCategory Platform để bảo toàn định danh action trong CUI/menu cũ; các đường dẫn runtime, model và dữ liệu thiết bị không đổi. Installer cập nhật các bản macro tự sinh cũ đã biết nếu có. Bản MZP đổi tên là v1.3.1; cần kiểm tra hiển thị thực tế sau khi khởi động lại Max.
## D34 — Một panel chọn nhiều cửa sổ Max (2026-11-06)

Theo yêu cầu mới, thay hành vi owner-bound của D32: dropdown native liệt kê các Max đang mở, tên scene/đường dẫn/PID và trạng thái agent. Lựa chọn rõ ràng giữ nguyên qua polling/focus; không tự chuyển sang cửa sổ khác khi đích đóng hoặc đổi document. Import chụp PID + thời điểm khởi chạy + đường dẫn + document token; Max sở hữu panel dùng adapter local, Max khác nhận qua named pipe giới hạn cùng Windows user. Agent phía đích kiểm process identity và MAXScript kiểm document ngay trước merge. Mỗi Max cần agent Startup cùng phiên bản, không cần panel riêng. Đóng Max chứa panel vẫn đóng panel. Không thay luồng tải/chọn mẫu/license.

## D35 — Đồng bộ riêng nhánh 3DMODELS, giữ định danh (2026-11-07)

Nguồn tên 3DSMOOD giữ nguyên root/source ID nhưng worker chọn duy nhất thư mục con 3DMODELS (hỗ trợ shortcut/resource key/phân trang). Không duyệt 3DSCENES; đường dẫn danh mục bắt đầu ngay từ Furniture, Lighting… Nguồn trỏ thẳng 3DMODELS tiếp tục dùng root đó; nguồn danh mục cũ khác tên giữ hành vi cũ. Thiếu hoặc trùng nhánh 3DMODELS thì fail trước publish, không tự quét cả gốc. File ID không đổi nên không tạo lại model/file/category; preview category đã duyệt tiếp tục được ưu tiên.

Snapshot/scan cũ của hai loại nguồn này không đủ điều kiện dùng tiếp cho INCREMENTAL hoặc resume; phải FULL theo policy models-v1. Worker tự xếp một FULL mỗi source/policy sau deploy, giữ checkpoint scopeRefresh để không lặp; đang có job thì chờ lần kiểm tra tiếp theo (60 giây). Hủy hoặc fail thì admin quyết định chạy lại, không tự lặp vô hạn. FULL chỉ duyệt metadata, không tải lại archive/preview. Không thay API/plugin/device/license hoặc dữ liệu Đã tải trên SSD khách.
