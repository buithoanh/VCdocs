# VCworkspace

Dự án trước đây có tên **VCdocs**, được đổi tên theo quyết định chủ dự án ngày
2026-10-23. Nghiệp vụ quản lý hồ sơ hiện có vẫn nằm trong repo; kiến trúc mở rộng
workspace đang ở giai đoạn nghiên cứu và chưa mặc nhiên được duyệt triển khai.

- [Sổ tay dự án](SO_TAY_DU_AN.md): quyết định, trạng thái và bàn giao giữa các phiên.
- [Tài liệu](docs/README.md): BA, hợp đồng, kiến trúc và nghiên cứu.
- [Quy tắc AI](AGENTS.md) và [cách bật 4 lớp, quyền Google/GCP/GitHub](docs/huong-dan/quan-tri-ai.md).
- Kiểm rào chắn: `pnpm ai:guard:test`; kiểm thay đổi: `pnpm ai:check`;
  kiểm đầy đủ: `pnpm ai:check:full`.

Đường dẫn local `/Users/apple/projects/VCdocs`, remote GitHub `buithoanh/VCdocs`,
package `@vcdocs/*`, project GCP và tên miền cũ là định danh kỹ thuật hiện có.
Chúng chưa được đổi bằng việc cập nhật tên tài liệu. Bản xuất BA/hợp đồng và nhật ký
lịch sử giữ tên tại thời điểm tạo để không làm sai nguồn hay phiên bản.
