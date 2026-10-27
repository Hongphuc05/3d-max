# Tài liệu dự án 3DS Mood cho 3ds Max

## Hướng dẫn hiện tại

Luồng hiện tại dùng license vĩnh viễn theo mã máy, xác minh offline. Chủ sở hữu tự xử lý
thanh toán và cấp license bên ngoài plugin. Google Drive là nguồn chuẩn của model; catalog
và preview được đóng gói trực tiếp trong plugin; thay đổi thư viện cần phát hành bộ cài mới.

| Thứ tự | Tài liệu | Mục đích |
|---:|---|---|
| 1 | [`offline-library.md`](offline-library.md) | Hướng dẫn catalog, license, cài đặt, import và trạng thái kiểm thử |
| 2 | [`admin-web-handoff-vi.md`](admin-web-handoff-vi.md) | Hướng dẫn chủ sở hữu mở trang admin và cấp license |
| 3 | [`customer-handoff-vi.md`](customer-handoff-vi.md) | Hướng dẫn ngắn để gửi cùng bộ cài cho khách |
| 4 | [`../tools/license-owner/README.md`](../tools/license-owner/README.md) | Tạo khóa riêng và cấp license bằng CLI |
| 5 | [`../apps/license-admin/README.md`](../apps/license-admin/README.md) | Cấu hình giao diện admin Vercel và cấp license |
| 6 | [`../README.md`](../README.md) | Build plugin và thông tin repo |

## Trạng thái ngày 2026-10-27

| Hạng mục | Trạng thái |
|---|---|
| Catalog | 360 mục/model và ảnh preview đóng gói; đã đối chiếu ID model với root Drive |
| Nguồn dữ liệu | Root Drive là chuẩn; thư mục tải cục bộ `3DSMOOD` có 71 archive và 75 ảnh, không đại diện toàn bộ inventory của root |
| License | Xác minh RSA offline; khóa production 3072-bit đã tạo; public XML và hai biến User đã cấu hình |
| Admin web | Đăng nhập và ký license qua server; không dùng để cập nhật catalog |
| Drive | Lần quét metadata mới xác nhận root có 360 model trong 126 folder; lần kiểm tra trước xác nhận các file ID công khai có thể tải |
| E2E trong Max | Lần kiểm tra trước dùng kiến trúc Pages, không chứng minh bản đóng gói mới |
| Cập nhật | Thay đổi thư viện cần build lại plugin và gửi bộ cài mới |

## Tài liệu lịch sử

Các tài liệu bên dưới ghi lại phương án cũ về web store, đăng nhập, thanh toán tự động và
backend. Chúng hữu ích để tra cứu quyết định trước đây nhưng không mô tả luồng plugin hiện tại.

| Tài liệu | Nội dung |
|---|---|
| [`STATUS.md`](STATUS.md) | Checklist và trạng thái của kế hoạch web store cũ |
| [`product-roadmap.md`](product-roadmap.md) | Roadmap và mô hình thanh toán trước đây |
| [`decisions.md`](decisions.md) | Quyết định kiến trúc lịch sử |
| [`architecture.md`](architecture.md) | Ranh giới web store và native host |
| [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) | Kế hoạch tích hợp giai đoạn trước |
| [`compatibility.md`](compatibility.md) | Ma trận tương thích ban đầu |
| [`phase1-report.md`](phase1-report.md) | Báo cáo PoC WebView2/MAXScript |
| [`current-platform-audit.md`](current-platform-audit.md) | Audit website cũ |

Tài liệu cấp repo: [`../spec.md`](../spec.md), [`../agent.md`](../agent.md),
[`../plan.md`](../plan.md), [`../roadmap.md`](../roadmap.md).
