# 3DsMood — IMPLEMENT LICENSE & PAYOS SYSTEM

## ROLE & MISSION

Bạn là Senior Full-stack Engineer, Security Engineer, Database Architect và Windows Plugin Engineer.

Nhiệm vụ: **Trực tiếp triển khai hoàn chỉnh hệ thống License + payOS trên source code 3DsMood hiện tại.**

Tôi không muốn chỉ nhận bản thiết kế hoặc kế hoạch. Hãy đọc repository, viết code, sửa lỗi, tạo migration, tích hợp frontend/plugin, chạy build, chạy test và hoàn thiện các phần trong khả năng môi trường thực thi.

Chủ động đưa ra quyết định kỹ thuật hợp lý, ưu tiên bảo mật, chi phí vận hành thấp và tương thích với dự án hiện tại.

## 1. TECH STACK HIỆN CÓ

- Frontend: React 19, Vite 7, Tailwind CSS 4.
- Backend: Node.js, Express 5.
- Database: PostgreSQL, thư viện `pg`.
- Plugin: C#, .NET Framework 4.8, WebView2.
- 3ds Max: 2022, tích hợp MAXScript.
- Frontend development: port 5173.
- Backend hiện có auth, catalog, download và import ticket.

Sử dụng backend Express hiện hữu để tránh chạy hai backend đồng thời. Không tự ý rewrite sang Go, thay framework, hoặc nâng cấp major dependencies nếu không cần thiết.

**Phạm vi không thực hiện:**

- Không thiết kế lại catalog.
- Không thay đổi lưu trữ model.
- Không chỉnh sửa xử lý ZIP, texture, thumbnail hoặc merge engine.
- Không tích hợp Google Drive, R2 hoặc Wasabi.
- Không refactor những module không liên quan.
- Chỉ chạm vào import-ticket/download endpoint khi cần kiểm tra quyền license.

Backend hiện có thể đang lỗi xác thực PostgreSQL và `SOURCE_DIR`. Hãy kiểm tra và sửa cấu hình PostgreSQL an toàn nếu có thể. Không cần sửa `SOURCE_DIR` hoặc di chuyển thư viện model để hoàn thành nhiệm vụ này.

## 2. YÊU CẦU LICENSE CỐ ĐỊNH

Triển khai chính sách:

- 1 account chỉ được sở hữu 1 license.
- License có hiệu lực vĩnh viễn (`LIFETIME`).
- 1 license có tối đa 2 thiết bị.
- Mỗi slot sau khi kích hoạt sẽ gắn cố định với danh tính thiết bị.
- Không có API cho người dùng deactivate, đổi máy, xóa slot hoặc transfer license.
- Máy thứ ba phải bị từ chối.
- Máy đã kích hoạt được đăng nhập và sử dụng lại bình thường.
- License gắn với account, không thể nhập key của account A để kích hoạt bằng account B.
- Backend có thể suspend/revoke license khi cần xử lý vi phạm.
- Khởi động plugin lần sau không bắt người dùng nhập lại license key.
- Không được bypass giới hạn bằng cách xóa file cấu hình local hoặc sửa giá trị device ID gửi qua API.

**Chính sách bất biến:** Không tự động chuyển slot nếu người dùng cài lại Windows, thay phần cứng hoặc mất khóa thiết bị. Không xây chức năng tự reset. Ghi rõ hạn chế này trong UI và tài liệu.

## 3. TỰ THIẾT KẾ DATABASE

Đọc database schema và migration hiện tại trước khi thay đổi. Không giả định kiểu dữ liệu của `users.id`.

Tạo schema phù hợp, tối thiểu gồm:

**licenses**
- id
- user_id (UNIQUE)
- key_hash (UNIQUE)
- key_ciphertext và thông tin giải mã nếu cần hiển thị lại key
- key_last4
- license_type = LIFETIME
- status
- issued_at
- revoked_at (nếu cần)

**license_devices**
- id
- license_id
- slot_number (chỉ 1 hoặc 2)
- device_id
- device_fingerprint_hash nếu sử dụng
- device_public_key
- activated_at
- last_seen_at

**orders**
- id
- user_id
- order_code (unique)
- amount_vnd
- status
- payos_payment_link_id
- created_at
- paid_at

