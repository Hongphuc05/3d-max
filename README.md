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

| File | Nội dung |
|---|---|
| [docs/decisions.md](docs/decisions.md) | **Đọc đầu tiên.** D1–D4 đã khóa, O1–O5 còn mở, R1–R3 risks |
| [docs/phase1-report.md](docs/phase1-report.md) | Đã làm gì, nó chạy thế nào, cách test, bẫy đã dính |
| [docs/compatibility.md](docs/compatibility.md) | Ma trận version — đã điền một phần |
| [spec.md](spec.md) | Kiến trúc, bridge protocol, security, error model |
| [plan.md](plan.md) | Phase 0→8 |
| [roadmap.md](roadmap.md) | Milestone M0→M7 |
| [agent.md](agent.md) | Rules cho coding agent |
| [codex-prompt.md](codex-prompt.md) | Prompt khởi động |

## Blocker hiện tại

Chưa audit repo web platform. Không viết bridge method nào phụ thuộc asset API
trước khi có `docs/current-platform-audit.md`.
