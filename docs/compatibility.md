# Ma trận tương thích

> Trạng thái tổng thể: **chưa đủ bằng chứng release**. Mọi ô `?` phải được điền bằng test
> thật, không suy đoán. `inspected` chỉ có nghĩa đã đọc source, không có nghĩa runtime pass.
> Cập nhật file này ngay khi một ô được xác minh, kèm ngày.

## Target chính

| Hạng mục | Giá trị | Trạng thái |
|---|---|---|
| 3ds Max | 2022 | locked ([D1](decisions.md#d1--target-3ds-max-2022-locked)) |
| .NET target framework | `net48` (.NET Framework 4.8) | cần verify bằng build chạy được trong Max |
| C++ toolset (nếu cần shim) | VS 2019 / v142 | chưa cần |
| Qt (Max UI) | 5.15.2 | ảnh hưởng dock panel — xem [R3](decisions.md#r3--dockable-panel-trên-qt-515) |
| Max .NET assemblies | `Autodesk.Max.dll`, `ManagedServices.dll`, `MaxCustomControls.dll` — có đủ tại `C:\Program Files\Autodesk\3ds Max 2022\` | verified 2026-09-23 (chỉ mới xác nhận tồn tại; host hiện chưa reference cái nào) |
| WebView2 SDK | `Microsoft.Web.WebView2` 1.0.4191.47, dùng `lib\net462` | verified 2026-09-23 — build `net48` + `PlatformTarget=x64` pass |
| WebView2 Runtime | Evergreen 153.0.4234.48 (máy dev) | ? hành vi khi vắng mặt vẫn chưa test |
| Windows | 11 Education 26200 (máy dev) | ? chưa test Win10 |
| Frontend | React 19 + Vite 7 | inspected 2026-09-30; chưa clean install/build/run |
| Backend | Express 5 + Mongoose 8 | inspected 2026-09-30; chưa startup với `.env_local` |
| Auth web | JWT Bearer/localStorage; Google OAuth redirect | inspected; chưa test trong WebView2 |

## Việc phải làm để điền bảng này (Phase 0/1 spike)

1. Cài Max 2022 sạch. Ghi lại build number chính xác.
2. Tìm đường dẫn thật của Max .NET assemblies, ghi vào đây. Không hard-code trong csproj —
   dùng property trỏ tới Max install dir.
3. Build một plugin rỗng `net48`, load được trong Max. Ghi cách Max nạp nó (`plugin.ini`?
   `bin/assemblies`? loader riêng?).
4. Mở một dock panel rỗng. Kiểm tra dock / undock / đóng / mở lại / đổi DPI.
5. Nhét WebView2 vào panel, load `about:blank`. Đây là exit criteria của Phase 0.
6. **Kiểm tra R2:** liệt kê assemblies Max đã nạp sẵn (`AppDomain.CurrentDomain.GetAssemblies()`),
   đối chiếu với dependency dự kiến của bridge. Ghi kết quả vào đây.
7. Gỡ WebView2 Runtime, mở lại Max. Plugin phải báo lỗi có nghĩa, không crash Max.

## Ma trận cần cho asset import

Audit source đã hoàn thành bước đầu, nhưng các mục dưới đây chỉ được điền sau khi có asset
mẫu và chạy trong Max thật. Xem [D2](decisions.md#d2--web-platform-có-source-trong-web-amended-locked)
và [`current-platform-audit.md`](current-platform-audit.md).

| Hạng mục | Ghi chú |
|---|---|
| Asset format | chờ [O3](decisions.md#quyết-định-chưa-khóa-blocker-cho-phase-0) |
| Renderer | chỉ khi làm `material.apply` (M6) |
| Frontend framework / build | React/Vite đã inspect; build/runtime chưa verify |

## Nguyên tắc

Không claim support một Max version nào trước khi có một lần chạy thật trên máy sạch
của version đó. "Chắc chạy được" không phải là một ô trong bảng này.

Các trạng thái dùng trong tài liệu:

- `inspected`: xác nhận từ source/config.
- `tested local`: đã chạy trên máy dev ngoài Max.
- `tested in Max`: đã chạy trong 3ds Max target.
- `clean-machine verified`: đã chạy trên máy sạch theo release procedure.
