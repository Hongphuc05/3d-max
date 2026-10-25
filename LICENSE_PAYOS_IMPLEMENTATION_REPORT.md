# 3DsMood — License & payOS implementation report

Ngày kiểm chứng: **2026-10-25**, Windows, PostgreSQL18, Node24.11, Max2022/.NET Framework4.8.
Source triển khai theo `goal.md` và yêu cầu bổ sung PayOS VietQR 2.000 VND; quyết định D11 thay license từng model bằng Lifetime theo account.
Các kiểm chứng Max trong bảng lịch sử bên dưới thuộc giai đoạn triển khai license trước; phần bổ sung PayOS
không thay source C# và không tuyên bố đã chạy lại giao dịch ngân hàng thật. Build/native được chạy lại theo phần kiểm chứng hiện tại.

## Kết quả triển khai

Đã triển khai License Service, migration, payment provider/service, React UI và native device identity.
Account chỉ có một license bằng UNIQUE; slot chỉ nhận 1 hoặc 2, identity bindings bị trigger cấm sửa/xóa.
Activation khóa license row để các request đồng thời không chiếm thêm slot. Thiết bị cũ VERIFY bằng chữ ký,
không cần gửi lại key. Account khác không xem hoặc dùng key để tạo slot mới; theo D12, tài khoản đã đăng nhập
có thể dùng quyền của máy đã gắn slot sau khi ký proof khớp cả device UUID và public-key hash.
Tài khoản sử dụng trong device session được tách khỏi chủ sở hữu license; VERIFY không thêm slot và response không lộ key/last4.

License key gồm 160 bit CSPRNG, prefix3DM, normalize thống nhất, HMAC-SHA256 và AES-256-GCM với hai secret32byte riêng.
AAD gắn bản mã với user UUID; key plaintext chỉ được giải mã trả cho account chính chủ, no-store.
Admin allowlist UUID nằm phía server, không dựa vào role trong React. Có suspend/revoke, không reset slot/transfer/reactivate.

Device UUID lưu DPAPI CurrentUser ngoài thư mục plugin, private key RSA2048 CNG nonexportable.
Ưu tiên TPM, software fallback có nhãn bảo vệ thấp hơn. Server challenge TTL2phút, một lần, gắn account/auth session,
public key và purpose. Cookie thiết bị HttpOnly TTL15phút ràng buộc auth session, device và license ACTIVE.
Import ticket TTL tối đa5phút, một lần, kiểm tra lại license/auth/device lúc redeem; revoke/logout chặn cả ticket đã cấp.

payOS dùng `@payos/node`2.0.5, `paymentRequests.create/get` và `webhooks.verify`.
Giá được backend cố định **2.000 VND**; `LICENSE_PRICE_VND` chấp nhận 2000, giá khác fail closed.
Checkout mới không tái sử dụng đơn lịch sử có giá khác; recovery đơn cũ vẫn đối chiếu số tiền bền vững của chính đơn đó.
`PAYOS_RETURN_URL` và `PAYOS_CANCEL_URL` cấu hình riêng. Order PENDING được commit trước remote call,
retry giữ orderCode, khóa theo user qua PostgreSQL. Expiry 15 phút được lưu DB và gửi `expiredAt` tới PayOS.
SDK kiểm signature, application kiểm order/amount/currency/link/reference. Payment event + PAID + license nằm cùng transaction;
unique reference và user constraint chặn replay/cấp trùng. Return/cancel/query không phải bằng chứng thanh toán.
Reconciliation kiểm paid totals và transactions từ provider. Sample/unknown order không cấp license.
Sweep 20 đơn mỗi 60 giây khi payment được cấu hình, có DB claim/cooldown và CLI cho operator;
hoạt động khi người dùng offline và phục hồi đơn qua restart. Đơn PAID thiếu license được đối soát provider trước khi sửa quyền.

