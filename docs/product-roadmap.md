# Product roadmap — 3DS Mood License Store cho 3ds Max

> Cập nhật: 2026-10-06 · Thay thế hướng "nhúng website bán hàng cũ vào Max".
> Quyết định nền: [`decisions.md`](decisions.md) D5–D8. Chi tiết kỹ thuật phần Max (Phase B):
> [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) Phase 4–14.

## 0. Hướng đi trong một đoạn

**Sản phẩm là gì:** một **plugin thư viện model cho 3ds Max**. Khách mở panel ngay trong Max,
duyệt/tìm trong kho model của 3DS Mood, mua license từng model và import thẳng vào scene, không
phải tự tải, giải nén rồi merge. Giá trị cốt lõi là **tiết kiệm thời gian dựng scene**. Panel
trong Max là UI chính; web trên browser là kênh phụ (xem catalog, tài khoản, thanh toán) và
**không cho tải file nén**.

Trước đây 3DS Mood là website bán file 3D: user mua, tải file nén về, tự mở trong Max.
Hướng mới: **bán license sử dụng từng sản phẩm, dùng trực tiếp trong 3ds Max**. User duyệt
catalog (trong browser hoặc trong panel Max), thanh toán chuyển khoản 15.000 VND/sản phẩm,
hệ thống xác nhận thanh toán tự động → cấp license → user bấm **Import** và model xuất hiện
trong scene. Không còn nút "tải file nén" cho user.

Ẩn dụ: trước là **bán đĩa CD** (mua xong cầm đĩa đi), giờ là **Spotify cho model 3D trả theo
bài** (mua quyền dùng gắn với tài khoản, app chính chủ phát cho mình).

Hai phase, làm tuần tự:

```text
Phase A — Web store (FE + BE)          Phase B — Kết nối 3ds Max
A0 Chốt + dọn repo                     B1 Host load web thật (URL config, exact origin)
A1 Ingest catalog từ source/           B2 Bridge SDK trong React + Max mode
A2 Catalog API + FE xem preview  ◄─ mốc test đầu tiên
A3 Auth                                B3 Device registration + import ticket
A4 Thanh toán + license                B4 Native download/verify/extract/cache
A5 Admin tối thiểu                     B5 Import vào scene (merge .max)
A6 Hardening + staging                 B6 Progress, installer, signing, clean machine
```

**Gate:** Phase B chỉ bắt đầu khi (1) Phúc đã review và duyệt giao diện app mới, (2) A4 pass
(có license thật thì import mới có ý nghĩa).
B1–B2 có thể làm song song với A5–A6 nếu có người.

---

## 1. Dữ liệu nguồn — đã xác nhận (2026-10-06)

Đường dẫn: `source/3DSMOOD/` (đã nằm trong `.gitignore`, không commit).

| Hạng mục | Giá trị đo được |
|---|---|
| Cấu trúc | `<Category>/<Subcategory>/<file>` — 11 category, 114 subcategory, khớp `seed/seedCategories.js` cũ |
| Số sản phẩm | 360 (360 ảnh + 360 file nén) |
| Ảnh preview | `.jpg` / `.JPG` |
| File nén | 312 `.rar` + 1 `.RAR`, 45 `.zip`, 2 `.7z` |
| Dung lượng file nén | tổng ≈ 10 GB · min 130 KB · median ≈ 18 MB · max ≈ 200 MB |
| Metadata | **không có** tên, giá, mô tả — chỉ có tên file (số ID hoặc chuỗi kiểu ULID) |

Nội dung bên trong (mẫu 2 file):

- Thường chứa **nhiều biến thể `.max`** theo version và renderer, ví dụ
  `..._2013_Vray.max`, `..._2016_Corona.max`, `..._max13.max`, kèm `.FBX`, `.obj/.mtl`,
  `.mat` và texture (`maps/` hoặc nằm phẳng).
- Tên file `.max` bên trong là nguồn tốt để suy ra **tên hiển thị** (vd. `Zehnder Subway`,
  `33B 20 Murakami 2`).

Dữ liệu bẩn phải xử lý khi ingest (đã thấy thật):

- Tên ảnh có khoảng trắng trước đuôi: `2087881.5b69bcaa5ce91 .jpg`.
- File nén thiếu dấu chấm: `...AGP24Lrar.rar`.
- Hậu tố lạ chỉ có ở một bên: `198034.550f761d4bc32-yzbmix.*` và
  `605389.57a897d5de7d9-2reavm.*` (2 cặp).

