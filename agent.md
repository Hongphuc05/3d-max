# AGENT.md — Coding Agent Instructions

## Mission
Tích hợp web platform hiện có vào Autodesk 3ds Max bằng một native C#/.NET host chứa WebView2 và một bridge API tối thiểu, typed, secure giữa JavaScript và 3ds Max.

## Non-negotiable Architecture
```text
Existing Web UI
   <-> MaxBridge TypeScript SDK
   <-> WebView2 message channel
   <-> C# Bridge Router
   <-> Max Adapter
   <-> 3ds Max API

Existing Web UI
   <-> Existing Backend API
```
Không rewrite backend/frontend nếu không có bằng chứng bắt buộc.

## Agent Working Rules
1. Trước khi sửa code, inspect repo và ghi lại stack/cấu trúc thực tế.
2. Không giả định version 3ds Max/.NET/API; xác minh từ project/docs được cung cấp.
3. Làm theo vertical slices nhỏ, build/test sau mỗi slice.
4. Không refactor unrelated code.
5. Không thay auth/backend contract nếu chưa cần.
6. Không hard-code URL production, token, secret, user path.
7. Mọi web input là untrusted.
8. Không tạo bridge method kiểu `executeScript(string)`, `shell(string)`, `readFile(path)` hoặc tương đương.
9. Scene mutation phải qua Max-safe/main-thread dispatcher.
10. Network/file extraction không block UI thread.
11. Giữ browser web app hoạt động khi không có Max host.
12. Khi thiếu thông tin ảnh hưởng kiến trúc, ghi assumption/TODO rõ ràng thay vì invent.

## Suggested Repository Shape
Adapt vào monorepo hiện có; không ép nếu cấu trúc hiện tại khác.
```text
/apps
  /web                     # existing
  /3dsmax-plugin
    /Platform.Max.Host
    /Platform.Max.Bridge
    /Platform.Max.Adapter
/packages
  /max-bridge-web           # TS SDK
/docs
  spec.md
  plan.md
  roadmap.md
```

## Bridge Contract Rules
- Versioned protocol.
- Unique request ID.
- Explicit method allowlist.
- Typed params/results.
- Structured error codes.
- Timeout/cancellation where relevant.
- Event names separate from RPC method names.
- Backward-compatible additions when possible.

## Initial RPC Surface
```text
host.ping
host.getInfo
scene.getInfo
scene.getSelection
scene.createBox        # PoC only
asset.import
```
Do not add methods speculatively.

## Web SDK Behavior
- `isAvailable()` host detection.
- Promise-based `request()`.
- request map keyed by ID.
- timeout cleanup.
- runtime validation for inbound messages.
- browser fallback returns explicit unsupported error.
- UI components never call raw WebView2 APIs directly.

## Native Bridge Behavior
- Validate trusted origin/navigation state before privileged call.
- Deserialize to known DTOs.
- Reject unknown method.
- Validate params.
- Dispatch to service/adapter.
- Catch exception at boundary and map to safe error response.
- Never return stack traces/secrets to JS.

## Asset Security
- Native owns privileged download/import pipeline.
- Asset ID, not arbitrary URL/path, should be primary input.
- Allowlist expected schemes/hosts if URLs are involved.
- Canonicalize paths.
- Zip-slip protection.
- Temp download then verify then atomic move.
- Prefer checksum/version from backend.

## Coding Quality
- Dependency injection where it reduces coupling, not ceremonial abstraction.
- Small interfaces around WebView transport and Max adapter so bridge can be unit-tested outside Max.
- Async I/O.
- CancellationToken for long native operations where practical.
- Structured logging with request ID.
- Nullable/reference safety enabled if project permits.

## Test Priority
1. Bridge serialization/router tests.
2. Origin/unknown-method/invalid-param tests.
3. Safe extraction/path tests.
4. Web SDK request correlation/timeout tests.
5. Max manual smoke test.

## First Implementation Sequence
1. Inspect repo.
2. Create architecture note based on actual stack.
3. Create minimal Max host project.
4. Render local WebView2 page.
5. Implement `host.ping`.
6. Add TS SDK.
7. Implement `scene.createBox`.
8. Implement `scene.getSelection`.
9. Load staging platform route.
10. Only then implement `asset.import`.

## Completion Report Required
At the end of each milestone report:
- files changed
- commands/builds/tests run
- what works
- known limitations
- assumptions
- exact next step
