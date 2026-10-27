# 3ds Max Platform Extension

Nhúng web platform vào Autodesk 3ds Max qua một C#/.NET plugin host chứa WebView2
và một bridge hai chiều, typed, có allowlist giữa JavaScript và Max API.

**Mô hình hiện tại:** license vĩnh viễn theo mã máy, xác minh offline; chủ sở hữu xác nhận chuyển khoản và cấp license riêng.
**Target:** 3ds Max 2022 · .NET Framework 4.8 · React/Vite + C# WebView2.
**Thư viện:** danh sách và ảnh được đóng gói trong plugin; model tải từ Google Drive khi import.

Hướng dẫn vận hành hiện tại: **[License offline và cập nhật thư viện](docs/offline-library.md)**.
Các tài liệu R2/payOS và backend được giữ để tham khảo hệ thống cũ, không thuộc luồng khách hàng mới.

## Build và cài đặt

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 `
  -LicensePublicKeyPath 'C:\LibraryOwnerKeys\library-public.xml'
installer\PlatformSetup.exe
```

Tạo khóa và cấp license bằng [CLI nội bộ](tools/license-owner/README.md) hoặc triển khai [giao diện admin Vercel](apps/license-admin/README.md); private key luôn ở ngoài repo và bộ cài.
Đóng Max trước khi cài. Trong Max: `Customize > Customize User Interface > Toolbars`, Category `Platform`,
kéo nút mở thư viện vào toolbar. Khách copy mã máy, nhận license từ chủ sở hữu và dán vào plugin.
UI, danh sách, preview và xác minh license dùng offline; tải model từ Drive cần mạng.

Catalog đóng gói có 360 model. Thay đổi model hoặc preview cần build và bàn giao plugin mới. Xem [hướng dẫn thư viện](docs/offline-library.md) và [cấu hình admin web](apps/license-admin/README.md).
## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `library/` | Schema, validator, catalog và preview đóng gói trong plugin |
| `tools/license-owner/` | Công cụ nội bộ tạo khóa và cấp license; không đóng gói cho khách |
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
| [docs/STATUS.md](docs/STATUS.md) | Checklist của kế hoạch web store cũ |
| [docs/product-roadmap.md](docs/product-roadmap.md) | Roadmap kiến trúc lịch sử; luồng hiện tại ở `docs/offline-library.md` |
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

Thực hiện các bước cấu hình chủ sở hữu còn thiếu trong [hướng dẫn thư viện](docs/offline-library.md).