→ Luật ghép cặp: chuẩn hóa tên (trim, bỏ hậu tố `rar`/`zip`). Nếu trong một subcategory còn
đúng 1 ảnh và 1 file nén chưa ghép thì ghép với nhau. Còn lại đưa vào **ingest report** để
người duyệt, không đoán bừa.

---

## 2. Tech stack đề xuất

### 2.1 Quyết định lớn: dùng lại `web/` hay làm app mới gọn?

| Lựa chọn | Ưu | Nhược | Đánh giá |
|---|---|---|---|
| 1. Cắt tỉa `web/` hiện có | Giữ UI đã có, đỡ thiết kế lại | 23k dòng FE (nhiều file >1.000 dòng), domain cũ (màu, style, vật liệu, scenes, coin, điểm, discount, collection) không còn dùng; debt bảo mật (xem §2.4); xóa còn tốn hơn viết | Không khuyến nghị |
| **2. App mới gọn, cùng stack JS, copy có chọn lọc** | Model dữ liệu mới đơn giản (preview + file nén + giá); dữ liệu Mongo cũ đã mất nên không có gánh nặng migrate; sửa dứt điểm debt bảo mật | Phải dựng lại UI catalog | **Khuyến nghị** |
| 3. Stack mới (Next.js/NestJS…) | Framework "đầy đủ" hơn | Học thêm, không đem lại giá trị cho 360 sản phẩm | Không cần |

Lý do chính cho lựa chọn 2: nguyên tắc "không rewrite platform đang chạy" (agent.md) đặt ra
khi platform **còn chạy và còn đúng mô hình kinh doanh**. Cả hai điều kiện đó không còn: DB
server đã sập, và mô hình đổi từ bán file sang bán license. `web/` **đã xóa** (2026-10-06);
logic tham chiếu (SePay webhook, stream, auth) tra bằng `git show main:web/<path>`.

### 2.2 Stack

| Lớp | Chọn | Vì sao / ghi chú |
|---|---|---|
| Frontend | React 19 + Vite + React Router + Tailwind (như cũ) | Team đã quen; SPA chạy tốt trong WebView2 |
| Data fetching FE | `fetch` + một wrapper nhỏ (không thêm lib) | Nếu cache/refetch phức tạp lên thì cân nhắc TanStack Query |
| Backend | Node.js + Express 5 | Như cũ; tái sử dụng được logic SePay/stream |
| Database | **PostgreSQL** (Docker local, managed khi production) | Order/payment/license là dữ liệu dạng sổ cái: cần transaction, unique constraint (`user_id, product_id`), foreign key. Mongo làm được nhưng transaction cần replica set và dễ sai. Bạn làm SQL nên không tốn thêm chi phí học |
| Truy vấn DB | `pg` + SQL thuần, migration bằng file `.sql` đánh số | ~6 bảng, ORM là thừa. Nếu muốn type-safe thì Kysely/Drizzle là lựa chọn nhẹ |
| Storage file nén | Dev: thư mục local · Prod: S3-compatible (Wasabi như cũ), **private bucket + presigned GET TTL ngắn** | Bỏ được token store in-memory của code cũ; scale nhiều instance |
| Ảnh preview | Sinh thumbnail `.webp` khi ingest (`sharp`), phục vụ public/CDN | Ảnh gốc vài MB, grid 360 ảnh mà không có thumbnail thì rất chậm |
| Auth | Email/password, `crypto.scrypt` (stdlib), session cookie HttpOnly lưu server — xem D9 | Google OAuth để sau (embedded WebView có thể bị Google chặn, cần spike riêng — O2) |
| Thanh toán | **VietQR chuyển khoản + SePay webhook** (code cũ đã có, chuyển sang thanh toán theo đơn) | Hợp với 15.000 VND/sản phẩm và chạy được trong panel Max (user quét QR bằng điện thoại). Lựa chọn khác: PayOS, VNPay, MoMo — chưa đánh giá phí/hợp đồng, cần so sánh trước A4 |
| Ingest | Script Node CLI + `bsdtar` (libarchive) để list/extract rar/zip/7z | `bsdtar` có sẵn trên macOS và đã list được `.rar` mẫu. Hỗ trợ RAR5 phải verify trên toàn bộ 360 file |
| Chạy local | `docker compose` (postgres) + `npm run dev` | Không dùng DB remote khi dev |
| Native (Phase B) | Giữ nguyên: C# .NET 4.8 + WebView2 + MAXScript | Đã khóa D1. Gói asset chuẩn hóa thành `.zip` để native chỉ cần `System.IO.Compression`, **không thêm NuGet** (R2) |
| Test | `node:test` cho backend (không thêm framework); Playwright cho 1–2 luồng E2E chính (catalog, checkout) | Ưu tiên test ở luồng tiền/license |

