# Kế hoạch đưa website 3DS Mood vào 3ds Max

> Cập nhật: 2026-09-30  
> Trạng thái: kế hoạch triển khai, chưa bắt đầu Phase 1  
> Target đã khóa: 3ds Max 2022, .NET Framework 4.8, WebView2 Evergreen  
> Tài liệu liên quan: [`architecture.md`](architecture.md),
> [`current-platform-audit.md`](current-platform-audit.md), [`decisions.md`](decisions.md)

## 1. Goal

Trong 3ds Max 2022:

1. User mở panel 3DS Mood.
2. Website React thật được hiển thị; không dùng `frontend/index.html` làm UI sản phẩm.
3. User đăng nhập, duyệt catalog và xem product detail như trong browser.
4. Website nhận biết đang chạy trong 3ds Max.
5. Asset tương thích có nút **Import vào 3ds Max**.
6. Khi import, backend xác minh quyền sở hữu, native host tải/cache/verify asset và import
   vào scene trên thread an toàn.
7. UI hiển thị progress và lỗi có request ID.
8. Website vẫn chạy bình thường trong browser khi không có Max host.

## 2. Chuỗi milestone

```text
M0: Website chạy local trong browser
  -> M1: Website local hiển thị trong WebView2/Max
  -> M2: React giao tiếp hai chiều với Max
  -> M3: Backend cấp quyền import an toàn
  -> M4: Asset thật được import vào scene
  -> M5: Hardening, installer và release candidate
```

| Milestone | Phase | Demo bắt buộc |
|---|---:|---|
| M0 — Local web baseline | 1–3 | Website chạy ổn trong Chrome với backend local |
| M1 — Embedded website | 4–5 | Website thật xuất hiện và dùng được trong Max |
| M2 — Bidirectional bridge | 6–7 | React gọi `host.ping`, đọc scene/selection |
| M3 — Import authorization | 8 | Backend cấp import ticket sau ownership check |
| M4 — Real asset import | 9–10 | Asset thật xuất hiện trong scene |
| M5 — Productization | 11–14 | Progress, hardening, installer và test matrix pass |

Không bắt đầu milestone sau nếu exit criteria của milestone trước chưa đạt.

---

## Phase 0 — Chốt baseline và ranh giới

### Mục tiêu

Giữ website và native integration tách trách nhiệm, đồng thời thống nhất tiêu chí hoàn thành.

### Việc phải làm

- Xác nhận `/web` là source of truth cho website 3DS Mood.
- Xác nhận `plugin-csharp/`, `maxscript/`, `frontend/`, `installer/` là PoC/native integration.
- Giữ `frontend/index.html` làm diagnostic page, không phát triển thành product UI.
- Định nghĩa ba environment:
  - development: frontend/backend local;
  - staging: website/API staging;
  - production: website/API production.
- Chốt nguyên tắc security:
  - web input luôn untrusted;
  - native không nhận arbitrary URL/path/script;
  - scene mutation chỉ chạy trên Max-safe/main thread;
  - browser mode không phụ thuộc Max bridge.
- Tạo checklist trạng thái theo bốn nhãn:
  - inspected;
  - tested local;
  - tested in Max;
  - deployed.

### Deliverable

- [`architecture.md`](architecture.md).
- [`current-platform-audit.md`](current-platform-audit.md).
- Tài liệu plan này.

### Exit criteria

- Không còn hiểu nhầm HTML demo là website chính.
- Không có yêu cầu rewrite frontend/backend ngoài nhu cầu integration cụ thể.

---

## Phase 1 — Chạy backend local

### Mục tiêu

Backend khởi động ổn định từ clean install và phục vụ được API tối thiểu cho frontend.

### 1.1 Chuẩn hóa local environment