My License hiển thị **2.000 ₫**, mở payment modal cùng theme dark/accent xanh lá; QR payload được render local bằng
`qrcode.react`. Modal có thông tin bank PayOS trả về, sao chép, checkout link, countdown, trạng thái và nút đóng.
Polling tuần tự 4 giây, tối đa 300 lần, timeout request 10 giây, abort/cleanup khi đóng; reload dùng order ID đã lưu,
luôn đọc trạng thái qua owner-authorized API. PAID refresh My License và tự đóng modal QR sau khi key chính chủ đã tải xong;
hiển thị `3DsMood Lifetime - Active` và slots từ server. Máy đã kích hoạt giữ quyền qua đổi tài khoản mà không lộ key chủ sở hữu.
Checkout/reconcile có timeout 20 giây, abort khi unmount/đổi account; response cũ không hiển thị đơn của account trước.

## Files tạo/sửa

| Phần | Files |
|---|---|
| Schema | `apps/store-api/migrations/003_licenses.sql`, `004_payments.sql`, `005_licensed_import_tickets.sql`, `006_device_identity_scope.sql`, `007_payment_checkout.sql`, rollback tương ứng |
| License | `src/licensing/{crypto,device-crypto,devices,errors,routes,service}.js` và các test cùng thư mục |
| Payment | `src/payments/{config,provider,repository,routes,service,validation,maintenance}.js`, unit/integration tests; `scripts/{register-payos-webhook,reconcile-payos}.js` |
| API tích hợp | `src/{auth,security,db,assets,server}.js`; auth/assets tests; `src/{test-database,migrations.test,server.test,security.test}.js`; `scripts/migrate.js`; `.env.example`; package và lock |
| React | `src/{LicensePanel,license,Purchase,PaymentDialog}.jsx`, `license-flow.js`, `payment-poll.js`, `payment-request.js`, flow/UI/poll/request tests; `App.jsx`, `components.jsx`, `main.jsx`, `api.js`, bridge SDK; package/lock, tsconfig và Playwright config/E2E |
| Native | `DeviceIdentityService.cs`, `BridgePolicy.cs`, `MaxWebViewForm.cs`, csproj; `plugin-csharp/tests/NativeSecurityTests.cs`, `WebViewTransportTests.cs`, hai PowerShell runners và Node interoperability verifier |
| Tài liệu | README gốc, `apps/README.md`, `docs/decisions.md`, `docs/STATUS.md`, `docs/license-payos-setup.md`, `docs/license-payos-api.md`, báo cáo này |

Không sửa source MAXScript, cơ chế archive/texture/merge hay thư mục lưu model. Chỉ đổi nhãn giá từng model sang quyền Lifetime
và thêm gate license/UI; giữ bố cục catalog và queue. Thư viện sharp được nâng từ0.34 lên0.35.5 để xử lý advisory đã phát hiện,
không đổi thuật toán thumbnail. Vite được patch7.3.7, body-parser được cập nhật qua lockfile; npm audit cuối không còn advisory.
`goal.md` là yêu cầu người dùng và được giữ nguyên. Không commit/push tự động.

## Database và môi trường thực tế

Credential PostgreSQL service hiện có ở5432 trả `28P01`. Không đổi password, authentication rules hay dữ liệu service đó.
Tạo cluster local riêng tại `storage/license-postgres/data`, listen127.0.0.1:55432, với credential ngẫu nhiên:
`store_license_dev` và `store_license_test`. Environment/secret dev nằm trong file gitignored `storage/license-dev.env`.
Đã chạy **001,002,003,004,005,006,007** trên database dev; chạy lại không còn migration cần áp dụng.
Tests chạy schema riêng hoặc fixture bổ sung trong database test.
Migration idempotent; kiểm thử lịch sử rollback006→005→004→003 và reapply thành công; rollback từ chối xóa license/order thật.
006 cho phép một Windows identity dùng các account đều có license riêng, giữ unique identity/public key trong từng license.
Không chạy migration vào database production/cũ. `SOURCE_DIR` người dùng không bị sửa.

Development API và Vite được chạy cục bộ4000/5173. Sau khi người dùng cập nhật `.env` local, health thực tế trả
DB=true, licensing=true, payments=true; product API trả 2000 VND. Bảy biến PayOS/giá yêu cầu đã hiện diện.
Callback/webhook còn dùng `yourdomain.com`/`api.yourdomain.com`; cần hostname HTTPS public thật trước khi đăng ký.
Catalog=false (chưa có `storage/catalog.json`).
Mất catalog chỉ chặn endpoint model, không làm sập API tài khoản/license/payment.

