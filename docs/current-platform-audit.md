# Audit platform 3DS Mood hiện tại

> Ngày audit source: 2026-09-30  
> Phạm vi: đọc source code; chưa xác nhận runtime local, dịch vụ ngoài hoặc deployment.

## 1. Kết luận ngắn

Website 3DS Mood thật đã nằm trong repo tại `web/`. Frontend và backend có đủ flow catalog,
auth, purchase/ownership và download để làm nền cho tích hợp Max. Tuy nhiên PoC WebView2
hiện vẫn load một HTML demo riêng và chưa có code bridge trong React frontend.

Việc cần làm đầu tiên là chạy backend và frontend local thành công trong browser. Sau đó mới
đổi C# host từ `HtmlPath` sang URL của Vite.

## 2. Stack đã xác nhận từ source

### Frontend

| Hạng mục | Giá trị |
|---|---|
| Framework | React 19 |
| Build/dev server | Vite 7 |
| Routing | React Router 7 |
| HTTP | Axios và `fetch` |
| Styling/UI | Tailwind, CSS, nhiều thư viện animation/gallery |
| Auth state | React Context + JWT trong `localStorage` |
| API config | `VITE_API_BASE_URL`, một số nơi có fallback `http://localhost:5000` |

Các route chính gồm homepage, 3D Model, 3D Scenes, product detail, account, login/signup,
Google callback và admin.

### Backend

| Hạng mục | Giá trị |
|---|---|
| Runtime | Node.js/CommonJS |
| HTTP framework | Express 5 |
| Database | MongoDB + Mongoose |
| Auth | JWT Bearer, JWT cookie, Passport Google OAuth, Express session |
| Storage | Wasabi/S3 và local uploads |
| Domain | product, category, collection, cart, order, download, point, deposit, SePay, admin |

### Native PoC

| Hạng mục | Giá trị |
|---|---|
| Host | C# WinForms, .NET Framework 4.8 |
| Browser | Microsoft WebView2 |
| JSON | `JavaScriptSerializer` từ framework, tránh Newtonsoft conflict |
| Max adapter | MAXScript event handler |
| UI đang load | `frontend/index.html` local |
| Panel | Form nổi, chưa dockable |

## 3. Flow auth hiện tại

### Email/password

```text
React login
  -> POST /api/auth/login
  -> backend trả user + JWT
  -> frontend lưu JWT trong localStorage
  -> Authorization: Bearer <token>
```

Backend đồng thời set HttpOnly cookie cho domain `.3dsmood.com`. Local frontend chủ yếu sử
dụng Bearer token, không dựa hoàn toàn vào cookie.

### Google OAuth

```text
Frontend chuyển tới /api/auth/google
  -> Google redirect về backend callback
  -> backend tạo JWT
  -> redirect frontend /google-callback?token=<jwt>
  -> frontend lưu token
```

Flow này phải được test riêng trong WebView2 vì có redirect qua external origin.

## 4. Flow asset/download hiện tại

Product lưu các trường liên quan:

- `modelKey`;
- `modelBucket`;
- `modelContentType`;
- `modelSize`;
- `modelEtag`;
- `modelFilePath` legacy/display.

Flow browser download:

```text
Frontend gọi GET /api/downloads/product/:id?type=file bằng Bearer token
  -> backend kiểm product và ownership nếu asset trả phí
  -> backend cấp URL /api/downloads/stream/:token hoặc passthrough URL
  -> browser tải file
```

Download token hiện được giữ trong memory của một process. Cách này dùng được cho browser
flow đơn giản nhưng phải đánh giá lại khi scale nhiều instance hoặc dùng cho native importer.

## 5. Format asset quan sát được

Frontend admin hiện cho chọn:

- `.zip`;
- `.glb`;
- `.fbx`;
- `.obj`;
- `.blend`;
- `.rar`.

Đây chỉ là danh sách upload, không phải danh sách đã xác nhận import được vào Max 2022.
Format đầu tiên cho MVP vẫn phải chốt bằng file asset thật và test trong Max.

## 6. Các vấn đề phải xử lý trước local smoke test

### Đã xác nhận từ source

1. Backend gọi `dotenv.config()` nên mặc định tìm `.env`, trong khi file đang được dùng trong
   IDE là `.env_local`. Startup local phải chỉ rõ file config hoặc chuẩn hóa startup script.
2. `download.routes.js` require `mime-types`, nhưng package chưa được khai báo trực tiếp trong
   backend `package.json`.
3. CORS backend đang hard-code `http://localhost:5173`.
4. Session secret đang hard-code giá trị placeholder.
5. Backend đang log `MONGO_URI`; không được giữ hành vi này.
6. Auth middleware và admin authorization chưa đồng nhất giữa các route.
7. `ProtectedRoute.jsx` đọc `token` từ Auth Context nhưng context không expose key này.
8. Frontend chưa có route hoặc SDK cho Max host.
9. Chưa có automated test script đáng kể trong package manifests.

### Chưa được xác nhận runtime

- `.env_local` có đủ credential hợp lệ hay không.
- MongoDB/Wasabi hiện có truy cập được từ máy dev hay không.
- Clean install frontend/backend có pass hay không.
- Production build frontend có pass hay không.
- Login Google có chạy trong WebView2 hay không.
- Asset production thật có format và package layout gì.

## 7. Khoảng cách giữa PoC và goal

| Hạng mục | PoC hiện tại | Goal |
|---|---|---|
| Web UI | HTML demo local | React website 3DS Mood thật |
| Start target | Hard-code file path | Config URL theo dev/staging/prod |
| Origin trust | Prefix local path | Exact scheme/host/port allowlist |
| Bridge SDK | JS inline trong demo | Module tập trung trong React |
| Auth | Không có | Reuse auth platform |
| Asset | Primitive dựng bằng MAXScript | Asset có ownership từ backend |
| Download | Không có | Native async download/cache/verify |
| Import | Box/design demo | Adapter theo format đã xác minh |
| Logging | Panel + Listener | Correlated rolling diagnostic log |
| Distribution | Installer PoC | Signed installer, upgrade/rollback |

## 8. Kết luận audit

Audit source đã đủ để bắt đầu Phase 1 trong
[`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md). Những kết luận liên
quan runtime vẫn phải được xác nhận bằng chạy local và test trên 3ds Max thật; không được coi
source inspection là bằng chứng deployment hoặc compatibility.
