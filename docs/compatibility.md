# COMPATIBILITY MATRIX

> Trạng thái: **chưa verify**. Mọi ô `?` phải được điền bằng test thật, không suy đoán.
> Cập nhật file này ngay khi một ô được xác minh, kèm ngày.

## Target chính

| Hạng mục | Giá trị | Trạng thái |
|---|---|---|
| 3ds Max | 2022 | locked ([D1](decisions.md#d1--target-3ds-max-2022-locked)) |
| .NET target framework | `net48` (.NET Framework 4.8) | cần verify bằng build chạy được trong Max |
| C++ toolset (nếu cần shim) | VS 2019 / v142 | chưa cần |
| Qt (Max UI) | 5.15.2 | ảnh hưởng dock panel — xem [R3](decisions.md#r3--dockable-panel-trên-qt-515) |
| Max .NET assemblies | `Autodesk.Max.dll`, `ManagedServices.dll`, `MaxCustomControls.dll` | ? verify đường dẫn thật trong Phase 1 |
| WebView2 SDK | `Microsoft.Web.WebView2` (NuGet) | ? verify hỗ trợ `net48` ở version chọn |
| WebView2 Runtime | Evergreen ([D4](decisions.md#d4--webview2-runtime-evergreen--bootstrapper-trong-installer)) | ? verify hành vi khi vắng mặt |
| Windows | ? (10 minimum giả định) | ? |

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

## Ma trận sẽ cần khi tới Phase 5/6

Chưa điền được cho tới khi audit platform xong ([D2](decisions.md#d2--web-platform-repo-riêng-có-source-locked)).

| Hạng mục | Ghi chú |
|---|---|
| Asset format | chờ [O3](decisions.md#quyết-định-chưa-khóa-blocker-cho-phase-0) |
| Renderer | chỉ khi làm `material.apply` (M6) |
| Frontend framework / build | chờ audit |

## Nguyên tắc

Không claim support một Max version nào trước khi có một lần chạy thật trên máy sạch
của version đó. "Chắc chạy được" không phải là một ô trong bảng này.