## Kiểm chứng bổ sung PayOS VietQR hiện tại — 2026-10-25

Bổ sung theo phản hồi người dùng: backend **68/68** và frontend **22/22** đạt, gồm khôi phục quyền máy qua tài khoản khác,
key chỉ hiện chính chủ, cookie/proof giả bị từ chối, logout/revoke chặn quyền và PAID tự hiển thị key sau khi tải xong.
Key hiện ngay trong lúc proof TPM còn đang chạy; quyền import chờ xác minh riêng. State client được scope đồng bộ theo
tài khoản hiện tại, không có render tạm hiển thị key của tài khoản trước khi đổi account.
Chromium **3/3** và frontend build đã đạt trong lần bổ sung này; browser dùng mock API cho auto key, callback giả và đổi tài khoản
trên máy đã kích hoạt. Không cần migration hay thay source C# production cho D12. Các số coverage/native bên dưới thuộc lần
kiểm chứng PayOS trước, không phải bằng chứng đã chạy giao dịch ngân hàng hoặc thử đổi tài khoản trong 3ds Max thật.

| Phần | Kết quả |
|---|---|
| Backend unit/PostgreSQL/HTTP | **66/66 pass, 0 fail, 0 skip**, gồm một helper entry; `node --env-file=../../storage/license-dev.env --test --test-concurrency=1 --experimental-test-coverage` |
| Backend coverage | **90.04% lines, 84.27% branches, 85.71% functions**; không đại diện coverage C#/React |
| Frontend unit/flow/UI | **18/18 pass**, gồm QR/bank/countdown, callback giả, reload, cleanup và đổi account |
| Chromium Playwright | **2/2 pass**, browser E2E với mock API; không phải thanh toán ngân hàng thật |
| Frontend build | `npm run build` thành công với Vite7.3.7 |
| Migration dev | Đã áp dụng **001–007**; lần chạy tiếp theo không có migration mới |
| Native security | **28/28 pass** và Node interoperability verifier thành công |
| WebView2 standalone | **11/11 pass**, khóa thực tế **TPM**; harness dùng browser profile riêng cho từng lần chạy, không dùng chung profile panel đang mở |
| Plugin build | MSBuild net48/x64 thành công |
| Runtime config | DB/license/payment health=true; product=2000; đủ bảy biến cấu hình được yêu cầu |
| Read-only PayOS SDK | GET mã không tồn tại trả HTTP200, code101, “Mã thanh toán không tồn tại”; đã thêm xử lý recovery cho mã lỗi này |
| Dependency audit | API và web đều **0 vulnerabilities** |
| Kiểm tra source | JavaScript payment/script syntax và `git diff --check` đều thành công |

SDK GET là lời gọi đọc merchant, không tạo đơn, không đăng ký webhook, không chuyển khoản. Kết quả không chứng minh
checksum key đúng với callback thật hoặc xác nhận bank payment E2E. Không commit/push/deploy trong nhiệm vụ này.
WebView harness ban đầu lỗi core initialization khi dùng profile chung; đã sửa `plugin-csharp/tests/WebViewTransportTests.cs`
để đặt `WEBVIEW2_USER_DATA_FOLDER` trong thư mục Temp riêng, khôi phục environment và retry cleanup sau test.
Không thay source C# production trong phần bổ sung PayOS này.

## Lệnh và kết quả kiểm chứng lịch sử license

Các lệnh Node API bên dưới chạy từ `apps/store-api`; web chạy từ `apps/store-web`; native từ repo root.

