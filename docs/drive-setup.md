# Thiết lập kết nối Google Drive (v3 · P1)

> Việc **thủ công** của chủ dự án. Code P1 đã xong và test bằng Drive giả; các bước dưới đây để chạy **thật** và ghi biên bản vào
> [`STATUS.md`](STATUS.md). Chưa làm các bước này thì chưa thể kết luận Q4 hay xác nhận "tải được file từ Drive private".

## 1. Chuẩn bị tài khoản
1. **Gmail A** (chủ thư mục): chia sẻ thư mục root `3DSMOOD` cho **Gmail B** quyền **Viewer**.
2. Trên thư mục đó, **không tắt** "Người xem và người nhận xét có thể xem tùy chọn tải xuống" — nếu tắt, Drive sẽ từ chối tải qua API
   (`capabilities.canDownload=false`), và hệ thống **không** tìm cách vượt qua.

## 2. Google Cloud (đăng nhập bằng Gmail B hoặc tài khoản quản trị dự án)
1. Tạo project → bật **Google Drive API**.
2. *OAuth consent screen*: loại External, thêm **Gmail B vào Test users**. Ghi lại trạng thái hiện tại (**Testing** hay **In production**).
3. *Credentials → Create OAuth client ID → Web application*. Thêm **Authorized redirect URI**:
   `http://localhost:4000/api/admin/drive/oauth/callback` (dev) và `https://<domain>/api/admin/drive/oauth/callback` (production).
4. Scope duy nhất ứng dụng xin: `https://www.googleapis.com/auth/drive.readonly`.

> **Lưu ý (chưa kiểm chứng ở đây — đối chiếu tài liệu Google hiện hành):** ứng dụng ở trạng thái *Testing* có thể làm refresh token
> **hết hạn sau 7 ngày**, và scope `drive.readonly` thuộc nhóm *restricted* có thể cần Google xác minh khi chuyển *Production*.
> Hệ thống xử lý: token bị thu hồi/hết hạn → kết nối chuyển `RECONNECT_REQUIRED` và admin bấm **Kết nối lại**.

## 3. Cấu hình máy chủ (`apps/store-api/.env`)
Điền `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (khớp **chính xác** mục 2.3) và tạo khóa:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"   # → DRIVE_TOKEN_KEY
```
Khởi động API: nếu thiếu biến, log sẽ in **tên biến còn thiếu** (không in giá trị).

## 4. Kết nối và thử
1. Đăng nhập admin → mở `GET /api/admin/drive/oauth/start` (P3 sẽ có nút **Kết nối**) → đăng nhập **Gmail B** → đồng ý quyền đọc Drive.
2. `GET /api/admin/drive/status` → `connection.status = CONNECTED`.
3. `POST /api/admin/drive/sources` body `{"rootFolderUrlOrId":"<link thư mục 3DSMOOD>"}`.
4. `POST /api/admin/drive/test-access` body `{}` → kỳ vọng `canList:true`, `canDownloadSample:true`.

## 5. Thăm dò đầy đủ (biên bản P1.3)
```bash
cd apps/store-api
node --env-file=.env scripts/drive-probe.js --folder "<link thư mục>" --connection <id trong drive_connections>
```
Kỳ vọng theo tài liệu nhánh nam: **~126 thư mục / ~845 file / 360 model**. Script tải thử file **nhỏ nhất, trung vị, lớn nhất** vào bộ nhớ
(không ghi đĩa), kiểm kích thước + MD5 với Drive, đo MB/s. Báo cáo: `storage/drive-probe-report.json` (không chứa ID Drive hay token).
Ghi kết quả vào `STATUS.md` mục P1.

## 6. So sánh Service Account (Q4)
1. Cloud Console → *IAM → Service Accounts* → tạo tài khoản + khóa JSON (**không commit**).
2. Chia sẻ thư mục root cho email của service account (quyền Viewer).
3. `node --env-file=.env scripts/drive-probe.js --folder "<link>" --service-account ./sa-key.json`
4. So sánh với kết quả OAuth: tốc độ, lỗi, và (quan trọng) token có hết hạn sau vài ngày không. Chốt Q4 trong `decisions.md`.

## 7. Bảo mật
* `DRIVE_TOKEN_KEY` và client secret chỉ nằm trong `.env`/secret manager. Refresh token trong DB luôn được mã hóa AES-256-GCM, gắn với id dòng kết nối.
* API admin **không bao giờ** trả token, ciphertext hay ID thư mục/file của model ra ngoài; plugin khách không nhận ID Drive.
