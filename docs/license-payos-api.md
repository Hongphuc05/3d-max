> **ĐÃ NGỪNG DÙNG (P7, 2026-11-03):** hệ thống thanh toán payOS đã được gỡ khỏi code; thay bằng đơn hàng + Telegram (xem `docs/v3-implementation-plan.md` §2.6, D21). Tài liệu giữ lại để tra cứu hệ thống cũ.

# License/payOS API V1

Base `/api`. JSON, cookie `sid` chứa JWT HS256, HttpOnly; request ghi có Origin hợp lệ, `Content-Type: application/json`.
Response lỗi `{ "error": "UPPERCASE_CODE" }`, không stack/secret. Rate limit trả 429 và Retry-After.
Mọi response API no-store. Key plaintext chỉ trả cho chính chủ qua HTTPS trong My License.

Auth: `POST /auth/register` nhận `{email,password}`, luôn tạo khách hàng.
`POST /auth/login` nhận `{email,password}`; trường `email` có thể chứa tên đăng nhập admin.
Hai route trả `{user}` và cookie JWT `sid`. `GET /auth/me` trả `{user:{id,email}}` cho khách hàng;
admin nhận thêm `{role:'ADMIN',username,mustChangeCredentials}`. Role được đọc từ DB hoặc legacy server allowlist.
`POST /auth/logout` nhận `{}` và thu hồi session ngay.
JWT tối đa 30 ngày; bắt buộc chữ ký, issuer/audience, expiry và session PostgreSQL còn hoạt động.
Không gửi token trong JSON/Authorization/localStorage. Cookie cũ trước khi chuyển JWT cần đăng nhập lại.

| Method / path | Auth / body | Kết quả |
|---|---|---|
| GET `/licenses/me` | sid | `{license:null}` hoặc `{license:{id,type,status,key,last4,issuedAt}}` |
| GET `/licenses/devices` | sid | `{devices:[{id,deviceId,slotNumber,deviceName,keyProtection,activatedAt,lastSeenAt}]}` |
| POST `/devices/challenge` | sid; identity + purpose | 201 `{challengeId,message,expiresAt}` |
| POST `/licenses/activate` | sid; `{challengeId,signature,licenseKey}` | `{license,device,expiresAt}`, Set-Cookie dsid |
| POST `/devices/verify` | sid; `{challengeId,signature}` | cùng shape activation; không cần key |
| GET `/devices/session` | sid + dsid | `{license,device,expiresAt}` nếu còn hợp lệ |
| GET `/payments/product` | public | `{product:{name,licenseType,amountVnd,currency,available}}` |
| POST `/payments/create` | sid; `{}` | `{order}`; không nhận amount từ client |
| GET `/payments/:orderId` | sid chính chủ | `{order}` |
| POST `/payments/:orderId/reconcile` | sid chính chủ; `{}` | `{order}` sau truy vấn provider |
| POST `/webhooks/payos` | SDK signature, không cookie | `{received:true,result}`; không cấp khi đơn không tồn tại |
| GET `/admin/overview` | sid admin | `{stats:{users,activeLicenses,paidOrders,revenueVnd},catalog}` |
| GET `/admin/users?q=&page=` | sid admin | `{items:[{id,email,createdAt,license,deviceCount}],total,page,limit}` |
| GET `/admin/users/:id` | sid admin | `{user,license,devices,orders,audit}`; tối đa 25 đơn/50 audit gần đây |
| GET `/admin/legacy-orders?q=&status=&page=` | sid admin | `{items:[{id,userId,email,orderCode,amountVnd,status,createdAt,paidAt,fulfillmentResult}],total,page,limit}` |
| GET `/admin/audit?page=` | sid admin | `{items:[{id,eventType,actorEmail,targetEmail,licenseId,createdAt,details}],total,page,limit}` |
| PATCH `/admin/account` | sid admin, kể cả first login; `{username,currentPassword,newPassword?}` | `{user}`; thu hồi mọi session cũ, Set-Cookie sid mới |
| POST `/admin/licenses/issue` | sid admin; `{userId}` | 201 `{license}` (không raw key của người khác) |
| POST `/admin/licenses/revoke` | admin; `{userId,status?,reason?}` | `{license}`; mặc định REVOKED |
| POST `/admin/licenses/resume` | admin; `{userId}` | `{license}` ACTIVE; chỉ mở license SUSPENDED, không mở REVOKED |
| POST `/products/:slug/import-ticket` | sid + dsid, license ACTIVE; `{}` | `{assetId,ticket}` TTL tối đa5 phút |
| GET `/products/:slug/download` | sid + dsid, license ACTIVE | file gốc, cơ chế cũ |
| GET `/downloads/stream/:ticket` | ticket một lần | native tải file; server kiểm tra lại auth/license/device |