| Loại | Lệnh / thao tác thực tế | Kết quả |
|---|---|---|
| API unit + PostgreSQL integration + HTTP | `node --env-file=../../storage/license-dev.env --test --test-concurrency=1 --experimental-test-coverage` | **57 runner entries pass, 0 fail, 0 skip**; gồm helper file được Node phát hiện như một entry |
| API coverage | Node coverage report cùng lệnh trên | **89.62% lines, 83.43% branches, 84.44% functions** trên các file được đo; không phải coverage C#/React |
| React flow/queue/UI | `npm test` | **11/11 pass**; jsdom UI dùng fixture native/API, không thay cho kiểm thử ngân hàng thật |
| React production build | `npm run build` | Thành công với Vite7.3.7 |
| API dependency audit | `npm audit --omit=dev` | 0 vulnerabilities sau cập nhật |
| Web dependency audit | `npm audit` | 0 vulnerabilities |
| Thumbnail dependency smoke | sharp tạo ảnh fixture8×8, resize400×400, encodeWebP, đọc metadata | Đúng400×400 WebP với sharp0.35.5 |
| C# build | MSBuild2022 `MaxWebViewHost.csproj /t:Rebuild /p:Configuration=Release /p:PlatformTarget=x64 /verbosity:minimal` | Thành công net48, DLL tại `plugin-csharp/MaxWebViewHost/MaxWebViewHost/bin/Release/MaxWebViewHost.dll` |
| Native security | `powershell -ExecutionPolicy Bypass -File plugin-csharp/tests/run-native-tests.ps1` | **28/28 pass** + Node xác minh JWK/SPKI/RSA signature từ C# |
| WebView2 thật, standalone | `powershell -ExecutionPolicy Bypass -File plugin-csharp/tests/run-webview-tests.ps1` | **11/11 pass**; provider thực tế **TPM**; không nằm trong Max |
| Backend runtime | `node --env-file=../../storage/license-dev.env src/server.js`, GET health trực tiếp và qua Vite proxy | HTTP200, DB/license ready; payment disabled đúng cấu hình |
| 3ds Max2022 runtime | Cài DLL mới khi Max đã đóng, mở Max, bấm toolbar Platform | React load, Connected, Max build24000, scene0objects/Arnold |
| Activation trong Max | Đăng nhập account fixture local, nhập key, native ký challenge bằng TPM | UI “Thiết bị đã được xác minh”, DB slot1/protectionTPM |
| Mở lại plugin | Đóng panel, mở lại từ toolbar | Cookie khôi phục account, tự VERIFY không nhập key; DB vẫn **1slot**, audit có **2 DEVICE_SESSION_CREATED**, chỉ **1 DEVICE_ACTIVATED** |
| Diff | `git diff --check` | Không lỗi whitespace (Git có thông báo LF/CRLF của file test) |

Log API test/coverage nằm trong `storage/license-api-tests.txt` (gitignored). File credential fixture runtime
đã xóa sau kiểm chứng; account/license thử còn trong database dev, cookie đăng nhập của panel được giữ.
Không có password/key thật trong báo cáo.
DLL cũ được backup ở `storage/plugin-before-license`; DLL mới đã copy vào user scripts Platform trước khi mở Max.

## Bằng chứng theo các invariant bắt buộc

| Yêu cầu | Bằng chứng |
|---|---|
| Một account/một Lifetime | Concurrent issuance test + unique user_id + admin issue idempotency |
| AccountB không dùng keyA, sai key | Service và activation HTTP/crypto tests; slot count không tăng |
| PC1/PC2 được, PC3 từ chối | PostgreSQL device integration tests, `DEVICE_LIMIT_REACHED` |
| Hai request tranh slot cuối | Concurrent activation tests; đúng một contender thắng |
| Máy cũ không tốn slot | VERIFY test và runtime Max đóng/mở panel, slot count vẫn1 |
| Sửa UUID/xóa metadata không reset | Public-key/device-id unique + immutable triggers; native tests xóa/tamper metadata/mất CNG key fail closed |
| Fake proof/expiry/replay/session | Signature, consumed nonce, expired challenge, wrong account/session tests |
| Revoke/logout chặn quyền | Device session tests và HTTP download/ticket issuance/redemption tests |
| Không reset/delete/transfer API | HTTP thử các đường reset/device mutation trả404; immutable SQL update/delete bị từ chối |
| Giá server, signature và data đúng | SDK fixture signature, client amount rejection, signed wrong amount/currency/link/code tests |
| Duplicate không cấp thêm | Concurrent duplicate webhook test; unique provider reference và unique account license |
| DB fail không fulfillment sai | Throw sau license insert và **pg_terminate_backend thật** giữa transaction; events/license/PAID rollback, retry cấp đúng1 |
| Return URL/setup sample | Forged query UI/routes vẫn PENDING, signed sample unknown order không cấp |
| Admin kín quyền | HTTP user thường403, allowlist admin mới issue; không gửi plaintext key của target khác |

