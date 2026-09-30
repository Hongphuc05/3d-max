# 3ds Max Platform Extension

Nhúng web platform vào Autodesk 3ds Max qua một C#/.NET plugin host chứa WebView2
và một bridge hai chiều, typed, có allowlist giữa JavaScript và Max API.

**Target:** 3ds Max 2022 · .NET Framework 4.8 · sản phẩm thương mại
**Trạng thái:** PoC chạy được — bấm nút trên web thì object hiện ra trong scene Max.
Chi tiết: [docs/phase1-report.md](docs/phase1-report.md)

## Chạy thử

```
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
installer\PlatformSetup.exe          # đóng 3ds Max trước khi chạy
```

Trong Max: `Customize > Customize User Interface > tab Toolbars`, Category `Platform`,
kéo `Mở Platform Design Library` vào một toolbar rồi bấm.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `frontend/` | Trang web chạy trong panel. HTML thuần, không build step |
| `plugin-csharp/` | Plugin host: WebView2 + bridge. Không tham chiếu `Autodesk.Max` |
| `maxscript/` | Handler phía Max + macroscript cho nút toolbar |
| `installer/` | Đóng tất cả thành `PlatformSetup.exe` |
| `docs/` | Quyết định, ma trận version, report |

## Docs

Bắt đầu tại **[docs/README.md](docs/README.md)** để đọc theo đúng thứ tự.

| File | Nội dung |
|---|---|
| [docs/README.md](docs/README.md) | Mục lục và trạng thái hiện tại |
| [docs/decisions.md](docs/decisions.md) | **Đọc đầu tiên.** D1–D4 đã khóa, O1–O5 còn mở, R1–R3 risks |
| [docs/architecture.md](docs/architecture.md) | Ranh giới web platform, native PoC và kiến trúc mục tiêu |
| [docs/current-platform-audit.md](docs/current-platform-audit.md) | Audit stack/flow từ source hiện tại |
| [docs/web-in-3dsmax-integration-plan.md](docs/web-in-3dsmax-integration-plan.md) | Plan chi tiết từ chạy local tới release candidate |
| [docs/phase1-report.md](docs/phase1-report.md) | Đã làm gì, nó chạy thế nào, cách test, bẫy đã dính |
| [docs/compatibility.md](docs/compatibility.md) | Ma trận version — đã điền một phần |
| [spec.md](spec.md) | Kiến trúc, bridge protocol, security, error model |
| [plan.md](plan.md) | Phase 0→8 |
| [roadmap.md](roadmap.md) | Milestone M0→M7 |
| [agent.md](agent.md) | Rules cho coding agent |
| [codex-prompt.md](codex-prompt.md) | Prompt khởi động |

## Bước tiếp theo

Audit source ban đầu đã hoàn thành. Bước tiếp theo là chạy backend/frontend local theo
Phase 1–3 trong [kế hoạch tích hợp](docs/web-in-3dsmax-integration-plan.md). Chưa triển khai
`asset.import` production trước khi có local baseline, asset mẫu và import authorization.