**payment_events**
- id
- order_id
- provider_reference
- event_type
- processed_at
- kết quả xử lý

Thiết kế thêm bảng device challenges, audit logs hoặc các ràng buộc cần thiết.

Yêu cầu database:

1. Bảo đảm 1 user tối đa 1 license bằng UNIQUE constraint.
2. Bảo đảm tối đa 2 slot bằng constraint và transaction.
3. Ngăn sửa/xóa quan hệ gắn thiết bị sau activation; cân nhắc DB trigger bảo vệ tính bất biến.
4. Ngăn webhook trùng tạo license trùng.
5. Ngăn hai request kích hoạt đồng thời cùng chiếm slot cuối.
6. Sử dụng `SELECT ... FOR UPDATE` và transaction phù hợp.
7. Sử dụng parameterized queries.
8. Tạo versioned SQL migrations và rollback nếu khả thi.
9. Không DROP dữ liệu hiện có và không sửa database production khi chưa được cho phép.

## 4. THUẬT TOÁN TẠO LICENSE KEY

Tự xây license generator bằng Node.js `crypto`.

Yêu cầu:

- Dùng CSPRNG `crypto.randomBytes`.
- Ít nhất 128 bit entropy.
- Format key dễ nhập, có prefix `3DM-`.
- Không dựa trên email, username, thời gian, số đơn hàng hoặc hardware ID.
- Kiểm tra trùng key tại database, có retry an toàn trong trường hợp collision.
- Normalize key nhất quán trước khi verify.
- Lưu HMAC-SHA256 của key với secret riêng trong environment.
- Nếu cần người dùng xem lại key trong trang My License, lưu bản key đã mã hóa authenticated encryption bằng AES-256-GCM với key bí mật tách khỏi HMAC secret.
- Không ghi raw license key, encryption secret hoặc HMAC secret vào log.

Xây một License Service có các nghiệp vụ:

- `issueLifetimeLicense(userId, orderId)`
- `getLicenseByAccount(userId)`
- `verifyLicenseOwnership(userId, licenseKey)`
- `activateDevice(...)`
- `verifyDevice(...)`
- `getActivatedDevices(userId)`
- `revokeLicense(...)`

Các hàm cần tuân thủ tính idempotent và database constraints. Khi account đã có license, không sinh license mới.

Hỗ trợ admin phát hành license thử mà chưa cần giao dịch ngân hàng, nhưng endpoint phải được bảo vệ chặt và không công khai quyền admin cho client.

## 5. THIẾT KẾ DEVICE ID VÀ KHÓA THIẾT BỊ

Đây là phần bảo mật trọng tâm.

Thiết kế Device Identity trong **C# .NET Framework 4.8**, không giao việc xác định thiết bị hoàn toàn cho JavaScript trong WebView2.

Yêu cầu:

1. Khi chạy lần đầu, C# tạo một Device ID dạng UUID ngẫu nhiên, lưu bền vững và được bảo vệ trên Windows.
2. Tạo cặp khóa asymmetric cho thiết bị.
3. Ưu tiên Windows CNG với TPM-backed, non-exportable private key nếu môi trường hỗ trợ.
4. Nếu không có TPM, đánh giá fallback Windows CNG + DPAPI với mức bảo mật thấp hơn. Không âm thầm coi fallback tương đương TPM.
5. Chỉ gửi public key lên backend.
6. Backend tạo challenge ngẫu nhiên, thời hạn ngắn, chỉ được dùng một lần và ràng buộc với đúng tài khoản/phiên.
7. Plugin ký challenge bằng private key.
8. Backend verify signature trước khi xác nhận thiết bị.
9. Thiết bị đã kích hoạt phải tiếp tục chứng minh sở hữu private key khi tạo phiên thiết bị mới.
10. Không tin `device_id`, hostname, MAC Address, MachineGuid hoặc dữ liệu client đơn lẻ là bằng chứng sở hữu thiết bị.

Nếu thu thập hardware fingerprint, chỉ thu thập thông tin tối thiểu, hash trước khi lưu, tránh lưu serial phần cứng thô không cần thiết.

Bảo đảm device ID và khóa còn sử dụng được sau khi cập nhật plugin thông thường.

