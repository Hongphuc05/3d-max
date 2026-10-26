# Tài liệu dự án 3DS Mood cho 3ds Max

**Cấu hình hiện tại:** [R2 polling catalog và SSE](r2-catalog.md) · [License Lifetime + payOS](license-payos-setup.md). Phần định hướng 2026-10-06 bên dưới được giữ làm lịch sử; R2 thay nguồn Drive/local và Lifetime thay license từng model.

> Cập nhật: 2026-10-06

**Hướng đi hiện tại (D5):** bán license từng model 3D (15.000 VND/sản phẩm), import thẳng vào
3ds Max. Làm theo hai phase:

- **Phase A — Web store (FE + BE)** từ dữ liệu `source/3DSMOOD/`: catalog, xem preview, auth,
  thanh toán, cấp license.
- **Phase B — Kết nối 3ds Max:** nâng PoC WebView2/bridge hiện có để chạy với web store thật và
  import asset đã có license.

## Thứ tự đọc

| Thứ tự | Tài liệu | Mục đích |
|---:|---|---|
| 0 | [`STATUS.md`](STATUS.md) | **Đã làm tới đâu, còn gì** (checklist, cập nhật mỗi khi xong việc) |
| 0b | [`download-queue-plan.md`](download-queue-plan.md) | Plan cho người làm Windows: hàng đợi Download, tiến độ, hủy, cache (native + backend) |
| 1 | [`product-roadmap.md`](product-roadmap.md) | **Plan tổng**: dữ liệu nguồn, tech stack, mô hình license, Phase A/B |
| 2 | [`decisions.md`](decisions.md) | Quyết định đã khóa và đề xuất (D1–D8), câu hỏi mở (O1–O8), rủi ro |
| 3 | [`architecture.md`](architecture.md) | Ranh giới web store và 3ds Max host |
| 4 | [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) | Chi tiết kỹ thuật Phase B (host, bridge, download, import) |
| 5 | [`compatibility.md`](compatibility.md) | Ma trận tương thích và những gì còn phải test thật |
| 6 | [`phase1-report.md`](phase1-report.md) | Báo cáo PoC DLL/WebView2/MAXScript đã chạy |
| 7 | [`current-platform-audit.md`](current-platform-audit.md) | Audit website cũ `web/` (đã xóa, xem bằng nhánh `main`) |

## Tài liệu cấp repo

| Tài liệu | Vai trò |
|---|---|
| [`../spec.md`](../spec.md) | Protocol bridge, security boundary, error model, acceptance criteria |
| [`../agent.md`](../agent.md) | Quy tắc bắt buộc khi agent làm việc với repo |
| [`../plan.md`](../plan.md), [`../roadmap.md`](../roadmap.md) | Kế hoạch high-level **cũ**, đã được thay bằng `product-roadmap.md` |

Nếu tài liệu mâu thuẫn, ưu tiên theo thứ tự:

1. `decisions.md` cho các quyết định đã khóa.
2. `product-roadmap.md` cho hướng đi và thứ tự triển khai.
3. Source code hiện tại cho hành vi đang tồn tại.
4. `web-in-3dsmax-integration-plan.md` cho chi tiết Phase B.
5. Các tài liệu cũ (`plan.md`, `roadmap.md`, `current-platform-audit.md`).

## Trạng thái hiện tại

| Hạng mục | Trạng thái |
|---|---|
| Dữ liệu catalog | 360 sản phẩm trong `source/3DSMOOD/` (đã khảo sát, chưa ingest) |
| Web store mới (Phase A) | Chưa bắt đầu; D6 (app mới) đã chốt, D7 (PostgreSQL) chờ chốt |
| Website cũ `web/` | Đã xóa khỏi repo 2026-10-06; tra lại bằng nhánh `main` |
| PoC WebView2 trong Max | Đã chạy trên máy dev với `frontend/index.html` demo |
| Kết nối web thật ↔ Max, import asset | Chưa triển khai (Phase B) |
| Installer production | Chưa có signing, update/rollback, clean-machine test |

## Goal cuối

Trong 3ds Max 2022, user mở panel 3DS Mood, đăng nhập, duyệt catalog, thanh toán một sản phẩm
và được cấp license tự động. Sau đó bấm **Import** thì model xuất hiện trong scene mà Max không
bị treo. Web store vẫn chạy bình thường trong browser (xem, mua, quản lý thư viện).