Admin first login có `mustChangeCredentials=true`: các route quản trị trả 403 `ADMIN_CREDENTIALS_CHANGE_REQUIRED`
cho tới khi đổi mật khẩu ban đầu qua `/admin/account`. Username 3–64 ký tự `[a-z0-9][a-z0-9_.-]*`, chuẩn hóa chữ thường;
mật khẩu mới 8–128 ký tự, khác mật khẩu ban đầu trong lần đổi đầu. Body không nhận trường role/userId.
Sai mật khẩu hiện tại trả 403 `INVALID_CURRENT_PASSWORD`, username trùng trả 409 `USERNAME_TAKEN`.
List dùng page từ 1, 25 bản ghi/trang; `q` tối đa 254 ký tự. Response admin chỉ chứa last4 và metadata;
không trả full key license, password hash, public key thiết bị, payload thanh toán hoặc checkout URL.
`/resume` trả 409 `LICENSE_REVOCATION_PERMANENT` cho REVOKED và `LICENSE_NOT_SUSPENDED` cho trạng thái khác.

Order: `{id,orderCode,productCode,amountVnd,currency,status,checkoutUrl,qrCode,expiresAt,bankBin,accountNumber,accountName,description,createdAt,paidAt,fulfillmentResult}`.
Giá cố định 2000 VND; `productCode` là `3DSMOOD_LIFETIME`. `expiresAt` là timestamp ISO, thời hạn khoảng 15 phút.
`qrCode` là payload VietQR để render local, không phải URL ảnh. QR/bank fields có thể null khi phục hồi remote create response bị mất;
`checkoutUrl` vẫn cho phép tiếp tục trên PayOS. Không tự tạo QR từ URL hoặc tự ghép dữ liệu ngân hàng.
Status PENDING/PAID/FAILED/CANCELLED/EXPIRED. Fulfillment LICENSE_ISSUED/ALREADY_LICENSED, null khi chưa trả.
GET order còn trả `entitlement:null` hoặc `{id,type,status,deviceLimit:2,deviceCount}` bên trong order khi đã PAID.
Endpoint `/licenses/me` và `/licenses/devices` chỉ trả license/key và fixed slots thuộc tài khoản hiện tại.
Phiên thiết bị có thể xác nhận binding của license khác ngay cả khi `/licenses/me` trả null;
thông tin đó không cấp quyền tải/import. Archive API vẫn yêu cầu license ACTIVE của chính tài khoản đang đăng nhập.
Order ID của người khác =>404. POST create/reconcile không nhận trường ngoài body rỗng.

Create tái sử dụng đơn PENDING chưa hết hạn, khóa theo account xuyên các API process. Đơn cũ hết hạn cho phép mua lại;
account đã có license trả 409 ALREADY_LICENSED. Phía client không quyết định amount/product/userId.
GET không tin query callback; request trả status đã lưu và đánh dấu EXPIRED khi hết hạn, không tự cấp quyền.
Callback return/cancel điều hướng tới URL cấu hình cộng `orderId`. SPA tự mở My License khi có orderId hợp lệ,
kể cả đường dẫn `/payment/success` hoặc `/payment/cancel`; reverse proxy cần fallback các đường dẫn này về SPA.
Không có API kích hoạt license bằng callback.
Khi order từ API là PAID, giao diện tải license của tài khoản và tự đóng modal QR sau khi có key,
để hiển thị ngay My License. Query callback không đủ để chuyển màn hình sang trạng thái đã sở hữu.
Hiển thị key không chờ bước chứng minh thiết bị TPM hoàn tất; trạng thái quyền import được xác minh riêng.
State client được giới hạn theo tài khoản ngay khi render, không tạm hiện key của chủ cũ khi đổi tài khoản.