Thiết kế cơ chế lưu credential an toàn qua Windows Credential Manager hoặc DPAPI, không nhúng secret vào JavaScript, MAXScript hoặc file plaintext.

Nêu rõ giới hạn chống crack: không thể bảo đảm tuyệt đối chống clone hoặc patch client; TPM là lớp bảo vệ bổ sung.

## 6. DEVICE ACTIVATION FLOW

Triển khai đầy đủ:

1. Khách đăng nhập bằng account.
2. Nếu chưa kích hoạt, hiển thị trang Activate License.
3. Khách nhập license key.
4. C# tạo/đọc Device Identity.
5. Backend xác minh account và license.
6. Thực hiện challenge-response.
7. Trong một database transaction, khóa license row.
8. Nếu thiết bị đã đăng ký, xác minh đúng khóa và không tạo thêm slot.
9. Nếu là thiết bị mới và còn slot, gắn vào slot trống.
10. Nếu đủ 2 slot, trả lỗi `DEVICE_LIMIT_REACHED`.
11. Nếu thành công, tạo phiên xác thực có kiểm soát, mở giao diện sử dụng.

Lần sau mở plugin:
- Tự đăng nhập nếu credential hợp lệ.
- Xác thực lại thiết bị.
- Không yêu cầu nhập license key mỗi lần.
- Không cấp phiên nếu license revoked hoặc device proof không hợp lệ.

Không thiết kế cơ chế offline license hoàn chỉnh trong V1.

## 7. PAYOS — THANH TOÁN TỰ ĐỘNG

Tài khoản payOS và ngân hàng đã được người dùng thiết lập. Hiện chưa có nghĩa là các API secret và webhook đã cấu hình trong source.

Dùng Node SDK chính thức `@payos/node` và API hiện hành, đọc tài liệu:

https://payos.vn/docs/sdks/back-end/node/

https://payos.vn/docs/du-lieu-tra-ve/webhook/

https://payos.vn/docs/moi-truong-test/

Yêu cầu:

- Tạo link thanh toán cho sản phẩm 3DsMood Lifetime.
- Giá phải do backend lấy từ cấu hình tin cậy, không nhận giá do React gửi lên.
- Số tiền VND là số nguyên.
- `orderCode` duy nhất và đúng yêu cầu của payOS.
- Lưu order `PENDING` trước khi hoàn tất flow tạo payment link, xử lý thất bại và retry an toàn.
- Trả checkout URL/QR cho frontend.
- Tạo webhook endpoint, xác minh signature bằng SDK chính thức.
- Kiểm tra trạng thái thanh toán thành công, orderCode, amount, currency và paymentLinkId/reference khi thích hợp.
- Không coi `returnUrl`, `cancelUrl`, query string hoặc nút “Tôi đã thanh toán” là bằng chứng thanh toán.
- Chống duplicate webhook và replay.
- Chỉ sau khi thanh toán hợp lệ mới đánh dấu `PAID` và gọi License Service.
- Việc xử lý payment và phát hành license phải nhất quán bằng transaction/idempotency.
- Webhook không tìm được đơn thật hoặc là payload kiểm thử đăng ký webhook thì tuyệt đối không cấp license.
- Nếu account đã có license, không cấp lần hai; ghi nhận và xử lý trường hợp thanh toán trùng rõ ràng.
- Hỗ trợ endpoint lấy trạng thái order để frontend cập nhật.
- Bổ sung cơ chế reconciliation/truy vấn trạng thái payOS cho tình huống webhook chậm hoặc thất lạc nếu SDK hỗ trợ phù hợp.

Lưu ý: payOS không có sandbox độc lập. **Không tự ý tạo giao dịch tiền thật**, kể cả giá trị nhỏ. Mọi bài test tự động phải dùng mock hoặc fixture. Chỉ triển khai real payment end-to-end khi chủ dự án phê duyệt rõ.

## 8. ENVIRONMENT & SECRETS

Tạo hoặc cập nhật `.env.example` với các cấu hình thích hợp:

- DATABASE_URL hoặc bộ biến cấu hình `pg` hiện có
- PAYOS_CLIENT_ID
- PAYOS_API_KEY
- PAYOS_CHECKSUM_KEY
- PAYOS_WEBHOOK_URL
- PUBLIC_BASE_URL
- LICENSE_HMAC_SECRET
- LICENSE_ENCRYPTION_KEY
- LICENSE_LIFETIME_PRICE_VND
- các session/auth secrets có liên quan

