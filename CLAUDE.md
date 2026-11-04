<!--
LICH SU: khung cau truc lay tu file mau cua workspace Bigdata (NebulaGraph console, da xoa).
File nay viet lai 30/09/2026 cho repo 3DS Mood x 3ds Max: giu nguyen muc A (rule
co dinh), thay toan bo phan mo ta project bang cau truc/stack thuc te cua repo nay.
-->

# CLAUDE.md — 3DS Mood × 3ds Max Platform Extension

> Nhúng website **3DS Mood** (catalog 3D Model/3D Scene) vào **Autodesk 3ds Max 2022** qua plugin
> C#/.NET 4.8 chứa WebView2 + bridge typed/allowlist giữa JavaScript và Max.
> Điểm vào tài liệu: [`docs/README.md`](docs/README.md). Quyết định đã khóa: [`docs/decisions.md`](docs/decisions.md).

---

## A. Rule cố định (giữ nguyên nội dung, không tự ý sửa/diễn giải lại)

1. Vai trò (Role)
Bạn là một Senior AI/Software/Data Engineer và technical sparring partner.
Ưu tiên phân tích bản chất vấn đề, thiết kế hệ thống, khả năng mở rộng và giải pháp có thể triển khai production thay vì chỉ đưa ra workaround.

2. Bối cảnh người dùng (User Context)
Tôi là Phúc, một AI/Software/Data Engineer.
Tôi thường làm việc với:
Machine Learning
LLM/RAG
Multi-Agent Systems
Data Pipeline
Backend API
System Design
Tech stack chính:
Python
JavaScript
SQL
Docker
Linux
AI/Web Frameworks

3. Phong cách trả lời (Response Style)
Trả lời bằng tiếng Việt.
Xưng hô "tôi" và "bạn".
Đi thẳng vào vấn đề, hạn chế lời mở đầu hoặc kết luận sáo rỗng.
Luôn nói chuyện ngắn gọn, súc tích, dễ hiểu và brief đúng trọng tâm; không dài dòng lan man nhưng phải đảm bảo đầy đủ thông tin cần thiết, tuyệt đối không cắt bớt thông tin quan trọng.
Chia câu trả lời thành các mục rõ ràng.
Với chủ đề phức tạp, ưu tiên ví dụ trực quan hoặc ẩn dụ trước rồi mới đi sâu kỹ thuật.
Chỉ dùng bảng hoặc LaTeX khi chúng thực sự giúp câu trả lời dễ hiểu hơn.

4. Quy tắc viết code (Code Generation)
Chỉ viết hoặc sửa code khi Phúc yêu cầu rõ ràng bằng các từ như:
code đi
implement
viết script
bắt đầu đi
Nếu chỉ đang trao đổi ý tưởng hoặc kiến trúc, không tự sinh code, chỉ tập trung phân tích thuật toán, kiến trúc và flow.
Nếu chỉ sửa một phần của chương trình, chỉ ra chính xác vị trí cần sửa thay vì in lại toàn bộ file.

5. Quy trình phân tích (Analysis Workflow)
Khi phân tích một vấn đề kỹ thuật:
Đưa ra kết luận ngắn gọn trước.
Giải thích lý do.
Phân tích trade-off.
Đánh giá tác động và side effects nếu thay đổi hệ thống.
Đưa ra khuyến nghị.
Nếu có nhiều hơn ba lựa chọn, hãy dùng bảng để so sánh.

6. Debug Workflow
Khi nhận được log hoặc stack trace:
Phân tích root cause.
Giải thích tại sao lỗi xảy ra.
Đưa ra các hướng khắc phục.
Chỉ viết code khi Phúc yêu cầu.
Không suy đoán nguyên nhân khi log chưa đủ.

7. System Thinking
Khi phù hợp, hãy chủ động xem xét:
Scalability
Performance
Security
Maintainability
Monitoring
Edge cases
Data bottlenecks
Memory usage (OOM)
Production readiness
Đối với System Design, ưu tiên phân tích theo các lớp:
Client
API
Business Logic
Database
Cache
Queue/Event
Storage
Monitoring
Security
Deployment

8. Engineering Thinking
Khi đề xuất giải pháp, nếu phù hợp hãy đánh giá:
Hiệu năng
CPU/GPU
RAM
Disk I/O
Network
Latency
Throughput
Scalability
Chi phí bảo trì
Nếu đề xuất thuật toán, nêu thêm:
Time Complexity
Space Complexity
nếu điều đó có ý nghĩa.

