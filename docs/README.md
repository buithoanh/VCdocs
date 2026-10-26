# Tài liệu dự án VCworkspace

Bản lưu trong kho mã của các tài liệu gốc. **Bản gốc nằm trên Claude (artifact); khi hai bản lệch, bản gốc đúng.** Sửa tài liệu thì sửa bản gốc rồi xuất lại vào đây.

| Tài liệu | Bản trong repo | Bản gốc (artifact) | Bản đã xuất |
|---|---|---|---|
| BA và đặc tả người dùng | [ba/BA-dac-ta-nguoi-dung.md](ba/BA-dac-ta-nguoi-dung.md) | https://claude.ai/artifact/74kFt4rhgHd3ecPmgitRYc | rev 20, xuất 2026-10-20 |
| Hợp đồng API v1 | [hop-dong-api/hop-dong-api-v1.md](hop-dong-api/hop-dong-api-v1.md) | https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT | rev 22, xuất 2026-10-20 |
| Kiến trúc code | [kien-truc/kien-truc.html](kien-truc/kien-truc.html) (mở bằng trình duyệt) | https://claude.ai/artifact/Bh992AU1qAhyneRJxkbRhF | bản 1, 2026-10-20 |
| Nghiên cứu khả thi VCworkspace (thay Google Workspace) | [nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md](nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md) | (bản gốc là file trong repo) | cập nhật kiểm chứng 48 ID, 2026-10-23 |

Hồ sơ đối chiếu từng luận điểm, nguyên văn câu gốc, nguồn đã đọc và giới hạn: [Kiểm chứng VCworkspace 2026-10-23](nghien-cuu/vcworkspace-kiem-chung-2026-10-23.md).

Đo tải 48 người sửa đồng thời, so ONLYOFFICE 9.4 với Euro-Office 9.3.7: [Engine soạn thảo 2026-10-26](nghien-cuu/office-engine-tai-48-2026-10-26.md) (harness: `poc/office-load/`).

Thử công cụ REA (Reverse Engineer Anything) trên ONLYOFFICE 9.4 trong lab Docker cô lập, so với mã nguồn AGPL công khai: [REA × ONLYOFFICE 2026-10-26](nghien-cuu/rea-onlyoffice-2026-10-26.md) (lab: `poc/rea-lab/`).

Ghi chú:

- Bản máy đọc của hợp đồng là [`contract/openapi.yaml`](../contract/openapi.yaml), viết tay theo hợp đồng; [`contract/NGUON.md`](../contract/NGUON.md) ghi rev hợp đồng đã đưa vào OpenAPI.
- Bản Markdown không giữ được hình vẽ trong tài liệu gốc (sơ đồ vòng đời ở BA mục 5); xem hình ở bản gốc.
- Các artifact ở chế độ riêng tư: người khác cần được chủ dự án chia sẻ mới mở được link.

> Tên dự án hiện tại là VCworkspace (từ 2026-10-23). Các định danh `vcdocs`,
> package `@vcdocs/*` và cấu hình hạ tầng trong ví dụ vẫn đang dùng tên kỹ thuật cũ.
> Phiên code AI: xem [quy tắc chung](../AGENTS.md) trước khi khởi động dịch vụ thật.

Hướng dẫn mới: [Quản trị AI 4 lớp cho VCworkspace](huong-dan/quan-tri-ai.md).

Biên bản phát triển: [Thứ tự tính năng VCworkspace — Drive trước](ke-hoach/bien-ban-thu-tu-phat-trien-vcworkspace.md).
