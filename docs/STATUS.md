# STATUS — đã làm tới đâu, còn gì

> Cập nhật lần cuối: **2026-10-19** (giao diện plugin theme tối — UI-1) · nhánh hiện tại: `hung-connection_to_3dsmax` · nhánh làm việc: `phuc_apps` · `main` giữ code cũ (có `web/`)
> Plan đầy đủ: [`product-roadmap.md`](product-roadmap.md) · Cách chạy: [`../apps/README.md`](../apps/README.md)
> **Khi xong một việc: đổi `[ ]` thành `[x]`, ghi ngày, và sửa dòng "Cập nhật lần cuối".**

Chú giải: `[x]` xong và đã kiểm tra · `[~]` xong một phần / chưa kiểm tra đủ · `[ ]` chưa làm.

## Tổng quan

| Phase | Trạng thái |
|---|---|
| **A — Web store** | Đang làm. A0 xong một phần; A1 và A2 xong (giao diện đã duyệt); **A3 code xong, chờ Phúc kiểm tra giao diện đăng nhập**; A4–A6 chưa làm |
| **B — Kết nối 3ds Max** | Chưa bắt đầu. **Chỉ bắt đầu khi A4 pass** (giao diện đã được duyệt) |
| PoC native (WebView2 + bridge + MAXScript) | Đã chạy trên máy dev với trang demo `frontend/index.html`; chưa nối với web store |

## Phase A — Web store

### A0 — Chốt quyết định và dọn repo
- [x] Hướng đi: bán license từng model, dùng trong 3ds Max (D5)
- [x] Làm app mới thay `web/` cũ (D6); xóa `web/` ở nhánh `phuc_apps`
- [x] Quyền phân phối thương mại 360 model: Phúc xác nhận đã có (R4)
- [x] Không cho user tải file nén trong browser (O7)
- [x] D7: PostgreSQL (2026-10-06)
- [x] O8: token đăng nhập bằng cookie HttpOnly (D9, 2026-10-06)
- [x] Secret trong `.env_local` cũ (Wasabi, JWT, Google, Mongo): Phúc xác nhận **không còn dùng**, không cần đổi key hay xóa khỏi lịch sử git (2026-10-06)
- [ ] Commit và merge `phuc_apps` vào `main` (hiện `main` cố ý giữ code cũ)

### A1 — Ingest catalog (`apps/store-api/scripts/ingest.js`)
- [x] Quét `source/3DSMOOD`, ghép ảnh với file nén: **360/360 sản phẩm, 0 file lẻ**
- [x] Sinh thumbnail `.webp` (480px, 1400px) vào `storage/previews/`
- [x] Tên hiển thị từ file `.max` trong gói (296/360); còn lại đặt `<Subcategory> NN`
- [x] Manifest gói: định dạng (max/fbx/obj), renderer (V-Ray/Corona), có texture, dung lượng
- [x] Chạy lại nhiều lần không tạo bản trùng; có báo cáo `storage/ingest-report.json`
- [x] Test: ghép cặp, đặt tên (`npm test`)
- [ ] **TỒN ĐỌNG A1-1 — 24 file `.rar` dạng solid không đọc được** bằng `bsdtar`/`tar` (libarchive
  không hỗ trợ RAR solid). Hậu quả: 24 sản phẩm thiếu tên thật, danh sách `.max`, renderer; chưa
  đóng gói lại được. **Hướng giải quyết:** `brew install sevenzip` (lệnh `7zz`) hoặc
  `brew install unar`; trong `ingest.js` thêm nhánh: nếu `tar` lỗi thì thử `7zz l` / `lsar`.
  Danh sách file lỗi: `storage/ingest-report.json` → `archiveErrors`. Kiểm tra: chạy lại ingest,
  `archiveErrors` phải về 0. Làm trước A1-3.
- [ ] **TỒN ĐỌNG A1-2 — 64/360 sản phẩm tên dạng `<Subcategory> NN`** (không suy ra được từ `.max`);
  tên suy ra từ `.max` cũng chưa được duyệt hết. **Hướng giải quyết:** (a) làm A5 (admin) cho sửa
  tên; hoặc (b) xuất `catalog.json` ra CSV `id,name`, Phúc điền tên, ingest đọc file override
  `data/names.csv`. Chọn (a) nếu ít tên cần sửa, (b) nếu muốn sửa hàng loạt.
- [ ] **TỒN ĐỌNG A1-3 — Đóng gói lại mỗi asset thành `.zip` chuẩn hóa** (`storage/assets/<sha256>.zip`)
  cho native ở Phase B (plugin chỉ cần `System.IO.Compression`, không thêm NuGet). Chưa cần cho
  A3–A6. **Hướng giải quyết:** thêm bước vào ingest: extract vào thư mục tạm → kiểm đường dẫn
  (zip-slip, đường dẫn tuyệt đối, giới hạn số file/dung lượng) → nén `.zip` → ghi `assetKey`.
  Phụ thuộc A1-1. Làm trước B4.
