# STATUS — đã làm tới đâu, còn gì

> Cập nhật lần cuối: **2026-10-26** — bỏ credential admin dùng chung, thu hồi bootstrap admin cũ; R2 catalog, License Lifetime + payOS, tải/import chỉ cho tài khoản sở hữu license. Phần roadmap cũ bên dưới được giữ làm lịch sử.
> Plan đầy đủ: [`product-roadmap.md`](product-roadmap.md) · Cách chạy: [`../apps/README.md`](../apps/README.md)
> **Khi xong một việc: đổi `[ ]` thành `[x]`, ghi ngày, và sửa dòng "Cập nhật lần cuối".**

Chú giải: `[x]` xong và đã kiểm tra · `[~]` xong một phần / chưa kiểm tra đủ · `[ ]` chưa làm.


## v3 — Drive private → VPS → plugin (bắt đầu 2026-10-29)

Plan: [`v3-implementation-plan.md`](v3-implementation-plan.md) · Quyết định: D17–D25 trong [`decisions.md`](decisions.md).
Nhánh hiện tại: `v3/p1-drive-oauth`. Mọi phase làm trên nhánh này, không tạo nhánh mới hay MR/PR. **Người nhận P2–P7 đọc mục "Bàn giao" đầu file plan.**

- [x] P0 — Audit repo, kiến trúc, ERD, API contract, plan từng phase; chủ dự án chốt Q1–Q8 (2026-10-29)
- [~] **P1 — Drive OAuth: code xong và test bằng Drive giả (2026-10-29); CHƯA thử Drive thật, CHƯA chốt Q4** — nhánh `v3/p1-drive-oauth`
  - [x] Migration 014 (`drive_connections`, `drive_sources`, `oauth_states`) + rollback (từ chối khi đã có kết nối); kiểm trên Postgres thật
  - [x] OAuth code + PKCE S256, `state` dùng một lần/10 phút, refresh token **mã hóa AES-256-GCM** (AAD = id dòng), access token chỉ ở RAM, làm mới không chạy trùng, `invalid_grant` → `RECONNECT_REQUIRED`
  - [x] Client Drive v3 (fetch, không SDK): phân trang, shortcut/shared drive/resource key trong request, chặn chèn câu truy vấn, 401 → làm mới token đúng 1 lần, backoff + jitter + `Retry-After`, **không retry** lỗi quyền/404, `openMedia` stream đúng dạng provider của `createArchiveSender`
  - [x] API admin: `status`, `oauth/start`, `oauth/callback` (công khai, bảo vệ bằng state), `test-access`, `sources` (GET/POST); gắn vào `server.js` **trước** `adminRouter`; lỗi theo envelope v3 `{error:{code,message,requestId}}`
  - [x] `scripts/drive-probe.js` (+ Service Account để so sánh Q4): quét cây thư mục, tải thử file nhỏ nhất/trung vị/lớn nhất, kiểm size + MD5, ghi `storage/drive-probe-report.json` (không chứa ID/token)
  - [x] Hướng dẫn thủ công: [`drive-setup.md`](drive-setup.md)
  - [x] **194/194 test `store-api` pass** (126 cũ + 68 mới). Thử phá code có chủ đích 13 chỗ (bỏ kiểm folder id, bỏ refresh 401, retry lỗi quyền, Retry-After thiếu = 0, state tái dùng, bỏ kiểm scope, refresh đồng thời, lưu token rõ, bỏ PKCE, bỏ guard admin, lộ lỗi 5xx ngoài, `connection` undefined…): **mọi lần đều có test báo lỗi** (1 chỗ ban đầu lọt → đã thêm `errors.test.js`)
  - [x] 2 lỗi thật do test phát hiện và đã sửa: `Retry-After` thiếu bị hiểu là 0 giây (sẽ gọi Drive dồn dập); lỗi từ guard `requireAdmin` bị trả 500 thay vì 403
  - [ ] **CHƯA CHẠY VỚI GOOGLE THẬT** — mọi request Drive/OAuth mới được kiểm với Drive giả. Cần chủ dự án làm [`drive-setup.md`](drive-setup.md) §1–§5 rồi chạy `drive-probe`; ghi kết quả vào đây. Các điểm **chưa kiểm chứng**: tên header resource key, `corpora` cho Shared Drive, `about.user` với scope `drive.readonly`, hành vi `canDownload`, tốc độ/giới hạn tải file ~200 MB
  - [ ] **Chốt Q4** sau khi so sánh OAuth Gmail B với Service Account (token có hết hạn sau ~7 ngày khi app ở *Testing* không?)
  - [ ] Nợ P1-1: chỉ có một "kết nối hiện hành" (kết nối mới nhất); chưa có UI chọn/ngắt kết nối (P3)
  - [ ] Nợ P1-2: nút **Kết nối** trên giao diện admin chưa có (P3); hiện dùng link `/oauth/start` trực tiếp
- [~] **P2 — Worker đồng bộ Drive + catalog v3: CODE XONG; đã chạy Drive thật (2026-11-01) — đạt các tiêu chí P2.8 trừ RAM cả job (xem đối chiếu bên dưới)** — nhánh `v3/p2-sync-worker` (tách từ `v3/p1-drive-oauth` theo yêu cầu của chủ dự án; plan ghi 'không tạo nhánh mới', prompt bàn giao ghi đè). Baseline 194 → **347/347 test pass**. Nhật ký từng bước: mục 'Nhật ký P2' ngay dưới.
  - Quét Drive dùng **API key** (D26), không OAuth; giữ nguyên mã OAuth P1.
  - **Lệch so với `v3-database.md` §3.5 (cần chủ dự án duyệt):** `model_download_sessions` và `model_download_logs` KHÔNG nằm trong 018 vì khóa ngoại tới `devices`/`entitlements` của 017 (P4/P5); 018 hiện chỉ có `audit_events`. Hai bảng kia đi cùng migration thiết bị ở P4.
  - Nợ P2-1: giá model mới lấy từ biến môi trường `DEFAULT_MODEL_PRICE_VND` (mặc định 15000) vì `app_settings` thuộc migration 017 (P4/P5); đổi sang `app_settings.default_model_price_vnd` ở P3/P4.
  - Nợ P2-2: `node --test` không có timeout mặc định; khi ai đó phá fencing/lease thì test **treo** thay vì fail rõ. Cân nhắc thêm `--test-timeout` vào script `npm test` (chưa đổi vì ảnh hưởng toàn suite).
  - Nợ P2-3: shortcut trỏ tới **file** chỉ được ghi nhận (hàng `is_shortcut`), mapper chưa dùng đích của nó; Drive hiện tại không có shortcut nào nên chưa ảnh hưởng.
  - Nợ P2-4: checkpoint (`drive_sync_jobs.checkpoint`) chứa hàng đợi thư mục (ID Drive); đây là dữ liệu nội bộ, API admin `GET sync-jobs/:id` (P3) **không được trả cột này**.
  - Nợ P2-5: `computeDiff` đọc toàn bộ inventory + `model_files` vào RAM (đủ cho vài nghìn file; thư viện lớn hơn cần phân trang). Checkpoint quét ghi lại cả danh sách thư mục đã thăm sau MỖI trang (nhỏ ở 126 thư mục, lớn dần tới trần 10.000).
  - Nợ P2-6: chưa có dọn file `<sha256>.webp` mồ côi trong `PREVIEW_DIR` (sau khi đổi ảnh, bản cũ vẫn nằm trên đĩa); cần job GC an toàn (chỉ xóa file không còn `model_previews` nào trỏ tới và đủ cũ) — P6. Atomic `rename` khi ghi preview chưa test trực tiếp (kiểm bằng đọc code).
  - Nợ P2-7: chỉ khi job bị **dừng êm** (SIGTERM/Ctrl+C) thì worker sau mới tiếp tục từ checkpoint. Job đã `FAILED` (ví dụ hết hạn mức Drive 429, hết đĩa) thì xếp job mới sẽ **quét và tải lại ảnh từ đầu** (file `<sha256>.webp` đã có thì không ghi lại, nhưng ảnh vẫn bị tải xuống). Cần tái dùng `checkpoint.previews` của job FAILED gần nhất khi retry (P3).
  - Nợ P2-8 (từ review, chưa sửa): bảng `audit_events` chưa có nơi nào ghi vào (chỉ có test schema); mỗi ảnh được giải mã 2 lần (sm và lg) thay vì 1 lần; fixture test `scanned()/pair()` lặp ở `diff.test.js` và `publish.test.js`; model L2 nhiều ảnh sẽ tải và lưu cả ảnh phụ dù manifest v1 chỉ dùng ảnh chính.
  - **Cách chạy thật (thứ tự quan trọng):** (1) `npm run sync:drive -- <rootFolderId>` tạo nguồn API key + xếp job FULL và in ID nguồn; (2) **trước khi chạy worker** nếu muốn giữ 360 model cũ: `npm run seed:legacy -- <sourceId>` (seed khớp theo `drive_file_id`; nếu worker chạy trước thì 360 model tạo mới và seed sẽ đụng khoá duy nhất `drive_file_id`); (3) `npm run worker`. Cần `DATABASE_URL`, `DRIVE_API_KEY`; tùy chọn `PREVIEW_DIR`, `MIN_FREE_DISK_BYTES`, `DEFAULT_MODEL_PRICE_VND`, `CATALOG_SSE_MAX`. Chỉ chạy trên DB dev.
  - **Đối chiếu tiêu chí P2.8 (Drive thật, DB `store_p2`, 2026-11-01):** job FULL chạy hết, công bố — ✔ `COMPLETED`, 0 lỗi, 360 model, 79 danh mục, 720 preview, 720 file WebP trên đĩa, `tmp` rỗng, catalog version 1 · chạy lại lần 2 → ✔ `new=0, updated=0, unchanged=360, review=2, bytes_downloaded=0`, version/checksum không đổi · API công khai — ✔ 200 + ETag khớp DB, 79 danh mục, 360 model, 720 preview, ảnh `image/webp` + `nosniff` + `immutable`, 304 với ETag đúng, đường dẫn lạ → 404 · dừng worker giữa DOWNLOADING_PREVIEWS → tự tiếp tục — ✔ Ctrl+C (SIGINT) ở 191 ảnh, chạy lại tiếp từ 191 tới 360; **chưa thử kill cứng** (mất lease) trên Drive thật · RSS worker < 400 MB suốt job — **chưa đo cả job** (chỉ đo đỉnh ~94 MB ở giai đoạn quét). Ảnh preview mở bằng trình duyệt qua `/previews/<sha256>.webp` hiển thị đúng (kệ trang trí, có logo 3dsMood).
  - **Việc còn mở sau P2:** chạy P2.8 với Drive thật; chủ dự án duyệt 4 quyết định thiết kế ở P2.5 và lệch 018; Regenerate API key đã lộ; admin API/UI (P3), thiết bị/quyền/tải (P4), đơn hàng (P5), GC file preview mồ côi (P6).