- Không in giá trị secret ra terminal hoặc tài liệu.
- Chọn một cách rõ ràng để backend đọc `.env_local` trong development.
- Không copy credential sang file được commit.
- Xác minh các key bắt buộc tồn tại:
  - port;
  - MongoDB URI;
  - JWT secret;
  - frontend URL;
  - Google OAuth config nếu test Google;
  - Wasabi endpoint, region, bucket và credential;
  - payment config chỉ khi test payment.
- Chuyển CORS origin thành environment config thay vì hard-code.
- Thay session secret placeholder bằng environment config.
- Loại bỏ log `MONGO_URI` và mọi log có thể lộ credential.

### 1.2 Chuẩn hóa dependency

- Chạy clean install từ lockfile.
- Bổ sung `mime-types` thành direct dependency vì source require trực tiếp.
- Kiểm tra việc tồn tại đồng thời `bcrypt` và `bcryptjs`; chỉ giữ cả hai nếu có use case thật.
- Xác minh mọi module được require khi startup đều nằm trong manifest.

### 1.3 Startup và health

- Khởi động backend bằng development script.
- Xác nhận process listen đúng port.
- Xác nhận MongoDB connect thành công.
- Tạo/chuẩn hóa health endpoint không trả secret.
- Health response nên phân biệt:
  - process alive;
  - database ready;
  - degraded dependency nếu có.

### 1.4 Smoke test API

- `GET /` trả `200`.
- Category tree trả dữ liệu.
- Product list trả dữ liệu.
- Product detail trả dữ liệu.
- Homepage data trả dữ liệu.
- Login email/password trả user và JWT hợp lệ.
- Protected endpoint trả `401` khi không có token.
- Protected endpoint trả dữ liệu khi token hợp lệ.
- Download endpoint kiểm ownership đúng cho asset free/paid.
- Không thực hiện payment hoặc mutation production trong smoke test nếu chưa có test data riêng.

### Validation

- Startup từ clean dependency install.
- Không có unhandled rejection/exception.
- Không có secret trong log.
- Ghi lại lệnh chạy và kết quả trong milestone report.

### Exit criteria

- Backend local chạy ổn định.
- API public và auth cơ bản pass.
- Các dependency trực tiếp đã được khai báo đúng.

---

## Phase 2 — Chạy frontend local trong browser

### Mục tiêu

Thiết lập baseline website trước khi đưa vào WebView2.

### 2.1 Cấu hình

- Clean install frontend từ lockfile.
- Xác minh `VITE_API_BASE_URL` trỏ đúng backend local.
- Thêm/chuẩn hóa `VITE_ASSET_BASE_URL` nếu asset URL khác API base.
- Chạy Vite tại origin phù hợp CORS, mặc định `http://localhost:5173`.
- Không hard-code production URL trong component.

### 2.2 Build check

- Chạy lint.
- Chạy production build.
- Ghi riêng:
  - lỗi blocker;
  - warning;
  - technical debt không chặn integration.

### 2.3 Browser smoke test

- Trang chủ.
- Danh sách 3D Model.
- Danh sách 3D Scenes.
- Product detail cho cả hai loại.
- Login/signup.
- Reload sau login vẫn hydrate đúng user.
- Account, collection, cart và ownership state.
- Download asset đã sở hữu.
- Direct refresh trên route React không ra 404/trang trắng.
- Image/font/video load đúng.
- Không có request bị CORS block.

### 2.4 Auth cleanup tối thiểu

- Sửa contract giữa `ProtectedRoute` và `AuthContext`.
- Xác định source of truth cho token ở frontend.
- Chuẩn hóa cách Axios/fetch gắn Bearer token.
- Chưa redesign toàn bộ auth nếu flow hiện tại chạy được.
- Ghi rõ Google OAuth là test riêng trong WebView2.

### Exit criteria

- Website hoạt động trong Chrome với backend local.
- Production build pass.
- Không có lỗi console/network chặn các flow sẽ dùng trong Max.

---

## Phase 3 — Baseline test và platform audit runtime

### Mục tiêu

Phân biệt lỗi có sẵn của website với lỗi chỉ xuất hiện sau khi embed.