- [ ] sha256 đã có trong catalog nhưng chưa dùng; cần cho import ticket (B3/B4)

### A2 — Catalog API + giao diện xem preview
- [x] API: categories, products (tìm kiếm, lọc, phân trang), chi tiết, health
- [x] API không lộ đường dẫn nguồn và sha256 (có test)
- [x] Giao diện: sidebar category, tìm kiếm, lưới ảnh, "Xem thêm", cửa sổ chi tiết, responsive
- [x] Build frontend thành công; qua proxy Vite thì API/ảnh/font/icon trả 200
- [x] Phúc đã xem và kiểm tra giao diện trên trình duyệt thật: ổn (2026-10-06)
- [x] Phúc duyệt giao diện — **cổng review để sang Phase B đã qua** (vẫn còn cổng A4 pass)
- [ ] Thử ở bề rộng panel Max (~400–700px) và trong WebView2
- [ ] Chạy thử trên Windows (chưa có máy; `tar.exe` đọc RAR chưa xác minh)
- [ ] Catalog vẫn đọc từ `catalog.json`; Postgres hiện chỉ chứa tài khoản/phiên. Sản phẩm vào DB khi cần (A4: khóa ngoại license → product, A5: admin sửa tên/giá)

### A3 — Tài khoản (code xong 2026-10-06, **chờ Phúc kiểm tra giao diện**)
- [x] Đăng ký / đăng nhập / đăng xuất / `me` bằng email + mật khẩu (`apps/store-api/src/auth.js`)
- [x] Cơ chế: session cookie HttpOnly + SameSite=Lax, lưu hash sha256 phía server; mật khẩu băm
  `scrypt` của Node (quyết định D9, `docs/decisions.md`)
- [x] PostgreSQL 16 + migration tự chạy khi khởi động (`migrations/001_init.sql`: `users`, `sessions`)
- [x] Chống CSRF: kiểm `Origin` + chỉ nhận JSON; giới hạn 10 KB/body
- [x] Giới hạn đăng nhập sai: 10 lần/15 phút theo email, 100 lần/15 phút theo IP → 429
- [x] Thông báo đăng nhập sai giống nhau cho "email lạ" và "sai mật khẩu"; có băm giả để thời gian
  phản hồi không lộ email nào tồn tại
- [x] Giao diện: nút Đăng nhập → hộp thoại Đăng nhập/Đăng ký, hiện email + nút Đăng xuất
- [x] 9 test mới trên Postgres thật (tổng 15 test pass). Đã **thử phá code có chủ đích** (bỏ kiểm
  Origin, bỏ kiểm hết hạn, bỏ kiểm mật khẩu, bỏ giới hạn, lưu token thô): mỗi lần đều có test báo lỗi
- [x] Chạy đầu-cuối qua proxy Vite bằng curl: đăng ký (201, cookie `HttpOnly; SameSite=Lax`) → `me` →
  đăng xuất → `me` 401; Origin lạ bị 403; catalog vẫn chạy
- [~] **Chưa ai xem giao diện đăng nhập trên trình duyệt thật** (tôi chỉ kiểm được build và API) —
  Phúc kiểm tra: đăng ký, F5 vẫn còn đăng nhập, đăng xuất, thử sai mật khẩu, thử email trùng
- [ ] **TỒN ĐỌNG A3-1 — Quên mật khẩu / đổi mật khẩu chưa có.** Chờ chọn dịch vụ gửi email (Phúc:
  "tính sau"). **Hướng giải quyết:** chọn nhà cung cấp (Resend/SendGrid/SMTP của tên miền), thêm bảng
  `password_resets` (token băm, hạn 30 phút, dùng 1 lần), 2 route `forgot`/`reset`; khi đổi mật khẩu
  phải **xóa mọi session của user** (`delete from sessions where user_id = ...`). Đổi mật khẩu khi đã
  đăng nhập (không cần email) có thể làm trước, độc lập.
- [ ] **TỒN ĐỌNG A3-2 — Session hết hạn không bị xóa khỏi DB** (chỉ bị từ chối khi dùng). Bảng
  `sessions` sẽ phình dần. **Hướng giải quyết:** job định kỳ `delete from sessions where expires_at <
  now()` (ví dụ mỗi giờ trong `server.js`, hoặc cron của hệ thống ở A6).
