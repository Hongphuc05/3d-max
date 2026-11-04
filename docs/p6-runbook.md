# P6 — Runbook VPS: triển khai, rollback, backup, giám sát, nghiệm thu

> Theo `v3-implementation-plan.md` §P6 và `v3-architecture.md` §10.2. File cấu hình nằm ở [`deploy/`](../deploy/).
> **Quy ước:** ứng dụng `/opt/3dsmood` (git checkout), dữ liệu `/var/lib/3dsmood` (`STORAGE_DIR`), env `/etc/3dsmood/store.env`
> (mẫu: `apps/store-api/.env.example`, **không commit**), admin web build ở `/var/www/3dsmood`, backup `/var/backups/3dsmood`, user chạy `dsmood`.

## 0. Đã kiểm chứng gì, chưa gì (2026-11-02, máy dev Windows + Docker)

| Hạng mục | Đã kiểm chứng | Cách | CHƯA kiểm chứng |
|---|---|---|---|
| `deploy/nginx/3dsmood.conf` | `nginx -t` + 18 ca hành vi thật (preview từ đĩa + cache, rơi về API, chặn `/internal`, 413, HSTS/nosniff mọi location, SPA fallback, redirect HTTP) trong `nginx:stable` | `deploy/nginx/smoke-test.sh` | TLS Let's Encrypt thật, `limit_conn`/`limit_req` dưới tải, SSE qua Nginx thật, stream model 30 phút |
| `deploy/systemd/*` | `systemd-analyze verify` không lỗi | container Debian | Chạy thật trên VPS: `MemoryMax`, hardening, tự lên sau reboot |
| `deploy/backup.sh` + `restore-drill.sh` | Sao lưu thật DB dev (360 model), giữ đúng N bản, đối chiếu số dòng, **restore sang DB tạm = PASS**; ca phải FAIL đều FAIL (trùng production / lệch số dòng / dump cụt); không để lại DB tạm | container `postgres:16` | Restore trên **máy sạch khác**, `BACKUP_RSYNC_TARGET` ra ngoài VPS, dữ liệu production |
| Giám sát (`scripts/monitor.js`) | Logic + SQL trên PostgreSQL thật (15 test, đột biến) | `npm test` | Chạy bằng systemd timer, `systemctl show MainPID`, gửi Telegram thật |
| Rollback migration (`npm run migrate -- rollback`) | Test trên PostgreSQL thật, chạy tay trên DB dev | `src/rollback.test.js` | Diễn tập rollback trên bản sao production (plan E5) |
| Diễn tập deploy production (`deploy/rehearsal/rehearse.sh`) | Cả stack Postgres + API + worker + Nginx thật trong Docker: 30 kiểm tra PASS (migrate, health, 401, preview chung volume, SSE, giám sát, backup+restore, job Drive lỗi, DB sập rồi hồi phục) | `bash deploy/rehearsal/rehearse.sh` (cần Docker; `... down` để dọn) | systemd, TLS thật, `TRUST_PROXY=127.0.0.1`, tải model qua Nginx, Drive thật, RAM worker khi xử lý ảnh |

## 1. Chuẩn bị VPS (một lần)

```bash
# Ubuntu/Debian, VPS 2 GB. Cần: Node (cùng phiên bản dev, hiện 26.x — chưa kiểm phiên bản thấp nhất), PostgreSQL 16 CHỈ nghe localhost,
# postgresql-client (pg_dump/pg_restore/psql cho backup), nginx, certbot, rsync (nếu chép backup ra ngoài).
sudo useradd -r -m -d /var/lib/3dsmood dsmood
sudo mkdir -p /opt/3dsmood /etc/3dsmood /var/backups/3dsmood /var/www/3dsmood /var/www/certbot
sudo chown -R dsmood:dsmood /var/lib/3dsmood /var/backups/3dsmood
sudo git clone <repo> /opt/3dsmood && cd /opt/3dsmood && git checkout <nhánh/tag phát hành>
cd apps/store-api && npm ci --omit=dev
sudo install -m 600 -o dsmood /dev/null /etc/3dsmood/store.env   # rồi điền biến theo .env.example (xem §2)
```

