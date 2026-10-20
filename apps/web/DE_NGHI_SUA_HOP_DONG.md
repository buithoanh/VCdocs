# Đề nghị sửa hợp đồng – từ phiên FE giai đoạn 1

Phiên FE không sửa `contract/`. Dưới đây là chỗ hợp đồng (`contract/openapi.yaml`)
thiếu hoặc chưa rõ, và cách FE xử lý.

**2026-10-20:** chủ dự án đã chốt toàn bộ đề nghị #1–#13 (hợp đồng Claude Docs mục 9,
rev 19; `contract/openapi.yaml` 1.1.0-gd1, commit `bbebac3` trên `giai-doan-1`). FE đã
gộp `giai-doan-1` và sửa theo. Mục mới ở cuối bảng.

**2026-10-20 (v1.2):** chủ dự án đồng ý #14, #15 (D19, D20; `contract/openapi.yaml` 1.2.0-gd1, commit `432bad4`). FE đã sửa theo D15–D20.

| # | Ngày | Điểm cuối / đối tượng | Vấn đề | Tình trạng |
|---|------|----------------------|--------|-----------|
| 1 | 2026-10-19 | `allowedActions` (mọi đối tượng) | Không liệt kê tên hành động. | **Đã xử lý (D9).** Enum từng đối tượng; FE so đúng từng chữ, kiểu TypeScript bắt sai tên lúc biên dịch. |
| 2 | 2026-10-19 | User, Folder, Block, Department, Division, Delegation, tài liệu bên ngoài | Không có `allowedActions`, FE phải đoán theo vai trò. | **Đã xử lý (D9).** Nút sửa / đổi tên / kết thúc dự án / đọc lại / sửa vai trò / ghi nghỉ việc / cập nhật tài liệu bên ngoài / kiểm tra toàn vẹn đều theo `allowedActions`. Vai trò chỉ còn dùng cho nút tạo mới và menu. |
| 3 | 2026-10-19 | Chọn người | `GET /users` chỉ cho R3, R4, R9. | **Đã xử lý (D3).** Dùng `GET /users/lookup?q=`; bỏ câu "nhờ trưởng phòng". |
| 4 | 2026-10-19 | Tên người trong đối tượng | Chỉ có id. | **Đã xử lý (D10).** Gom `people` từ mọi phản hồi vào một kho chung; bỏ gọi `/users/{id}` từng người. Xem thêm #14. |
| 5 | 2026-10-19 | Máy chủ giả Prism | Không có tiền tố `/api/v1`. | **Đã xử lý.** Ghi trong `contract/README.md`; FE dùng `API_PATH_PREFIX=` (`pnpm --filter @vcdocs/web dev:mock`). |
| 6 | 2026-10-19 | `Job.result`, `Job.type` | Kiểu tự do. | **Đã xử lý (D11).** Tên tiếng Việt theo enum `Job.type`; link "Mở" theo `objectType/objectId` hoặc `fileId/url`. |
| 7 | 2026-10-19 | BR-28 lập lùi ngày | Không rõ ngưỡng. | **Đã xử lý (D12).** Chỉ đòi lý do khi lùi quá `limits.backdateWorkingDays` ngày làm việc. |
| 8 | 2026-10-19 | BR-17 hạn chia sẻ | Không rõ số ngày tối đa. | **Đã xử lý (D12).** Mặc định và giới hạn ngày hết hạn theo `limits.shareMaxDays`. |
| 9 | 2026-10-19 | `GET /folders` | Không rõ khi không có `parentId`. | **Đã xử lý (D8).** Không có `parentId` = cấp 1 của drive; tạo thư mục ở gốc drive không gửi `parentId`; số kế tiếp hỏi bằng `driveId`. |
| 10 | 2026-10-19 | Mẫu tên thư mục (BR-11) | Không có ví dụ đầy đủ. | **Giữ nguyên (nhóm 3, giả định).** FE hiện "Tên dự kiến", ghi rõ máy chủ ghép chính thức. 2026-10-20: chỉnh cho khớp cách BE ghép (mã đã chứa tên ngắn thì không lặp, vd `11 SAN-TTS TikTok Shop`). Nên ghi quy tắc này vào hợp đồng. |
| 11 | 2026-10-19 | Callback đăng nhập lỗi | Trả JSON. | **Đã xử lý (D13).** Trang `/dang-nhap` đọc `loi=domain\|locked\|expired\|state`. |
| 12 | 2026-10-19 | `Me` thiếu `blockId` | | **Đã xử lý (D12).** Bảng uỷ quyền mở đúng khối theo `me.blockId`. |
| 13 | 2026-10-19 | Phiếu `disposal`, `delegation` | Chưa có màn hình M11. | Không cần sửa; giai đoạn 2. |
| 14 | 2026-10-20 | `GET /blocks`, `GET /departments` | Không có `people`, nên không hiện được tên giám đốc khối, trưởng phòng. | **Đã xử lý (D19, v1.2).** Tên lấy từ `people` của `/blocks`, `/departments`, `/divisions`, `/delegations`; đã thử với BE thật. |
| 15 | 2026-10-20 | Loại thư mục ở gốc drive | Không rõ loại nào được tạo ở gốc. | **Đã xử lý (D20, v1.2).** Gốc drive chỉ cho docs, plan_report, operations, area, project, closed, archive; năm, tháng, đối tượng chỉ hiện khi đã chọn thư mục cha. |