- [ ] **TỒN ĐỌNG A3-3 — Giới hạn đăng nhập sai nằm trong RAM của 1 tiến trình.** Khởi động lại là reset;
  chạy nhiều instance thì mỗi instance đếm riêng. Ngoài ra khi API đứng sau proxy/load balancer,
  `req.ip` sẽ là IP của proxy → mọi người dùng chung một bộ đếm IP. **Hướng giải quyết (A6):** đặt
  `app.set('trust proxy', ...)` đúng theo hạ tầng deploy; chuyển bộ đếm sang bảng DB hoặc Redis nếu
  chạy nhiều instance.
- [ ] **TỒN ĐỌNG A3-4 — Đăng ký lộ việc email đã tồn tại** (trả 409 `EMAIL_TAKEN`). Đánh đổi có chủ
  ý để người dùng biết mà đăng nhập. **Hướng giải quyết nếu cần chặt hơn:** trả thông báo trung tính và
  gửi email xác nhận (phụ thuộc A3-1).
- [ ] **TỒN ĐỌNG A3-5 — Chưa xác minh email** (ai cũng đăng ký được bằng email bất kỳ). Phụ thuộc A3-1.
- [ ] **TỒN ĐỌNG A3-6 — `docker-compose.yml` chưa chạy thử** (Docker chưa bật trên máy dev; Postgres
  đang dùng bản Homebrew). **Hướng giải quyết:** bật Docker Desktop, tắt Postgres Homebrew hoặc đổi
  cổng, chạy `docker compose up -d` rồi `npm test` để xác nhận.
- [ ] Google login — để sau, cần thử riêng trong WebView2 (O2)

### A4 — Giỏ hàng, thanh toán, license
- [ ] Chốt cổng thanh toán (O6; đề xuất SePay/VietQR, chưa so sánh phí các cổng khác)
- [ ] Tạo đơn (server tự tính giá), mã QR, kiểm trạng thái đơn, hết hạn đơn
- [ ] Webhook xác nhận thanh toán: bắt buộc xác thực, chống xử lý trùng, đối soát
- [ ] Cấp license `(user, product)` sau khi thanh toán được xác minh
- [ ] Trang "Thư viện của tôi"; nút Mua đổi theo trạng thái (hiện đang khóa, ghi "sắp có")
- [ ] Test các tình huống: thiếu tiền, dư tiền, sai mã, webhook gửi trùng, đơn hết hạn

### A5 — Admin tối thiểu
- [ ] Duyệt/ẩn sản phẩm, sửa tên và giá
- [ ] Xem đơn và payment, khớp thủ công, cấp/thu hồi license
- [ ] Phân quyền admin ở API

### A6 — Hardening và staging
- [ ] HTTPS, CORS/CSP theo môi trường, secret qua biến môi trường
- [ ] Backup database và thử restore
- [ ] Deploy staging, test E2E (xem → đăng nhập → mua → thấy trong thư viện)

## UI-1 — Giao diện plugin theme tối (2026-10-19, chỉ frontend `apps/store-web`)

Tham khảo bố cục từ ảnh Phúc gửi (thư viện model dạng app desktop); **không** dùng tên/logo của sản phẩm đó.

- [x] Theme tối, accent xanh; tên model dùng Codec Pro, số liệu/trạng thái dùng font monospace hệ thống
- [x] Khung app: thanh trên (trạng thái 3ds Max + API ONLINE/OFFLINE + làm mới), cột icon (Models, Tài khoản),
  cột bộ lọc + hàng đợi, lưới, panel chi tiết bên phải (màn hẹp: bộ lọc thành ngăn kéo, chi tiết phủ lên)
- [x] Bộ lọc: cây danh mục chọn nhiều (checkbox 3 trạng thái), lọc renderer V-Ray/Corona, đếm bộ lọc, xóa lọc
- [x] Tìm kiếm, sắp xếp (tên, dung lượng), phân trang 30/trang, tab Online / Đã tải
- [x] Card: ảnh nền trắng, nhãn renderer, dung lượng; trong Max có nút Download theo trạng thái
  (Đăng nhập để tải / Download / Trong hàng đợi / Đang tải / Lỗi · Thử lại / Đã import)
- [x] Hàng đợi (`queue.js`): chống bấm trùng, chạy tuần tự, thử lại xin ticket mới, bỏ job chờ/lỗi
- [x] **Bỏ nút Download trên trình duyệt (O7)**; trình duyệt chỉ xem catalog + nút "Mua license — sắp có"
- [x] Giả lập host khi dev: `http://localhost:5173/?mockMax=1` (không có trong bản build production — đã kiểm)
- [x] 3 test hàng đợi (`cd apps/store-web && npm test`); thử phá code: bỏ chạy tuần tự / bỏ chống trùng /
  cho bỏ job đang chạy → đều có test báo lỗi