PostgreSQL: tạo role/DB riêng (`createuser store`, `createdb -O store store`); `listen_addresses = 'localhost'`; `DATABASE_URL=postgres://store:<mật khẩu>@localhost:5432/store`.

## 2. Biến môi trường (`/etc/3dsmood/store.env`)

Tên và ý nghĩa từng biến: `apps/store-api/.env.example`. Bắt buộc cho production:

| Nhóm | Biến |
|---|---|
| Lõi | `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `NODE_ENV=production` (unit đã đặt), `TRUST_PROXY=127.0.0.1` (unit đã đặt) |
| Drive | `DRIVE_API_KEY` |
| Dữ liệu | `PREVIEW_DIR`, `MIN_FREE_DISK_BYTES`, `MODEL_CACHE_*` |
| Telegram | `TELEGRAM_*` (để trống hết = tắt) |
| Giám sát | `MONITOR_*` (tùy chọn; mặc định: đĩa trống < 20%, RAM > 800 MB, > 20 lỗi Drive/giờ, > 5 GiB/giờ, đơn chờ chủ > 60 phút) |

Thông tin ngân hàng **không** nằm trong env: nhập ở trang admin → Cài đặt (`app_settings`). Chưa nhập thì tạo đơn trả `PAYMENT_NOT_CONFIGURED`.

Production **không tự migrate khi khởi động** (`RUN_MIGRATIONS` mặc định false khi `NODE_ENV=production`). Luôn chạy tay ở §4.

## 3. Cài file cấu hình

```bash
sudo cp deploy/nginx/3dsmood.conf /etc/nginx/conf.d/3dsmood.conf   # sửa api.example.com
sudo certbot certonly --webroot -w /var/www/certbot -d <domain>     # cấp chứng chỉ TRƯỚC khi bật khối 443
sudo nginx -t && sudo systemctl reload nginx
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo chmod +x deploy/backup.sh deploy/restore-drill.sh
sudo systemctl daemon-reload
sudo systemctl enable --now store-api store-worker store-monitor.timer store-backup.timer
```

Kiểm Nginx **trước khi cài** (không cần VPS): `docker run --rm -v "$PWD/deploy/nginx:/t:ro" -v "$PWD/deploy/nginx/3dsmood.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable sh /t/smoke-test.sh` → phải in `PASS`.

## 4. Deploy (theo kiến trúc §10.2)

1. **Staging trước** (cùng cấu hình 2 GB): khôi phục bản sao DB production vào staging (`pg_restore`), chạy migration trên **bản sao**, smoke test (`/api/health`, mở plugin, mua thử).
2. **Production:**
   ```bash
   sudo systemctl start store-backup.service && journalctl -u store-backup -n 3                       # (1) backup ngay trước khi đổi (phải thấy "backup ok")
   cd /opt/3dsmood && git fetch && git checkout <tag mới> && (cd apps/store-api && npm ci --omit=dev)
   cd apps/store-api && sudo -u dsmood bash -c "set -a; . /etc/3dsmood/store.env; set +a; npm run migrate"   # (2) chỉ THÊM bảng/cột
   sudo systemctl restart store-api && sudo systemctl restart store-worker                           # (3) API rồi worker
   (cd ../store-web && npm ci && npm run build) && sudo rsync -a --delete ../store-web/dist/ /var/www/3dsmood/   # (4) admin web
   curl -fsS https://<domain>/api/health                                                               # (5) kiểm
   # Lần đầu: tạo admin  ->  ADMIN_PASSWORD=<mật khẩu> npm run create-admin -- <tên-đăng-nhập>   (cùng env như bước migrate)
   ```
3. Migration 023 xóa vĩnh viễn các bảng của hướng đã bỏ (license cũ, payOS, R2, catalog cũ); rollback của nó từ chối. Sao lưu (`deploy/backup.sh`) trước khi chạy.
4. **Bộ cài cho khách mới:** chạy `installer\build-installer.ps1 -ApiBaseUrl https://<domain>` (bộ cài không đóng sẵn catalog/ảnh: lần chạy đầu plugin tự tải từ VPS, D28.3). Khách cũ tự đồng bộ, không cần cài lại.

## 5. Rollback