### 2.3 Vị trí code

```text
3d-max/
├── apps/
│   ├── store-web/      # React app mới (Phase A)
│   └── store-api/      # Express API mới (Phase A)
│       ├── migrations/ # 001_init.sql ...
│       └── scripts/ingest.js
├── source/3DSMOOD/     # dữ liệu gốc, gitignored
├── storage/            # dev: assets đã chuẩn hóa + thumbnails, gitignored
└── plugin-csharp/ maxscript/ installer/ frontend/   # native (Phase B)
```

### 2.4 Không mang sang từ code cũ (debt đã xác nhận trong source)

- SePay webhook **bỏ qua xác thực nếu thiếu `SEPAY_WEBHOOK_APIKEY`** (`routes/sepay.routes.js`):
  ai cũng gọi được webhook và tự cấp tiền cho mình. Bản mới phải bắt buộc có key, thiếu thì
  không khởi động.
- `GET /api/downloads/recent` không cần auth mà trả danh sách sản phẩm của các đơn paid gần đây.
- `/api/downloads/stream/:token` lưu `userId` nhưng không kiểm tra; token nằm trong RAM của
  một process.
- CORS hard-code, session secret `'your-secret'`, log `MONGO_URI`.
- `.env_local` đang được commit → **rotate toàn bộ secret** trong đó (Wasabi, JWT, Google,
  Mongo) và gỡ khỏi git (A0).

---

## 3. Mô hình license

### 3.1 License là gì trong hệ thống này

**License = quyền vĩnh viễn của một tài khoản được import một sản phẩm vào 3ds Max qua plugin
chính chủ.** Đây là entitlement phía server, không phải file license chạy offline.

| Khái niệm | Dữ liệu | Ghi chú |
|---|---|---|
| Product | id, slug, name, category, price (mặc định 15000), status, preview, asset (key, sha256, size, manifest) | Giá lưu theo sản phẩm để sau đổi được từng cái |
| Order | id, user, code (`TDM…`), items, total, status `pending/paid/expired/cancelled` | Một đơn có thể nhiều sản phẩm (giỏ hàng) |
| Payment | provider, provider_tx_id **unique**, amount, raw payload, matched order | Chống xử lý trùng webhook |
| License (entitlement) | user, product, order, granted_at, revoked_at | **unique (user_id, product_id)** |
| Device (Phase B) | user, device_id, public key, name, last_seen, revoked_at | Giới hạn số máy/tài khoản |
| Import ticket (Phase B) | jti, user, product, device, sha256, exp, used_at | One-time, TTL 2–5 phút |

### 3.2 Luồng mua (Phase A)

```text
User chọn sản phẩm → POST /orders  (server tính tiền từ DB, không tin giá từ client)
  → order pending + mã TDMxxxx + QR VietQR (số tiền + nội dung = mã đơn)
  → user chuyển khoản
  → SePay gọi webhook (bắt buộc API key)
      → trong 1 transaction: lưu payment (unique tx id) → khớp mã đơn + số tiền ≥ total
      → order = paid → insert licenses (ON CONFLICT DO NOTHING)
  → FE poll GET /orders/:code (hoặc SSE) → hiện "Đã sở hữu"
```

Các trường hợp phải xử lý: chuyển thiếu tiền, chuyển dư, sai nội dung, chuyển hai lần, đơn
hết hạn mới có tiền về, webhook tới trễ hoặc mất. Cần thêm job **đối soát** định kỳ với lịch
sử giao dịch (SePay có API giao dịch hay không cần verify trong tài liệu SePay trước A4) và màn
admin để khớp đơn thủ công.

### 3.3 Luồng dùng license (Phase B)

