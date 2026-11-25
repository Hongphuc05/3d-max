# Checklist chỉnh UI/UX plugin (nhánh `ui/plugin-polish`)

Review tại: **http://localhost:5173/?mockMax=1** (đã có dev server chạy; dữ liệu thật từ VPS, host Max giả).
Mẫu: ảnh Photoshop chủ dự án gửi 15/11/2026.

- Cột **Dev**: Claude tick khi code xong và đã gộp vào nhánh (localhost thấy được).
- Cột **Phúc**: chủ dự án tick sau khi review trên localhost.

| # | Việc | Nhóm | Dev | Phúc |
|---|---|---|---|---|
| 1 | Bỏ cột thông tin chi tiết model bên phải | Lưới | [x] | [ ] |
| 2 | Lưới **10 model/dòng**, tự co giãn theo chiều rộng plugin | Lưới | [x] | [ ] |
| 3 | Rê chuột vào ảnh thẻ → **popup ảnh lớn như bản cũ, to hơn 25%** (440 → 550px). *Sửa lại 15/11: lần đầu làm nhầm thành phóng tại chỗ* | Lưới | [x] | [ ] |
| 4 | Viền thẻ + nút Download / "Đã tải · Xem": chưa chọn = **trắng mờ**, đang chọn = **trắng**; bỏ viền đỏ | Lưới | [x] | [ ] |
| 5 | Khoảng trống **100px ở mép phải cùng** để đặt chuột cuộn (không chạm ảnh nên không bật popup) *(bỏ 22/11, trả lại 25/11 khi lưới cuộn lại)* | Lưới | [x] | [ ] |
| 6 | Ảnh **Scene**: hết 2 dải trắng, ảnh to hơn (thẻ 4:3; popup Scene khung ngang 720px, ảnh lấp đầy) | Lưới | [x] | [ ] |
| 7 | Thanh kết nối chuyển từ WinForms **vào web**: ô "Connected: <cửa sổ Max> ▾" bên trái hàng trên cùng, bấm để chọn cửa sổ Max. *Web + C# đã gộp; C# chưa build, phải kiểm trên Windows* | Header | [x] | [ ] |
| 8 | Nút **focus 3ds Max** chuyển vào web: nút **Home đỏ** góc phải, cạnh nút làm mới (đỏ). *Web + C# đã gộp; C# chưa build, phải kiểm trên Windows* | Header | [x] | [ ] |
| 9 | Tab Models/Scenes: dạng **"3D" + chữ nhỏ Models/Scenes** như mẫu, chừa chỗ thay icon khách gửi sau | Header | [x] | [ ] |
| 10 | Nút **Thiết bị** mở **popup** (giống Cài đặt): mã máy, phiên bản plugin | Header | [x] | [ ] |
| 11 | Ô **tìm model + sắp xếp** nằm cùng hàng, ngay sau Online / Đã tải (n) / Yêu thích (n) *(đã thử đưa lên header, trả về theo yêu cầu 15/11)* | Thanh lọc | [x] | [ ] |
| 12 | Icon danh mục: ô vuông → **hình tròn** (đang chọn = tròn đỏ) | Thanh lọc | [x] | [ ] |
| 13 | Hàng đợi: bỏ dòng mô tả, gọn 1 dòng "⇩ Hàng đợi · 0 job" như mẫu | Thanh lọc | [x] | [ ] |
| 14 | Phân trang: nút số trang « ‹ 1 2 3 … 8 9 10 › » + ô **Nhảy tới trang** | Thanh lọc | [x] | [ ] |
| 15 | Ô sắp xếp: bỏ **Nhẹ → nặng** và **Nặng → nhẹ**, còn Tên A → Z / Mới nhất / Cũ nhất | Thanh lọc | [x] | [ ] |
| 16 | Mỗi trang **100 model, 10 cột**, thẻ đầy đủ (ảnh, tên, dung lượng, nút Download), **cuộn dọc** *(đã thử 10×10 khít màn hình không cuộn, rollback 25/11)* | Lưới | [x] | [ ] |
| 17 | Tab Đã tải: **Mới nhất / Cũ nhất** xếp theo **lúc tải** (`downloadedAt`), không theo ngày model | Thanh lọc | [x] | [ ] |
| 18 | Popup **Thêm vào yêu thích**: bỏ nền gradient đỏ, nền tối đơn giản như Cài đặt | Popup | [x] | [ ] |
| 19 | Nút **− / +** cạnh ô sắp xếp: mỗi nấc thêm/bớt **1 cột** (4–16 cột). Mỗi trang = số cột × 10 hàng nên hàng cuối luôn đầy; đổi cột giữ model đang xem; **F5/mở lại về 10 × 10**; có cả trên web công khai | Thanh lọc | [x] | [ ] |
| 20 | Sang trang khác (hoặc đổi số cột) → **tự cuộn lên đầu lưới** | Thanh lọc | [x] | [ ] |
| 21 | Góc dưới: thanh **Hàng đợi** và thanh **phân trang** cùng cao 48px, viền trên thẳng hàng | Thanh lọc | [x] | [ ] |

Câu trả lời đã chốt (15/11): hover = popup ảnh lớn như bản cũ, to hơn 25%; "Nhập số trang" = nhảy tới trang; nút focus Max chỉ chỉnh giao diện (chức năng đã chạy).
