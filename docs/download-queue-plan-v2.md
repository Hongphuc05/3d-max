# Plan v2 — Download queue + import đa Max (native + backend)

> Viết 2026-10-20 · Nhánh: `hung-connection_to_3dsmax` · Sau commit `cf05ad3` (agent + named pipe).
> Thay phần **native/backend** của [`download-queue-plan.md`](download-queue-plan.md). Phần frontend giữ nguyên, trừ F3 (bỏ) và F6 (thêm).
> Trạng thái: đã đọc code, **chưa chạy lại test**. Mục "chưa xác minh" ở cuối.

## 0. Luồng

```text
Bấm Download ──► [web] xin ticket ──► asset.import { assetId, ticket }
[hub = Max chứa panel]  tải → kiểm → giải nén → chọn file
        │ đích = chính nó ──► import local
        └ đích = Max khác (focus gần nhất) ──► named pipe ──► agent ──► import (main thread)
```

Tải và giải nén chạy ở **hub**; chỉ bước import đi qua pipe. Vì vậy progress và cancel nằm hết ở hub.

## 1. Hiện trạng (đã đọc code)

| Phần | Đang có | Thiếu / lỗi |
|---|---|---|
| Native, import đa Max | Agent + pipe `MaxPlatform-<pid>`, chọn Max đích theo focus, nhãn "Import vào: ..." | Pipe không có ack, không có version; chờ 10 phút 15 giây khi Max đích treo |
| Native, cache | `cache\<assetId>\<timestamp>\` | `CleanOldDirs` xóa **cả thư mục assetId** mỗi lần import → race giữa 2 panel; ticket 1 lần nên không bao giờ trúng cache |
| Native, `RunTar` | Chạy `tar.exe`, timeout 5 phút | Vòng `ReadLine` chặn → timeout vô hiệu nếu `tar` treo |
| Dữ liệu | 313/360 sản phẩm là RAR (87%) | `tar.exe` đọc RAR chưa xác minh |
| Backend | `import-ticket` 1 lần, 5 phút | Chưa kiểm license; `GET /products/:slug/download` còn mở (`assets.js:24`) |

## 2. Contract

- **Event native → web:** `asset.progress` (phase `download|extract|dispatch|import`), `asset.completed`, `asset.failed`. Giữ response cuối của `asset.import`.
- **Method mới:** `asset.cancel { requestId }` (chỉ hủy ở download/extract), `asset.listCached`. Ghi vào `decisions.md` và allowlist cả C# lẫn MAXScript trước khi code.
- **Pipe:** `{"v":1,"id","path"}` → reply 1 `{"ack":true}` → reply 2 là kết quả. Agent từ chối version lạ.
- Không nhận URL/đường dẫn từ web (spec §5.5).

## 3. Việc native (theo thứ tự)

| # | Việc | Xong khi |
|---|---|---|
| N7 | Kiểm RAR thật bằng `tar.exe`; nếu lỗi thì đổi ingest sang `.zip` (A1-3) | Import được 1 sản phẩm RAR và 1 ZIP |
| N10 | Chống race cache: mutex theo `assetId`; `CleanOldDirs` chỉ xóa bản cũ, không xóa thư mục đang dùng | 2 Max cùng tải 1 sản phẩm: không lỗi giữa chừng |
| N9 | Pipe: thêm ack + `v`; hub không có ack sau ~3 giây thì báo `TARGET_BUSY` | Max đích mở modal: báo lỗi sau vài giây, không phải 10 phút |
| N1 | `asset.progress` ở hub (throttle ~4 lần/giây; `total=null` nếu không có `Content-Length`) | Gói ~200 MB: % tăng dần, Max không đứng |
| N2 | `asset.cancel`; sửa `RunTar` đọc không đồng bộ có timeout thật | Hủy khi tải: file tạm bị xóa |
| N8 | Bảng lỗi thống nhất (`TARGET_BUSY`, `CANCELLED`, ...); log có `requestId`, không log ticket | Lỗi nào cũng có thông báo tiếng Việt |
| N6 | `scene.getInfo` trả thêm `file` | Thanh trên hiện tên file scene |
| N11 | Hỏi cache **trước** khi xin ticket | Lần 2 cùng sản phẩm không tốn ticket, không tải lại |
| N4/N5 | Giữ cache + kiểm `sha256` (cần BE3); `asset.listCached` + quota | Tab "Đã tải" sống qua F5 |

**Bỏ/hoãn:** N3 (2 job tải song song) — băng thông là nút cổ chai, tuần tự đơn giản hơn.
**Ràng buộc:** `net48`, không thêm NuGet (R2), không tham chiếu `Autodesk.Max`, scene mutation qua main thread.

## 4. Frontend (sau native)

F1 nhận event + %, F2 nút hủy, F4 tab "Đã tải" từ `listCached`, F5 tên file scene.
**Bỏ F3.** **Thêm F6:** hiện rõ "Import vào: <tên Max>" trong hàng đợi.

## 5. Backend

| # | Việc | Khi nào |
|---|---|---|
| BE2 | Gỡ `GET /api/products/:slug/download` + sửa `assets.test.js:50-55` | **Ngay** |
| BE3 | `import-ticket` trả `sha256` + `size` | Trước N4 |
| BE1 | `import-ticket` kiểm license | Trước khi có user thật (A4); cấm mở public khi chưa có |
| BE4–BE6 | Như plan cũ | Theo A4/A6 và quy mô catalog |

## 6. Thứ tự

```text
BE2 ─ N7 ─ N10 ─ N9 ─ N1 ─ N2 ─ N8 ─ N6
              BE3 ─ N11 ─ N4 ─ N5
BE1 + BE4 cùng A4, trước user thật
```

## 7. Checklist test thêm

- [x] 2 Max, đổi focus rồi Import: đúng Max
- [ ] Đóng Max đích giữa chừng: `TARGET_UNAVAILABLE`, không import nhầm
- [ ] Max đích mở modal: báo lỗi trong vài giây (cần N9)
- [ ] 2 panel cùng tải 1 sản phẩm: không lỗi file bị xóa (cần N10)
- [ ] Đóng panel giữa lúc tải: Max không crash
- [ ] Import sản phẩm có texture, import lại lần 2: texture của scene còn
- [ ] Max chạy quyền Administrator vs Max thường: pipe kết nối được không

## 8. Chưa xác minh

- `tar.exe` đọc RAR (313/360 chỉ đếm theo đuôi file).
- Texture sau merge có trỏ vào `cache\...\content\` không (suy luận).
- Hậu quả đóng panel giữa job (`PostResponse` trên WebView2 đã dispose).
- Pipe giữa 2 Max khác quyền.