### Nhật ký P2 (mới nhất ở cuối)

| Ngày | Bước | Kết quả thật |
|---|---|---|
| 2026-10-30 | Tạo nhánh `v3/p2-sync-worker` từ `v3/p1-drive-oauth` (đã fast-forward lên `4b0abe8`) | OK |
| 2026-10-30 | Đọc plan (Bàn giao, §0, §2, P2), architecture §6–7, database, STATUS v3 | Xong. Phát hiện: `.env` chưa có `JWT_SECRET` và chưa có biến API key Drive |
| 2026-10-30 | `docker compose up -d` (Postgres 16, container `3d-max-postgres-1`) | Chạy. Chỉ DB dev/test trên máy dev, không đụng production |
| 2026-10-30 | `npm install` trong `apps/store-api` (thiếu `jose` trong `node_modules`, đã khai báo sẵn trong `package.json`) | OK; hoàn lại `package-lock.json` bị `npm` đổi để không lẫn vào commit |
| 2026-10-30 | **Baseline** `npm test` (store-api) | **194/194 pass**, 0 fail (12,7 s) |
| 2026-10-30 | Chủ dự án tạo API key Drive (project Google Cloud `3dsmood`, giới hạn Drive API) và chia sẻ thư mục gốc công khai; đặt `DRIVE_API_KEY` trong `apps/store-api/.env` (gitignore). **Key đã lộ trong ảnh chụp màn hình gửi vào chat → phải Regenerate trước khi deploy** | Key đúng định dạng, gọi Drive API OK |
| 2026-10-30 | **Thăm dò bố cục Drive thật** (script tạm ngoài repo, chỉ in tên/đuôi, không in key/ID): 126 thư mục, 720 file, sâu tối đa 2 cấp dưới gốc, 72 thư mục lá; đuôi: 360 `.jpg` + 313 `.rar` + 45 `.zip` + 2 `.7z`; **không có** Google Docs/shortcut; **không có** thư mục lẫn file+thư mục con. **Bố cục = L1 phẳng theo cặp** (`<tên>.jpg` + `<tên>.rar|zip`), không có L2. 74 tên bất thường (khoảng trắng trước đuôi `.jpg`, như local). 11 danh mục gốc; Technology/Plants/Material/Other models rỗng | Khớp 360 ảnh + 360 file nén của `source/` local |
| 2026-10-30 | **P2.1 xong** — migration `015_drive_sync_jobs` (jobs, items, inventory), `016_catalog` (categories, models, model_files, model_previews, review_items, catalog_state), `018_download_audit` (chỉ `audit_events`) + 3 rollback (từ chối khi đã có dữ liệu). Test-trước: `src/worker/migration.test.js` (8 test: ràng buộc, 1 job hoạt động/nguồn, primary preview duy nhất, `primary_file_id` deferrable, singleton `catalog_state`, rollback đúng thứ tự 018→016→015). Sửa `src/drive/migration.test.js` (rollback 014 phải gỡ 018/016/015 trước vì phụ thuộc; danh sách migrate lại) | `npm test` store-api: **202/202 pass** (194 baseline + 8 mới). **Thử phá 8 chỗ** (bỏ UNIQUE job hoạt động, bỏ CANCELLING khỏi chỉ mục, bỏ UNIQUE ảnh primary, bỏ deferrable, bỏ singleton, bỏ kiểm sha256, bỏ từ chối rollback 016/018): cả 8 đều có test báo lỗi — riêng *deferrable* ban đầu **lọt** (test chỉ `update`), đã thêm ca chèn model trỏ file chưa tồn tại trong cùng transaction rồi phá lại: bắt được |
| 2026-10-30 | **P2.2 xong** — migration `019_drive_source_api_key` (nguồn quét bằng API key: `access_mode`, `connection_id` nullable khi `API_KEY`, 1 nguồn API key/thư mục gốc) + rollback; `src/worker/seed.js` (`seedLegacyCatalog`: 1 transaction, kiểm đầu vào, trim tên, hạ chữ hoa đuôi file, không ghi đè thứ admin đã sửa, lỗi không lộ Drive id) + `scripts/seed-legacy-catalog.js` (`npm run seed:legacy -- <sourceId>`, giá từ `DEFAULT_MODEL_PRICE_VND`, mặc định 15000). Test: `src/worker/seed.test.js` (5) + 2 test 019; sửa `src/drive/migration.test.js` (rollback 014 gỡ thêm 019 trước). Catalog thật: **360 model, 79 danh mục, 360 file; chạy lại 2 lần không nhân đôi** | `npm test` store-api: **209/209 pass** (202 + 7). Thử phá 11 chỗ (ghi đè tên admin, lộ Drive id, bỏ transaction, bỏ kiểm trùng id, bỏ trim, bỏ hạ chữ hoa đuôi, bỏ kiểm sha256, bỏ ràng buộc 019, bỏ UNIQUE root, bỏ từ chối rollback 019): đều bị bắt. 2 chỗ ban đầu **lọt** do test yếu (test không thể thấy rò rỉ Drive id; mọi lỗi kiểm tra đều xảy ra trước khi mở transaction) → đã thêm ca `LEAKMARK` và ca lỗi DB giữa chừng rồi phá lại: bắt được. **Chưa chạy:** script CLI trên DB dev thật (chỉ kiểm cú pháp + module qua test); chưa tạo nguồn `API_KEY` thật cho thư mục Drive (làm ở P2.4) |
| 2026-10-30 | **P2.3 xong** — `src/worker/queue.js` (`enqueueJob` → `SYNC_ALREADY_RUNNING` 409; `claimJob` một câu `UPDATE … FOR UPDATE SKIP LOCKED`, nhận lại job hết lease; `heartbeat`; `saveProgress` chỉ nhận cột đếm trong whitelist; `finishJob`; `releaseJob`; `cancelJob`; job chết quá `MAX_ATTEMPTS`=5 → `FAILED JOB_ATTEMPTS_EXCEEDED`; CANCELLING mà worker đã chết → `CANCELLED`) + `src/worker/runner.js` (`runWorker`: heartbeat, dừng an toàn khi SIGTERM/mất lease/hủy; handler ném lỗi → `FAILED JOB_HANDLER_ERROR`, **không lưu nội dung lỗi**). Mọi ghi sau khi nhận job kiểm `lease_owner` (fencing). Test: `queue.test.js` (10) + `runner.test.js` (7), gồm 8 worker tranh 1 job / 3 job, crash recovery, worker cũ bị chặn sau khi bị thay, shutdown, hủy | `npm test` store-api: **226/226 pass** (209 + 17). Thử phá 16 chỗ (bỏ SKIP LOCKED, bỏ kiểm owner ở heartbeat/saveProgress/finish/release, không nhận lại job hết lease, job độc không dừng, không kết thúc huy khi worker chết, release tính 1 lần thử, bỏ whitelist counter, huy QUEUED không kết thúc ngay, huy không thắng handler, lưu nội dung lỗi): **15/16 bị bắt** (một số ca bắt bằng cách làm test treo → phải dùng watchdog khi chạy thử phá); **1 mutant tương đương**: bỏ `if (state.leaseLost) return` trong runner vẫn pass vì `finishJob` đã tự chặn bằng kiểm owner ở DB (hai lớp). **Chưa làm:** entry `src/worker.js` (SIGTERM → AbortController → `runWorker`) và handler thật — làm ở P2.4 cùng bước quét; chưa dùng `LISTEN/NOTIFY` (poll 5 s). Chưa chạy trên Postgres production/VPS |
| 2026-10-30 | **P2.4 xong** — `drive/client.js`: chế độ `apiKey` (key gắn vào query, không gửi `Authorization`, validate định dạng, không có trong lỗi; OAuth giữ nguyên) · `src/worker/scan.js` `scanSource` (BFS, checkpoint sau mỗi trang, đếm tuyệt đối nên resume không đếm đôi, upsert `unnest` theo lô 200, file ở 2 thư mục chỉ ghi 1 lần/job, theo shortcut thư mục có chống vòng lặp, bỏ Google Docs, thư mục con 404/403 → item FAILED rồi quét tiếp, thư mục gốc/lỗi tạm hết retry → ném lỗi để job FAILED, trần 100k file / 10k thư mục, tên đã làm sạch `/` và ký tự điều khiển, md5/size/ngày bẩn → NULL) · `drive/testing/fake-drive.js` hỗ trợ API key + thư mục 404. Test: `client-apikey.test.js` (4) + `scan.test.js` (14) | `npm test` store-api: **244/244 pass**, 0 cancelled (226 + 18). Thử phá **16 chỗ** (client: không gắn key, vẫn gửi Authorization, bỏ validate key, URL vào lỗi; scan: bỏ khử trùng trong lô, bỏ điều kiện 1 lần/job, bỏ visited, thư mục con 404 làm hỏng job, gốc 404 bị nuốt, quên pageToken, không lưu checkpoint, không làm sạch `/`/NUL, bỏ trần file, không làm sạch md5, không bỏ Google Docs): **16/16 bị bắt**. Ba ca ban đầu lọt do test yếu hoặc do cách đo của tôi: (1) thiếu test trùng file trong CÙNG một trang → đã thêm; (2) **cách đo sai:** `node --test` ghi test bị timeout là *cancelled* chứ không phải *fail*, nên đếm `ℹ fail` bỏ sót → đã đổi sang đếm dòng `✖`; (3) test resume ban đầu không kích hoạt shutdown vì spread object làm đóng băng getter → đã sửa. **Chưa kiểm chứng:** chạy với Drive thật (key thật, ~126 thư mục / 720 file, tốc độ, 429 thật); chưa có handler gom các giai đoạn và entry `src/worker.js` (làm ở P2.7) |
| 2026-10-30 | **P2.5 xong** — `src/worker/mapper.js` `mapFolder` (hàm thuần, kết quả không phụ thuộc thứ tự đầu vào): L1 cặp chuẩn / tên bẩn (`A .jpg` + `Arar.rar`, hoa-thường, khoảng trắng) / file model rời `.max .fbx .obj`; L2 (1 file model + ảnh preview, tên model = tên thư mục, danh mục = thư mục cha, ảnh đầu là chính); mơ hồ → `AMBIGUOUS_PAIR`; sót đúng 1 ảnh + 1 file model → `SUGGESTED_PAIR` (không có mơ hồ trong thư mục); còn lại → `ORPHAN_IMAGE`/`ORPHAN_MODEL`; không bao giờ ghép theo vị trí; đuôi lạ vào `skipped`. `src/worker/diff.js` `computeDiff` (CHỈ ĐỌC): từ inventory của job → kế hoạch `{models[NEW/MODIFIED/UNCHANGED + changes], previews cần tải, missing, recovered, reviews(kèm fingerprint ổn định, không có Drive ID), counters}`; từ chối chạy nếu quét chưa `done`; khớp theo `drive_file_id`; tên chỉ đổi khi tên file nén đổi và admin chưa sửa; md5/size NULL của model seed chỉ 'điền thêm'; REMAP_CANDIDATE khi md5+size trùng với model đã mất. Test: `mapper.test.js` (16, không cần DB) + `diff.test.js` (14, Postgres), gồm **seed 360 model từ catalog thật rồi quét → 0 model mới, 0 trùng, 0 mất, và lần so sánh thứ hai (sau khi giả lập publish) hoàn toàn yên lặng**, và `computeDiff` không ghi gì vào DB | `npm test` store-api: **275/275 pass**, 0 cancelled (244 + 31). Thử phá **23 chỗ** (9 mapper, 14 diff): **23/23 bị bắt**. Ba mutant ban đầu lọt do thiếu test, đã thêm test rồi phá lại: L2 không được chen vào thư mục đã có cặp L1 / nhóm mơ hồ; 1 ảnh + 1 model lệch tên chỉ là SUGGESTED_PAIR; đổi đuôi file không đổi tên đẹp; model seed chỉ cần điền md5 vẫn UNCHANGED; đổi chỉ size; ảnh bị xóa / đổi ảnh chính. **Chưa kiểm chứng:** chạy trên Drive thật (mới đối chiếu ID + đường dẫn của 360 mục, chưa chạy mapper trên 720 file thật); chưa có bước áp dụng kế hoạch (ghi `models`, `missing_scans`, `review_items`) — đó là publish P2.7 |
| 2026-10-30 | **P2.6 xong** — **migration `020_preview_shared_files`** (bỏ UNIQUE `model_previews.local_path`, thay bằng index thường; rollback từ chối khi còn path lặp) sửa lỗi trong migration 016 của tôi: tên file là hash nội dung nên ảnh nguồn ≤ 480px (sm và lg giống hệt) hoặc 2 model dùng chung ảnh sẽ làm publish vỡ. `src/worker/previews.js`: `runPreviewStage` (tải stream vào `PREVIEW_DIR/tmp/*.part`, trần 20 MB cả theo `Content-Length` lẫn khi stream, **allowlist magic bytes JPEG/PNG/WebP** — chặn TIFF/SVG mà Sharp vẫn giải mã được, `limitInputPixels` 40 MP, Sharp `concurrency(1)`, xoay theo EXIF, bỏ toàn bộ metadata, `sm` 480 / `lg` 1400 WebP q80 không phóng to, tên = sha256 nội dung, ghi `.part` rồi `rename`, nội dung trùng dùng chung 1 file, song song ≤ 2, kiểm dung lượng trống TRƯỚC khi khởi động worker và mỗi 100 ảnh, lỗi từng ảnh → item FAILED + `errorCount` rồi làm tiếp, huy/shutdown giữa lúc tải không bị ghi là lỗi ảnh, kết quả/bytes lưu trong `checkpoint.previews`, resume bỏ qua ảnh đã xong chỉ khi file còn trên đĩa) và `cleanStaleParts` (xóa `.part` > 1 giờ). Test: `previews.test.js` (15) + 1 test 020; cập nhật test chuỗi rollback ở `worker/migration.test.js` và `drive/migration.test.js` (020 phải gỡ trước 016/014) | `npm test` store-api: **291/291 pass**, 0 cancelled, không còn cảnh báo bất đồng bộ (275 + 16). Thử phá **17 chỗ** (bỏ kiểm magic bytes, bỏ trần khi stream, bỏ giới hạn pixel, bỏ xoay EXIF, phóng to ảnh nhỏ, ghi đè file có sẵn, song song 6, bỏ kiểm đĩa trước/định kỳ, tin checkpoint không kiểm file, không dọn .part, huy giữa chừng thành lỗi ảnh, không khử ảnh trùng, 020 không bỏ UNIQUE, rollback 020 không từ chối…): **16/17 bị bắt**; **1 mutant tương đương**: bỏ kiểm `Content-Length` sớm (vẫn bị chặn khi stream trước khi ghi byte nào xuống đĩa, chỉ tốn thêm băng thông). Test lỗi đáng ghi nhớ khi viết: ban đầu kiểm đĩa chỉ chạy ở ảnh số 0 nên worker thứ 2 tải 1 ảnh trước khi lỗi lộ ra (đã sửa: kiểm trước khi khởi động worker); lỗi `terminated` của undici có thể đến trước lỗi của tôi → phân loại sai (đã sửa bằng cờ `tooBig`). **Chưa kiểm chứng:** ảnh Drive thật (kích thước/định dạng thực tế, tốc độ, RSS < 400 MB); **atomic `rename` không được test trực tiếp** (cần mô phỏng crash giữa lúc ghi, mới kiểm bằng cách đọc code); dọn file preview mồ côi (không còn row nào trỏ tới) chưa có |
| 2026-10-30 | **P2.7a xong (publish + manifest)** — `src/catalog-v1/manifest.js` (`buildManifest`: chỉ cột công khai, `modelCount` gồm danh mục con, chỉ model PUBLISHED, chỉ ảnh chính sm/lg, checksum sha256 JSON chuẩn hoá; `withSnapshot` REPEATABLE READ; `refreshCatalogState` **chỉ tăng `active_version` khi manifest nhìn từ phía khách đổi**, catalog rỗng không tạo version) · `src/worker/publish.js` `publishPlan` (1 transaction, khoá `catalog_state`; NEW/MODIFIED/enrich; thay hàng preview theo ảnh nguồn, giữ ảnh cũ nếu tải lại lỗi, đặt primary; md5/size không bao giờ bị ghi đè bằng NULL; file đổi nội dung thì xoá `sha256`; model mới không có ảnh chính → `NEEDS_REVIEW`; `missing_scans` +1 / về 0; review không mở lại nếu fingerprint đã có kể cả đã DISMISS, gắn `model_id` cho SUGGESTED/REMAP; kế hoạch cũ → `PLAN_STALE`) · `src/worker/categories.js` (dựng cây danh mục dùng chung, `seed.js` đã chuyển sang dùng) · `diff.js` gắn `forFile` cho review SUGGESTED/REMAP (ngoài payload nên không lộ ID). Test: `publish.test.js` (16) | `npm test` store-api: **307/307 pass**, 0 cancelled (291 + 16). Gồm ca **seed 360 → publish → 720 preview, md5/size đủ, 0 model mới, publish lần 2 không đổi gì (version giữ nguyên)**, ca ATOMIC (lỗi giữa chừng → catalog và version y nguyên), 2 publish đồng thời (đúng 1 thắng). Thử phá **21 chỗ** (publish 14, manifest 7): **21/21 bị bắt** (một mutant ban đầu lọt vì chưa test `updated_at`, đã thêm assertion rồi phá lại). Lỗi fixture đáng ghi nhớ: file không có `id` cố định bị coi là file mới đổi ID → hệ thống tự mở REMAP_CANDIDATE (đúng hành vi, test sai). **Chưa kiểm chứng:** chạy trên Postgres thật với Drive thật; chưa có handler nối các giai đoạn, route khách §2.3, entry `worker.js` (P2.7b/c); manifest được dựng lại mỗi lần gọi (chưa cache theo version) |
| 2026-10-30 | **P2.7b xong (API catalog khách §2.3)** — `src/catalog-v1/routes.js`: `createCatalogV1Router` (`GET /api/v1/catalog/version`, `/categories`, `/catalog`, `/previews/manifest`; công khai, rate limit dùng chung, lỗi theo envelope v3; ETag `"<version>-<checksum>"`, 304 với `If-None-Match` dạng đơn/yếu/danh sách, `Cache-Control: no-cache` ghi đè `no-store` toàn cục; manifest cache theo version trong snapshot REPEATABLE READ; `GET /catalog/events` SSE với trần `CATALOG_SSE_MAX`, heartbeat, sự kiện đầu kết nối), `createCatalogEvents` (LISTEN/NOTIFY `catalog_v1` + poll dự phòng, mỗi version đúng 1 lần, trả kết nối khi `stop`), `createPreviewRouter` (`/previews/<64 hex>.webp`, immutable 1 năm, `nosniff`, tên khác rơi xuống route cũ). `manifest.js`: `refreshCatalogState` gọi `pg_notify` (chỉ phát sau COMMIT, chỉ khi manifest đổi). `server.js`: gắn router mới (`PREVIEW_DIR` mặc định `<STORAGE>/previews-v3`, `catalogEvents.start/stop`); `drive/errors.js`: mã `CATALOG_EVENTS_BUSY` 503. Test: `routes.test.js` (11, gồm quét mọi response không có Drive ID / source id / tên file / sha256 file model) + 1 test publish (NOTIFY) + 1 test lắp ráp `server.test.js` | `npm test` store-api: **320/320 pass**, 0 cancelled (307 + 13). Thử phá **21 chỗ** (routes 17, tích hợp server 4): **20/21 bị bắt, 1 mutant tương đương** (đổi thứ tự mount `/api/v1` sau route catalog cũ — hiện không đổi hành vi). Ba lỗ hổng test được lấp khi phá: (1) test slot SSE không kiểm client mới thật sự được nhận; (2) mount router preview chưa test bằng file thật; (3) **harness phá code của tôi hỏng**: file `.ps1` lưu UTF-8 không BOM nên PowerShell 5.1 đọc `✖` thành rác → mọi mutant báo '0 test rớt' (kết quả giả 'đều sống'); đã sửa bằng `[char]0x2716` và chạy lại — các kết quả trước đó trong log này dùng lệnh nội tuyến nên không bị ảnh hưởng. **Chưa kiểm chứng:** SSE qua Nginx thật (cần `proxy_buffering off`), tải cao, plugin thật đọc ETag; sự kiện chưa được phát khi API khởi động lại giữa lúc worker publish (client dựa vào sự kiện đầu kết nối + poll 5 phút của plugin) |
| 2026-10-30 | **P2.7c xong (handler + entry + CLI)** — `src/worker/process.js` `createSyncHandler` (SCANNING → COMPARING → DOWNLOADING_PREVIEWS → PUBLISHING; checkpoint đọc lại từ DB ở mỗi giai đoạn; diff tính LẠI ngay trước publish; lỗi đã biết → FAILED kèm mã + thông điệp tiếng Việt, lỗi lạ → `JOB_HANDLER_ERROR` chung, không lưu nội dung lỗi; `COMPLETED_WITH_ERRORS` khi còn lỗi từng ảnh/thư mục; cập nhật `last_successful_sync_at`) · `src/worker/config.js` · `src/worker/source.js` (`ensureApiKeySource`) · `src/worker.js` (entry: dọn `.part` cũ, SIGTERM/SIGINT → dừng an toàn) · `scripts/drive-sync.js` (`npm run sync:drive -- <rootFolderId>`) · mã lỗi mới `DISK_SPACE_LOW`, `SCAN_LIMIT_EXCEEDED`, `PLAN_STALE`, `JOB_HANDLER_ERROR` trong `drive/errors.js`; scripts `worker`, `sync:drive`. Test: `config.test.js` (3), `process.test.js` (12, đầu-cuối trên Drive giả + Postgres thật), `entry.test.js` (3, chạy tiến trình thật) | `npm test` store-api: **338/338 pass**, 0 cancelled (320 + 18). **Tiêu chí P2.8 kiểm được trên Drive giả:** job FULL chạy hết và công bố ✔; **chạy lại lần 2 → new=0, updated=0, 0 ảnh tải, version giữ nguyên** ✔; thêm 1 model → chỉ tải đúng 1 ảnh, version +1 ✔; **giết worker giữa DOWNLOADING_PREVIEWS → job về hàng đợi, worker sau tự tiếp tục, ảnh đã xong không bao giờ tải lại** ✔ (tiêu chí gốc 'mỗi ảnh đúng 1 lần' là sai: ảnh đang tải dở lúc bị giết sẽ được tải lại, đã sửa test cho đúng bản chất); hủy giữa chừng → CANCELLED, không publish ✔; gốc 404 / 429 hết retry / 403 / hết đĩa → FAILED mà catalog và version y nguyên ✔. Thử phá **22 chỗ** (handler 10, source 3, config 6, entry 3): **19 bị bắt, 3 mutant tương đương** (bỏ `stopped(p)` sau bước ảnh, luôn gọi `scanSource` khi resume, bỏ kiểm id ở `source.js`; mỗi cái có lớp bảo vệ thứ hai). Lỗi thật do test phát hiện: CLI `drive-sync.js` lọc quá tay nên không nói biến cấu hình nào sai (đã sửa); `return` cấp cao nhất không hợp lệ trong ES module (đã viết lại thành `main()`). **Chưa kiểm chứng: toàn bộ chạy với Google Drive THẬT** (key thật, 126 thư mục / 720 file, 360 model, ~720 WebP, RSS worker < 400 MB, tốc độ, 429 thật) |
| 2026-10-31 | **Sửa 3 phát hiện của review (ponytail-review) — xong** — (1) `previews.js`: `state.bytes += await download(...)` mất cập nhật khi 2 ảnh tải chồng nhau (chạy thử đoạn mã tương tự: kỳ vọng 300, ra 200) → cộng SAU khi chờ xong; test mới cho `bytes_downloaded` khớp tổng đúng (file nhỏ nhất kết thúc sau cùng) · (2) `runner.js`: log mặc định in thêm **mã lỗi** (`ECONNREFUSED`, `42P01`), vẫn không in thông điệp; test mới `runner-log.test.js` **không cần DB** · (3) `catalog-v1/routes.js`: trần SSE theo IP (`maxPerIp`, `CATALOG_SSE_MAX_PER_IP`, mặc định 10; hub giữ `res → IP`, thêm `countFor(ip)`); test mới: IP A đủ trần thì 503 `CATALOG_EVENTS_BUSY`, IP B vẫn được phục vụ, đóng 1 luồng thì IP A mở lại được. **Lưu ý vận hành: sau Nginx phải đặt `TRUST_PROXY`**, nếu không mọi plugin mang IP của proxy và chung trần 10 | `npm test` store-api: **342/342 pass**, 0 cancelled (338 + 4), chạy được trên cả máy tôi và máy chủ dự án. Thử phá **7 chỗ** (khôi phục đúng lỗi 1; lỗi 2 quay lại chỉ in name / in cả thông điệp; lỗi 3 bỏ trần, đếm luôn 0, không lưu IP, đếm mọi IP): **7/7 bị bắt**. Sự cố môi trường trong lúc làm: máy khởi động lại làm Docker Desktop tắt → mọi test DB báo `ECONNREFUSED` (không phải lỗi code); phải bật lại Docker. **Chưa làm** các mục 4-7 của review (bảng `audit_events` chưa dùng, checkpoint quét ghi lại mỗi trang, giải mã ảnh 2 lần, gom fixture test dùng chung) |
| 2026-10-31 | Chạy thật trên Drive: Google chặn tải ảnh (HTTP 403 "automated queries") sau ~191 ảnh; job dừng êm, `QUEUED`, checkpoint 191 ảnh. Thêm giãn cách tải: `PREVIEW_DELAY_MS` (mặc định 1500) và `PREVIEW_CONCURRENCY` (mặc định 1); nghỉ bị cắt ngay khi shutdown. Chưa làm: nhận diện 403 là lỗi giới hạn, tự ngắt khi lỗi liên tiếp | 344/344 test pass (+2) |
| 2026-10-31 | Chạy tiếp lần 2: Google chặn lại sau 248 ảnh (403 HTML), worker đứng >4 phút. Sửa: 403 HTML = `DRIVE_QUOTA_EXCEEDED` (không còn bị coi là thiếu quyền); worker nghỉ `PREVIEW_COOLDOWN_MS` (mặc định 10 phút, ngắt được bằng Ctrl+C) rồi thử lại chính ảnh đó, không ghi là lỗi của ảnh. Chưa giải thích được vì sao lần này đứng im thay vì báo lỗi nhanh | 347/347 test pass (+3) |
| 2026-11-01 | **P2.8 Drive thật xong.** Google chặn tải ảnh theo đợt (~57-66 ảnh/đợt rồi ~1 giờ; lần tải đầu ~191 ảnh): code mới tự nghỉ rồi thử lại, hết 360/360, 0 lỗi. Test B đạt (xem đối chiếu). API đạt. Lỗi `42P01` khi mở terminal mới = quên `DATABASE_URL` trỏ `store_p2` (`.env` trỏ `store`), không phải lỗi code. Nguyên nhân Google chặn: **chưa xác nhận** (chỉ có báo cáo cộng đồng, không có tài liệu chính thức) | Chạy tay, không thêm test |
| 2026-11-01 | **P3 bước 1 — API lượt đồng bộ cho admin (P3.2/P3.3 phần backend).** `src/drive/sync-routes.js` gắn trong `createDriveRouter` sau guard admin: `POST /sync-jobs` (202, 409 `SYNC_ALREADY_RUNNING`, nguồn tắt/mode sai = 400), `GET /sync-jobs` (phân trang keyset theo `created_at,id`, độ chính xác micro giây), `GET /sync-jobs/:id`, `GET /sync-jobs/:id/errors` (tên + đường dẫn, không Drive ID), `POST /sync-jobs/:id/cancel`, `GET /sync-jobs/:id/events` (SSE: `progress` khi đổi, `done` rồi đóng; tối đa 5 luồng). Thêm mã lỗi `JOB_NOT_FOUND` 422, `JOB_NOT_CANCELLABLE` 409, `SYNC_ALREADY_RUNNING` 409. Chỉ trả cột an toàn: không checkpoint, lease_owner, requested_by. Đột biến: 8/9 bị bắt; 1 sống (`mode` tùy ý ở route) là tương đương vì `enqueueJob` kiểm tra lần hai. Nhánh vẫn `v3/p2-sync-worker` (plan cấm tạo nhánh mới; tôi lỡ tạo `v3/p3-admin-sync` rồi đã xóa, nhánh đó chưa có commit). **Chưa làm:** UI `store-web`, `GET /drive/status` cho nguồn API key (hiện vẫn đọc theo kết nối OAuth), P3.4 duyệt review, P3.7 cài đặt | 354/354 test pass (+7 trong `sync-routes.test.js`) |
| 2026-11-01 | **P3 bước 1b — sửa API lượt đồng bộ cho KHỚP plan §2.2** (bản trước lệch hợp đồng, chủ dự án nhắc "bám sát plan v3"). Sửa: `Job` đúng dạng plan (`counters.{scannedFolders,scannedFiles,new,updated,unchanged,missing,review,skipped,errors}`, thêm `heartbeatAt`, bỏ trường ngoài plan); `GET /sync-jobs/:id/errors` đổi thành `GET /sync-jobs/:id/items?status=FAILED` trả mảng `{driveFileName,path,action,status,errorCode,errorMessage}`; `cancel` trả 202 không nội dung; **thêm `POST /sync-jobs/:id/retry`** (202 `{jobId}`, 409 `SYNC_ALREADY_RUNNING`). Đột biến 14/14 bị bắt (phát hiện thiếu test retry khi nguồn bị tắt, đã thêm). Còn lệch/chưa làm so với plan: mã `JOB_NOT_FOUND` 422 là mã tôi thêm (plan không nêu); `GET /drive/status`, `POST /drive/sources` vẫn theo OAuth (P3.1 sửa đổi cho API key chưa làm); `/admin/catalog/review*` (P3.4) và `/admin/models`, `/admin/settings` (P3.7) chưa làm; UI `store-web` chưa làm | 356/356 test pass (+9 trong `sync-routes.test.js`) |
| 2026-11-01 | **Tổng hợp kiểm chứng P2→P3** vào file riêng [`STATUS-v3.md`](STATUS-v3.md) (chỉ kết quả còn hiệu lực, không kể các kết quả đã bị thay thế; có mục "Chưa kiểm chứng") | Chỉ ghi tài liệu, không đổi code |
| 2026-11-01 | **P3.1 (backend) — cấu hình nguồn quét bằng API key.** Chủ dự án chốt: khóa chỉ ở `.env` (`DRIVE_API_KEY`), phạm vi lượt này là backend, UI lượt sau. `createDriveRouter({ apiKey })` bật chế độ API key (không truyền `apiKey` thì giữ hành vi OAuth P1): `GET /drive/status` → `{configured, missingConfig:["DRIVE_API_KEY"] khi thiếu, connection:null, sources}`; `POST /drive/sources` `{rootFolderUrlOrId, resourceKey?}` → 201 `{id,rootFolderName,sourceType}` (xác nhận thư mục qua Drive, idempotent, bật lại nguồn đã tắt, nhận resource key từ body hoặc URL); `POST /drive/test-access` dùng khóa cho nguồn `API_KEY`, `account:null`. Khóa không bao giờ nằm trong request/response/DB; thiếu khóa thì không gọi Google (mã `DRIVE_NOT_CONNECTED`). Sửa lỗi có từ P1 do test phát hiện: `sourceId` sai định dạng ở `test-access` trả 500, nay 400. Đột biến 10/10 bị bắt (2 lỗ hổng test về `resourceKey` lộ ra ở lần chạy đầu, đã thêm test). **Chưa làm:** giao diện P3.1 trong `store-web`; chưa thử `test-access` với Drive thật từ endpoint này; `server.js` vẫn in cảnh báo "Google Drive disabled: ... OAUTH" dù OAuth không còn là luồng chính | 366/366 test pass (+10 trong `routes-apikey.test.js`) |
| 2026-11-01 | **P3.1 (giao diện) — màn "Kết nối Drive" trong `apps/store-web`.** `AdminDrive.jsx` thêm vào `AdminDashboard` (mục "Kết nối Drive", tải dữ liệu khi mở): hiện đã/chưa cấu hình khóa (thiếu thì nêu TÊN biến `DRIVE_API_KEY`, khóa **không nhập và không hiển thị**), form thư mục gốc (liên kết/ID + resource key tùy chọn, cắt khoảng trắng, không gửi ô rỗng, chống gửi kép, giữ ô nhập khi server từ chối), bảng nguồn đã lưu, nút "Kiểm tra truy cập" hiện từng mục đạt/không đạt kèm mã lỗi. `api.js` đọc đúng envelope lỗi v3 `{error:{code,message}}` (`ApiError.detail` = thông điệp tiếng Việt của máy chủ); `adminError` dùng `detail` khi không có thông điệp riêng. Thêm route `/admin` (`admin-route.js`, `AdminEntry.jsx`, `main.jsx`) theo plan dòng 346; `/administrator`, `/admin-x` không tính. Cài devDependencies `store-web` bằng `npm ci` (trước đó thiếu `tsx`, `jsdom`). Đột biến UI 18/18 bị bắt (1 lỗ hổng test về `ApiError.code` lộ ra, đã thêm). `vite build` thành công. **Chưa làm / chưa kiểm chứng:** chưa mở trên trình duyệt thật (chỉ jsdom), chưa chạy Playwright e2e; người dùng thường vào `/admin` sẽ thấy cửa hàng cũ (StoreApp) chứ chưa có màn đăng nhập admin riêng | store-web 79/79 test pass (+10: 9 trong `admin-drive.test.jsx`, 1 trong `admin-route.test.js`) |
| 2026-11-01 | **P3.1 — chạy thử giao diện trên trình duyệt thật (chủ dự án) và sửa `test-access`.** Kết quả thật: vào `/admin` bằng tài khoản admin (cấp bằng `LICENSE_ADMIN_USER_IDS`) thấy màn "Kết nối Google Drive" đúng thiết kế: khóa "Đã cấu hình", nguồn `3DSMOOD` "Đang bật" kèm ngày đồng bộ. Bấm "Kiểm tra truy cập": liệt kê **Đạt (11 mục)** nhưng tải thử **Không đạt (NO_SAMPLE_FILE)**. Nguyên nhân (lỗi từ P1): `test-access` chỉ tìm file mẫu ở **một cấp** dưới gốc, mà thư mục gốc thật chỉ chứa thư mục danh mục nên không bao giờ có mẫu. Sửa: tìm theo chiều rộng xuống thư mục con, tối đa 8 lần liệt kê thêm (`findSample`, hợp đồng §2.2 không đổi). Test: tìm dưới gốc, giới hạn độ sâu không đập Drive, bỏ qua file rỗng/`canDownload=false`, đi nhiều tầng; củng cố một khẳng định cũ vốn luôn đúng (tautology). Đột biến phần này: 5/6 bị bắt, còn 1 tương đương (thư mục không có `size`). **Chưa kiểm chứng sau sửa:** chưa bấm lại nút trên Drive thật (cần khởi động lại API); chưa thử các dòng 4–7 và trường hợp thiếu khóa trên trình duyệt | 369/369 test pass (+3 trong `routes-apikey.test.js`) |
| 2026-11-01 | **P3.1 — bản sửa `test-access` lần 1 chưa đủ; sửa lần 2.** Chủ dự án bấm lại, vẫn `NO_SAMPLE_FILE`. Đối chiếu DB `store_p2` (`drive_inventory`): 11 thư mục ở độ sâu 1, 114 ở độ sâu 2, **720 file ở độ sâu 3**. Bản sửa lần 1 tìm theo chiều **rộng** với trần 8 lần liệt kê: 8 lần dùng hết cho 8 thư mục danh mục (độ sâu 1) nên không bao giờ tới độ sâu 3; fixture của tôi chỉ có 1–2 tầng nên không lộ ra. Lần 2: tìm theo chiều **sâu** (ngăn xếp), file độ sâu 3 mất 3 lần liệt kê. Thêm test mô phỏng đúng cấu trúc thật (11 danh mục × 3 thư mục con × file, trần ≤ 9 lần liệt kê). Đột biến 6/6 bị bắt (kể cả quay lại tìm theo chiều rộng). Bài học: fixture phải mô phỏng hình dạng dữ liệu thật. **Chưa kiểm chứng:** chưa bấm lại trên Drive thật sau lần sửa 2 (cần khởi động lại API); nếu 3 thư mục đầu toàn rỗng thì vẫn có thể ra `NO_SAMPLE_FILE` (giới hạn đã ghi chú trong code) | 370/370 test pass (+1) |
| 2026-11-01 | **P3.1 — `test-access` lần 3: lấy file mẫu từ `drive_inventory`.** Chủ dự án bấm lại vẫn `NO_SAMPLE_FILE`. Mô phỏng đúng thuật toán trên **Drive thật** (chỉ liệt kê metadata): thư mục danh mục đầu có 7 thư mục con và **cả 7 đều rỗng**, 8 lần liệt kê hết sạch mà không thấy file nào. Kết luận: đào cây để tìm mẫu là mong manh (thư viện thật có thư mục rỗng xen kẽ; hai lần sửa trước dựa trên giả định sai về dữ liệu). Cách đúng: dùng file **đã biết từ lần quét** — `knownSample`: file nhỏ nhất, `size_bytes>0`, `can_download` không false, đúng nguồn, kèm resource key — 1 yêu cầu tải, không đào cây; chỉ đào (DFS, ≤ 8 lần) khi nguồn chưa quét lần nào. Test: dùng inventory, không đào cây dù gần như mọi thư mục rỗng; bỏ qua file 0 byte / bị chặn / của nguồn khác; inventory cũ (file đã xóa trên Drive) báo `DRIVE_NOT_FOUND` chứ không giấu; gửi resource key. Đột biến 9/9 bị bắt. **Đã kiểm chứng trên dữ liệu thật:** truy vấn chọn file nhỏ nhất (42.652 byte), Google trả 206 `image/jpeg`, 4 byte đầu `ff d8 ff e0`. **Chưa kiểm chứng:** chưa bấm nút trên giao diện sau lần sửa 3 (cần khởi động lại API). **Cải chính:** lần chạy `npm test` đầu tiên sau sửa báo **373/374** (test `disk guard` của `worker/previews.test.js` fail, không liên quan thay đổi này) nhưng dòng nhật ký ban đầu và commit `dd12328` đã ghi "374/374 pass" do lệnh của tôi không dừng khi test fail; sau đó chạy lại: file riêng 5/5 pass, cả bộ 2/2 lần **374/374**. Lần fail đó **không tái hiện và chưa rõ nguyên nhân** (nghi tranh chấp thời gian giữa hai luồng tải; chưa chứng minh) | 374/374 ở 2 lần chạy lại; 1 lần 373/374 không tái hiện |
- [ ] P3 — Web Admin: kết nối Drive, quét, tiến độ, lịch sử, cần duyệt, quyền, đơn, cài đặt
- [ ] P4 — API thiết bị/quyền/tải + plugin (cache + seed preview, tự cập nhật, tải qua backend, UI-1)
- [ ] P5 — Đơn hàng + bot Telegram
- [ ] P6 — VPS, giám sát, backup, E2E 18 tiêu chí, deploy
- [ ] P7 — Dọn code cũ (payOS, R2, tài khoản khách, Vercel admin, bảng cũ)