### Việc phải làm

- Tạo checklist browser baseline cho:
  - rendering;
  - routing;
  - auth;
  - product APIs;
  - download authorization;
  - refresh/reload;
  - offline/error state.
- Cập nhật [`current-platform-audit.md`](current-platform-audit.md) bằng bằng chứng runtime.
- Cập nhật [`compatibility.md`](compatibility.md) nhưng chỉ đánh dấu verified khi test thật.
- Ghi asset mẫu dùng cho integration:
  - product ID test;
  - free hay paid;
  - format;
  - kích thước;
  - package layout;
  - renderer/material nếu liên quan.

### Exit criteria M0

- Có baseline browser pass/fail rõ ràng.
- Có ít nhất một tài khoản test và một asset test hợp lệ.
- Có thể tái hiện local environment trên máy dev từ tài liệu.

---

## Phase 4 — Chuyển C# host từ HTML path sang URL

### Mục tiêu

WebView2 load website React local thay cho HTML demo.

### 4.1 Cấu hình host

Thay mô hình `HtmlPath` đơn lẻ bằng config có tối thiểu:

- `StartUrl`;
- `TrustedOrigins`;
- `EnvironmentName`;
- `UserDataFolder`;
- timeout startup;
- optional diagnostic page.

Development dự kiến:

```text
StartUrl: http://localhost:5173
Trusted web origin: http://localhost:5173
Trusted API origin: http://localhost:5000
```

Production URL phải đi từ config/installer, không compile cứng vào DLL.

### 4.2 Navigation policy

- Parse URL thành `Uri` và so sánh exact scheme/host/port.
- Không dùng string prefix để xác minh origin.
- Phân biệt:
  - navigation được hiển thị;
  - origin được cấp bridge privilege.
- External link được mở bằng browser hệ thống hoặc chạy không bridge privilege.
- Không bỏ qua certificate error ngoài môi trường test có kiểm soát.
- Redirect OAuth có policy riêng.

### 4.3 Startup/error UX

- Nếu Vite chưa chạy: hiện lỗi kết nối và nút retry.
- Nếu WebView2 Runtime thiếu: báo lỗi có nghĩa, không crash Max.
- Nếu config sai: log environment/start URL đã scrub, không log secret.
- Giữ local diagnostic page để khoanh vùng bridge khi website không chạy.

### Test

- Load localhost thành công.
- Trusted origin có bridge.
- Untrusted origin không có bridge.
- External navigation không vượt allowlist.
- Đóng/mở form không tạo duplicate event handler.

### Exit criteria

- C# host render được website React local độc lập ngoài Max và khi được mở từ Max.

---

## Phase 5 — Website thật chạy trong 3ds Max

### Mục tiêu

Chứng minh website hoạt động trong WebView2/Max trước khi thêm RPC mới.

### Test bắt buộc

- Mở panel từ toolbar.
- Homepage render đúng.
- CSS, font, ảnh và video load đúng.
- React Router navigation hoạt động.
- Direct reload không ra trang trắng.
- Scroll, text input, keyboard, clipboard và focus hoạt động.
- Login email/password hoạt động.
- Token/session tồn tại sau đóng/mở panel theo policy.
- Product list/detail và account hoạt động.
- Backend offline hiển thị lỗi có nghĩa.
- Đóng/reopen panel không đăng ký bridge handler trùng.
- Max không bị treo khi web tải chậm.

### Google OAuth spike

1. Ghi toàn bộ redirect chain nhưng không log token.
2. Xác định Google có cho login trong embedded WebView hay không.
3. Nếu không phù hợp, mở browser hệ thống và dùng callback/deep-link an toàn.
4. Chỉ chốt giải pháp sau test thật.

Email/password là flow ưu tiên để đạt M1; Google OAuth có thể là sub-milestone riêng nếu
không phải acceptance criterion bắt buộc của MVP đầu tiên.

### Exit criteria M1

