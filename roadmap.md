# ROADMAP — 3ds Max Platform Extension

> Milestone-based, không ép ngày trước khi audit repo/platform.

## M0 — Technical Feasibility
**Goal:** chứng minh Max có thể host web UI.
- [ ] Chốt target Max version
- [ ] C# plugin skeleton
- [ ] Dockable panel
- [ ] WebView2 render local page
- [ ] Load staging web page
- [ ] Startup diagnostics

**Demo:** `Platform` panel hiện web page trong 3ds Max.

## M1 — Bidirectional Bridge
**Goal:** web/native giao tiếp có contract.
- [ ] request/response envelope
- [ ] correlation ID
- [ ] timeout/error model
- [ ] origin validation
- [ ] TS Max SDK
- [ ] `host.ping`
- [ ] `host.getInfo`

**Demo:** web hiển thị Max/plugin version lấy từ native.

## M2 — 3ds Max Control
**Goal:** bridge thực sự điều khiển scene.
- [ ] main-thread dispatcher
- [ ] `scene.createBox`
- [ ] `scene.getSelection`
- [ ] `scene.getInfo`
- [ ] reload/reopen tests

**Demo:** nút `Create Cube` trên web tạo cube trong scene.

## M3 — Existing Platform Embedded
**Goal:** platform thật chạy trong panel.
- [ ] extension route/mode
- [ ] auth works
- [ ] search/browse works
- [ ] browser mode vẫn hoạt động
- [ ] privileged origin allowlist

**Demo:** login và browse asset trong Max.

## M4 — First Real Asset Import
**Goal:** feature có giá trị thực đầu tiên.
- [ ] metadata API adapter
- [ ] native download manager
- [ ] cache
- [ ] integrity verification
- [ ] safe extraction
- [ ] import adapter
- [ ] progress events
- [ ] retry/error UX

**Demo:** `Import` một asset thật vào scene.

## M5 — Production Hardening
- [ ] offline/error matrix
- [ ] expired session
- [ ] corrupted package
- [ ] unsafe archive tests
- [ ] performance test
- [ ] installer
- [ ] versioning/update
- [ ] support logs
- [ ] CI build

## M6 — Material/Renderer Integration
Nếu cần:
- [ ] renderer detection
- [ ] Physical Material
- [ ] Corona adapter
- [ ] V-Ray adapter
- [ ] texture remap
- [ ] material preview/apply

## M7 — Platform SDK Generalization
Chỉ sau khi Max integration ổn:
```text
platform-extension-sdk/
  core/
  3dsmax/
  future-blender/
  future-sketchup/
```
Chuẩn hóa capability names, host detection và shared web API để mở đường cho DCC khác.

## Definition of Done cho mỗi milestone
- build reproducible
- code reviewable
- không hard-code secrets
- logs đủ debug
- test happy path + ít nhất 2 failure paths
- docs cập nhật cùng code