Không điền secret thật vào source, sample config, commit, log hay báo cáo.

Kiểm tra các biến bắt buộc khi khởi động. Khi thiếu secret hoặc giá sản phẩm, từ chối thực hiện thanh toán thay vì dùng giá/secret giả.

Không tự ý đăng ký webhook production hoặc thay đổi tài khoản payOS đang hoạt động nếu cần quyền xác nhận của người dùng.

## 9. REACT FRONTEND

Giữ nguyên thiết kế hiện tại, chỉ thêm các màn hình hoặc component cần thiết:

**Trang mua License**
- Hiển thị 3DsMood Lifetime.
- Giá VND từ backend.
- Nút mua.
- QR hoặc checkout link payOS.
- Trạng thái PENDING, PAID, FAILED/CANCELLED rõ ràng.

**Trang My License**
- Loại: Lifetime.
- Trạng thái license.
- Mã license với nút sao chép, chỉ hiển thị sau khi xác thực quyền sở hữu và giải mã an toàn.
- Danh sách tối đa 2 thiết bị.
- Không có nút deactivate hoặc transfer.

**Trang Activate trong plugin**
- Nhập key lần đầu.
- Hiển thị trạng thái đang kích hoạt.
- Thông báo lỗi sai key, license không thuộc account, hết slot, không hỗ trợ bảo mật thiết bị.
- Thông báo rõ: mỗi slot gắn cố định sau khi kích hoạt.

Frontend không được trực tiếp chứa payOS API key, checksum key, HMAC secret hoặc license encryption key.

## 10. TÍCH HỢP C# WEBVIEW2

Kiểm tra kiến trúc bridge React ↔ C# đang tồn tại.

- Giữ nguyên các chức năng 3ds Max và MAXScript.
- Thiết kế message bridge tối thiểu cho identity, activation và challenge-response.
- Validate origin của WebView2.
- Chặn điều hướng không tin cậy khi expose host functionality.
- Validate schema của mọi web message.
- Không cho JavaScript tự cung cấp bằng chứng thiết bị giả mà backend vẫn chấp nhận.
- Không đưa private key hoặc raw credential vào React.
- Không phá luồng import model đã hoạt động.

Các API cấp import ticket hoặc quyền tải model trả phí phải kiểm tra account, license và device session hợp lệ. Không cần sửa cơ chế đọc hoặc lưu file model.

## 11. API BACKEND

Thiết kế route phù hợp với conventions của repository. Các endpoint tối thiểu:

- `GET /api/licenses/me`
- `GET /api/licenses/devices`
- `POST /api/licenses/activate`
- `POST /api/devices/challenge`
- `POST /api/devices/verify`
- `POST /api/payments/create`
- `GET /api/payments/:orderId`
- `POST /api/webhooks/payos`
- `POST /api/admin/licenses/issue`

Có thể điều chỉnh URL để khớp routing hiện có, nhưng phải nhất quán và ghi tài liệu.

Thêm authorization, rate limiting, request validation, error handling, audit log và HTTP status chính xác.

Không để endpoint admin phát hành key bị truy cập bằng user thông thường.

## 12. TEST CASE BẮT BUỘC

Tự viết automated tests cho các trường hợp:

**License**
- Sinh key hợp lệ.
- Key sai bị từ chối.
- 1 account không thể có 2 licenses.
- Account B không thể kích hoạt key của account A.
- License revoked không đăng nhập được.

**Devices**
- PC-01 kích hoạt thành công.
- PC-02 kích hoạt thành công.
- PC-03 bị từ chối.
- PC-01 đăng nhập lại không tốn slot mới.
- Hai thiết bị kích hoạt đồng thời không thể vượt giới hạn 2.
- Giả mạo device ID nhưng không có private key hợp lệ bị từ chối.
- Challenge hết hạn, sai chữ ký hoặc replay bị từ chối.
- User không có API đổi hoặc xóa thiết bị.

