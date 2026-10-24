---
name: vcworkspace-contract
description: Cập nhật hợp đồng API VCworkspace khi được giao thay đổi contract; đối chiếu nguồn, giai đoạn và FE/BE.
---

# vcworkspace-contract

Đọc contract/NGUON.md, nguồn hợp đồng đầy đủ và đề nghị FE/BE. Không suy ra bản mới chỉ từ tiêu đề.
Xác định giai đoạn và điểm cuối bị ảnh hưởng; không chép giai đoạn 2 sang giai đoạn 1.
Chỉ áp dụng thay đổi đã được chủ dự án chốt hoặc giao rõ; phần chưa rõ ghi đề nghị.
Sửa OpenAPI viết tay, ghi rev/nguồn đúng; sinh lại schema FE bằng gen:api.
Chạy `pnpm ai:check:full`; không đặt ALLOW_PARTIAL_COVERAGE/SKIP_CONTRACT_COVERAGE ở full gate.
Bàn giao thay đổi tương thích/phá vỡ, kết quả FE/BE và câu hỏi còn mở; cập nhật sổ tay.