| Tình huống | Làm |
|---|---|
| Code mới lỗi, migration chưa chạy hoặc chỉ thêm | `git checkout <tag cũ>` → `systemctl restart store-api store-worker`. Bảng/cột thêm không ảnh hưởng bản cũ |
| Migration mới lỗi | `npm run migrate -- rollback <file.sql>` (chỉ lùi được migration **mới nhất**; file rollback **từ chối** nếu sẽ mất quyền/đơn/nhật ký khách đã có). Ví dụ: `npm run migrate -- rollback 022_model_downloads.sql` |
| Dữ liệu hỏng | `pg_restore` từ bản backup gần nhất sang DB mới, đổi `DATABASE_URL`, khởi động lại. **Diễn tập trước** (§6) |
| Preview mất | Không cần rollback: chạy FULL sync để sinh lại (idempotent) |
| Khách cũ | Plugin cũ vẫn chạy offline qua Drive công khai → rollback server không làm họ mất dịch vụ |

## 6. Backup và diễn tập restore (plan E3)

- Tự động: `store-backup.timer` 03:30 hằng ngày, giữ 14 bản (`BACKUP_KEEP`), mỗi bản có `.counts` (số dòng bảng chính). Chép ra ngoài VPS: đặt `BACKUP_RSYNC_TARGET=user@máy-khác:/duong/dan/` trong env.
- **Diễn tập (làm định kỳ, và bắt buộc trước khi go-live)** trên **máy sạch**, không phải production:
  ```bash
  DRILL_ADMIN_URL=postgres://<user có CREATE DATABASE>@<máy-sạch>/postgres ./deploy/restore-drill.sh /đường/dẫn/3dsmood-XXXX.dump
  ```
  Phải in `PASS: restore drill` và số migration khớp. Script từ chối chạy nếu `DRILL_ADMIN_URL` trùng `DATABASE_URL`, và luôn xóa DB tạm.

## 7. Giám sát (plan E2)

`store-monitor.timer` chạy mỗi 5 phút, in vấn đề ra journal (`journalctl -u store-monitor`) và báo chủ qua Telegram khi **tập vấn đề đổi** (hoặc sau `MONITOR_REPEAT_HOURS`=6 giờ nếu vẫn còn; hết vấn đề báo "đã bình thường" một lần). Kiểm: đĩa < 20% trống, RAM từng tiến trình, job quét Drive FAILED 24 giờ, lỗi Drive/giờ, băng thông/giờ, đơn `AWAITING_OWNER` quá 60 phút, DB không kết nối. Thoát mã 2 = có vấn đề (systemd coi là thành công, xem journal). **Nếu Telegram tắt thì chỉ có journal** — cần người xem.
Chưa có: giám sát từ bên ngoài (khi cả VPS sập thì không ai báo) — nên thêm dịch vụ ping bên thứ ba vào `/api/health`.

## 8. Failure test (plan §P6.6) — thủ công trên staging

| # | Kịch bản | Cách làm | Mong đợi | Kết quả |
|---|---|---|---|---|
| F1 | API key Drive bị thu hồi/hết quota giữa job | Đổi `DRIVE_API_KEY` sai khi job đang chạy | Job FAILED hoặc COMPLETED_WITH_ERRORS, **catalog giữ nguyên**, có cảnh báo `jobs-failed`/`drive-errors` | chưa chạy |
| F2 | Reboot VPS giữa sync | `reboot` khi job RUNNING | Sau khi lên, job được nhận lại sau khi lease hết, không chạy trùng, không file `.part` mồ côi | chưa chạy |
| F3 | Đầy đĩa (giả lập) | Tạo file lớn đến khi trống < `MIN_FREE_DISK_BYTES` | Worker từ chối khởi động/dừng phần ảnh; cảnh báo `disk:storage`; API vẫn trả lời | chưa chạy |
| F4 | Rút mạng plugin giữa tải | Ngắt Internet khi đang tải model | Plugin báo lỗi, không import file dở, tải lại được | chưa chạy |
| F5 | Quyền bị thu hồi giữa phiên | Thu hồi entitlement khi UI còn nút Download | Bị từ chối, không tạo phiên | **đã đạt trên Max thật ở P4.5** |
| F6 | Postgres dừng | `systemctl stop postgresql` | `/api/health` 503, cảnh báo `db`, tự hồi phục khi DB lên lại | chưa chạy |
| F7 | Telegram không gọi được | Chặn `api.telegram.org` | Khách vẫn mua được, admin xác nhận trên web, thông báo thất bại ghi audit `OWNER_NOTIFY_FAILED` | chưa chạy (có test tự động với Telegram giả) |
| F8 | Tải đồng thời vượt giới hạn | autocannon vào `/api/v1/model-downloads` | `503 DOWNLOAD_BUSY`, RSS không tăng theo cỡ file | chưa chạy |

