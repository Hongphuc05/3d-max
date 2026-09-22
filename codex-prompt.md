# Prompt cho Codex

Tôi có một web platform đã hoạt động và muốn tích hợp nó thành plugin/extension chạy trực tiếp trong Autodesk 3ds Max. Mục tiêu KHÔNG phải rewrite platform. Hãy coi 3ds Max là một host/client mới của hệ thống hiện tại.

Kiến trúc mục tiêu:

Existing Web Frontend <-> Existing Backend/API/Storage tiếp tục hoạt động như hiện tại.

Trong 3ds Max, xây một C#/.NET plugin host có dockable panel chứa WebView2 để load web platform (ưu tiên một route/mode dành cho 3ds Max). Tạo một bridge hai chiều:

Web UI -> TypeScript MaxBridge SDK -> WebView2 JSON message -> C# Bridge Router -> 3ds Max Adapter/API

và response/event theo chiều ngược lại.

Yêu cầu quan trọng:
- Reuse tối đa frontend/backend/auth hiện tại.
- Không tạo WPF frontend thứ hai nếu không bắt buộc.
- Không để UI gọi trực tiếp `window.chrome.webview` ở nhiều nơi; tạo một TypeScript SDK riêng.
- Bridge dùng protocol versioned, request ID, typed params/result, structured errors, timeout.
- Initial methods: `host.ping`, `host.getInfo`, `scene.getInfo`, `scene.getSelection`, `scene.createBox` (chỉ PoC), sau đó `asset.import`.
- Native side phải dùng explicit allowlist cho method và validate toàn bộ params.
- Tuyệt đối không expose generic `executeMaxScript`, arbitrary shell command, arbitrary file read/write, hoặc remote code execution primitive cho web.
- Chỉ origin của platform được phép có privileged bridge access. Navigation ngoài allowlist không được quyền gọi native capabilities.
- Scene mutation phải chạy theo cơ chế main/UI thread an toàn của 3ds Max; network/download/unzip phải chạy background để không freeze UI.
- Với `asset.import`, web chỉ nên gửi `assetId`; native plugin lấy metadata/download authorization từ backend hiện tại, download vào temp/cache, verify checksum/version nếu có, extract an toàn chống path traversal, rồi import vào scene.
- Không hard-code secret, token, production URL hoặc user-specific filesystem path.
- Website bình thường phải tiếp tục chạy được ngoài 3ds Max; Max SDK cần detect host và trả unsupported rõ ràng khi chạy trong browser.
- Thiết kế code sao cho bridge/router có thể unit-test ngoài 3ds Max bằng fake/mock Max adapter.
- `Platform.Max.Bridge` không được tham chiếu type nào của `Autodesk.Max`. Đây là điều kiện để sau này nâng lên Max 2025+/.NET 8 mà không viết lại protocol.
- Đây là sản phẩm thương mại: installer, code signing, update và diagnostic log là in-scope, không phải "nice to have".

Cách làm việc:
1. ĐẦU TIÊN hãy inspect toàn bộ repo liên quan và xác định stack thực tế: frontend framework, backend, auth, routing, asset APIs, download flow, project structure, target framework hiện có. Không đoán nếu repo đã có câu trả lời.
2. Đọc `docs/decisions.md` TRƯỚC, rồi `spec.md`, `plan.md`, `roadmap.md`, `agent.md` và tuân thủ chúng. Nếu tài liệu mâu thuẫn với code thực tế, báo rõ trước khi thay đổi kiến trúc.
3. Target đã khóa: **3ds Max 2022, .NET Framework 4.8 (`net48`)** — xem `docs/decisions.md`. Không hỏi lại, không đổi. Nhưng các API cụ thể của Max thì phải xác minh từ assembly thật (`Autodesk.Max.dll`, `MaxCustomControls.dll`), không bịa signature.
4. Lập implementation plan ngắn theo milestone và liệt kê files dự kiến tạo/sửa.
5. Implement theo vertical slice, không làm tất cả một lần.

Milestone đầu tiên cần hoàn thành:
- C# 3ds Max plugin skeleton có thể build.
- Dockable panel.
- WebView2 load một local test page hoặc staging route.
- Bridge request/response cơ bản.
- `host.ping`.
- TypeScript MaxBridge SDK phía web.
- `scene.createBox`: bấm nút trong web -> bridge -> native -> tạo cube/box trong current 3ds Max scene -> response về web.
- `scene.getSelection`.
- Logging tối thiểu với request/correlation ID.
- Tests cho protocol/router/TS request correlation nếu có thể chạy ngoài Max.

Sau khi milestone PoC pass, mới tiếp tục:
- nhúng route thật của platform + auth;
- `asset.import(assetId)`;
- download/cache/integrity/safe extraction;
- import asset thật;
- progress events và error UX;
- production hardening/installer/update.

Definition of done cho PoC:
- plugin load được trên target Max;
- panel dock/undock/reopen không crash;
- web -> C# -> Max -> web round-trip hoạt động;
- nút Create Cube tạo object thật trong scene;
- Get Selection trả đúng dữ liệu;
- web reload không crash native plugin;
- unknown method/invalid params bị reject có structured error;
- không có generic remote execution bridge;
- browser version của platform không bị hỏng.

Trong quá trình làm, ưu tiên code đơn giản, testable và production-oriented. Không over-engineer, không refactor phần không liên quan. Sau mỗi milestone, báo: files changed, commands/tests đã chạy, kết quả, limitation, assumptions và next step.

Bắt đầu bằng việc inspect repo và trả về: (1) current architecture, (2) compatibility/blockers, (3) proposed file structure dựa trên repo thật, (4) implementation plan cho PoC. Sau đó mới bắt đầu sửa code.