```text
Web (trong Max) bấm Import
  → bridge: native ký challenge bằng device key → backend kiểm user + license + device
  → backend cấp import ticket (gắn user/product/device/sha256, TTL ngắn, dùng 1 lần)
  → native đổi ticket lấy presigned URL → stream về temp → verify sha256
  → extract an toàn → cache → merge vào scene trên main thread
```

Device key do **native** sinh và giữ (DPAPI, theo user Windows), không để web tự khai báo
device: web là untrusted, giả được.

### 3.4 Giới hạn — nói thẳng

- **Không có DRM nào chặn được việc copy geometry sau khi đã merge vào scene.** User có thể
  Save As scene ra `.max`. License chỉ kiểm soát **ai được lấy file nguồn và lấy qua kênh
  nào**, không bảo vệ được tuyệt đối nội dung.
- Biện pháp tăng chi phí sao chép (không phải bảo vệ tuyệt đối): không có link tải trong UI;
  cache local mã hóa hoặc xóa sau khi merge; giới hạn số device; rate limit import; gắn
  user/order vào metadata của object (cần verify Max API cho custom attribute/file properties
  ở B5); điều khoản sử dụng (EULA) rõ ràng.
- Mức độ bảo vệ là quyết định kinh doanh (O5). Đề xuất MVP: entitlement + device limit +
  ticket one-time, chưa mã hóa cache.

### 3.5 Plugin có thu phí không?

Đề xuất: **plugin miễn phí, thu tiền theo nội dung**. Không cần license key cho plugin, nên
không phải làm DRM chống crack DLL .NET (dễ decompile). Vẫn cần login để import.

---

## 4. Phase A — Web store

### A0 — Chốt quyết định và dọn repo

- Chốt D5–D8 trong `decisions.md` (stack, DB, payment, license model).
- ~~Xác nhận quyền phân phối 360 model (R4)~~ — Phúc đã xác nhận có quyền (2026-10-06).
- Gỡ `.env_local` khỏi git (`git rm --cached`) và rotate secret; gỡ `bin/ obj/ installer/stage`
  và artifact đã track.
- Tạo `apps/store-api`, `apps/store-web`, `docker-compose.yml` (postgres).

Exit: repo không còn secret; `docker compose up` chạy Postgres; quyết định đã ghi.

### A1 — Ingest catalog

Script `ingest.js` chạy được nhiều lần (idempotent theo sha256):

1. Quét `source/3DSMOOD`, tạo cây category từ thư mục.
2. Ghép cặp ảnh và file nén theo luật §1; cặp không ghép được thì ghi report.
3. Với mỗi file nén: tính `sha256` và size, list entries (`bsdtar -tf`), phát hiện các
   `.max` / `.fbx`, version (`2013`, `2016`, `max13`…), renderer (`Vray`, `Corona`), và
   có texture hay không → lưu vào `manifest` (JSONB).
4. Suy ra tên hiển thị từ file `.max` chính; nếu không được thì dùng `<Subcategory> NN`.
5. Sinh thumbnail `.webp` (vd. 480px và 1200px) vào `storage/previews/`.
6. Chuẩn hóa gói asset: extract → kiểm path (zip-slip, absolute path) → đóng lại thành
   `.zip` vào `storage/assets/<sha256>.zip`. Native ở Phase B chỉ cần đọc zip.
7. Upsert DB, `price = 15000`, `status = draft` cho tới khi được duyệt.
8. Xuất `ingest-report.json`: lỗi, cặp không ghép được, file không có `.max`, file
   rar/7z không mở được.

Exit: 360 sản phẩm trong DB (hoặc ít hơn, phần còn lại có lý do trong report); chạy lại
không tạo bản trùng.

Ước lượng tài nguyên: I/O đọc 10 GB và ghi lại khoảng 10 GB zip, nên cần khoảng 20 GB đĩa
trống. Chạy tuần tự hoặc song song tối đa 2–4 file, vì file lớn nhất khoảng 200 MB và stream
từ đĩa nên không tốn RAM theo kích thước file.

### A2 — Catalog API và FE xem preview (mốc test đầu tiên)

API (public, chỉ đọc):

- `GET /categories` — cây kèm số lượng.
- `GET /products?category=&q=&page=&limit=` — phân trang, tìm theo tên.
- `GET /products/:slug` — chi tiết: ảnh lớn, category, giá, định dạng/renderer từ manifest.
- Static `/previews/*` có cache header dài (tên file theo hash).

FE:

