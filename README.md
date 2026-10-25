# 3ds Max Platform Extension

Nhúng web platform vào Autodesk 3ds Max qua một C#/.NET plugin host chứa WebView2
và một bridge hai chiều, typed, có allowlist giữa JavaScript và Max API.

**Mô hình:** một license Lifetime/tài khoản, tối đa hai thiết bị cố định; thanh toán payOS đã xác minh hoặc admin cấp thử.
**Target:** 3ds Max 2022 · .NET Framework 4.8 · sản phẩm thương mại
**Source hiện tại:** React/Vite, Express/PostgreSQL, C# CNG/DPAPI + WebView2.
**Online catalog:** [Google Drive → PostgreSQL, preview cache và licensed streaming](docs/google-drive-catalog.md).
Hướng dẫn mới: **[License + payOS setup](docs/license-payos-setup.md)** · **[API](docs/license-payos-api.md)** ·
**[Báo cáo triển khai](LICENSE_PAYOS_IMPLEMENTATION_REPORT.md)**. Roadmap cũ về license từng model được thay bởi D11.

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
| `source/3DSMOOD/` | Dữ liệu catalog gốc (360 sản phẩm, ~10 GB), gitignored |
| `apps/` | Web store mới — `store-web`, `store-api` (Phase A). Cách chạy: [apps/README.md](apps/README.md) |
| `frontend/` | Trang demo/diagnostic của PoC. HTML thuần, không build step |
| `plugin-csharp/` | Plugin host: WebView2 + bridge. Không tham chiếu `Autodesk.Max` |
| `maxscript/` | Handler phía Max + macroscript cho nút toolbar |
| `installer/` | Đóng tất cả thành `PlatformSetup.exe` |
| `docs/` | Quyết định, ma trận version, report |

## Docs

Bắt đầu tại **[docs/README.md](docs/README.md)** để đọc theo đúng thứ tự.

| File | Nội dung |
|---|---|
| [docs/README.md](docs/README.md) | Mục lục và trạng thái hiện tại |
| [docs/STATUS.md](docs/STATUS.md) | **Tiến độ**: đã làm tới đâu, còn gì (checklist) |
| [docs/product-roadmap.md](docs/product-roadmap.md) | **Plan tổng**: tech stack, license, Phase A (web) → Phase B (Max) |
| [docs/decisions.md](docs/decisions.md) | D1–D8 (khóa/đề xuất), O1–O8 còn mở, R1–R8 risks |
| [docs/architecture.md](docs/architecture.md) | Ranh giới web platform, native PoC và kiến trúc mục tiêu |
| [docs/current-platform-audit.md](docs/current-platform-audit.md) | Audit stack/flow từ source hiện tại |
| [docs/web-in-3dsmax-integration-plan.md](docs/web-in-3dsmax-integration-plan.md) | Plan chi tiết từ chạy local tới release candidate |
| [docs/phase1-report.md](docs/phase1-report.md) | Đã làm gì, nó chạy thế nào, cách test, bẫy đã dính |
| [docs/compatibility.md](docs/compatibility.md) | Ma trận version — đã điền một phần |
| [spec.md](spec.md) | Kiến trúc, bridge protocol, security, error model |
| [plan.md](plan.md) | Phase 0→8 (cũ, đã thay thế) |
| [roadmap.md](roadmap.md) | Milestone M0→M7 (cũ, đã thay thế) |
| [agent.md](agent.md) | Rules cho coding agent |
| [codex-prompt.md](codex-prompt.md) | Prompt khởi động |

## Bước tiếp theo

Cấu hình secrets, giá Lifetime và webhook HTTPS theo [hướng dẫn](docs/license-payos-setup.md).
Không tạo giao dịch thật hoặc đăng ký webhook production trong bộ test tự động.
