# STATUS — đã làm tới đâu, còn gì

> Cập nhật lần cuối: **2026-10-06** · nhánh làm việc: `phuc_apps` · `main` giữ code cũ (có `web/`)
> Plan đầy đủ: [`product-roadmap.md`](product-roadmap.md) · Cách chạy: [`../apps/README.md`](../apps/README.md)
> **Khi xong một việc: đổi `[ ]` thành `[x]`, ghi ngày, và sửa dòng "Cập nhật lần cuối".**

Chú giải: `[x]` xong và đã kiểm tra · `[~]` xong một phần / chưa kiểm tra đủ · `[ ]` chưa làm.

## Tổng quan

| Phase | Trạng thái |
|---|---|
| **A — Web store** | Đang làm. A0 xong một phần; **A1 và A2 xong, giao diện đã được Phúc duyệt**; A3–A6 chưa làm |
| **B — Kết nối 3ds Max** | Chưa bắt đầu. **Chỉ bắt đầu khi A4 pass** (giao diện đã được duyệt) |
| PoC native (WebView2 + bridge + MAXScript) | Đã chạy trên máy dev với trang demo `frontend/index.html`; chưa nối với web store |

## Phase A — Web store

### A0 — Chốt quyết định và dọn repo
- [x] Hướng đi: bán license từng model, dùng trong 3ds Max (D5)
- [x] Làm app mới thay `web/` cũ (D6); xóa `web/` ở nhánh `phuc_apps`
- [x] Quyền phân phối thương mại 360 model: Phúc xác nhận đã có (R4)
- [x] Không cho user tải file nén trong browser (O7)
- [ ] **D7: chọn database (đề xuất PostgreSQL)** — cần chốt trước A3
- [ ] **Đổi (rotate) toàn bộ secret trong `.env_local` cũ** (Wasabi, JWT, Google, Mongo) — đã nằm trong lịch sử git. Bản gốc ở nhánh `main`
- [ ] Quyết định có xóa secret khỏi lịch sử git hay không (cần nếu repo đã push remote)
- [ ] Commit và merge `phuc_apps` vào `main` (hiện `main` cố ý giữ code cũ)

### A1 — Ingest catalog (`apps/store-api/scripts/ingest.js`)
- [x] Quét `source/3DSMOOD`, ghép ảnh với file nén: **360/360 sản phẩm, 0 file lẻ**
- [x] Sinh thumbnail `.webp` (480px, 1400px) vào `storage/previews/`
- [x] Tên hiển thị từ file `.max` trong gói (296/360); còn lại đặt `<Subcategory> NN`
- [x] Manifest gói: định dạng (max/fbx/obj), renderer (V-Ray/Corona), có texture, dung lượng
- [x] Chạy lại nhiều lần không tạo bản trùng; có báo cáo `storage/ingest-report.json`
- [x] Test: ghép cặp, đặt tên (`npm test`)
- [ ] **24 file `.rar` dạng solid không đọc được** bằng `bsdtar`/`tar` → cần `7zz` hoặc `unar`
- [ ] Rà soát lại tên sản phẩm (64 tên là `<Subcategory> NN`, tên từ `.max` chưa duyệt hết)
- [ ] Đóng gói lại mỗi asset thành `.zip` chuẩn hóa (cho native ở Phase B; chưa cần cho A2)
- [ ] Tính sha256 đã có trong catalog nhưng chưa dùng; cần khi làm import ticket (B3/B4)

### A2 — Catalog API + giao diện xem preview
- [x] API: categories, products (tìm kiếm, lọc, phân trang), chi tiết, health
- [x] API không lộ đường dẫn nguồn và sha256 (có test)
- [x] Giao diện: sidebar category, tìm kiếm, lưới ảnh, "Xem thêm", cửa sổ chi tiết, responsive
- [x] Build frontend thành công; qua proxy Vite thì API/ảnh/font/icon trả 200
- [x] Phúc đã xem và kiểm tra giao diện trên trình duyệt thật: ổn (2026-10-06)
- [x] Phúc duyệt giao diện — **cổng review để sang Phase B đã qua** (vẫn còn cổng A4 pass)
- [ ] Thử ở bề rộng panel Max (~400–700px) và trong WebView2
- [ ] Chạy thử trên Windows (chưa có máy; `tar.exe` đọc RAR chưa xác minh)
- [ ] Dữ liệu hiện đọc từ `catalog.json`, chưa dùng database (làm cùng A3/A4)

### A3 — Tài khoản
- [ ] Đăng ký / đăng nhập email + mật khẩu, refresh token, rate limit
- [ ] Chốt nơi lưu token: cookie HttpOnly hay localStorage (O8)
- [ ] Quên mật khẩu (cần chọn dịch vụ gửi email)
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

## Phase B — Kết nối 3ds Max (chưa bắt đầu)

Chi tiết kỹ thuật: [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) (Phase 4–14).

- [x] PoC: WebView2 trong Max, bridge `host.ping` / `scene.*` / `design.create`, installer (chỉ với trang demo)
- [ ] B1: panel load web store thật theo URL cấu hình, kiểm origin chính xác; bỏ path `D:\` cứng
- [ ] B2: SDK bridge trong React, chế độ "đang chạy trong Max", nút Import
- [ ] B3: đăng ký máy (device) + import ticket dùng 1 lần
- [ ] B4: native tải file, kiểm sha256, giải nén an toàn, cache
- [ ] B5: import `.max` vào scene (chọn bản theo version/renderer)
- [ ] B6: tiến trình, installer, ký số, test trên máy sạch

## Câu hỏi còn mở

| # | Câu hỏi | Chặn |
|---|---|---|
| D7 | Database: PostgreSQL? | A3 |
| O6 | Cổng thanh toán | A4 |
| O8 | Cookie hay localStorage cho token | A3 |
| O5 | Mức bảo vệ asset (chỉ license + giới hạn máy, hay thêm mã hóa cache) | B3–B5 |
| O7 | Số máy tối đa mỗi tài khoản | B3 |
| O4 | Kênh phân phối plugin (Autodesk App Store hay tự host) | B6 |

## Giới hạn đã biết

- Mọi thứ trong `apps/` mới chỉ chạy thử trên **macOS**.
- Sau khi model đã vào scene Max thì không chặn được việc lưu ra file khác; license chỉ kiểm soát
  ai được lấy file nguồn (xem `product-roadmap.md` §3.4).
