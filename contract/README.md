# Hợp đồng API VCworkspace

- `openapi.yaml` là gốc, viết tay theo tài liệu "Hợp đồng API VCdocs v1" (tên tài liệu nguồn cũ) trên
  Claude Docs (https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT). Phạm vi hiện
  tại: giai đoạn 1 (M01–M09, M14, /jobs).
- Chỗ hợp đồng chưa ghi rõ được đánh dấu `x-gia-dinh` (giả định).
- Chỉ phiên được giao việc cập nhật hợp đồng mới sửa thư mục này. Phiên FE/BE
  ghi đề nghị vào `DE_NGHI_SUA.md`.

## Lệnh

    pnpm contract:lint   # kiểm tra file hợp lệ
    pnpm contract:mock   # máy chủ giả ở http://localhost:4010

## Quy ước cho hai bên

- Cổng local: web 3000, api 4000 (tiền tố /api/v1), mock 4010.
- Web gọi `/api/v1/...` cùng tên miền; Next.js chuyển tiếp sang
  `API_ORIGIN` (mặc định http://localhost:4000, chạy mock thì :4010).
- Đường dẫn cố định đặt trước đường dẫn có tham số: `/folders/next-number`
  trước `/folders/{id}`, `/documents/similar` trước `/documents/{id}`…
- Máy chủ giả Prism phục vụ KHÔNG có tiền tố `/api/v1` (đường dẫn gốc là
  `/me`, `/documents`…). FE chạy mock thì đặt `API_ORIGIN=http://localhost:4010`
  và `API_PATH_PREFIX=` (rỗng); chạy BE thật thì để mặc định `/api/v1`.
- Lỗi luôn theo `components/schemas/Error`; `message` tiếng Việt.
- `pnpm-lock.yaml` mỗi bên tự sinh; lúc ghép thì chạy lại `pnpm install`
  để gộp, không sửa tay.

> Tên dự án hiện tại là VCworkspace (từ 2026-10-23). Các định danh `vcdocs`,
> package `@vcdocs/*` và cấu hình hạ tầng trong ví dụ vẫn đang dùng tên kỹ thuật cũ.
> Phiên code AI: xem [quy tắc chung](../AGENTS.md) trước khi khởi động dịch vụ thật.