- Trang chủ hoặc catalog: sidebar category và grid thumbnail, lazy-load, phân trang hoặc
  infinite scroll.
- Trang chi tiết: ảnh lớn có zoom, tên, giá, thông tin "Có bản Vray/Corona, Max 2013+…".
- Tìm kiếm theo tên.
- **Thiết kế panel-first:** layout chuẩn ở bề rộng panel (~400–700px), mở rộng ra desktop
  browser sau. Grid dày, tìm kiếm nhanh, ít click.
- **Review gate:** Phúc duyệt giao diện trước khi sang Phase B.

Test:

- Mọi sản phẩm `active` đều có ảnh load được (script so sánh DB với file).
- Category rỗng, ảnh lỗi, trang 404.
- Lighthouse cho trang grid.

Exit: chạy local trong Chrome, xem được toàn bộ catalog và preview.

### A3 — Auth

- Đăng ký, đăng nhập email/password, quên mật khẩu (email: cần chọn SMTP provider).
- JWT access token khoảng 15 phút và refresh token xoay vòng. Phải chốt nơi lưu token để hoạt
  động trong cả browser và WebView2: cookie HttpOnly cùng site (khuyến nghị, cần CSRF
  protection) hay `localStorage` như code cũ (đơn giản hơn nhưng dễ lộ khi XSS).
- Rate limit login.
- Exit: login, logout và refresh hoạt động; protected API trả 401 đúng.

### A4 — Giỏ hàng, thanh toán, license

- Giỏ hàng (client-side là đủ), checkout tạo order, màn QR, poll trạng thái, hết hạn đơn
  (vd. 15 phút).
- Webhook SePay theo §3.2, transaction, idempotent.
- Trang "Thư viện của tôi" liệt kê license.
- Trên trang sản phẩm, nút đổi theo trạng thái: Mua / Đang chờ thanh toán / Đã sở hữu
  (và trong Max là "Import").
- **Không có nút tải file** trong browser (theo mô hình license). Nếu muốn cho tải thì đó là
  quyết định kinh doanh riêng.

Test bắt buộc (`node:test` với payload webhook giả):

- Đủ tiền, thiếu tiền, dư tiền, sai mã.
- Webhook gửi trùng.
- Thiếu hoặc sai API key.
- Đơn hết hạn rồi mới có tiền.
- Hai đơn cùng chứa một sản phẩm.
- Đã sở hữu rồi vẫn mua lại: phải chặn khi tạo đơn.

Exit: chuyển khoản thật 15.000 VND vào tài khoản test thì license tự xuất hiện trong vòng
vài giây đến vài chục giây (đo thực tế, không hứa số trước).

### A5 — Admin tối thiểu

- Duyệt sản phẩm `draft → active`, sửa tên, giá, ẩn sản phẩm.
- Danh sách đơn và payment, khớp thủ công payment lạc (có audit log ai làm).
- Cấp hoặc thu hồi license thủ công (hoàn tiền, khiếu nại).
- Phân quyền admin ở API, không chỉ ẩn trên FE.

### A6 — Hardening và staging

- HTTPS, CORS và CSP theo env, secret qua env/secret manager, không log token hay payload nhạy
  cảm.
- Backup Postgres định kỳ và **thử restore**.
- Log có cấu trúc và request ID; healthcheck.
- Deploy staging (API + web + Postgres + bucket). Nơi host cần chọn: VPS + Docker compose là
  đủ cho quy mô này.
- E2E Playwright: catalog → login → mua (webhook giả) → thấy trong thư viện.

**Definition of Done Phase A:** web store chạy ở staging; mua bằng tiền thật và nhận license
tự động; không còn secret trong repo; có backup đã thử restore.

---

## 5. Phase B — Kết nối 3ds Max