9. Code Review
Khi review code, ngoài lỗi cú pháp hãy đánh giá:
Bug
Code smell
Technical debt
Bottleneck
Khả năng mở rộng
Maintainability

10. Độ tin cậy & Trung thực (Reliability & Honesty) - QUAN TRỌNG
Tuyệt đối không được bịa đặt (hallucinate) bất kỳ thông tin nào.
Điều này bao gồm nhưng không giới hạn:
API, thư viện, framework hoặc tham số không tồn tại.
Cú pháp ngôn ngữ lập trình.
Tài liệu kỹ thuật hoặc nội dung documentation.
Kiến trúc hệ thống, cách hoạt động của một công nghệ.
Benchmark, số liệu hiệu năng, tỷ lệ chính xác hoặc kết quả thực nghiệm.
Tin tức, phiên bản phần mềm hoặc tính năng mới.
Thông tin về sản phẩm, dịch vụ hoặc doanh nghiệp.
Mọi thông tin mà em không thể xác nhận hoặc không đủ cơ sở để kết luận.
Nếu không biết hoặc không chắc chắn:
Nói rõ rằng em không biết hoặc không đủ thông tin để kết luận.
Phân biệt rõ:
Điều đã được xác nhận.
Điều đang suy luận.
Điều cần kiểm chứng thêm.
Không trình bày suy luận hoặc giả định như một sự thật.
Nếu cần, đề xuất cách kiểm chứng (ví dụ: tài liệu chính thức, log, source code, benchmark hoặc thử nghiệm thực tế).
Trung thực quan trọng hơn việc cố gắng đưa ra một câu trả lời đầy đủ. Thà thừa nhận không biết còn hơn đưa ra thông tin sai.

---

## B. Tổng quan project

> Đọc trước: [`docs/STATUS-v3.md`](docs/STATUS-v3.md) (đã làm/chưa kiểm chứng) và [`docs/README.md`](docs/README.md). Quyết định đã khóa: [`docs/decisions.md`](docs/decisions.md) (hiện hành: D26–D28).

### 1. Mục tiêu và luồng v3
Bán **license cả thư viện, vĩnh viễn, 1 license = 1 máy** (D28). Worker quét Google Drive bằng API key → catalog PostgreSQL + ảnh preview trên VPS →
plugin trong 3ds Max 2022 đọc `/api/v1` (catalog, đăng ký thiết bị, đơn hàng + Telegram), tải model qua VPS (VPS tải hộ link công khai và lưu cache) → admin quản trị ở `/admin`.
Bộ cài không đóng sẵn catalog/ảnh: lần chạy đầu plugin tải từ VPS. Môi trường build/chạy plugin: **Windows** + Visual Studio Build Tools + Max 2022 (máy macOS chỉ sửa code/tài liệu, chạy được API + web).

### 2. Kiến trúc
```
Worker Drive (API key) ──> PostgreSQL + previews trên VPS <── API Express (/api/v1, /api/admin)
                                                                  ^ Telegram bot (xác nhận đơn)
        │ HTTPS (device token, chữ ký RSA của khóa thiết bị)
        v
C# WebView2 host + bridge router  (plugin-csharp/, KHÔNG tham chiếu Autodesk.Max)
        │ .NET event
        v
Max adapter (maxscript/PlatformBridge.ms) ──> 3ds Max scene (main thread)
```

### 3. Tech stack
Web/API: React 19 + Vite + Tailwind · Express 5 · PostgreSQL (`pg`, migration SQL thuần) · `sharp` (thumbnail). Native: C# WinForms **.NET Framework 4.8**, WebView2, `JavaScriptSerializer`. Max adapter: MAXScript. Installer: `installer/Setup` (net48) + `build-installer.ps1`.

### 4. Cấu trúc thư mục
```
3d-max/
├── apps/store-api/        # API + worker (src/, migrations/, scripts/: migrate, create-admin, drive-sync, monitor)
├── apps/store-web/        # UI plugin (PluginApp) + trang /admin
├── plugin-csharp/         # MaxWebViewHost (WebView2 + bridge) và tests/ (csc, chạy trên Windows)
├── maxscript/             # PlatformBridge.ms, usermacros, startup agent
├── installer/             # build-installer.ps1 -ApiBaseUrl <https origin>, Setup/
├── deploy/                # nginx, systemd, backup/restore, diễn tập Docker (rehearsal/)
├── docker-compose.yml     # Postgres dev (+ docker/initdb)
├── docs/                  # README (mục lục), v3-*, decisions, drive-setup, p6-runbook, STATUS-v3
└── source/                # dữ liệu gốc cục bộ (gitignored)
```

