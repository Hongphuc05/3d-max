# Tài liệu dự án 3DS Mood cho 3ds Max

Hệ thống hiện tại (v3): license cả thư viện theo thiết bị, catalog từ Google Drive → PostgreSQL trên VPS, plugin WebView2 trong 3ds Max, đơn hàng xác nhận qua Telegram.
Cách chạy: [`../apps/README.md`](../apps/README.md). Build plugin + installer: [`../README.md`](../README.md).

| Tài liệu | Nội dung |
|---|---|
| [`v3-architecture.md`](v3-architecture.md) | Kiến trúc, luồng dữ liệu, bảo mật (một phần là lịch sử thiết kế — xem banner đầu file) |
| [`v3-database.md`](v3-database.md) | Mô hình dữ liệu và kế hoạch migration |
| [`decisions.md`](decisions.md) | Quyết định D1–D28 (giữ nguyên làm lịch sử; D26–D28 là hiện hành) |
| [`drive-setup.md`](drive-setup.md) | Thiết lập API key và quét Drive |
| [`p6-runbook.md`](p6-runbook.md) | Triển khai VPS, backup/restore, rollback, nghiệm thu |
| [`STATUS-v3.md`](STATUS-v3.md) | Đã làm tới đâu, việc chưa kiểm chứng, hướng giải quyết |
| [`v3-implementation-plan.md`](v3-implementation-plan.md) | Plan gốc v3 và mục "Bàn giao" (D26) |

Tài liệu cũ (web store, R2, payOS, offline library, PoC…) đã gỡ ở D28.5; xem lại bằng `git show d7d24b3:docs/<tên-file>`.
