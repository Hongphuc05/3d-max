# Catalog Google Drive

Nguồn đang cấu hình là folder `1qQgoy1yLQuaO9S-yT_ZT7nai6EAA4OwA`. Không giả định đây là root 3DSMOOD: tên/thư mục con được đọc bằng Drive API v3. Chế độ mặc định `google_drive` không đọc `SOURCE_DIR` hoặc `storage/catalog.json`; nguồn local chỉ bật bằng `CATALOG_PROVIDER=local`.

## Cấu hình và chạy

Backend `.env` (đã gitignore) có `CATALOG_PROVIDER`, `GOOGLE_DRIVE_FOLDER_URL`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_API_KEY`, `GOOGLE_DRIVE_SYNC_INTERVAL_MINUTES=30`, `GOOGLE_DRIVE_PREVIEW_CACHE_DIR=./storage/drive-previews`. API key chỉ có trên server. Có thể thêm `GOOGLE_DRIVE_RESOURCE_KEY` nếu link nguồn yêu cầu resource key. Đường dẫn cache tương đối với working directory của backend; khi chạy trong `apps/store-api`, mặc định nằm tại `apps/store-api/storage/drive-previews`. Mount một persistent volume ở đường dẫn này và dùng chung cache giữa các API instances; hoặc triển khai adapter thay `FilePreviewStorage` bằng object storage.

Tạo key: trong [Google Cloud Console](https://console.cloud.google.com/apis/credentials), chọn project, bật **Google Drive API**, chọn Credentials → Create credentials → API key. API restrictions phải cho phép **Google Drive API**; giới hạn ứng dụng bằng IP backend phù hợp. Điền key vào `.env`, không vào mã nguồn/frontend/plugin. Xem [hướng dẫn chính thức](https://developers.google.com/workspace/guides/create-credentials) và [quản lý key](https://docs.cloud.google.com/docs/authentication/api-keys).

```powershell
cd apps/store-api
node --env-file-if-exists=.env scripts/migrate.js
npm start
# Máy phát triển hiện tại có database/license secrets riêng tại storage/license-dev.env:
npm run dev
# Kiểm tra Drive thật: JPG cache + stream một ZIP/RAR nhỏ nhất, không giữ archive trên server.
node --env-file-if-exists=.env scripts/check-drive.js --download-archive
# Manual sync cũng có CLI dùng cùng advisory lock/snapshot như admin endpoint:
npm run sync:drive
```

`npm start` dùng DATABASE_URL trong `.env`. Máy hiện tại chạy database phát triển qua file override `storage/license-dev.env`; không thay database/license/payment credentials hiện có. Production phải cấu hình DATABASE_URL và các secret ổn định, chạy migration bằng role phù hợp, HTTPS, origins/proxy và persistent cache. Các biến payOS được giữ nguyên.

## Dữ liệu và đồng bộ

Migration `008_drive_catalog.sql` thêm `catalog_sources`, `catalog_sync_runs`, `catalog_folders`, `catalog_models`, không sửa user/license/payment/ticket. Archive ID của Drive là source identity; ID model riêng 12 ký tự hex, được giữ qua rename, restart và tái xuất hiện. Folder category ID nội bộ được hash theo provider/root/folder, không trả Drive file IDs ra public API.

Provider dùng SDK `googleapis`, quét đầy đủ pagination và cây thư mục, xử lý resource keys, timeout và retry exponential backoff. Ghép basename NFKC, gộp whitespace, không phân biệt hoa/thường, chỉ trong cùng parent. Ưu tiên archive ZIP → RAR → 7z và preview JPG → JPEG → PNG → WebP; cùng loại chọn ID theo thứ tự ổn định và log ambiguity. Preview đơn lẻ không tạo model. Không suy đoán renderer/định dạng bên trong archive.

Worker chạy async sau startup mà không chặn API, sau đó mỗi 30 phút. Nếu PostgreSQL ghi nhận một lần sync lỗi gần đây, startup chờ đủ retry interval đã cấu hình; restart không tạo burst request. Một promise chặn sync trùng trong instance; PostgreSQL advisory lock giữ từ scan đến publish/cleanup chặn trùng giữa instances. Chỉ publish transaction sau khi toàn bộ scan và preview chuẩn bị thành công. Nếu bất kỳ page/folder/preview lỗi, snapshot cũ còn nguyên, không reconcile deletion. Version tăng khi nội dung thực sự đổi; last-seen/timestamp không làm tăng version. Bản ghi removed được giữ để ID ổn định.

Preview tải lúc sync, giới hạn 20 MiB và 40 triệu pixel, chỉ JPEG/PNG/WebP một frame; kiểm tra MIME, decode, kích thước/checksum rồi đổi sang WebP tối đa 1200 px, ghi atomic. Cache key dựa trên ID/checksum/modifiedTime/size. Preview bị xóa sẽ bỏ reference ngay sau publish; cache không tham chiếu được dọn sau thời gian đệm một giờ để tránh đụng file sync khác đang chuẩn bị. Không cache archive. API trả ETag, URL có version và revalidate sau 120 giây; URL version cũ không tiếp tục phục vụ preview đã thay/xóa.

## API

| API | Công dụng |
| --- | --- |
| `GET /api/catalog/version` | version, catalogKey, provider, state, syncing, lastSuccessfulSync, error, report |
| `GET /api/catalog/status` | alias status/version |
| `GET /api/categories` | cây thư mục đệ quy, kể cả thư mục rỗng |
| `GET /api/products` | catalog PostgreSQL, `q/category/sub/folder/renderer/sort/page/limit`, limit tối đa 100 |
| `GET /api/products/:slug` | model public |
| `GET /api/catalog/models/:id/preview?v=...` | chỉ đọc cache nội bộ, không gọi Drive theo mỗi request |
| `POST /api/admin/catalog/sync` | JSON + JWT HttpOnly + user UUID trong LICENSE_ADMIN_USER_IDS; trả 202 |
| `POST /api/products/:slug/import-ticket` | JWT + license/device session; ticket một lần, tối đa 5 phút |
| `GET /api/downloads/stream/:ticket` | revalidate session/license/device, consume ticket atomic, stream từ Drive |

Status: `not_synced`, `syncing`, `ready`, `empty`, `error`, `configuration_required`. `lastAttempt` có thời điểm/duration/error kể cả khi thất bại. `DRIVE_AUTOMATED_REQUESTS_BLOCKED` dừng ngay, không retry nhanh hoặc bypass; chờ lịch sync/hướng dẫn Google. Report gồm duration, folders/files scanned, models added/updated/removed, previews updated; lỗi chỉ lưu code đã lọc. `GOOGLE_DRIVE_API_DISABLED`, `GOOGLE_DRIVE_API_KEY_RESTRICTED`, `DRIVE_PERMISSION_DENIED`, `DRIVE_FILE_OR_RESOURCE_KEY_NOT_FOUND`, `DRIVE_DOWNLOAD_RESTRICTED`, `DRIVE_QUOTA_EXCEEDED`, `DRIVE_TIMEOUT` là các trường hợp riêng. [Resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys) và [download API](https://developers.google.com/workspace/drive/api/guides/manage-downloads) dùng theo phương thức Google hỗ trợ; không vượt hạn chế tải.

React fetch khi mở, kiểm tra version mỗi 120 giây và khi focus/foreground, hủy request/timer khi unmount. Tải các page theo nhóm tối đa bốn, kiểm tra version để không publish snapshot trộn hai lần sync. Refresh không reload WebView hoặc reset license/login/queue/model còn tồn tại. Job giữ snapshot model để Online deletion không xóa lịch sử Đã tải trong phiên; queue vẫn có phạm vi RAM như thiết kế trước đó.

## Download và plugin

JWT nằm trong cookie HttpOnly `sid` của WebView, proof thiết bị trong `dsid`; native không cần giữ JWT/API key. Backend kiểm tra user, Lifetime ACTIVE và thiết bị đã ký proof trong hai slot cố định trước khi cấp ticket/fetch archive. Khi redeem, SQL kiểm tra lại entitlement và consume một lần. Client chỉ gửi model slug/ID nội bộ/ticket; server tự map Drive ID. API không nhận arbitrary Drive file ID/download URL.

Archive stream có backpressure, bốn lượt tải đồng thời mỗi instance, timeout 30 phút, hủy upstream khi client ngắt, kiểm tra số byte khi biết kích thước. Không giữ archive lâu dài. Resume/Range **không được công bố hỗ trợ**: endpoint trả `Accept-Ranges: none`, vì ticket một lần; lỗi cần xin ticket mới.

Plugin net48 dùng SharpCompress 0.50.7 (MIT; deploy cùng các dependency DLL trong bin/Release), sniff ZIP/RAR/7z, kiểm tra manifest rồi kiểm tra lại từng entry thực sự đọc, từ chối link/reparse point/path traversal/NTFS device/ADS/duplicate/encrypted/corrupt archive. Giới hạn package 2 GiB, giải nén 8 GiB và 20.000 entries; timeout/cancellation và byte limit vẫn áp dụng nếu không có Content-Length. Không ghi các file script/executable trong blocklist; không chạy extractor command từ archive. Ưu tiên `.max`, rồi FBX/OBJ để giữ tương thích. Dùng GUID cache directory và giữ texture sau khi giao lệnh merge (kể cả mất reply); chỉ xóa package và nội dung chưa giao scene một cách an toàn. Tiến độ native qua bridge không tiêu thụ final response.

File `.max` có thể chứa embedded scripts. `PlatformBridge.ms` kiểm tra Safe Scene Script Execution hiện hành và block MAXScript/Python/.NET trước merge, trả `SCENE_SCRIPT_PROTECTION_REQUIRED` nếu chưa bật; không tự thay thiết lập bảo mật. API riêng cho script-file assets được kiểm tra ở bản mới; Max2022 chưa có API/tính năng riêng này nên chỉ áp dụng bốn cờ hiện hành đã kiểm chứng. Cần giữ Scene Security Tools cập nhật. Đây là bảo vệ được Autodesk cung cấp, không phải tuyên bố sandbox tuyệt đối cho mọi renderer/plugin. Xem [API security manager](https://help.autodesk.com/cloudhelp/2024/ENU/MAXScript-Help/files/3ds-Max-Objects-and-Interfaces/Interfaces/Core-Interfaces/Core-Interfaces-Documentation/S/GUID-63268EE4-CC58-49B1-B94D-A63090DD3EC4.html).

Drive gốc công khai: JWT chỉ kiểm soát download qua 3DsMood; người có link nguồn vẫn có thể truy cập theo quyền Google Drive.