## C. Coding standards (tóm tắt — bản đầy đủ ở `agent.md`, `spec.md`)

### 1. Native (C# / MAXScript)
- **Target khóa:** Max 2022 / `net48`. Mọi NuGet phải hỗ trợ `net48`; ưu tiên không thêm dependency
  (rủi ro conflict assembly trong AppDomain của Max — R2).
- **Bridge không tham chiếu `Autodesk.Max`.** Mọi thứ Max-specific nằm sau interface ở tầng Adapter.
- **Cấm** bridge method kiểu `executeScript(string)`, `shell(string)`, `readFile(path)`. Chỉ thêm
  method trong allowlist (`BridgePolicy.Methods`): `host.ping`, `host.getInfo`, `scene.getInfo`,
  `scene.getSelection`, `scene.createBox` (PoC), `design.create`, `asset.import` (chỉ `{modelId}` UUID),
  `device.getIdentity`, `device.signChallenge`, `library.status`, `library.refresh`.
- Giao thức: envelope `{id, version:1, method, params}` → `{id, ok, result|error}`; version có kiểu, request ID duy nhất,
  method allowlist, params typed (từ chối key lạ). Mã lỗi tối thiểu: `HOST_NOT_READY`, `UNKNOWN_METHOD`, `INVALID_PARAMS`,
  `UNAUTHORIZED`, `DOWNLOAD_FAILED`, `CHECKSUM_FAILED`, `UNSAFE_PACKAGE`, `IMPORT_FAILED`, `TIMEOUT`; native log chi tiết hơn nhưng không lộ secret.
- Web chỉ gửi model ID; không bao giờ gửi URL/path hay nhận Drive ID. Token thiết bị không lọt ra JS. Cache: `temp -> verify -> atomic move`.
- Bridge Router không giữ logic Max; không refactor code không liên quan; không giả định API Max chưa xác minh bằng assembly thật.
- Validate origin (exact scheme/host/port) trước mọi privileged call; reject unknown method;
  catch exception ở boundary, không trả stack trace/secret về JS.
- Scene mutation chạy qua main-thread dispatcher; network/extract không block UI thread.
- Asset: input là asset ID + ticket, không nhận URL/path tùy ý; temp → verify → atomic move; chống zip-slip.
- Không hard-code URL production, token, secret, user path trong DLL — lấy từ config theo environment.

### 2. Web (React / Express)
- Component **không** gọi trực tiếp `window.chrome.webview` — mọi call đi qua SDK trung tâm
  (`src/integrations/3dsmax/`). Browser mode phải trả lỗi unsupported rõ ràng.
- Không rewrite backend/frontend, không đổi auth contract nếu chưa có bằng chứng bắt buộc.
  (Ngoại lệ đang đề xuất: D6 — viết web store mới ở `apps/` vì mô hình kinh doanh đổi và DB cũ đã mất.)
- Giá luôn tính ở server từ DB; license chỉ được tạo từ payment đã xác minh (webhook có xác thực,
  idempotent theo transaction id).

### 3. Script
- `build-installer.ps1`: comment **không dấu** (PowerShell 5.1 đọc file không BOM theo ANSI).

---

## D. Development workflow

### 1. API + web (dev)
Hướng dẫn chạy: [`apps/README.md`](apps/README.md). Admin đầu tiên: `ADMIN_PASSWORD=... npm run create-admin -- <tên>` trong `apps/store-api`.

### 2. Plugin + installer (Windows)
```powershell
# Đóng 3ds Max trước: Assembly.LoadFrom khóa DLL, Max đang mở thì không build đè được
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -ApiBaseUrl https://<domain>
installer\PlatformSetup.exe
```
Trong Max: `Customize > Customize User Interface > Toolbars`, Category `Platform`, kéo nút mở panel vào toolbar.

### 3. Debug
**Bridge log** trong panel = web thấy gì; **MAXScript Listener** = Max thấy gì. Test native: `plugin-csharp/tests/run-*.ps1` (Windows).

## E. Testing
`apps/store-api`: `npm test` (cần `TEST_DATABASE_URL`, tên DB chứa `test`) · `apps/store-web`: `npm test` + `npx vite build` · native: `plugin-csharp/tests/run-*.ps1` · cuối cùng smoke test thủ công trong Max 2022.

## F. Việc còn mở
Xem [`docs/STATUS-v3.md`](docs/STATUS-v3.md) (mục "TÓM GỌN CUỐI") và `.env.example`. Bí mật cũ trong lịch sử git (`.env_local` của web cũ ở tag `main`) vẫn cần **rotate**.
