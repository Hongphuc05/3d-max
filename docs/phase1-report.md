# Báo cáo PoC Phase 1–3 — WebView2/DLL/MAXScript

> Ngày: 2026-09-23. Trạng thái: chạy được trên máy dev, chưa test máy sạch.
> Đây là báo cáo lịch sử của HTML demo, không phải bằng chứng website React thật đã chạy
> trong Max. Kế hoạch tiếp theo: [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md).

## Tóm tắt một câu

Một trang web chạy bên trong 3ds Max, bấm nút trên trang thì object hiện ra trong scene.

## Bốn mảnh

| Mảnh | File | Việc của nó |
|---|---|---|
| Trang web | `frontend/index.html` | 4 thẻ design (bàn, ghế, kệ, sofa) + khung log. HTML thuần, không framework, không build step |
| Người phiên dịch | `plugin-csharp/.../MaxWebViewForm.cs` | Cửa sổ chứa WebView2. Chuyển lệnh giữa JavaScript và MAXScript |
| Tay chân | `maxscript/PlatformBridge.ms` | Thật sự dựng object trong scene. Chỉ mảnh này được đụng Max API |
| Nút bấm | `maxscript/usermacros/Platform-OpenPanel.mcr` | Macroscript để mở panel từ toolbar |

Cộng thêm `installer/` — đóng cả 4 mảnh thành một file `PlatformSetup.exe`.

## Một cú bấm nút đi qua đâu

```
Trang web:  postMessage {id, method:"design.create", params:{type:"desk", width:140, ...}}
   ↓
Phiên dịch: kiểm origin → kiểm method có trong allowlist không → bắn .NET event
   ↓
Tay chân:   dựng 5 box, group lại, đặt tên desk_01
   ↓
Phiên dịch: PostWebMessageAsJson {id, ok:true, result:{name:"desk_01", parts:5}}
   ↓
Trang web:  tra id trong bảng request đang chờ → hiện kết quả
```

Kênh nối là `window.chrome.webview` — WebView2 tự bơm object này vào trang khi trang
chạy bên trong host. Trình duyệt thường không có nó, nên trang tự biết mình đang ở đâu.

Kênh này chỉ đẩy message một chiều, không có khái niệm request/response. Phần
request/response là tự dựng: mỗi lệnh mang một `id` uuid, JS giữ bảng `id → promise`,
C# trả về đúng `id` đó. Quá 10 giây không thấy trả lời thì báo `TIMEOUT`.

## Vì sao chẻ làm ba

- Đổi trang web test thành web platform thật → chỉ sửa **mảnh 1**.
- Phiên dịch **không tham chiếu `Autodesk.Max`** — ràng buộc trong `agent.md`. Nhờ vậy
  sau này nâng Max 2025+/.NET 8 chỉ phải viết lại mảnh 3, không đụng protocol.

## Bảo vệ (web input luôn là untrusted)

| Chặn ở đâu | Chặn cái gì |
|---|---|
| `IsTrusted` | Message từ origin ngoài thư mục frontend → bỏ qua |
| `AllowedMethods` | Method không có trong danh sách → trả `UNKNOWN_METHOD`, không tới MAXScript |
| `pbNum` | Mọi số từ web đều clamp về khoảng hợp lệ |
| `Extract` trong installer | Chặn zip-slip khi bung payload |

Thêm method mới phải sửa **hai** chỗ: `AllowedMethods` (C#) và `case` (MAXScript).
Cố ý làm vậy để allowlist không lách được từ một phía.

## Cài và test

```
powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
installer\PlatformSetup.exe          # đóng 3ds Max trước khi chạy
```

Trong Max: `Customize > Customize User Interface > tab Toolbars`, Category `Platform`,
kéo `Mở Platform Design Library` vào một toolbar. Bấm nút đó.

| # | Làm | Đúng thì |
|---|---|---|
| 1 | Bấm nút Platform | Panel mở, badge xanh `3ds Max (WebView2)` |
| 2 | `host.ping` | Log xanh `"pong":true`, dưới 1000ms |
| 3 | Bàn làm việc → Thêm vào scene | Bàn hiện trong viewport, stats lên 5 object |
| 4 | Sửa Rộng = 300, đổi màu, thêm nữa | Bàn thứ hai dài gấp đôi, nằm bên phải, không đè lên |
| 5 | Chọn 2 object → `scene.getSelection` | `{"count":2,"names":[...]}` khớp |
| 6 | Đóng panel, bấm nút lại | Mở lại sạch, `host.ping` chỉ ra một dòng trả lời |

Test 3 quan trọng nhất — nó đi hết cả chuỗi. Các test khác chỉ để khoanh vùng khi 3 gãy.

Gãy thì đọc hai chỗ: **Bridge log** trong panel (web thấy gì) và **MAXScript Listener**
(Max thấy gì). `TIMEOUT` mà Listener có dòng `[bridge]` → tới MAXScript rồi nhưng chết
giữa chừng. `TIMEOUT` mà Listener trống → chưa tới được MAXScript.

## Chưa làm

- Panel là form nổi, **chưa dockable**. Dock được thì phải reference `MaxCustomControls`,
  tức khóa DLL vào Max — đúng cái `agent.md` cấm. [R3](decisions.md#r3--dockable-panel-trên-qt-515) vẫn mở.
- Design là preset ghép từ box, **không backend, không asset file**. `asset.import` thật
  vẫn chờ audit platform (Phase 5).
- Chưa có log file, chưa correlation ID xuống native log (Phase 6).
- Installer chưa ký số, chưa uninstall, chưa bootstrap WebView2 Runtime khi máy đích thiếu.
- Chưa test trên máy sạch, chưa test khi vắng WebView2 Runtime.

## Bẫy đã dính, ghi lại để khỏi dính lại

- **`Assembly.LoadFrom` khóa file DLL.** Max đang mở là không build đè được. Đóng Max → build → mở lại.
- **Không được dùng `pause` trong script của installer.** IExpress chạy nó trong console
  không tương tác được → treo vĩnh viễn, người dùng không thấy gì. Đây là lý do bỏ IExpress,
  chuyển sang installer viết bằng C#.
- **Visual Studio có thể xoá reference khỏi `.csproj`** khi rewrite file. `System.Web.Extensions`
  (dùng cho `JavaScriptSerializer`) đã bị xoá một lần làm build gãy.
- **Không thêm Newtonsoft.Json.** Max nạp sẵn Newtonsoft trong AppDomain của nó, version tùy
  bản Max — đúng rủi ro [R2](decisions.md#r2--assembly-conflict-trong-appdomain-của-max).
  `JavaScriptSerializer` có sẵn trong .NET Framework 4.8, dùng nó.
- **Sửa `index.html` hay `.ms` thì phải đóng gói lại installer**, không exe vẫn mang bản cũ.

## Bước tiếp theo

Audit source ban đầu đã được ghi tại [`current-platform-audit.md`](current-platform-audit.md).
Bước triển khai tiếp theo là Phase 1 của
[`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md): chạy backend và
frontend local trong browser, tạo baseline runtime, sau đó mới đổi C# host sang URL Vite.