- Website 3DS Mood local dùng được trong Max gần tương đương Chrome.
- Chưa yêu cầu import asset ở phase này.

---

## Phase 6 — Thêm Max host mode vào React

### Mục tiêu

Frontend biết đang chạy trong Max nhưng browser mode vẫn hoạt động.

### 6.1 Bridge SDK tập trung

Tạo integration module duy nhất, dự kiến:

```text
web/front-3dsmood-main/src/integrations/3dsmax/
├── bridge.js
├── protocol.js
├── host.js
├── scene.js
└── assets.js
```

Không component nào gọi trực tiếp `window.chrome.webview`.

### 6.2 SDK behavior

- `isAvailable()` để detect host.
- `request(method, params)` trả Promise.
- Request ID unique.
- Pending request map.
- Timeout và cleanup.
- Runtime validation cho inbound message.
- Structured error.
- Event subscribe/unsubscribe.
- Cleanup khi page reload hoặc component unmount.
- Browser fallback trả `HOST_NOT_AVAILABLE`, không crash.

### 6.3 Extension route

Khuyến nghị thêm `/extension/3dsmax` để:

- tái sử dụng catalog/product component;
- tối ưu layout cho panel hẹp;
- ẩn control không phù hợp;
- hiển thị host status;
- thêm Import action;
- không ảnh hưởng route browser hiện tại.

### Exit criteria

- UI phân biệt rõ Browser, Max connected, Max unavailable và bridge error.
- Browser mode regression test pass.

---

## Phase 7 — Bridge cơ bản trên website thật

### Mục tiêu

React giao tiếp hai chiều với Max trước khi đưa asset production vào pipeline.

### RPC giữ lại

- `host.ping`.
- `host.getInfo`.
- `scene.getInfo`.
- `scene.getSelection`.
- `scene.createBox` chỉ dùng diagnostic/PoC.

### Protocol

Request:

```json
{
  "id": "uuid",
  "version": 1,
  "method": "host.ping",
  "params": {}
}
```

Response thành công và lỗi tiếp tục theo contract trong [`../spec.md`](../spec.md).

### Test

- Request song song không trả nhầm response.
- Unknown method bị từ chối ở C# allowlist.
- Invalid params bị từ chối.
- Malformed JSON không làm host crash.
- Reload web hủy pending request.
- Timeout dọn pending map.
- Message từ untrusted origin không tới MAXScript.
- Native exception được map thành safe error.
- Không trả stack trace, token hoặc local path về web.

### Exit criteria M2

- React hiển thị host/plugin/WebView version.
- React đọc scene info và selection thật.
- Browser mode không lỗi khi bridge không tồn tại.

---

## Phase 8 — Thiết kế backend contract cho import

### Mục tiêu

Backend tiếp tục là source of truth cho quyền sở hữu; native có capability ngắn hạn để tải
đúng asset mà không nhận JWT hoặc arbitrary URL từ web.

### 8.1 Flow đề xuất

```text
User bấm Import
  -> frontend gọi backend bằng JWT hiện tại
  -> backend kiểm user, ownership và asset status
  -> backend tạo import ticket ngắn hạn
  -> frontend gửi assetId + ticket qua bridge
  -> native đổi ticket lấy metadata/download stream
  -> backend audit ticket use
```

### 8.2 Import ticket

Ticket phải được ràng buộc với:

- user ID;
- asset ID;
- asset version/checksum;
- format;
- expected size;
- expiration;
- one-time/replay policy;
- intended client capability: Max import.

Ticket không chứa storage secret. Không log raw ticket.

### 8.3 API dự kiến

- API tạo import ticket, yêu cầu user auth.
- API resolve/stream ticket cho native.
- Ownership check dùng cùng rule với browser download.
- Response metadata có format/version/size/checksum khi khả dụng.
- Error model phân biệt unauthorized, not-owned, expired và asset unavailable.
- Rate limit và audit theo user/asset/request ID.