PoC native hiện có (WebView2 → C# bridge → MAXScript) đã chạy với `frontend/index.html`.
Phase B nâng nó lên để chạy với web store thật. Chi tiết kỹ thuật đã viết ở
[`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) (Phase 4–14); dưới
đây là những gì **thay đổi hoặc cụ thể hơn** theo mô hình license.

| Bước | Nội dung | Ánh xạ plan cũ |
|---|---|---|
| B1 | Host load `StartUrl` theo config; exact-origin allowlist thay prefix path; bỏ path `D:\` hard-code ở C#/.ms/.mcr; external link mở browser hệ thống | Phase 4–5 |
| B2 | `src/integrations/3dsmax/` trong `store-web`; detect Max mode; layout panel hẹp; nút Import chỉ hiện trong Max và khi đã có license | Phase 6–7 |
| B3 | **Mới:** native sinh device key (DPAPI), API đăng ký device, giới hạn N máy/tài khoản; API cấp import ticket ký số và dùng 1 lần | Phase 8 (cụ thể hóa) |
| B4 | Native: đổi ticket lấy presigned URL, stream về temp, verify sha256, extract zip an toàn, cache theo `sha256` | Phase 9 |
| B5 | Import: chọn file `.max` theo manifest (version ≤ 2022, ưu tiên renderer đang cài, fallback FBX), merge trên main thread, remap texture path, đặt vào scene, undo; xử lý thiếu V-Ray/Corona | Phase 10 |
| B6 | Progress events, chặn double import, installer cài config env + bootstrap WebView2, code signing, clean-machine test | Phase 11–14 |

Điểm kỹ thuật mới phát sinh từ dữ liệu thật:

- **Một gói có nhiều `.max`.** Native không được tự chọn ngẫu nhiên; ingest đã ghi manifest,
  backend trả entry đề xuất, native áp rule (version, renderer) và có thể hỏi user.
- **Renderer.** Nhiều asset chỉ có material V-Ray hoặc Corona. Máy user không cài renderer đó
  thì material sẽ lỗi hoặc thiếu. Phải phát hiện renderer đang cài (verify cách làm bằng
  MAXScript ở B5) và cảnh báo trước khi mua (hiển thị trên trang sản phẩm).
- **Version `.max`.** File lưu từ Max cũ hơn thường mở được trên Max mới hơn; file mới hơn 2022
  thì không mở được trên 2022. Cần verify bằng test thật với asset mẫu, và ingest phải đánh dấu
  gói nào không có bản ≤ 2022.
- **Bridge allowlist.** Thêm `asset.import` (đã có trong danh sách chốt). `design.create`
  hiện có trong PoC phải bị gỡ khi lên web thật (không thuộc allowlist chốt).

**Definition of Done Phase B:** trên máy sạch Win + Max 2022, cài installer, mở panel, login,
mua 1 sản phẩm, bấm Import thì model xuất hiện đúng trong scene; Import lần hai dùng cache;
sản phẩm chưa mua không import được kể cả khi gọi bridge trực tiếp.

---

## 6. Rủi ro chính

| # | Rủi ro | Tác động | Giảm thiểu |
|---|---|---|---|
| R4 | Quyền phân phối model | — | **Đã đóng**: Phúc xác nhận có quyền (2026-10-06); vẫn nên lưu bằng chứng/hợp đồng |
| R5 | Không chặn được copy sau khi import | Mất doanh thu do chia sẻ | §3.4: device limit, ticket one-time, EULA, theo dõi bất thường |
| R6 | Webhook payment bị giả hoặc mất | Cấp license sai hoặc user trả tiền mà không có hàng | Bắt buộc API key, idempotent, đối soát, khớp tay có audit |
| R7 | RAR/7z mở không được hoặc RAR5 không hỗ trợ | Thiếu sản phẩm | Ingest report; xử lý tay các file lỗi |
| R8 | Asset phụ thuộc renderer hoặc version Max | Import ra scene lỗi, khiếu nại | Manifest, cảnh báo trước mua, fallback FBX |
| R1–R3 | Max 2022 EOL, assembly conflict, dock panel | Xem `decisions.md` | Như cũ |

## 7. Việc phải xác minh (chưa có bằng chứng)

- `bsdtar` mở được toàn bộ 313 file rar (gồm RAR5) và 2 file 7z.
- SePay: định dạng webhook hiện tại, cơ chế xác thực, API tra giao dịch để đối soát.
- Google login trong WebView2 (nếu cần).
- Max 2022 merge `.max` của các version trong dữ liệu, và hành vi khi thiếu V-Ray/Corona.
- Cách gắn metadata user vào object hoặc scene trong Max 2022 (nếu dùng để truy vết).

## 8. Báo cáo cuối mỗi bước

Giống `web-in-3dsmax-integration-plan.md`: files changed, lệnh/test đã chạy, chạy ở browser
hay trong Max, cái gì chạy thật và cái gì mới inspect, giới hạn, assumption, bước tiếp theo.
