# License Lifetime + payOS: cấu hình và vận hành

## Chính sách

Một account có một Lifetime license, tối đa hai slot cố định. Không có API xóa/reset/chuyển slot.
Cài lại Windows, mất khóa hoặc đổi phần cứng có thể mất khả năng sử dụng slot vĩnh viễn.
Đăng nhập dùng JWT HS256 trong cookie `sid` HttpOnly; quyền tải/import còn cần license ACTIVE và cookie thiết bị `dsid`.
Theo D12, máy đã kích hoạt tiếp tục dùng được khi đổi sang tài khoản khác trên cùng danh tính Windows.
Plugin tự ký challenge để khôi phục slot ACTIVE khớp cả UUID và public-key hash; không nhập lại key hay tạo thêm slot.
Key, bốn ký tự cuối và danh sách slot chỉ hiển thị trong tài khoản sở hữu. Tài khoản sử dụng máy không nhận quyền sở hữu license.
Thêm slot mới bằng ACTIVATE vẫn yêu cầu key thuộc tài khoản đang đăng nhập, tối đa hai slot cố định mỗi license.
Không hỗ trợ offline license. Revoke/suspend license chặn tất cả phiên/ticket đang dùng license đó;
logout thu hồi phiên/ticket của tài khoản vừa đăng xuất.

## Development

Backend cần `JWT_SECRET`: secret riêng đúng 32 byte ngẫu nhiên dạng base64, chỉ lưu phía server.
Tạo bằng `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` rồi lưu vào `.env`
hoặc secret manager; không dùng lại secret license/PayOS. Giữ giá trị này qua restart; thay nó yêu cầu đăng nhập lại.
Cookie JWT hết hạn tối đa 30 ngày, vẫn đối chiếu session DB để logout thu hồi ngay.
Khi nâng cấp từ opaque cookie cũ, đăng nhập lại một lần; slot máy đã kích hoạt được giữ nguyên.
Không cần migration cho JWT vì giữ kiểu session ID và các khóa ngoại hiện có.

1. Cài dependency với `npm ci` trong `apps/store-api` và `apps/store-web`.
2. `npm run dev` trong `apps/store-api` nạp `.env`, rồi ghi đè các giá trị trùng bằng `../../storage/license-dev.env` nếu file đó có mặt. Biến môi trường đặt trực tiếp trong PowerShell vẫn được ưu tiên.
   Nếu không có file local này, đặt `DATABASE_URL` trong `.env` đúng credential PostgreSQL.
   Không sửa `pg_hba.conf` của service đang dùng để né mật khẩu; không chạy test lên database thật.
3. Tạo **hai** giá trị riêng bằng `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
   Gán vào `LICENSE_HMAC_SECRET` và `LICENSE_ENCRYPTION_KEY`. Không gửi lên React, ghi log hay commit.
4. Chạy `npm run dev` ở API (4000), rồi ở web (5173). Plugin load `http://localhost:5173`.
5. `GET /api/health` báo riêng DB, licensing, payments, catalog. Không có catalog vẫn dùng được license API;
   không cần sửa `SOURCE_DIR` cho phần này. Dữ liệu model giữ cơ chế hiện hữu.

Trong lần triển khai này, credential database cũ lỗi `28P01`; cluster riêng được tạo tại
`storage/license-postgres/data`, listen **127.0.0.1:55432**, database `store_license_dev` và `store_license_test`.
Credential ngẫu nhiên cùng secret dev nằm trong **file gitignored** `storage/license-dev.env`.
Service PostgreSQL cũ ở 5432 và `.env` của người dùng được giữ nguyên.

Trên máy phát triển này, chạy backend thông thường từ `apps/store-api`:

```powershell
npm run dev
```

Hoặc chạy thủ công bằng cấu hình riêng:

```powershell
node --env-file=../../storage/license-dev.env src/server.js
node --env-file=../../storage/license-dev.env --test --test-concurrency=1
```

