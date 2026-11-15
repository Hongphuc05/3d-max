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
| 5 | Khoảng trống **28px ở mép phải cùng** của plugin để đặt chuột cuộn (không chạm ảnh nên không bật popup) | Lưới | [x] | [ ] |
| 6 | Ảnh **Scene**: hết 2 dải trắng, ảnh to hơn (thẻ 4:3; popup Scene khung ngang 720px, ảnh lấp đầy) | Lưới | [x] | [ ] |
| 7 | Thanh kết nối chuyển từ WinForms **vào web**: ô "Connected: <cửa sổ Max> ▾" bên trái hàng trên cùng, bấm để chọn cửa sổ Max. *Web + C# đã gộp; C# chưa build, phải kiểm trên Windows* | Header | [x] | [ ] |
| 8 | Nút **focus 3ds Max** chuyển vào web: nút **Home đỏ** góc phải, cạnh nút làm mới (đỏ). *Web + C# đã gộp; C# chưa build, phải kiểm trên Windows* | Header | [x] | [ ] |
| 9 | Tab Models/Scenes: dạng **"3D" + chữ nhỏ Models/Scenes** như mẫu, chừa chỗ thay icon khách gửi sau | Header | [x] | [ ] |
| 10 | Nút **Thiết bị** mở **popup** (giống Cài đặt): mã máy, phiên bản plugin | Header | [x] | [ ] |
| 11 | Ô **tìm model + sắp xếp** lên cùng hàng với Online / Đã tải (n) / Yêu thích (n) *(thay bởi mục 16)* | Thanh lọc | [x] | [ ] |
| 12 | Icon danh mục: ô vuông → **hình tròn** (đang chọn = tròn đỏ) | Thanh lọc | [x] | [ ] |
| 13 | Hàng đợi: bỏ dòng mô tả, gọn 1 dòng "⇩ Hàng đợi · 0 job" như mẫu | Thanh lọc | [x] | [ ] |
| 14 | Phân trang: nút số trang « ‹ 1 2 3 … 8 9 10 › » + ô **Nhảy tới trang** | Thanh lọc | [x] | [ ] |
| 15 | Ô sắp xếp: bỏ **Nhẹ → nặng** và **Nặng → nhẹ**, còn Tên A → Z / Mới nhất / Cũ nhất | Thanh lọc | [x] | [ ] |
| 16 | **Tìm model + sắp xếp** lên hàng trên cùng, nằm giữa ô Connected và nút ONLINE | Header | [x] | [ ] |

Câu trả lời đã chốt (15/11): hover = popup ảnh lớn như bản cũ, to hơn 25%; "Nhập số trang" = nhảy tới trang; nút focus Max chỉ chỉnh giao diện (chức năng đã chạy).