Webhook dùng `webhooks.verify` của SDK chính thức, kiểm success/code/mã đơn/amount/currency/link/reference.
Unknown order đã ký được ACK để hỗ trợ đăng ký webhook; sai signature trả 400, dữ liệu sai trả 409,
lỗi xử lý tạm thời trả non-2xx để provider retry. Event audit chỉ lưu whitelist mã đơn, amount, currency, link,
reference/code; không lưu chữ ký, credential hoặc thông tin cá nhân ngân hàng.
Payment event, PAID và license được commit cùng transaction với row lock. Unique reference, user và order/license
ngăn cấp lặp. Reconcile xác minh dữ liệu provider qua API; PAID luôn giữ quyền kể cả callback cũ báo hủy/hết hạn.
Background reconciliation quét tối đa 20 đơn/60 giây khi payment được cấu hình; CLI được mô tả trong setup.

## Identity và protocol

Identity body `{deviceId:UUID, publicKey:{kty:'RSA',n:base64url,e:base64url}, keyProtection:'TPM'|'SOFTWARE', deviceName}`.
Challenge thêm `purpose:'ACTIVATE'|'VERIFY'`; RSA >=2048bits. Không nhận private JWK fields.
Message UTF-8 chính xác:

```text
3DM-DEVICE-V1|challengeUuid|nonceBase64url43|userUuid|deviceUuid|ACTIVATE_OR_VERIFY|spkiSha256Hex64
```

C# ký RSA-SHA256 PKCS#1 v1.5. `signature` là base64 chuẩn. Challenge TTL2 phút, dùng một lần,
gắn auth session + account. Kể cả chữ ký sai cũng đốt nonce; activation rollback không tái dùng challenge.
`dsid` TTL15 phút, hash SHA256 lưu DB; frontend tự VERIFY định kỳ8 phút và khi mở lại.
Logout xóa auth session, kéo theo dsid; revoke/suspend xóa dsid và chặn proof/ticket cũ.

Theo D12, `VERIFY` có thể khôi phục device binding ACTIVE bằng cặp UUID và public-key hash chính xác,
kể cả khi license thuộc tài khoản khác; thao tác này không cho phép tải/import. Các route archive yêu cầu
license ACTIVE của tài khoản hiện tại và ID khớp với device session. Ticket stream kiểm tra lại chủ sở hữu
license. `ACTIVATE` vẫn yêu cầu key của tài khoản hiện tại để thêm slot, tối đa hai slot cố định.
Response phiên của tài khoản không sở hữu bỏ cả `key` và `last4`; `/licenses/me` không trả key chủ cũ.

Bridge envelope `{id,version:1,method,params}`. Method mới:
`device.getIdentity` với `{}`, và `device.signChallenge` với `{challengeId,message}`.
Native kiểm tra grammar, chính deviceId/public-key hash, origin và tài liệu đang hiển thị.
Không có private key, raw cookie, arbitrary signing, reset hay transfer method.

Lỗi chính: 400 INVALID_*; 401 UNAUTHENTICATED; 403 INVALID_LICENSE_KEY, LICENSE_REQUIRED,
LICENSE_SUSPENDED/REVOKED, INVALID_DEVICE_PROOF, CHALLENGE_EXPIRED, DEVICE_SESSION_INVALID;
409 DEVICE_LIMIT_REACHED/DEVICE_IDENTITY_ALREADY_BOUND/ALREADY_LICENSED/PAYMENT_DATA_MISMATCH;
503 LICENSE_CONFIGURATION_REQUIRED/PAYMENTS_UNAVAILABLE/PAYMENT_CREATION_PENDING.
Sai key account khác trả INVALID_LICENSE_KEY chung, không tiết lộ owner khác.
