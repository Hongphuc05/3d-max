# Kiến trúc hiện tại và kiến trúc mục tiêu

> Cập nhật: 2026-09-30  
> Xem quyết định đã khóa tại [`decisions.md`](decisions.md).

## 1. Hai phần của repo

### 1.1 Website 3DS Mood thật

Nằm trong `web/`:

```text
web/
├── front-3dsmood-main/   # React/Vite frontend
└── back-3dsmood-main/    # Express/Mongoose backend
```

Đây là source of truth cho:

- user, auth và role;
- catalog 3D Model/3D Scene;
- category, collection và cart;
- order, coin, point và payment;
- quyền sở hữu và download asset;
- metadata và storage key của asset;
- admin UI.

### 1.2 PoC kết nối 3ds Max

```text
frontend/index.html       # UI demo, không phải website sản phẩm
plugin-csharp/            # WinForms + WebView2 + bridge C#
maxscript/                # scene adapter chạy trong Max
installer/                # đóng gói PoC
```

PoC hiện chứng minh được flow:

```text
HTML demo
  -> window.chrome.webview.postMessage
  -> C# WebView2 bridge
  -> .NET event
  -> MAXScript
  -> 3ds Max scene
```

PoC không phải source of truth cho catalog, auth hoặc asset production.

## 2. Kiến trúc mục tiêu

```text
Website React 3DS Mood
  <-> Existing Backend API
  <-> MongoDB / Wasabi

Website React 3DS Mood
  <-> 3ds Max Bridge SDK
  <-> WebView2 message channel
  <-> C# bridge/router
  <-> Max adapter
  <-> 3ds Max scene
```

### Ranh giới trách nhiệm

| Layer | Có trách nhiệm | Không có trách nhiệm |
|---|---|---|
| React web | UI, login, catalog, gọi API, hiển thị progress | Không gọi raw MAXScript hoặc arbitrary native API |
| Backend | Auth, ownership, metadata, import ticket, audit | Không điều khiển scene Max |
| C# bridge | Origin validation, RPC routing, download/cache/verify | Không chứa business logic payment/catalog |
| Max adapter | Import và scene mutation trên thread an toàn | Không tự quyết quyền sở hữu asset |
| Installer | Cài plugin/runtime/config, upgrade/rollback | Không hard-code secret hoặc production token |

## 3. Development và production

### Development

```text
WebView2 -> http://localhost:5173
Frontend -> http://localhost:5000
Backend  -> MongoDB / Wasabi theo local environment
```

### Production đề xuất

```text
WebView2 -> HTTPS website 3DS Mood
Frontend -> HTTPS API 3DS Mood
Backend  -> production database/storage
```

Plugin phải lấy URL từ config theo environment, không hard-code URL production trong DLL.

## 4. Browser mode và Max mode

Website phải có hai chế độ:

- **Browser mode:** không có `window.chrome.webview`; mọi chức năng web hiện tại vẫn chạy.
- **Max mode:** bridge khả dụng; UI có thể mở route `/extension/3dsmax`, hiển thị host
  status và nút import.

Không component nào được gọi trực tiếp `window.chrome.webview`. Mọi call đi qua một SDK
trung tâm trong frontend.

## 5. Flow import mục tiêu

```text
User bấm Import trong website
  -> frontend xin import ticket từ backend bằng auth hiện tại
  -> backend kiểm user + ownership + asset metadata
  -> frontend gửi assetId + ticket qua bridge
  -> native tải stream từ API trusted
  -> verify checksum/size/version
  -> safe extract nếu là package
  -> cache theo assetId/version
  -> dispatch import lên Max main thread
  -> trả progress/result về frontend
```

Asset ID và ticket là input chính. Web không được truyền arbitrary URL, path, shell command
hoặc MAXScript cho native host.

## 6. Cấu trúc mục tiêu đề xuất

Không cần di chuyển code ngay. Khi triển khai, có thể tiến dần tới cấu trúc:

```text
web/
├── front-3dsmood-main/
│   └── src/integrations/3dsmax/
│       ├── bridge.js
│       ├── protocol.js
│       ├── host.js
│       ├── scene.js
│       └── assets.js
└── back-3dsmood-main/
    └── routes/max-import.routes.js

plugin-csharp/
└── MaxWebViewHost/
    ├── Host/               # WebView lifecycle, navigation, config
    ├── Bridge/             # DTO, validation, router, errors
    ├── Assets/             # download, cache, verify, extraction
    └── MaxAdapter/         # interface; implementation phụ thuộc Max
```

Tên folder có thể thay đổi khi implement, nhưng ranh giới trách nhiệm không được phá vỡ.

## 7. Nguyên tắc không thay đổi

- Target đầu tiên là 3ds Max 2022 / .NET Framework 4.8.
- Web input luôn là untrusted.
- Chỉ exact trusted origin có bridge privilege.
- Native sở hữu privileged download/import pipeline.
- Scene mutation phải chạy qua Max-safe/main-thread dispatcher.
- Không thêm bridge method ngoài use case đã chốt.
- Không để tích hợp Max làm hỏng website browser hiện tại.