- [x] Build pass; API trả đủ 360 sản phẩm qua 4 trang
- [~] **Chưa ai xem giao diện mới trên trình duyệt thật** — Phúc kiểm tra (cả chế độ thường và `?mockMax=1`)
- [ ] **Chưa chạy trong 3ds Max thật** (cần Windows) — checklist ở `download-queue-plan.md` §7
- [ ] **NỢ FE-1 — Web tải hết catalog về rồi lọc/sắp xếp/phân trang tại chỗ.** Đủ cho 360 sản phẩm (~100 KB),
  không đủ khi lên hàng nghìn. **Hướng giải quyết:** backend lọc nhiều danh mục + renderer + sắp xếp (BE5), web
  quay lại gọi theo trang.
- [ ] **NỢ FE-2 — Hàng đợi chưa có %, chưa hủy được job đang chạy, mất khi F5, tab "Đã tải" chỉ là trong phiên.**
  Nguyên nhân: native chưa gửi event tiến độ / chưa hỗ trợ hủy / xóa cache sau import. **Hướng giải quyết:**
  N1–N5 rồi F1–F4 trong `download-queue-plan.md`.
- [ ] **NỢ FE-3 — Thanh trên chưa hiện tên file scene** (scene.getInfo chưa trả). Hướng: N6 + F5.
- [ ] **NỢ FE-4 — Chưa có lọc "Đã sở hữu / Chưa mua"** (thay cho PRO/FREE trong ảnh tham khảo) và không có lọc
  Style (dữ liệu không có style). Hướng: BE4 cùng A4.
- [ ] **NỢ FE-5 — Mỗi sản phẩm chỉ có 1 ảnh** nên panel chi tiết không có gallery. Cần dữ liệu ảnh thêm.

### Nợ backend phát sinh (chi tiết: `download-queue-plan.md` §5)
- [ ] **BE2 — Gỡ `GET /api/products/:slug/download`** (trái O7; giao diện đã bỏ nút nhưng endpoint vẫn tải được). Làm ngay.
- [ ] BE1 — `import-ticket` kiểm license (cùng A4). Hiện đăng nhập là import được mọi sản phẩm.
- [ ] BE3 — trả `sha256` + `size` cùng ticket để native kiểm file.
- [ ] BE4 — cờ `owned` trong danh sách sản phẩm. · BE5 — lọc/sắp xếp ở server. · BE6 — giới hạn ticket/phút.

## Phase B — Kết nối 3ds Max (đang làm trên nhánh `hung-connection_to_3dsmax`)

Chi tiết kỹ thuật: [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) (Phase 4–14).

- [x] PoC: WebView2 trong Max, bridge `host.ping` / `scene.*` / `design.create`, installer (chỉ với trang demo)
- [~] B1: host nạp `StartUrl` theo cấu hình, kiểm origin chính xác scheme/host/port (đã có trong code của Hùng —
  chưa xác minh trên Windows). Còn path `D:\` dự phòng trong `PlatformBridge.ms` / `.mcr`
- [~] B2: `bridge.js` + nút Download/hàng đợi trên giao diện mới; thanh trạng thái dùng `host.getInfo`/`scene.getInfo`.
  Chưa chạy trong Max thật
- [~] Ticket import 1 lần (Hùng, `import_tickets`) — **chưa kiểm license (BE1)**
- [ ] Hàng đợi native, tiến độ, hủy, cache: **plan cho người làm Windows ở [`download-queue-plan.md`](download-queue-plan.md)**
- [ ] B3: đăng ký máy (device) + import ticket dùng 1 lần
- [ ] B4: native tải file, kiểm sha256, giải nén an toàn, cache
- [ ] B5: import `.max` vào scene (chọn bản theo version/renderer)
- [ ] B6: tiến trình, installer, ký số, test trên máy sạch

## Câu hỏi còn mở

| # | Câu hỏi | Chặn |
|---|---|---|
| O6 | Cổng thanh toán | A4 |
| O5 | Mức bảo vệ asset (chỉ license + giới hạn máy, hay thêm mã hóa cache) | B3–B5 |
| O7 | Số máy tối đa mỗi tài khoản (đã chốt: không Download trên trình duyệt) | B3 |
| O4 | Kênh phân phối plugin (Autodesk App Store hay tự host) | B6 |

## Giới hạn đã biết

- Mọi thứ trong `apps/` mới chỉ chạy thử trên **macOS**.
- Sau khi model đã vào scene Max thì không chặn được việc lưu ra file khác; license chỉ kiểm soát
  ai được lấy file nguồn (xem `product-roadmap.md` §3.4).
