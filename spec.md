# SPEC — 3ds Max Extension cho Web Platform hiện có

> Quyết định đã khóa: [`docs/decisions.md`](docs/decisions.md). Ma trận version: [`docs/compatibility.md`](docs/compatibility.md).
> Target: **3ds Max 2022 / .NET Framework 4.8**. Mục tiêu: **sản phẩm thương mại**.

## 1. Mục tiêu
Biến web platform hiện có thành một extension/plugin chạy trực tiếp trong Autodesk 3ds Max, tái sử dụng tối đa frontend/backend hiện tại. Extension phải cho phép UI web giao tiếp hai chiều với 3ds Max để thực hiện các thao tác scene/asset/material mà trình duyệt thông thường không thể làm.

Đây là sản phẩm bán cho studio, không phải PoC. Hệ quả: installer, code signing, update và support log là bắt buộc trước khi release — xem [D3](docs/decisions.md#d3--mục-tiêu-sản-phẩm-thương-mại-locked).

## 2. Phạm vi MVP
MVP chứng minh end-to-end:
1. Cài/load plugin trong 3ds Max.
2. Mở dockable panel `Platform`.
3. Panel nhúng web platform bằng WebView2.
4. Web nhận biết đang chạy trong 3ds Max host.
5. JS gửi request có cấu trúc sang native bridge.
6. Native bridge gọi 3ds Max API.
7. Kết quả trả về JS theo request/response protocol.
8. Demo bắt buộc: `Create Cube`, `Get Selection`, `Get Scene Info`.
9. Sau PoC: `asset.import` là vertical slice production đầu tiên.

## 3. Ngoài phạm vi MVP
- Marketplace hoàn chỉnh.
- Hệ thống thanh toán mới.
- Rewrite frontend thành WPF/native.
- Hỗ trợ Maya/Blender/SketchUp ngay từ đầu.
- C++ SDK nếu .NET/Max API đã đáp ứng.
- Corona/V-Ray adapter đầy đủ trước khi bridge core ổn định.

## 4. Kiến trúc
```text
Existing Backend / API / Storage
             ^
             | HTTPS
             v
+------------------------- 3ds Max --------------------------+
| C#/.NET Plugin Host                                        |
|  +-------------------------------------------------------+  |
|  | Dockable Panel + WebView2                            |  |
|  | Existing Web Frontend                                |  |
|  +----------------------+--------------------------------+  |
|                         | JSON messages                    |
|  +----------------------v--------------------------------+  |
|  | MaxBridge                                             |  |
|  | validation / routing / request-response / errors      |  |
|  +----------------------+--------------------------------+  |
|                         |                                  |
|  +----------------------v--------------------------------+  |
|  | 3ds Max Adapter                                      |  |
|  | scene / asset / material / renderer operations       |  |
|  +----------------------+--------------------------------+  |
|                         v                                  |
|                     3ds Max API                            |
+------------------------------------------------------------+
```

## 5. Thành phần
### 5.1 Plugin Host
- C# trên **.NET Framework 4.8**, target **3ds Max 2022** ([D1](docs/decisions.md#d1--target-3ds-max-2022-locked)).
- Bridge và Adapter tách nhau: `Platform.Max.Bridge` không được tham chiếu type nào của `Autodesk.Max`. Đây là điều kiện để nâng lên Max 2025+/.NET 8 sau này mà không viết lại protocol.
- Lifecycle: initialize, panel registration, shutdown/dispose.
- Không chứa business logic của web platform.
- Quản lý WebView2 runtime/environment, local cache và bridge.

### 5.2 Embedded Web UI
- Tái sử dụng web app hiện tại.
- Nên có route/mode riêng, ví dụ `/extension/3dsmax`.
- UI có thể ẩn các thành phần không phù hợp trong host.
- Không gọi trực tiếp Max API; chỉ gọi `MaxBridge SDK`.

### 5.3 MaxBridge
API boundary duy nhất giữa web và native.

Request envelope:
```json
{
  "id": "uuid",
  "version": 1,
  "method": "scene.getSelection",
  "params": {}
}
```

Success:
```json
{
  "id": "uuid",
  "ok": true,
  "result": {}
}
```

Failure:
```json
{
  "id": "uuid",
  "ok": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "Human-readable message"
  }
}
```

Initial methods:
- `host.ping`
- `host.getInfo`
- `scene.getInfo`
- `scene.getSelection`
- `scene.createBox` (PoC only)
- `asset.import`
- later: `material.apply`, `renderer.getInfo`

Events native -> web:
- `host.ready`
- `scene.selectionChanged` (later)
- `asset.importProgress`
- `asset.importCompleted`
- `asset.importFailed`

### 5.4 Web Max SDK
Frontend wrapper, không để `window.chrome.webview` rải khắp codebase.
```text
src/integrations/3dsmax/
  bridge.ts
  types.ts
  host.ts
  scene.ts
  assets.ts
  materials.ts
```
Public API ví dụ:
```ts
await max.host.getInfo();
await max.scene.getSelection();
await max.assets.import(assetId);
```
Nếu chạy ngoài 3ds Max, SDK phải detect `unsupported host` rõ ràng thay vì crash.

### 5.5 Asset Import Pipeline
```text
UI click Import
 -> bridge asset.import
 -> validate asset ID
 -> obtain asset metadata/download authorization from existing backend
 -> cache lookup
 -> download to temp
 -> verify package/checksum if available
 -> unpack safely
 -> resolve entry file
 -> execute import on Max main/UI thread
 -> return result
```
Không cho web truyền arbitrary filesystem path hoặc arbitrary script để native execute.

## 6. Security
- Chỉ load origin allowlist của platform trong privileged WebView.
- Chặn/không cấp bridge privilege cho navigation ngoài allowlist.
- Không expose generic `executeMaxScript`, shell command hoặc arbitrary file read/write cho remote web.
- Validate method + schema + asset ID ở native side.
- Path canonicalization; chống `../` traversal khi unzip.
- HTTPS production.
- Token/credential không hard-code trong DLL/repo.
- Log không ghi access token/password.
- Download package nên có checksum/signature khi bước vào production.
- Principle of least privilege cho bridge API.

## 7. Threading
3ds Max scene mutations phải được dispatch theo cơ chế an toàn lên Max/UI/main thread. Network/download/unzip chạy background. Không block UI trong lúc download asset lớn.

## 8. Auth
Ưu tiên reuse auth hiện tại. Cần spike sớm để xác nhận cookie/session/OAuth hoạt động trong WebView2. Nếu auth dựa browser redirect, định nghĩa callback flow rõ ràng. Native bridge không nên tự sở hữu password người dùng.

## 9. Cache
Mặc định cache theo user ở local app data, ví dụ logic `Platform/cache/<asset-id>/<version>/` (đường dẫn thực tế phải lấy từ OS, không hard-code). Metadata cache gồm version/checksum/last-access. Có chính sách clear cache và atomic download (`temp -> verify -> move`).

## 10. Compatibility
Ma trận sống ở [`docs/compatibility.md`](docs/compatibility.md) — điền bằng test thật, không suy đoán.

MVP chỉ support **3ds Max 2022**. Không claim support version khác trước khi có một lần chạy thật trên máy sạch của version đó.

WebView2 Runtime dùng bản Evergreen, installer tự bootstrap nếu thiếu ([D4](docs/decisions.md#d4--webview2-runtime-evergreen--bootstrapper-trong-installer)). Khi Runtime vắng mặt, plugin phải báo lỗi có nghĩa chứ không crash Max.

## 11. Error model
Các code tối thiểu:
- `HOST_NOT_READY`
- `UNKNOWN_METHOD`
- `INVALID_PARAMS`
- `UNAUTHORIZED`
- `ASSET_NOT_FOUND`
- `DOWNLOAD_FAILED`
- `CHECKSUM_FAILED`
- `UNSAFE_PACKAGE`
- `IMPORT_FAILED`
- `MAX_OPERATION_FAILED`
- `TIMEOUT`

Mọi lỗi phải trả về UI, đồng thời native log diagnostic chi tiết hơn nhưng không leak secret.

## 11b. Distribution (bắt buộc do D3)
- Installer tự detect/bootstrap WebView2 Runtime.
- Code signing cho cả DLL và installer.
- Update/rollback có version rõ ràng.
- Diagnostic log user export và gửi được, đã scrub secret.
- CI build reproducible, artifact khớp bản ship.

Kênh phân phối (Autodesk App Store hay tự host) và nhu cầu licensing/DRM còn mở — xem [O4/O5](docs/decisions.md#quyết-định-chưa-khóa-blocker-cho-phase-0).

## 12. Observability
- Native log rolling file.
- Correlation/request ID từ JS -> bridge -> operation.
- Log plugin version, Max version, WebView2 version khi startup.
- Optional telemetry chỉ khi chính sách sản phẩm cho phép.

## 13. Testing
- Unit: envelope parsing, validation, routing, path safety, cache.
- Contract: TypeScript types và C# DTO đồng nhất.
- Integration: WebView2 -> bridge -> fake Max adapter.
- Manual Max smoke: load/unload, panel, login, Create Cube, selection, import.
- Failure: offline, expired auth, 404 asset, corrupt zip, unsupported file, timeout.

## 14. Acceptance Criteria MVP
- Plugin cài được trên Max target sạch.
- Panel dock/undock/reopen không crash.
- Platform route load và login được.
- `host.ping` round-trip < 1s local trong điều kiện bình thường.
- `scene.createBox` tạo object qua bridge.
- `scene.getSelection` trả đúng selection.
- Reload web không làm plugin crash.
- Navigation sang origin ngoài allowlist không có native privileges.
- Không có generic remote-code-execution bridge.

## 15. Acceptance Criteria Vertical Slice Asset
- User chọn asset trên UI và bấm Import.
- Asset được download/cached từ backend hiện tại.
- UI không freeze trong download.
- File được verify/unpack an toàn.
- Import thành công vào current scene.
- Lần hai dùng cache khi version/checksum không đổi.
- Error hiển thị có nghĩa và có request ID để debug.