Q9 đã chốt: D26 (VPS tải hộ link công khai + lưu bản sao; quét bằng API key). Q4 không còn áp dụng. Còn mở: xử lý 360 ID đã lộ · thông tin ngân hàng thật (nhập ở admin).

## Tài khoản và giao diện admin (2026-10-25)

- [x] Migration 011–013: tạo schema admin, không cấp credential mặc định; migration 013 hạ quyền bootstrap admin cũ và thu hồi session. Operator cấp quyền bằng UUID đã xác minh trong `LICENSE_ADMIN_USER_IDS`.
- [x] Đăng nhập username mở dashboard riêng; người dùng thường tiếp tục dùng catalog và chỉ xem preview khi chưa mua license.
- [x] Tra cứu tài khoản/license/thiết bị, cấp thủ công, tạm khóa/mở khóa, thu hồi vĩnh viễn, tra cứu thanh toán và audit.
- [x] Đổi tên đăng nhập/mật khẩu cần mật khẩu hiện tại; thu hồi mọi session cũ trong transaction và cấp session mới.
- [x] Quyền admin đối chiếu DB/server allowlist mỗi request; đăng ký không được tự gán role; slot thiết bị chỉ xem.
- [x] Backend 121/121, frontend 48/48, Playwright 11/11 và Vite build pass; coverage phần admin/auth đạt 98,60% dòng và 86,79% nhánh.
- [x] Database dev đã áp dụng migration 011–013; migration 013 hạ quyền bootstrap admin cũ và thu hồi session, giữ nguyên bản ghi tài khoản.