## 9. Checklist nghiệm thu E2E

> **Lưu ý:** plan ghi "18 tiêu chí nghiệm thu của master prompt (§14)" nhưng **bản master prompt không có trong repo**; chỉ biết chắc tiêu chí #17 (cấp tay MXL1 vẫn hoạt động, có ghi DB + audit). Bảng dưới là **bản nháp lập từ cột "Nghiệm thu" của `v3-architecture.md` §9** — chủ dự án cần đối chiếu/bổ sung với 18 tiêu chí gốc. Mỗi dòng ghi pass/fail + bằng chứng khi chạy.

| # | Tiêu chí | Cách kiểm | Pass/Fail | Bằng chứng |
|---|---|---|---|---|
| 1 | HTTPS chạy; restart VPS tự lên (E1) | Mở `https://<domain>/api/health` trước và sau `reboot` | | |
| 2 | Admin cấu hình nguồn Drive, quét FULL ra đủ 360 model / 845 file (B3) | Trang admin → Drive → quét; so số liệu | | |
| 3 | Quét lại không tải trùng ảnh; ngắt giữa chừng không để file nửa vời (B5) | Quét lần 2, kill worker giữa chừng | | |
| 4 | Scan lỗi → catalog giữ nguyên (B6) | Gây lỗi giữa job | | |
| 5 | Mục mơ hồ vào Needs Review; xác nhận → model xuất hiện (C4) | Trang Needs Review | | |
| 6 | Admin thêm model → plugin đang mở tự hiện trong ≤ 5 phút (D2) | Thêm/sửa tên model, đo thời gian | | |
| 7 | Cài xong, mở lần đầu **có mạng** tải đủ catalog + ảnh có tiến độ; ngắt giữa chừng chạy tiếp được (D28.3) | Cài, mở panel, rút mạng giữa chừng, bật lại | | |
| 8 | Mở plugin lần 2 offline vẫn thấy catalog (D1) | Rút mạng, mở panel | | |
| 9 | Token thiết bị không lọt ra JS (D3) | Kiểm bridge/DevTools: không có `Device …` | | |
| 10 | Máy khác không dùng được token; chữ ký sai/replay/hết hạn bị từ chối (A5/A6) | Test tự động + thử tay | | |
| 11 | Không có quyền → tải bị 403; **không lộ Drive ID** trong WebView2 (A7) | Quét cache WebView2 khi Max đã đóng (còn nợ từ P4.5) | | |
| 12 | Tải + kiểm hash + merge vào scene Max 2022 thật (D4) | Tải 1 model, import | | |
| 13 | Mua: QR đúng số tiền/nội dung, quét được bằng app ngân hàng thật (F2, P5.3) | Quét QR bằng ít nhất 2 app ngân hàng | | |
| 14 | Chủ nhận tin Telegram, bấm ✅ → plugin sang Download ≤ 10 giây (P5) | Đo bằng đồng hồ | | |
| 15 | Người lạ bấm nút / sai secret → bị bỏ qua (F1) | Gửi thử từ tài khoản khác | | |
| 16 | Đổi thông tin ngân hàng không làm đổi đơn đã tạo (C6) | Tạo đơn, đổi cài đặt, xem lại đơn | | |
| 17 | **Cấp thủ công / ký MXL1 vẫn hoạt động, có ghi DB + audit** | Trang thiết bị → cấp MXL1 | | |
| 18 | Thu hồi quyền chặn tải ngay (A6) | Thu hồi, thử tải | | |
| 19 | Backup + restore trên máy sạch PASS (E3) | §6 | | |
| 20 | Cảnh báo khi đĩa < 20% (E2) | Giả lập đĩa đầy | | |
| 21 | Diễn tập rollback (E5) | §5 trên staging | | |
