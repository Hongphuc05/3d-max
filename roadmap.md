# ROADMAP — 3ds Max Platform Extension

> Milestone-based, không ép ngày trước khi audit repo/platform.
> Target: **Max 2022 / .NET 4.8**. Sản phẩm thương mại → M5 là bắt buộc, không phải optional.
> Xem [`docs/decisions.md`](docs/decisions.md).

## M0 — Technical Feasibility
**Goal:** chứng minh Max có thể host web UI.
- [x] Chốt target Max version → **2022 / .NET Framework 4.8** ([D1](docs/decisions.md#d1--target-3ds-max-2022-locked))
- [x] Audit source platform bước đầu → `docs/current-platform-audit.md` (runtime vẫn chưa verify)
- [ ] C# plugin skeleton (`net48`) build và load được trong Max 2022
- [ ] Dockable panel (dock/undock/reopen/DPI)
- [ ] WebView2 render local page
- [ ] Điền `docs/compatibility.md`, hết ô `?`
- [ ] Verify [R2](docs/decisions.md#r2--assembly-conflict-trong-appdomain-của-max) assembly conflict
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
**Bắt buộc** — sản phẩm thương mại ([D3](docs/decisions.md#d3--mục-tiêu-sản-phẩm-thương-mại-locked)).
- [ ] WebView2 Runtime vắng mặt → lỗi có nghĩa, không crash Max
- [ ] code signing DLL + installer
- [ ] diagnostic log export cho support
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