Hướng dẫn tại [Trang quản trị](license-payos-setup.md#trang-quản-trị).

## Cloudflare R2 catalog (2026-10-25)

- [x] Read-only `ListObjectsV2` diagnostic: 146 objects, 73 folders, 135 models (11 ready, 60 missing preview, 64 missing archive), no conflicts. Catalog sync uses only listed metadata; no production object writes or deletes.
- [x] Migrations 009–010 and PostgreSQL catalog are ready. `initialSyncComplete=true`, version 1, 135 model records. A repeated full scan found `objectsChanged=0`, left the version unchanged, and did not rewrite unchanged catalog rows.
- [x] API starts the first scan asynchronously and polls the full prefix every 600 seconds by default. Paginated scans use bounded batches, serialize through a PostgreSQL advisory lock, preserve the last good snapshot on failure, and mark missing keys removed only after a complete listing.
- [x] Admin-only `POST /api/admin/catalog/sync` and **Sync R2 Now** control accept the database ADMIN role or legacy `LICENSE_ADMIN_USER_IDS`; first-login admins must change their initial password.
- [x] Catalog changes publish through a shared PostgreSQL `LISTEN/NOTIFY` connection to SSE clients. React refreshes nested categories, models, previews, and availability on change and after EventSource reconnect.
- [x] R2 pairing covers nested folders and empty-folder markers; unambiguous full-path folder renames preserve model IDs. Tests cover nested category creation, deletion, metadata changes, failed scans, no-change scans, admin authorization, shared SSE notifications, and React refresh.
- [x] Webhook adapter remains disabled by default and is not required. No Cloudflare Worker, Queue, Event Notifications, Tunnel, billing, or R2 object settings were changed; Workers Paid is not required.
- [x] Backend tests 121/121, frontend tests 48/48, Playwright E2E 11/11, and Vite production build pass (including the new admin flows).

See [R2 polling setup and operations](r2-catalog.md).
## Google Drive catalog — historical, superseded by R2 (2026-10-25)

- [x] Provider SDK v3, recursive scan/pagination/resource keys/retry; không fallback local.
- [x] Migration 008 và bốn bảng catalog riêng; snapshot transaction/advisory lock/stable IDs.
- [x] Preview cache validate/convert/version/ETag; deletion chỉ publish sau complete scan.
- [x] Licensed backend archive streaming, one-use ticket, disconnect/timeout/concurrency limits.
- [x] React recursive folders/status/poll version/foreground refresh; giữ login/queue/Đã tải.
- [x] DLL Release net48; ZIP/RAR/7z extractor và tests traversal/budgets/manifest; native progress.
- [x] Backend 113 tests, frontend 31 unit/React tests và năm Playwright E2E tests; xem báo cáo catalog.
- [x] MAXScript guard/merge fixture thực tế PASS trong process Max2022 riêng; giữ tương thích API SSSE của 2022.
- [x] Drive API thật xác nhận root 3DSMOOD/126 folders/845 files/360 models; tải JPG và stream RAR 133.270 bytes thành công.
- [~] Initial sync cache 93 preview rồi Google chặn automated queries (HTML 403). Chưa publish snapshot dở dang; chờ sync đầy đủ thành công.

Xem [hướng dẫn](google-drive-catalog.md) và [báo cáo kiểm chứng](google-drive-catalog-report.md).

## License + payOS (2026-10-25)

- [x] Express/PostgreSQL: một Lifetime/account, hai slot bất biến, challenge và phiên thiết bị, bảo vệ import ticket/download.
- [x] payOS SDK: order, xác minh webhook, transaction/idempotency và reconciliation; test bằng mock, không giao dịch thật.
- [x] React: mua/My License/activation, khôi phục proof; C# net48 CNG/TPM + DPAPI và bridge có kiểm tra origin/schema.
- [x] D12 mới: signed VERIFY có thể xác nhận thiết bị nhưng tải/import chỉ được phép khi tài khoản hiện tại sở hữu license ACTIVE; preview vẫn xem được.
- [x] PAID tự đóng modal QR sau khi tải được key chính chủ và hiển thị My License, không chờ proof TPM; backend 68 tests, frontend 22 tests đạt trong lần bổ sung này.
- [x] State license phía client gắn ngay với tài khoản hiện tại, không hiển thị key của tài khoản trước trong lúc chuyển account.
- [x] Migration 003–007 đã chạy trên database dev/test riêng; rollback đã kiểm tra trên schema thử. D12 không cần migration mới.
- [x] API/React tests, build DLL, native/WebView2 runtime; kích hoạt TPM thật trong 3ds Max2022 và mở lại panel vẫn một slot.
- [x] Local `.env` đã có credential payOS/giá; SDK GET chỉ đọc đã được kiểm tra, không thay cho thanh toán thật.
- [ ] Thay URL webhook/return/cancel mẫu bằng HTTPS public thật, đăng ký webhook và kiểm thử ngân hàng có phê duyệt.
- [ ] Import model thật: source/catalog hiện chưa có trên máy, ngoài phạm vi thay đổi lưu trữ lần này.

Xem [báo cáo](../LICENSE_PAYOS_IMPLEMENTATION_REPORT.md), [setup](license-payos-setup.md), [API](license-payos-api.md).

## Tổng quan

| Phase | Trạng thái |
|---|---|
| **A — Web store** | Đang làm. A0 xong một phần; A1 và A2 xong (giao diện đã duyệt); **A3 code xong, chờ Phúc kiểm tra giao diện đăng nhập**; A4–A6 chưa làm |
| **B — Kết nối 3ds Max** | Chưa bắt đầu. **Chỉ bắt đầu khi A4 pass** (giao diện đã được duyệt) |
| PoC native (WebView2 + bridge + MAXScript) | Đã chạy trên máy dev với trang demo `frontend/index.html`; chưa nối với web store |

## Phase A — Web store

### A0 — Chốt quyết định và dọn repo
- [x] Hướng đi: bán license từng model, dùng trong 3ds Max (D5)
- [x] Làm app mới thay `web/` cũ (D6); xóa `web/` ở nhánh `phuc_apps`
- [x] Quyền phân phối thương mại 360 model: Phúc xác nhận đã có (R4)
- [x] Không cho user tải file nén trong browser (O7)
- [x] D7: PostgreSQL (2026-10-06)
- [x] O8: token đăng nhập bằng cookie HttpOnly (D9, 2026-10-06)
- [x] Secret trong `.env_local` cũ (Wasabi, JWT, Google, Mongo): Phúc xác nhận **không còn dùng**, không cần đổi key hay xóa khỏi lịch sử git (2026-10-06)
- [ ] Commit và merge `phuc_apps` vào `main` (hiện `main` cố ý giữ code cũ)

### A1 — Ingest catalog (`apps/store-api/scripts/ingest.js`)
- [x] Quét `source/3DSMOOD`, ghép ảnh với file nén: **360/360 sản phẩm, 0 file lẻ**
- [x] Sinh thumbnail `.webp` (480px, 1400px) vào `storage/previews/`
- [x] Tên hiển thị từ file `.max` trong gói (296/360); còn lại đặt `<Subcategory> NN`
- [x] Manifest gói: định dạng (max/fbx/obj), renderer (V-Ray/Corona), có texture, dung lượng
- [x] Chạy lại nhiều lần không tạo bản trùng; có báo cáo `storage/ingest-report.json`
- [x] Test: ghép cặp, đặt tên (`npm test`)
- [ ] **TỒN ĐỌNG A1-1 — 24 file `.rar` dạng solid không đọc được** bằng `bsdtar`/`tar` (libarchive
  không hỗ trợ RAR solid). Hậu quả: 24 sản phẩm thiếu tên thật, danh sách `.max`, renderer; chưa
  đóng gói lại được. **Hướng giải quyết:** `brew install sevenzip` (lệnh `7zz`) hoặc
  `brew install unar`; trong `ingest.js` thêm nhánh: nếu `tar` lỗi thì thử `7zz l` / `lsar`.
  Danh sách file lỗi: `storage/ingest-report.json` → `archiveErrors`. Kiểm tra: chạy lại ingest,
  `archiveErrors` phải về 0. Làm trước A1-3.
- [ ] **TỒN ĐỌNG A1-2 — 64/360 sản phẩm tên dạng `<Subcategory> NN`** (không suy ra được từ `.max`);
  tên suy ra từ `.max` cũng chưa được duyệt hết. **Hướng giải quyết:** (a) làm A5 (admin) cho sửa
  tên; hoặc (b) xuất `catalog.json` ra CSV `id,name`, Phúc điền tên, ingest đọc file override
  `data/names.csv`. Chọn (a) nếu ít tên cần sửa, (b) nếu muốn sửa hàng loạt.
- [ ] **TỒN ĐỌNG A1-3 — Đóng gói lại mỗi asset thành `.zip` chuẩn hóa** (`storage/assets/<sha256>.zip`)
  cho native ở Phase B (plugin chỉ cần `System.IO.Compression`, không thêm NuGet). Chưa cần cho
  A3–A6. **Hướng giải quyết:** thêm bước vào ingest: extract vào thư mục tạm → kiểm đường dẫn
  (zip-slip, đường dẫn tuyệt đối, giới hạn số file/dung lượng) → nén `.zip` → ghi `assetKey`.
  Phụ thuộc A1-1. Làm trước B4.
- [ ] sha256 đã có trong catalog nhưng chưa dùng; cần cho import ticket (B3/B4)

### A2 — Catalog API + giao diện xem preview
- [x] API: categories, products (tìm kiếm, lọc, phân trang), chi tiết, health
- [x] API không lộ đường dẫn nguồn và sha256 (có test)
- [x] Giao diện: sidebar category, tìm kiếm, lưới ảnh, "Xem thêm", cửa sổ chi tiết, responsive
- [x] Build frontend thành công; qua proxy Vite thì API/ảnh/font/icon trả 200
- [x] Phúc đã xem và kiểm tra giao diện trên trình duyệt thật: ổn (2026-10-06)
- [x] Phúc duyệt giao diện — **cổng review để sang Phase B đã qua** (vẫn còn cổng A4 pass)
- [ ] Thử ở bề rộng panel Max (~400–700px) và trong WebView2
- [ ] Chạy thử trên Windows (chưa có máy; `tar.exe` đọc RAR chưa xác minh)
- [ ] Catalog vẫn đọc từ `catalog.json`; Postgres hiện chỉ chứa tài khoản/phiên. Sản phẩm vào DB khi cần (A4: khóa ngoại license → product, A5: admin sửa tên/giá)

### A3 — Tài khoản (code xong 2026-10-06, **chờ Phúc kiểm tra giao diện**)
- [x] Đăng ký / đăng nhập / đăng xuất / `me` bằng email + mật khẩu (`apps/store-api/src/auth.js`)
- [x] Cập nhật 2026-10-25: JWT HS256 trong cookie HttpOnly + SameSite=Lax, Secure khi production.
  PostgreSQL giữ session ID để thu hồi ngay; mật khẩu vẫn băm `scrypt` (D13 thay D9).
- [x] Kiểm chứng JWT 2026-10-25: **77/77 backend tests**, coverage **90.68% lines / 85.67% branches**;
  frontend **22/22**, build thành công, dependency audit 0 vulnerabilities. Test có sửa token, sai chữ ký,
  hết hạn, sai chủ session, thiếu signing key và thu hồi logout/device/ticket. Không cần migration schema;
  cookie opaque cũ cần đăng nhập lại một lần, fixed slots được giữ nguyên.
- [x] PostgreSQL 16 + migration tự chạy khi khởi động (`migrations/001_init.sql`: `users`, `sessions`)
- [x] Chống CSRF: kiểm `Origin` + chỉ nhận JSON; giới hạn 10 KB/body
- [x] Giới hạn đăng nhập sai: 10 lần/15 phút theo email, 100 lần/15 phút theo IP → 429
- [x] Thông báo đăng nhập sai giống nhau cho "email lạ" và "sai mật khẩu"; có băm giả để thời gian
  phản hồi không lộ email nào tồn tại
- [x] Giao diện: nút Đăng nhập → hộp thoại Đăng nhập/Đăng ký, hiện email + nút Đăng xuất
- [x] 9 test mới trên Postgres thật (tổng 15 test pass). Đã **thử phá code có chủ đích** (bỏ kiểm
  Origin, bỏ kiểm hết hạn, bỏ kiểm mật khẩu, bỏ giới hạn, lưu token thô): mỗi lần đều có test báo lỗi
- [x] Chạy đầu-cuối qua proxy Vite bằng curl: đăng ký (201, cookie `HttpOnly; SameSite=Lax`) → `me` →
  đăng xuất → `me` 401; Origin lạ bị 403; catalog vẫn chạy
- [~] **Chưa ai xem giao diện đăng nhập trên trình duyệt thật** (tôi chỉ kiểm được build và API) —
  Phúc kiểm tra: đăng ký, F5 vẫn còn đăng nhập, đăng xuất, thử sai mật khẩu, thử email trùng
- [ ] **TỒN ĐỌNG A3-1 — Quên mật khẩu / đổi mật khẩu chưa có.** Chờ chọn dịch vụ gửi email (Phúc:
  "tính sau"). **Hướng giải quyết:** chọn nhà cung cấp (Resend/SendGrid/SMTP của tên miền), thêm bảng
  `password_resets` (token băm, hạn 30 phút, dùng 1 lần), 2 route `forgot`/`reset`; khi đổi mật khẩu
  phải **xóa mọi session của user** (`delete from sessions where user_id = ...`). Đổi mật khẩu khi đã
  đăng nhập (không cần email) có thể làm trước, độc lập.
- [ ] **TỒN ĐỌNG A3-2 — Session hết hạn không bị xóa khỏi DB** (chỉ bị từ chối khi dùng). Bảng
  `sessions` sẽ phình dần. **Hướng giải quyết:** job định kỳ `delete from sessions where expires_at <
  now()` (ví dụ mỗi giờ trong `server.js`, hoặc cron của hệ thống ở A6).
- [ ] **TỒN ĐỌNG A3-3 — Giới hạn đăng nhập sai nằm trong RAM của 1 tiến trình.** Khởi động lại là reset;
  chạy nhiều instance thì mỗi instance đếm riêng. Ngoài ra khi API đứng sau proxy/load balancer,
  `req.ip` sẽ là IP của proxy → mọi người dùng chung một bộ đếm IP. **Hướng giải quyết (A6):** đặt
  `app.set('trust proxy', ...)` đúng theo hạ tầng deploy; chuyển bộ đếm sang bảng DB hoặc Redis nếu
  chạy nhiều instance.
- [ ] **TỒN ĐỌNG A3-4 — Đăng ký lộ việc email đã tồn tại** (trả 409 `EMAIL_TAKEN`). Đánh đổi có chủ
  ý để người dùng biết mà đăng nhập. **Hướng giải quyết nếu cần chặt hơn:** trả thông báo trung tính và
  gửi email xác nhận (phụ thuộc A3-1).
- [ ] **TỒN ĐỌNG A3-5 — Chưa xác minh email** (ai cũng đăng ký được bằng email bất kỳ). Phụ thuộc A3-1.
- [ ] **TỒN ĐỌNG A3-6 — `docker-compose.yml` chưa chạy thử** (Docker chưa bật trên máy dev; Postgres
  đang dùng bản Homebrew). **Hướng giải quyết:** bật Docker Desktop, tắt Postgres Homebrew hoặc đổi
  cổng, chạy `docker compose up -d` rồi `npm test` để xác nhận.
- [ ] Google login — để sau, cần thử riêng trong WebView2 (O2)

### A4 — Giỏ hàng, thanh toán, license
- [ ] Chốt cổng thanh toán (O6; đề xuất SePay/VietQR, chưa so sánh phí các cổng khác)
- [ ] Tạo đơn (server tự tính giá), mã QR, kiểm trạng thái đơn, hết hạn đơn
- [ ] Webhook xác nhận thanh toán: bắt buộc xác thực, chống xử lý trùng, đối soát
- [ ] Cấp license `(user, product)` sau khi thanh toán được xác minh
- [ ] Trang "Thư viện của tôi"; nút Mua đổi theo trạng thái (hiện đang khóa, ghi "sắp có")
- [ ] Test các tình huống: thiếu tiền, dư tiền, sai mã, webhook gửi trùng, đơn hết hạn

### A5 — Admin tối thiểu
- [ ] Duyệt/ẩn sản phẩm, sửa tên và giá
- [ ] Xem đơn và payment, khớp thủ công, cấp/thu hồi license
- [ ] Phân quyền admin ở API

### A6 — Hardening và staging
- [ ] HTTPS, CORS/CSP theo môi trường, secret qua biến môi trường
- [ ] Backup database và thử restore
- [ ] Deploy staging, test E2E (xem → đăng nhập → mua → thấy trong thư viện)

## UI-1 — Giao diện plugin theme tối (2026-10-19, chỉ frontend `apps/store-web`)

Tham khảo bố cục từ ảnh Phúc gửi (thư viện model dạng app desktop); **không** dùng tên/logo của sản phẩm đó.

- [x] Theme tối, accent xanh; tên model dùng Codec Pro, số liệu/trạng thái dùng font monospace hệ thống
- [x] Khung app: thanh trên (trạng thái 3ds Max + API ONLINE/OFFLINE + làm mới), cột icon (Models, Tài khoản),
  cột bộ lọc + hàng đợi, lưới, panel chi tiết bên phải (màn hẹp: bộ lọc thành ngăn kéo, chi tiết phủ lên)
- [x] Bộ lọc: cây danh mục chọn nhiều (checkbox 3 trạng thái), lọc renderer V-Ray/Corona, đếm bộ lọc, xóa lọc
- [x] Tìm kiếm, sắp xếp (tên, dung lượng), phân trang 30/trang, tab Online / Đã tải
- [x] Card: ảnh nền trắng, nhãn renderer, dung lượng; trong Max có nút Download theo trạng thái
  (Đăng nhập để tải / Download / Trong hàng đợi / Đang tải / Lỗi · Thử lại / Đã import)
- [x] Hàng đợi (`queue.js`): chống bấm trùng, chạy tuần tự, thử lại xin ticket mới, bỏ job chờ/lỗi
- [x] **Bỏ nút Download trên trình duyệt (O7)**; trình duyệt chỉ xem catalog + nút "Mua license — sắp có"
- [x] Giả lập host khi dev: `http://localhost:5173/?mockMax=1` (không có trong bản build production — đã kiểm)
- [x] 3 test hàng đợi (`cd apps/store-web && npm test`); thử phá code: bỏ chạy tuần tự / bỏ chống trùng /
  cho bỏ job đang chạy → đều có test báo lỗi
- [x] Build pass; API trả đủ 360 sản phẩm qua 4 trang
- [~] **Chưa ai xem giao diện mới trên trình duyệt thật** — Phúc kiểm tra (cả chế độ thường và `?mockMax=1`)
- [ ] **Chưa chạy trong 3ds Max thật** (cần Windows) — checklist ở `download-queue-plan.md` §7
- [ ] **NỢ FE-1 — Web tải hết catalog về rồi lọc/sắp xếp/phân trang tại chỗ.** Đủ cho 360 sản phẩm (~100 KB),
  không đủ khi lên hàng nghìn. **Hướng giải quyết:** backend lọc nhiều danh mục + renderer + sắp xếp (BE5), web
  quay lại gọi theo trang.
- [ ] **NỢ FE-2 — Hàng đợi chưa có %, chưa hủy được job đang chạy, mất khi F5, tab "Đã tải" chỉ là trong phiên.**
  Nguyên nhân: native chưa gửi event tiến độ / chưa hỗ trợ hủy / xóa cache sau import. **Hướng giải quyết:**
  N1–N5 rồi F1–F4 trong `download-queue-plan.md`.
- [ ] **NỢ FE-3 — Thanh trên chưa hiện tên file scene** (scene.getInfo chưa trả). Hướng: N6 + F5.
- [ ] **NỢ FE-4 — Chưa có lọc "Đã sở hữu / Chưa mua"** (thay cho PRO/FREE trong ảnh tham khảo) và không có lọc
  Style (dữ liệu không có style). Hướng: BE4 cùng A4.
- [ ] **NỢ FE-5 — Mỗi sản phẩm chỉ có 1 ảnh** nên panel chi tiết không có gallery. Cần dữ liệu ảnh thêm.

### Nợ backend phát sinh (chi tiết: `download-queue-plan.md` §5)
- [ ] **BE2 — Gỡ `GET /api/products/:slug/download`** (trái O7; giao diện đã bỏ nút nhưng endpoint vẫn tải được). Làm ngay.
- [ ] BE1 — `import-ticket` kiểm license (cùng A4). Hiện đăng nhập là import được mọi sản phẩm.
- [ ] BE3 — trả `sha256` + `size` cùng ticket để native kiểm file.
- [ ] BE4 — cờ `owned` trong danh sách sản phẩm. · BE5 — lọc/sắp xếp ở server. · BE6 — giới hạn ticket/phút.

## Phase B — Kết nối 3ds Max (đang làm trên nhánh `hung-connection_to_3dsmax`)

Chi tiết kỹ thuật: [`web-in-3dsmax-integration-plan.md`](web-in-3dsmax-integration-plan.md) (Phase 4–14).

- [x] PoC: WebView2 trong Max, bridge `host.ping` / `scene.*` / `design.create`, installer (chỉ với trang demo)
- [~] B1: host nạp `StartUrl` theo cấu hình, kiểm origin chính xác scheme/host/port (đã có trong code của Hùng —
  chưa xác minh trên Windows). Còn path `D:\` dự phòng trong `PlatformBridge.ms` / `.mcr`
- [~] B2: `bridge.js` + nút Download/hàng đợi trên giao diện mới; thanh trạng thái dùng `host.getInfo`/`scene.getInfo`.
  Chưa chạy trong Max thật
- [~] Ticket import 1 lần (Hùng, `import_tickets`) — **chưa kiểm license (BE1)**
- [ ] Hàng đợi native, tiến độ, hủy, cache: **plan cho người làm Windows ở [`download-queue-plan.md`](download-queue-plan.md)**
- [ ] B3: đăng ký máy (device) + import ticket dùng 1 lần
- [ ] B4: native tải file, kiểm sha256, giải nén an toàn, cache
- [ ] B5: import `.max` vào scene (chọn bản theo version/renderer)
- [ ] B6: tiến trình, installer, ký số, test trên máy sạch

## Câu hỏi còn mở

| # | Câu hỏi | Chặn |
|---|---|---|
| O6 | Cổng thanh toán | A4 |
| O5 | Mức bảo vệ asset (chỉ license + giới hạn máy, hay thêm mã hóa cache) | B3–B5 |
| O7 | Số máy tối đa mỗi tài khoản (đã chốt: không Download trên trình duyệt) | B3 |
| O4 | Kênh phân phối plugin (Autodesk App Store hay tự host) | B6 |

## Giới hạn đã biết

- Mọi thứ trong `apps/` mới chỉ chạy thử trên **macOS**.
- Sau khi model đã vào scene Max thì không chặn được việc lưu ra file khác; license chỉ kiểm soát
  ai được lấy file nguồn (xem `product-roadmap.md` §3.4).

## Windows runtime — sửa lỗi merge (2026-10-26)

- Đã chạy luồng thật trong 3ds Max 2022 với API/Vite cục bộ và database test riêng: đăng nhập,
  license Lifetime, kích hoạt thiết bị TPM, cấp/dùng import ticket và merge model catalog.
  Không tạo thanh toán thật.
- Nguyên nhân `ASSET_IMPORT_FAILED` ở bản đã cài: chỉ có host/WebView2 DLL, thiếu SharpCompress
  và các dependency archive. Test chạy trực tiếp trên thư mục đã cài tái hiện
  `FileNotFoundException: SharpCompress 0.50.7`. Triển khai đầy đủ output và mở lại Max sửa được lỗi.
  Khi cập nhật phải đóng mọi Max và cài cả gói; không chỉ chép `MaxWebViewHost.dll`.
- `plugin-csharp/tests/run-package-tests.ps1 -PackageDirectory <Platform>` chạy host đã đóng gói
  trong CLR process riêng, kiểm giải nén ZIP/RAR/7z mà không mượn DLL từ thư mục test.
  `installer/build-installer.ps1` bắt buộc chạy test này trên stage trước khi tạo payload.
- Retest model thật `2111370.5b7ac43878188` (2 MB): client báo `Đã import`, Max có 10 entity
  được chọn và geometry hiển thị trong viewport. Đã lưu scene kết quả. Asset dùng V-Ray chưa
  cài trên máy test; cảnh báo missing renderer/material cần người dùng xử lý, không tự chuyển
  vật liệu hoặc xóa asset thiếu. Điều này chưa xác nhận chất lượng render V-Ray.
- Client có selector native cho scene đích: tên file, PID và đường dẫn đầy đủ. Nhiều Max
  bắt buộc chọn rõ đích; đổi focus không đổi lựa chọn. Mở/new/reset file thay document token;
  path/token được adapter kiểm ngay trước merge, không fallback sang scene khác khi đích mất.
  Refresh bất đồng bộ được dùng chung và chờ xong trước khi chụp đích import.
- Kiểm chứng hai Max thật, cùng model trên: không chọn đích thì cả scene giữ nguyên;
  chọn B qua pipe làm A giữ 1 object, B tăng 0→10; đổi selector sang A làm A tăng 1→11,
  B giữ 10. Client báo `Đã import` ở cả hai lượt. Hai scene kết quả đã được lưu.
- Regression thực tế Max 2022: reset Untitled và mở lại cùng path đổi token; stale path/token
  bị từ chối trước mutation; fixture `.max` merge thành công; security guard vẫn fail closed.
  C# selection suite: 19 PASS; WebView2/IPC/Form suite: 23 PASS (gồm race mở Max thứ hai
  trong lúc metadata đang chờ); archive security suite: 15 PASS; package smoke: ZIP/RAR/7z PASS.
  Release x64 và installer build đã qua, gói đầy đủ được triển khai lại vào runtime test.
