# Plan — Download queue + import trong 3ds Max (native + backend)

> Viết 2026-10-19 · Nhánh: `hung-connection_to_3dsmax` · Dành cho người làm trên **Windows + 3ds Max 2022**.
> Frontend (giao diện tối, hàng đợi phía web) **đã xong** ở bước UI-1 — xem [`STATUS.md`](STATUS.md).
> Tài liệu này là phần **còn lại** để hàng đợi chạy thật: native (C#/MAXScript) và backend.

## 0. Luồng sản phẩm (D10)

```text
Khách mua sản phẩm ──► thanh toán xác minh ──► license được cấp
        │
        ▼  (chỉ trong plugin 3ds Max — trình duyệt KHÔNG có Download, O7)
Bấm "Download" trên card / panel chi tiết
        │  1 lần bấm (lựa chọn a): tải về máy rồi import luôn
        ▼
[web]    POST /api/products/:slug/import-ticket  → { assetId, ticket }   (ticket 1 lần, 5 phút)
[web]    bridge asset.import { assetId, ticket }
[native] tải gói  →  kiểm tra  →  giải nén an toàn  →  chọn file  →  import trên main thread
[web]    hàng đợi hiển thị trạng thái; xong thì model nằm ở tab "Đã tải"
```

Download và import là **hai bước bên trong native**, chỉ gộp chung một nút ở giao diện. Giữ hai bước tách
riêng trong code để sau này có thể tách thành hai nút (tải trước, import sau từ tab "Đã tải") mà không đổi protocol.

## 1. Hiện trạng (đã xác nhận từ source, chưa chạy trên Windows)

| Phần | Đang có | Thiếu |
|---|---|---|
| Web — hàng đợi (`apps/store-web/src/queue.js`) | Chống bấm trùng, chạy tuần tự 1 job, thử lại xin ticket mới, bỏ job đang chờ/lỗi, tab "Đã tải" trong phiên | % tiến độ, hủy job đang chạy, nhớ lịch sử sau F5 |
| Web — giả lập host (`devMockHost.js`, `?mockMax=1`) | Xem giao diện hàng đợi trên trình duyệt khi dev | — |
| Native — `asset.import` (`MaxWebViewForm.cs`) | Tải về file tạm, kiểm zip-slip, giải nén bằng `tar.exe`, chọn `.fbx > .obj > .max`, import qua MAXScript | **Một request duy nhất**, trả kết quả khi xong (tối đa 10 phút); **không có event tiến độ, không hủy được** |
| Native — cache | Thư mục `%LOCALAPPDATA%\MaxWebViewHost\cache\<assetId>\` | **Bị xóa mỗi lần import** (`CleanOldDirs`) → chưa có gì để liệt kê ở tab "Đã tải" |
| Native — `scene.getInfo` | Số object, selected, units, renderer | **Tên file scene** (thanh trên muốn hiện `Connected: <file.max>`) |
| Backend — ticket | `import_tickets`, 1 lần, 5 phút, lưu sha256 | **Chưa kiểm license** (đăng nhập là import được); chưa trả `sha256`/`size` để native kiểm |

## 2. Contract đề xuất (phải chốt trước khi code native)

**Event native → web** (tên event tách khỏi tên method — `agent.md`):

```json
{ "event": "asset.progress",  "requestId": "<id của request asset.import>",
  "data": { "phase": "download|extract|import", "received": 1048576, "total": 52428800 } }
{ "event": "asset.completed", "requestId": "...", "data": { "imported": 12, "file": "x.max", "cached": true } }
{ "event": "asset.failed",    "requestId": "...", "data": { "code": "ASSET_DOWNLOAD_FAILED", "message": "..." } }
```

- Response cuối của `asset.import` vẫn giữ như hiện tại (để tương thích); event chỉ là thông tin thêm.
- Gửi `asset.progress` tối đa ~4 lần/giây (throttle), không gửi mỗi chunk.
- `total` = `Content-Length`; không có thì `null` → web hiện thanh không xác định.

**Method mới** — mỗi cái phải ghi vào `docs/decisions.md` và allowlist **cả C# lẫn MAXScript** trước khi code:

| Method | Params | Trả về | Vì sao |
|---|---|---|---|
| `asset.cancel` | `{ requestId }` | `{ cancelled: bool }` | Nút hủy trong hàng đợi. Chỉ hủy ở pha download/extract, **không hủy giữa lúc đang import vào scene** |
| `asset.listCached` | `{}` | `[{ assetId, sha256, size, cachedAt }]` | Tab "Đã tải" lâu dài (sau F5, sau khi đóng Max) |

Không thêm method nào khác. Không nhận URL/đường dẫn từ web (spec §5.5).

## 3. Việc native (Windows) — theo thứ tự

| # | Việc | Phụ thuộc | Kiểm tra xong khi |
|---|---|---|---|
| N1 | Event `asset.progress` khi stream (đếm byte đọc / `Content-Length`, throttle) + `phase` cho extract/import | — | Gói ~200 MB: web thấy % tăng dần; Max không đứng hình |
| N2 | `asset.cancel`: `CancellationToken` theo `requestId` cho `HttpClient` và tiến trình `tar`; dọn file tạm khi hủy | N1 | Hủy giữa lúc tải → file tạm bị xóa, job ở web chuyển "Đã hủy" |
| N3 | Hàng đợi native: tối đa 2 job tải song song; **import luôn tuần tự** trên main thread | N1 | 3 job cùng lúc: 2 tải, 1 chờ; không có 2 lần merge chồng nhau |
| N4 | **Giữ cache** sau khi import (bỏ `CleanOldDirs` sau import); khóa cache = `assetId/sha256`; kiểm `sha256` sau khi tải (cần BE3); ghi file tạm → kiểm → move | BE3 | Import lần 2 cùng sản phẩm không tải lại; file sai sha256 bị từ chối |
| N5 | `asset.listCached` + chính sách dọn cache (quota, ví dụ 20 GB, xóa cũ nhất) | N4 | Tab "Đã tải" hiện đúng sau khi mở lại Max |
| N6 | `scene.getInfo` trả thêm `file` (MAXScript `maxFileName`, rỗng nếu scene chưa lưu) | — | Thanh trên hiện tên file scene |
| N7 | Đọc được `.rar`/`.7z`: kiểm `tar.exe` với `.rar` thật; nếu không được thì chọn (a) ingest đổi mọi gói sang `.zip` (A1-3, **khuyến nghị**, native không cần thêm gì) hoặc (b) kèm 7-Zip | A1-1 | Import được ít nhất 1 sản phẩm `.rar` và 1 `.zip` |
| N8 | Bảng lỗi thống nhất (`ASSET_*`, `TIMEOUT`, `CANCELLED`) + log file có `requestId`, không log ticket | — | Mọi lỗi hiện thông báo tiếng Việt có nghĩa ở hàng đợi |

**Ràng buộc:** `net48`, không thêm NuGet (R2), bridge không tham chiếu `Autodesk.Max`, mọi thao tác scene qua main thread.

## 4. Việc frontend sau khi native xong (nhỏ, làm sau N1–N5)

| # | Việc | Phụ thuộc |
|---|---|---|
| F1 | `bridge.js`: nhận `event` (hiện chỉ xử lý response có `id`); `queue.js` cập nhật % theo `requestId` | N1 |
| F2 | Nút hủy job đang chạy | N2 |
| F3 | Cho 2 job chạy song song (bỏ giới hạn 1 job trong `queue.js`) | N3 |
| F4 | Tab "Đã tải" đọc từ `asset.listCached` thay cho danh sách trong phiên | N5 |
| F5 | Thanh trên hiện tên file scene | N6 |

## 5. Việc backend (nợ — làm sau, không chặn giao diện)

| # | Việc | Vì sao | Khi nào |
|---|---|---|---|
| BE1 | `import-ticket` phải **kiểm license** `(user, product)` thay cho "đăng nhập là được" | Hiện ai đăng nhập cũng import được mọi sản phẩm | Cùng A4 |
| BE2 | **Gỡ hoặc tắt `GET /api/products/:slug/download`** (tải file nén trên trình duyệt) | Trái O7. Giao diện đã bỏ nút, nhưng **endpoint vẫn còn**, ai đăng nhập gọi thẳng URL vẫn tải được | Ngay, trước khi có user thật |
| BE3 | Response `import-ticket` trả thêm `sha256` và `size` | Để native kiểm file (N4) | Trước N4 |
| BE4 | API danh sách sản phẩm trả cờ `owned` cho user đang đăng nhập | Lọc "Đã sở hữu / Chưa mua" thay cho PRO/FREE | Cùng A4 |
| BE5 | Lọc nhiều danh mục, lọc renderer, sắp xếp ở server | Hiện web tải hết catalog về rồi lọc tại chỗ (đủ cho 360 sản phẩm, không đủ cho hàng nghìn) | Khi catalog > ~2.000 sản phẩm |
| BE6 | Giới hạn số ticket / user / phút | Chống spam tải | A6 |

## 6. Thứ tự làm đề xuất

```text
BE2 (gỡ endpoint download)  ── làm ngay
N7 + A1-3 (đổi gói sang .zip)  ──► N1 ──► N2 ──► N3
BE3 ──► N4 ──► N5
N6 (độc lập, nhỏ)
F1..F5 theo native
BE1 + BE4 cùng A4 (thanh toán)
```

## 7. Checklist test trên Windows + 3ds Max 2022

- [ ] Mở panel, thanh trên hiện `Connected · <phiên bản> · <số object> · <renderer>`
- [ ] Chưa đăng nhập: nút hiện "Đăng nhập để tải"
- [ ] Download sản phẩm `.zip` nhỏ: hàng đợi chạy → xong → model trong scene, sang tab "Đã tải"
- [ ] Download sản phẩm `.rar` (N7)
- [ ] Bấm Download 2 lần liên tiếp: chỉ 1 job
- [ ] 3 job liên tiếp: chạy lần lượt, Max không đứng hình
- [ ] Tắt API giữa chừng: job báo lỗi, bấm "Thử lại" chạy lại được
- [ ] Ticket hết hạn (đợi > 5 phút giữa xin ticket và tải — cần chỉnh tay để test): báo lỗi có nghĩa
- [ ] Gói ~200 MB: không treo UI; (sau N1) có %
- [ ] Hủy job (sau N2)
- [ ] Đóng mở lại panel: không đăng ký handler trùng, hàng đợi trống (đúng hiện trạng — chưa nhớ lịch sử)