### 8.4 Scale concern

Download token hiện lưu trong memory process. Trước production phải quyết định:

- ticket stateless có chữ ký; hoặc
- ticket state dùng shared store như Redis/database.

Không phụ thuộc in-memory map nếu backend chạy nhiều instance.

### Test

- Asset free.
- Asset paid đã mua.
- Asset paid chưa mua.
- Ticket hết hạn.
- Ticket replay.
- Ticket cho asset A không tải được asset B.
- User A không dùng ticket của user B nếu policy yêu cầu binding.

### Exit criteria M3

- Contract được review và test backend độc lập.
- Native chỉ cần asset ID/ticket, không cần JWT của frontend.

---

## Phase 9 — Native download, verify, extraction và cache

### Mục tiêu

C# host sở hữu toàn bộ privileged file pipeline, chạy async và không block UI.

### 9.1 Download pipeline

1. Validate request schema.
2. Validate asset ID và ticket.
3. Chỉ gọi trusted HTTPS API origin ngoài local development.
4. Stream download vào temp file; không buffer toàn bộ trong RAM.
5. Giới hạn thời gian, kích thước và redirect.
6. Kiểm Content-Length khi có.
7. Tính checksum trong lúc stream hoặc sau download.
8. So sánh checksum/version.
9. Atomic move sang cache sau verify.
10. Dọn temp file khi fail/cancel.

### 9.2 Safe extraction

Nếu asset là package:

- canonicalize tất cả path;
- chặn `../` traversal;
- chặn absolute/UNC path;
- chặn symlink/reparse trick nếu có;
- giới hạn số file;
- giới hạn tổng uncompressed size;
- giới hạn compression ratio;
- chỉ cho phép extension cần thiết;
- extract vào temp directory rồi atomic move;
- xác định entry file bằng manifest hoặc rule rõ ràng.

`.rar` không được coi là supported chỉ vì frontend cho upload; phải có quyết định dependency,
license và security riêng trước khi hỗ trợ.

### 9.3 Cache

Cache key tối thiểu:

```text
assetId / version-or-checksum
```

Metadata cache nên có:

- asset ID;
- version/checksum;
- source format;
- entry file;
- size;
- created/last-access time.

Thêm quota, LRU/cleanup policy và thao tác clear cache cho support.

### Test

- Download thành công.
- Network timeout/reset.
- Sai size/checksum.
- Disk full/quota exceeded.
- Cancel giữa download.
- Zip-slip.
- Archive bomb.
- Cache hit và cache miss.
- Hai request cùng asset không làm hỏng cache.

### Exit criteria

- Asset mẫu được tải, verify và cache an toàn; chưa cần import scene.

---

## Phase 10 — Import asset vào 3ds Max

### Mục tiêu

Hoàn thành vertical slice từ click trên website tới object thật trong scene.

### 10.1 Chốt format MVP

Repo hiện nhận upload `.zip`, `.glb`, `.fbx`, `.obj`, `.blend`, `.rar`, nhưng support upload
không đồng nghĩa support import trong Max 2022.

Chỉ chọn một format đầu tiên sau khi có asset mẫu thật:

- `.max` nếu asset được chuẩn hóa đúng Max 2022;
- `.fbx` nếu cần interchange;
- `.zip` chỉ là package chứa entry `.max`/`.fbx` và texture.

Không claim `.blend`, `.glb` hoặc `.rar` support trước khi adapter được test thật.

### 10.2 Import behavior phải chốt

- Merge hay import.
- Unit conversion.
- Axis/orientation.
- Name collision.
- Placement trong scene.
- Texture path/remap.
- Material và renderer compatibility.
- Layer/group behavior.
- Undo transaction.
- Rollback khi import dở.

### 10.3 Threading

- Download/extract chạy background.
- Mọi scene mutation được dispatch lên Max-safe/main thread.
- Xác minh API/signature bằng assembly và Max 2022 thật.
- Không đưa type `Autodesk.Max` vào bridge core.