**Payment**
- Tạo order hợp lệ.
- Amount do backend kiểm soát.
- Payment success đã xác thực tạo đúng một license.
- Webhook sai signature không cấp license.
- Webhook đúng chữ ký nhưng sai amount/orderCode không cấp license.
- Duplicate webhook không tạo license trùng.
- Return URL giả không kích hoạt license.
- Webhook setup/sample không tạo license.
- Mất kết nối database giữa lúc xử lý không tạo trạng thái fulfillment sai.

**Frontend & Plugin**
- React build thành công.
- Backend khởi động và health check thành công.
- Test login/activation UI.
- C# plugin build thành công trên Windows có toolchain phù hợp.
- Kiểm tra bridge với WebView2.
- Nếu máy có 3ds Max 2022 và plugin đã cài, chạy thử plugin trong Max.

Phân biệt rõ kết quả **unit test**, **integration test**, **build**, và **runtime test bên trong 3ds Max**. Không tuyên bố plugin đã chạy trong 3ds Max nếu thực tế chỉ mới build DLL.

## 13. QUY TRÌNH THỰC THI

Hãy làm theo các checkpoint:

**Checkpoint A — Audit**
- Xác định repository root và đọc cấu trúc.
- Đọc package.json, source API, auth, database migrations và C# project.
- Kiểm tra Git status.
- Xác định lỗi PostgreSQL.
- Chạy baseline build/tests nếu có.

**Checkpoint B — Database & License**
- Tạo migrations.
- Tạo license generator/service.
- Tạo device activation API.
- Thêm unit/integration tests.

**Checkpoint C — payOS**
- Tích hợp SDK.
- Tạo Orders/Payments service.
- Webhook verification và idempotency.
- Mock webhook tests.

**Checkpoint D — React & C#**
- Tạo UI payment/license/activation.
- Tích hợp C# Device Identity.
- Tích hợp WebView2.
- Giữ nguyên plugin import logic.

**Checkpoint E — Build & Verification**
- Cài dependency cần thiết theo package manager hiện có.
- Chạy lint, test, build.
- Chạy migrations trên development database.
- Kiểm tra API và các luồng end-to-end dùng mock.
- Build C# DLL/plugin.
- Thử nghiệm với 3ds Max 2022 khi môi trường cho phép.
- Sửa lỗi phát hiện được và kiểm tra lại.

Không dừng ở việc viết kế hoạch. Bắt đầu thực hiện sau khi audit và tiếp tục qua các checkpoint.

Không bỏ qua lỗi để báo hoàn thành. Nếu thiếu Windows SDK, 3ds Max, PostgreSQL credential, public webhook URL hoặc công cụ cần thiết, hãy hoàn tất những phần có thể kiểm chứng và ghi blocker chính xác. Không bịa kết quả test.

## 14. DELIVERABLES

Khi kết thúc, cần có:

1. Source code License Service hoạt động.
2. PostgreSQL migrations và rollback phù hợp.
3. payOS integration với webhook xác minh an toàn.
4. React UI mua và quản lý license.
5. C# Device Identity/activation tích hợp plugin.
6. Automated tests.
7. `.env.example` không chứa secret.
8. README hướng dẫn cấu hình PostgreSQL, payOS và webhook HTTPS.
9. Tài liệu API.
10. File `LICENSE_PAYOS_IMPLEMENTATION_REPORT.md` ghi:
   - Files đã tạo/sửa.
   - Kiến trúc triển khai.
   - Migration đã chạy hay chưa.
   - Lệnh build/test thực tế và kết quả.
   - Những test chưa thực hiện được và lý do.
   - Các giới hạn bảo mật còn tồn tại.
   - Các bước cấu hình cuối cùng trước khi production.

**ĐIỀU KIỆN HOÀN THÀNH**

Hệ thống phải chứng minh được bằng test rằng một account chỉ được cấp một lifetime license, license chỉ kích hoạt tối đa hai thiết bị bất biến, máy thứ ba bị từ chối, và chỉ payment payOS hợp lệ đã xác minh mới tự động cấp license.

Build và test toàn bộ phần có thể chạy trong môi trường hiện tại, báo cáo trung thực mọi phần bị chặn bởi công cụ hoặc cấu hình ngoài repository.

Bắt đầu audit source code ngay bây giờ và triển khai thực tế.