Nếu cluster riêng đã dừng, ở repo root:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D "$PWD\storage\license-postgres\data" -l "$PWD\storage\license-postgres\postgres.log" -W start
```

Không xóa `storage` vì chứa database và secret cần để đọc license dev. Cluster này chỉ dành cho local dev/test.

## Cấp thử qua admin

Đăng ký tài khoản thử bằng auth API/UI, tra UUID trong `users`, điền UUID tài khoản admin vào
`LICENSE_ADMIN_USER_IDS` ở environment phía server. Đăng nhập tài khoản đó rồi gọi
`POST /api/admin/licenses/issue` với `{ "userId": "UUID-tai-khoan-nhan" }` và cookie `sid`.
Client không có trường role/admin. Danh sách rỗng từ chối tất cả. My License của account nhận sẽ hiển thị key.
Endpoint `/revoke` nhận `userId`, `status` là `SUSPENDED` hoặc `REVOKED`, `reason` tùy chọn.
Revoke là vĩnh viễn; không có endpoint khôi phục hay thay thiết bị.

## payOS và HTTPS

SDK chính thức `@payos/node` nằm trong dependencies API; `npm ci` cài đúng phiên bản trong lockfile.
Đặt các biến sau trong environment backend hoặc secret manager, không đưa vào `VITE_*` hay plugin:

```dotenv
LICENSE_PRICE_VND=2000
PAYOS_CLIENT_ID=
PAYOS_API_KEY=
PAYOS_CHECKSUM_KEY=
PAYOS_WEBHOOK_URL=https://your-domain/api/webhooks/payos
PAYOS_RETURN_URL=https://your-domain/license
PAYOS_CANCEL_URL=https://your-domain/license
```

Giá sản phẩm được backend cố định **2.000 VND**. Bỏ trống `LICENSE_PRICE_VND` dùng 2000; đặt giá khác làm
payment bị vô hiệu hóa. Tên cũ `LICENSE_LIFETIME_PRICE_VND` không còn được dùng.
Đơn lịch sử đã lưu giá khác không được tái sử dụng làm checkout mới; thanh toán đến muộn vẫn đối chiếu
đúng số tiền đã lưu của chính đơn lịch sử để giữ quyền lợi khách đã thanh toán.
Thiếu credential hoặc URL hợp lệ => purchase trả 503; giao diện vẫn hiển thị giá nhưng không cho tạo đơn.
`PUBLIC_BASE_URL` là cấu hình tùy chọn, không thay thế hai callback URL.
Return/cancel URL được thêm `orderId` của backend để mở lại My License; các tham số `status`, `success`, `cancel`
không chứng minh thanh toán và không tạo license. Production yêu cầu HTTPS; callback HTTP loopback chỉ dùng khi development.
Sau khi API xác nhận PAID, giao diện tải key từ `/api/licenses/me`, tự đóng modal QR và hiển thị My License khi key đã sẵn sàng.
Nếu key chưa tải xong, không hiển thị key giả hoặc tin query callback để đánh dấu đã sở hữu.
Key được hiển thị ngay cả khi bước ký/xác minh thiết bị TPM vẫn đang chạy; quyền import vẫn cần phiên thiết bị hợp lệ.
Khi đổi tài khoản, client ẩn state của tài khoản trước ngay trong render để không lộ key cũ trong lúc tải dữ liệu mới.

Khởi động API public trước, sau đó operator chủ động đăng ký webhook bằng SDK:

```powershell
node --env-file=.env scripts/register-payos-webhook.js
```

Lệnh này thay webhook của kênh PayOS đang cấu hình. Chỉ chạy cho môi trường mong muốn sau khi kiểm tra hostname.
API không tự đăng ký hoặc thay webhook khi khởi động. Callback mẫu đã ký được phản hồi 2xx nếu không có order khớp;
không cấp license. Webhook sai chữ ký bị từ chối.

Production cần `NODE_ENV=production`, HTTPS cùng origin cho web và `/api`, domain đúng trong `CORS_ORIGINS`
và `MaxWebViewForm.TrustedOrigins`/`StartUrl`/`ApiBase` (MAXScript cấu hình).
Reverse proxy chuyển `/api` tới Node và `/license` tới SPA. Nếu proxy ở loopback, cấu hình
`TRUST_PROXY=127.0.0.1/32,::1/128`; chỉ tin địa chỉ proxy thật, hạn chế truy cập upstream.
Không đặt trust proxy vô điều kiện. `HOST` mặc định loopback; container cần bind thích hợp và firewall.

Theo [payOS](https://payos.vn/docs/moi-truong-test/), không có sandbox riêng.
Bộ test dùng fixture ký HMAC và SDK thật để verify, mock create/get, không gửi tiền hoặc gọi API merchant thật.
Chỉ thử end-to-end ngân hàng khi chủ dự án phê duyệt riêng.

Đơn được lưu trước remote call, có mã từ PostgreSQL sequence, thời hạn 15 phút và `expiredAt` gửi PayOS.
Double-click/retry tái sử dụng đơn PENDING hợp lệ; timeout giữ nguyên mã để phục hồi. QR là payload do PayOS trả về,
được React render bằng `qrcode.react` tại client, không gửi sang dịch vụ QR khác. Nếu create đã thành công nhưng response
bị mất, PayOS GET không cung cấp lại QR/bank metadata; giao diện cung cấp checkout URL để tiếp tục thay vì dựng QR giả.

Mất hoặc chậm webhook: account gọi `POST /api/payments/:orderId/reconcile` với `{}`. Ngoài ra API đã cấu hình payment
chạy sweep **mỗi 60 giây, tối đa 20 đơn/lượt**, không chạy chồng trong cùng process; claim/cooldown trong DB điều phối nhiều replica.
Sweep tiếp tục từ dữ liệu bền vững sau restart, độc lập trình duyệt. Operator có thể chạy một lượt:

```powershell
node --env-file=.env scripts/reconcile-payos.js
```

Kết quả chỉ có số đơn scanned/reconciled/failed; lỗi cho exit code khác 0 để scheduler giám sát.
Lịch quét luân phiên theo `reconciled_at`; đơn hủy/hết hạn vẫn được giữ để nhận thanh toán hợp lệ đến muộn.
Giới hạn 20 đơn/lượt có thể tăng độ trễ khi ledger có nhiều đơn lịch sử; giám sát backlog và điều chỉnh vận hành theo tải.
Server truy vấn PayOS, kiểm tra mã đơn/link, số tiền chính xác, paid totals và transaction references trước khi cấp quyền.
PAID không bị hạ xuống CANCELLED/EXPIRED bởi dữ liệu cũ. Webhook hợp lệ đến muộn vẫn được xử lý với đơn đã hết hạn/hủy.
Đơn `ALREADY_LICENSED` đã nhận tiền cần operator xử lý hỗ trợ/hoàn tiền thủ công; không có chuyển tiền tự động.

### Đối soát đơn đã trả tiền nhưng chưa thấy license

1. Dùng tài khoản chủ đơn đọc `GET /api/payments/:orderId` và làm mới My License. Không tin callback URL hoặc ảnh chuyển khoản.
2. Chạy endpoint reconcile hoặc CLI ở trên. Nếu provider xác nhận PAID với dữ liệu khớp, server cấp license trong transaction.
   Sweep cũng xét đơn nội bộ PAID nhưng account chưa có license và sửa quyền thiếu bằng cùng đường xác minh provider.
3. Nếu còn lỗi, kiểm tra trạng thái migrations, DB connectivity, hai secret license, audit và cấu hình PayOS.
   Backup trước khi sửa; dùng forward migration/repair đã review cho dữ liệu hỏng. Không tự sửa status PAID, chèn key plaintext,
   xóa license hay reset device slots để né lỗi. Lưu case để retry sau khi phục hồi dịch vụ.

## Database và triển khai

Migration 003 thêm license/devices/challenges/sessions/audit/rate limit; 004 orders/events; 005 gắn import tickets với phiên và thiết bị;
006 giới hạn uniqueness của danh tính/khóa trong từng license, cho phép cùng máy dùng các tài khoản đều có license riêng.
007 bổ sung product, expiry, bank metadata, reconciliation claim, payload audit đã whitelist và UNIQUE license/order.
Chạy migration bằng role owner riêng: `node --env-file=.env scripts/migrate.js`.
Production mặc định không migrate lúc boot; `RUN_MIGRATIONS=true` là lựa chọn có chủ ý.
Runtime DB role chỉ cần DML/sequence phù hợp; không cấp SUPERUSER, table ownership, DDL hoặc TRUNCATE.
Trigger không thể chống DBA/superuser cố tình gỡ ràng buộc.

Backup DB **và hai secret license** trong secret manager. Đổi secret tùy tiện làm key không verify/giải mã được;
V1 chưa có key rotation versioned. Không ghi cookie, license plaintext, webhook body hay credential vào proxy logs.
Lọc/redact đường dẫn `/api/downloads/stream/<ticket>` ở access log vì ticket là bearer token ngắn hạn.

Rollback thủ công theo thứ tự **007 → 006 → 005 → 004 → 003**, dùng file tương ứng trong `migrations/rollback/`,
trong cửa sổ bảo trì với code tương thích. 007 từ chối khi có order/event để không bỏ dữ liệu thanh toán;
006 từ chối nếu có identity dùng chung nhiều license; 005 thu hồi ticket, 004 từ chối khi có order/event,
003 từ chối khi đã cấp license. Không dùng rollback làm reset slot.
Ưu tiên forward migration khi đã có dữ liệu thật; backup và kiểm tra staging trước khi production.

## Automated tests và thử giao dịch thực tế

Từ `apps/store-api`, dùng database test riêng trong file environment local:

```powershell
node --env-file=../../storage/license-dev.env scripts/migrate.js
node --env-file=../../storage/license-dev.env --test --test-concurrency=1 --experimental-test-coverage
```

Test tự tạo schema cô lập trong `TEST_DATABASE_URL`, verify webhook bằng SDK và fixture ký local, mock create/get.
Từ `apps/store-web`: `npm test`, rồi `npm run build`. Để chạy browser E2E dùng mock API:

```powershell
npx playwright install chromium
npm run test:e2e
```

Các bài UI kiểm QR, callback giả, khôi phục đơn, tự mở key sau PAID,
cleanup/bounded polling và khôi phục quyền máy qua tài khoản khác mà không lộ key.
Các bài HTTP kiểm chữ ký/cookie sai, revoke/logout và số slot không tăng khi VERIFY qua tài khoản khác.
Không có script lint/typecheck riêng trong package hiện tại.

Thử ngân hàng thật sau khi operator phê duyệt: cấu hình môi trường HTTPS và đăng ký webhook, dùng account chưa sở hữu license,
mở My License → Mua Lifetime, kiểm QR/checkout cùng giá 2.000 ₫. Thanh toán đúng nội dung trên màn hình, đóng trình duyệt
để xác nhận webhook vẫn cấp đúng một license; đăng nhập lại và kiểm Active, 0/2 slots. Sau đó mở plugin để xác minh/activate
thiết bị, kiểm slot từ server. Thử duplicate webhook chỉ trên staging có kiểm soát và chạy reconcile để xác nhận idempotency.
Không đánh dấu test ngân hàng thành công chỉ vì unit test hoặc callback URL báo PAID.

Tại thời điểm kiểm chứng 2026-10-25, `.env` local đã có đủ bảy biến PayOS/giá yêu cầu, health runtime báo
DB/license/payment sẵn sàng và product API trả 2000. Tuy nhiên callback còn dùng hostname mẫu `yourdomain.com`,
webhook dùng `api.yourdomain.com`: operator cần thay bằng HTTPS public thực tế rồi đăng ký webhook.
Read-only SDK GET với mã không tồn tại đã trả HTTP 200/code `101` (không có payment);
điều này kiểm tra đường gọi merchant và xử lý lỗi, không chứng minh checksum webhook hoặc giao dịch ngân hàng thành công.

## Native

Build net48 x64 bằng Visual Studio Build Tools + targeting pack4.8; `installer/build-installer.ps1` đóng gói.
Đóng Max trước khi cài DLL mới. Không xóa `%LOCALAPPDATA%\3DsMood\DeviceIdentity\v1\identity.dat`
hay khóa CNG `3DsMood.DeviceIdentity.v1`. Metadata DPAPI CurrentUser, khóa CNG nonexportable;
TPM ưu tiên, SOFTWARE fallback được UI thông báo. Cập nhật plugin bình thường giữ nguyên danh tính.
Cookie WebView2 nằm trong profile Windows hiện hữu, JS không nhận sid/dsid/private key.

Backend chứng minh sở hữu khóa, chưa chứng thực TPM từ xa. Người có quyền chạy code dưới cùng Windows account
có thể yêu cầu CNG ký; client bị patch/clone không thể được ngăn tuyệt đối. Không ngăn sao chép geometry sau import.
Mỗi Windows user có danh tính riêng; mất cả metadata và khóa tạo danh tính mới nhưng không giải phóng slot cũ.