### 10.4 Response

Kết quả thành công nên chứa:

- asset ID;
- imported object count;
- object/group names;
- cache hit/miss;
- elapsed time;
- warning về material/texture nếu có.

Error code tối thiểu:

- `UNAUTHORIZED`;
- `ASSET_NOT_FOUND`;
- `DOWNLOAD_FAILED`;
- `CHECKSUM_FAILED`;
- `UNSAFE_PACKAGE`;
- `UNSUPPORTED_FORMAT`;
- `IMPORT_FAILED`;
- `MAX_OPERATION_FAILED`;
- `TIMEOUT`.

### Test

- Import asset vào scene trống.
- Import lần hai từ cache.
- Import khi scene có object trùng tên.
- Missing texture.
- Unit khác nhau.
- Undo.
- Import failure không để scene/cache ở trạng thái nửa vời.

### Exit criteria M4

- User bấm Import trong React website và asset thật xuất hiện đúng trong scene.

---

## Phase 11 — Progress, cancellation và UX

### Mục tiêu

User biết operation đang ở đâu; asset lớn không làm UI hoặc Max bị treo.

### Event đề xuất

- `asset.importStarted`;
- `asset.downloadProgress`;
- `asset.extractProgress`;
- `asset.importProgress`;
- `asset.importCompleted`;
- `asset.importFailed`.

Event name tách khỏi RPC method name và luôn có request ID.

### Frontend UX

- Disable/debounce nút Import trong lúc chạy.
- Hiển thị phase và phần trăm khi có tổng size.
- Phân biệt cache hit và download mới.
- Có Cancel nếu từng stage hỗ trợ cancellation an toàn.
- Hiển thị lỗi cho user và request ID cho support.
- Hướng dẫn login lại khi ticket/session hết hạn.

### Native behavior

- CancellationToken cho network/extraction.
- Không cancel scene mutation ở điểm không an toàn.
- Chặn double import theo request ID/asset operation key.
- Nếu WebView reload, operation native phải có policy rõ: tiếp tục và reconcile hoặc cancel.

### Exit criteria

- UI không freeze.
- Không tạo duplicate import từ double-click.
- User hiểu success/failure mà không cần mở MAXScript Listener.

---

## Phase 12 — Security, reliability và observability hardening

### Security

- Exact origin allowlist.
- Runtime schema validation ở JS và C#.
- Explicit method allowlist.
- Không generic script/shell/file bridge.
- Không arbitrary URL/path.
- Import ticket ngắn hạn và chống replay.
- HTTPS bắt buộc ngoài local development.
- Zip-slip/archive bomb tests.
- Log scrub token, cookie, ticket, credential và signed URL.

### Reliability

- Retry network có giới hạn và backoff.
- Không retry scene mutation khi outcome chưa rõ.
- Atomic temp -> verify -> cache.
- Timeout/cancellation per operation.
- Idempotency theo request ID và asset version.
- Reconcile operation nếu WebView reload hoặc disconnect.
- Không để exception vượt qua WebView/native boundary.

### Performance

- Streaming I/O.
- Không giữ asset lớn trong RAM.
- Download/extract background.
- Main thread chỉ giữ đoạn Max API bắt buộc.
- Đo latency, throughput, disk I/O và peak memory bằng asset nhỏ/lớn.

### Observability

- Correlation ID xuyên suốt React -> backend -> bridge -> importer.
- Rolling native log.
- Startup log gồm plugin/Max/WebView version.
- Event stage và duration.
- Diagnostic export cho support.
- Không claim telemetry trước khi có privacy policy.

### Exit criteria

- Happy path và failure matrix quan trọng đều có test.
- Log đủ khoanh vùng lỗi mà không lộ secret.

---

## Phase 13 — Installer, config và update

### Mục tiêu

Cài được trên máy sạch, nâng cấp/rollback được và không phụ thuộc đường dẫn dev.

### Installer

