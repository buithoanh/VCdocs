---
name: vcworkspace-change
description: Thực hiện thay đổi mã VCworkspace, kiểm tra theo phạm vi và bàn giao bằng chứng.
---

# vcworkspace-change

Đọc AGENTS.md và sổ tay; xác định đúng nhánh, thay đổi có sẵn và tiêu chí nghiệm thu.
Giữ định danh @vcdocs/* đang chạy. Dùng Google giả; không khởi động BE tự nạp .env thật.
Thay đổi hợp đồng phải nằm trong phạm vi được giao, nếu không ghi đề nghị cho phiên hợp đồng.
Khi sửa hành vi, chọn test chứng minh hành vi đó; chạy `pnpm ai:check` trên bản cuối.
Trước bàn giao tích hợp, chạy `pnpm ai:check:full` trong môi trường không có secret thật.
Không nới assertion hay bỏ kiểm coverage. Ghi lệnh/kết quả/blocker thực tế và cập nhật sổ tay.