## Phần chưa kiểm chứng và giới hạn

- **Chưa có real payment E2E**: credentials local đã được người dùng điền nhưng public webhook HTTPS/callback URLs còn hostname mẫu;
  không có phê duyệt giao dịch thật. Chỉ gọi merchant GET read-only cho mã không tồn tại, không gọi create,
  không đăng ký/chuyển webhook production. Mock không chứng minh bank callback thực tế.
- **Chưa import model thật trong Max**: máy chưa có catalog/source model. Import gate HTTP được thử bằng file fixture;
  không tuyên bố đã merge gói thực tế. Không di chuyển dữ liệu để né giới hạn phạm vi này.
- Thử mở lại **panel** trong Max, không tuyên bố đã kiểm tra đầy đủ rebootWindows/TPM hardware replacement hay ma trận nhiều máy.
  Native persistence được test qua nhiều service instance và mất/tamper metadata/key.
- TPM key protection do client báo, **chưa có remote TPM attestation**. Backend chứng minh sở hữu khóa;
  không thể chứng minh client không bị patch hay key là TPM chỉ từ nhãn. Cùng Windows account có thể yêu cầu CNG ký.
- Chưa hỗ trợ secret key rotation có version, offline license, khôi phục slot mất khóa hoặc tự hoàn tiền.
  Reconciliation có endpoint, background sweep và CLI; đơn duplicate đã trả tiền cần operator xử lý thủ công.
  Sweep giới hạn20/lượt và giữ đơn terminal để phát hiện thanh toán muộn; backlog lớn có thể tăng độ trễ phục hồi.
- Khi PayOS create đã thành công nhưng response bị mất, provider GET không trả lại QR/bank fields; UI sử dụng checkout link
  để tiếp tục đơn đã phục hồi. Không dựng QR giả hoặc thay mã đơn chỉ để lấy QR.
- Global ingress limiter là in-memory một process; quota license dùng PostgreSQL. Production cần ingress/rate limit phù hợp
  và trusted proxy CIDR đúng. Khóa advisory payment giữ DB connection trong remote call (SDK timeout15s), cần pool capacity theo tải.
- Không đảm bảo chống copy geometry sau import, chống DBA/superuser sửa schema, hoặc bảo mật khi Windows account đã bị chiếm.
- Build DLL chưa đồng nghĩa package đã code-sign; bản installer thương mại/code-sign/update/bootstrapper vẫn theo các hạng mục release cũ.
  Không có chứng thư signing được cung cấp trong nhiệm vụ này.

## Cấu hình cuối trước production

1. Chuẩn bị database đúng credential, backup DB + hai secret license, migration role riêng/runtime DML role.
2. Local đã có bảy biến PayOS/giá; production vẫn cần lưu secret license32bytebase64 riêng, UUID admin,
   `LICENSE_PRICE_VND=2000`, `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` trong secret manager/backend environment.
   Thay hostname mẫu trong `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL`, `PAYOS_WEBHOOK_URL` bằng domain HTTPS public thực tế.
3. HTTPS cùng origin, CORS/Max trusted origins đúng, proxy/firewall/trust proxy cấu hình cụ thể; redact cookie/ticket ở access logs.
4. Chạy migration riêng, deploy frontend SPA có route `/license`; production runtime không tự chạy DDL mặc định.
5. Operator chạy `scripts/register-payos-webhook.js` với environment đúng để đăng ký HTTPS; thử payment E2E có chủ dự án
   giám sát, kiểm duplicate/reconciliation/đơn đã licensed. API không thay webhook production lúc boot.
6. Cung cấp source/catalog hiện hữu để xác nhận lại import model thật; hoàn tất signing/installer/release acceptance phù hợp.

Hướng dẫn đầy đủ: [setup](docs/license-payos-setup.md), [API](docs/license-payos-api.md).
Tài liệu provider đã đối chiếu: [SDK Node](https://payos.vn/docs/sdks/back-end/node/),
[webhook](https://payos.vn/docs/du-lieu-tra-ve/webhook/), [môi trường test](https://payos.vn/docs/moi-truong-test/),
[API](https://payos.vn/docs/api/).