- Cài DLL và native dependencies.
- Cài MAXScript/macro.
- Cài config environment/StartUrl.
- Detect WebView2 Runtime.
- Chạy Evergreen bootstrapper nếu thiếu.
- Tạo uninstall.
- Không overwrite user cache/config ngoài policy.
- Upgrade giữ tương thích protocol/config.
- Rollback khi installation fail.

### Distribution

- Code-sign DLL và installer.
- Version plugin, protocol và installer rõ ràng.
- CI build reproducible.
- Artifact checksum.
- Release notes và rollback package.
- Kênh self-host hay Autodesk App Store phải được chốt trước release.

### Clean-machine test

- Windows version mục tiêu.
- Max 2022 sạch.
- Không có WebView2 Runtime.
- Không có dev tools/dependencies.
- User path có Unicode/space.
- Upgrade từ version trước.
- Uninstall và reinstall.

### Exit criteria

- Installer chạy được trên máy sạch.
- Không còn hard-coded `D:\Project\3d-max`.
- Plugin mở đúng environment URL sau cài đặt.

---

## Phase 14 — End-to-end acceptance và release candidate

### Browser regression

- Website chạy khi không có `window.chrome.webview`.
- Login, catalog, account và download browser không regress.
- Max-only controls không xuất hiện sai trong browser.

### Max functional matrix

- Mở/đóng/reopen panel.
- Reload web.
- Login/logout.
- Session persistence.
- Host detection.
- Scene info/selection.
- Import cache miss.
- Import cache hit.
- Import cùng asset nhiều lần.
- Undo và name collision.

### Failure matrix

- Backend offline.
- Wasabi timeout/reset.
- User chưa mua asset.
- Ticket hết hạn/replay.
- File corrupt/sai checksum.
- Unsafe archive.
- Unsupported format.
- Disk full/cache quota.
- WebView reload giữa operation.
- Max đóng giữa download/import.
- WebView2 Runtime thiếu.

### Definition of Done

- Website 3DS Mood thật chạy trong Max.
- Browser mode không bị hỏng.
- User đăng nhập và browse được.
- Bridge chỉ cấp privilege cho trusted origin.
- Backend xác minh ownership trước import.
- Native tải/cache/verify/import an toàn.
- UI không freeze và có progress/error rõ ràng.
- Không có generic remote-code-execution bridge.
- Installer chạy trên máy sạch.
- Compatibility matrix có bằng chứng test thật.
- Có diagnostic log dùng được cho support.

---

## Quyết định cần chốt theo thời điểm

Các quyết định sau không chặn Phase 1–5 nhưng phải chốt trước phase tương ứng:

| Quyết định | Hạn chốt | Khuyến nghị hiện tại |
|---|---|---|
| Format asset MVP | Trước Phase 8–10 | Một format có asset mẫu thật; ưu tiên `.max` hoặc `.fbx`, package `.zip` nếu cần texture |
| Production load remote hay bundled web | Trước Phase 13 | Dev dùng localhost, production load website HTTPS để web deploy độc lập |
| Floating hay dockable panel | Trước release UI acceptance | Floating để đạt M1 nhanh; dockable là hardening riêng nếu product bắt buộc |
| Email/password hay Google OAuth bắt buộc | Trước Phase 5 exit | Email/password trước; Google là spike riêng |
| Distribution channel | Trước Phase 13 | Chốt self-host hoặc Autodesk App Store |
| Licensing/DRM | Trước khi ổn định installer contract | Quyết định business; không nhét muộn vào bridge |

## Báo cáo bắt buộc cuối mỗi phase

Mỗi phase phải ghi:

- files changed;
- commands/builds/tests đã chạy;
- tested ở browser hay trong Max;
- điều gì đã hoạt động;
- điều gì chỉ mới inspect/chưa verify;
- known limitations;
- assumptions;
- exact next step.

Không dùng một test focused pass để claim toàn bộ milestone đã hoàn thành.
