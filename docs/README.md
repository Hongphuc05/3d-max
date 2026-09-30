# Tài liệu dự án 3DS Mood cho 3ds Max

> Cập nhật: 2026-09-30

Thư mục này là điểm bắt đầu để hiểu dự án. Repo gồm hai phần độc lập về trách nhiệm:

1. **Website 3DS Mood thật** trong [`../web`](../web).
2. **PoC kết nối WebView2/DLL với 3ds Max** trong `plugin-csharp/`, `maxscript/`,
   `frontend/` và `installer/`.

Mục tiêu tiếp theo là thay trang HTML demo của PoC bằng website 3DS Mood thật, sau đó
nối chức năng import asset qua bridge có kiểm soát.

## Thứ tự đọc

| Thứ tự | Tài liệu | Mục đích |
|---:|---|---|
| 1 | [`decisions.md`](decisions.md) | Các quyết định đã khóa, câu hỏi còn mở và rủi ro kiến trúc |
| 2 | [`architecture.md`](architecture.md) | Cấu trúc repo, ranh giới giữa web platform và 3ds Max host |
| 3 | [`current-platform-audit.md`](current-platform-audit.md) | Stack và flow đã xác nhận từ source code hiện tại |
| 4 | [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) | Kế hoạch triển khai từng phase đến goal cuối |
| 5 | [`compatibility.md`](compatibility.md) | Ma trận tương thích và những gì còn phải test thật |
| 6 | [`phase1-report.md`](phase1-report.md) | Báo cáo PoC DLL/WebView2/MAXScript đã chạy trước đây |

## Tài liệu cấp repo

Các tài liệu sau vẫn nằm ở root vì được dùng như contract tổng quát:

| Tài liệu | Vai trò |
|---|---|
| [`../spec.md`](../spec.md) | Protocol, security boundary, error model và acceptance criteria tổng quát |
| [`../plan.md`](../plan.md) | Kế hoạch high-level ban đầu |
| [`../roadmap.md`](../roadmap.md) | Milestone high-level ban đầu |
| [`../agent.md`](../agent.md) | Quy tắc bắt buộc khi agent làm việc với repo |

Nếu tài liệu cũ mâu thuẫn với source code hoặc kế hoạch tích hợp mới, ưu tiên theo thứ tự:

1. `decisions.md` cho các quyết định đã khóa.
2. Source code hiện tại cho hành vi đang tồn tại.
3. `current-platform-audit.md` cho kết quả kiểm tra source.
4. `web-in-3dsmax-integration-plan.md` cho thứ tự triển khai mới.
5. Các tài liệu high-level cũ.

## Trạng thái hiện tại

| Hạng mục | Trạng thái |
|---|---|
| Website 3DS Mood | Có source frontend/backend trong `web/`; chưa chạy smoke test local trong đợt audit này |
| PoC WebView2 trong Max | Đã được báo cáo chạy trên máy dev; vẫn dùng `frontend/index.html` demo |
| Website thật trong Max | Chưa triển khai |
| Bridge React ↔ C# ↔ Max | Chưa tích hợp vào website thật |
| Import asset production | Chưa triển khai |
| Installer production | Chưa hoàn thiện signing, update/rollback và clean-machine test |

## Goal cuối

Trong 3ds Max 2022, user mở panel 3DS Mood, đăng nhập và duyệt website thật, sau đó
bấm **Import vào 3ds Max** để backend xác minh quyền sở hữu, native host tải/cache/verify
asset và import vào scene mà không làm UI bị treo. Website vẫn phải chạy bình thường
trong browser khi không có Max host.
