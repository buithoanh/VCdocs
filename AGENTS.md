# VCworkspace

Tên dự án hiện tại: VCworkspace (trước đây VCdocs). Đường dẫn, package `@vcdocs/*`,
GCP project, cookie và tên miền cũ vẫn là định danh kỹ thuật đang dùng.

## Bắt đầu và bàn giao
- Đọc `SO_TAY_DU_AN.md`; xác nhận cwd, nhánh, trạng thái Git và phạm vi được giao.
- Giữ thay đổi có sẵn của người khác. Không reset/clean hay gom chúng vào commit.
- Kết thúc cập nhật nhật ký, việc đang làm, quyết định mới và câu hỏi mở trong sổ tay.
- Phân biệt đã chạy / chưa chạy / bị chặn; test cũ không chứng minh bản hiện tại.

## Phạm vi và quyền
- Phát triển dùng Google giả và CSDL thử riêng. Không đọc `.env`, khoá SA,
  gcloud/ADC, SSH hoặc Keychain để tìm cách vượt lỗi đăng nhập.
- Phiên code không chạy deploy, IAM, thao tác dữ liệu thật hay gửi thư thật.
  Việc vận hành dùng phiên/môi trường riêng, quyền tối thiểu và phạm vi được giao.
- Không push trực tiếp `main`/`dev`, force-push, `--no-verify`, `reset --hard`, `clean -fd`.
- Nhánh công việc → PR vào `dev`; `main` chỉ nhận PR từ `dev` theo quyết định chủ dự án.
- Instructions và hook không thay thế sandbox, IAM hay bảo vệ nhánh phía GitHub.

## Mã và hợp đồng
- Node >=22; chỉ dùng pnpm 9.2.0. Không đổi package manager hay sửa tay lockfile.
- `contract/openapi.yaml` viết tay là gốc. Chỉ sửa khi được giao thay đổi hợp đồng;
  FE/BE ghi đề nghị tại file `DE_NGHI_SUA_HOP_DONG.md` tương ứng.
- `apps/web/src/api/schema.d.ts` được sinh bằng `pnpm --filter @vcdocs/web gen:api`.
- Không đổi runtime identifiers chỉ vì đổi tên hiển thị dự án.

## Kiểm tra
- `pnpm ai:check`: kiểm theo các file thay đổi (kể cả untracked), không tự chạy app.
- `pnpm ai:check:full`: kiểm hợp đồng, kiểu, test đầy đủ FE/BE, build.
- `pnpm ai:guard:test`: thử rào chắn bằng fixtures, không chạy lệnh nguy hiểm.
- Test FE lẻ: `pnpm --filter @vcdocs/web test src/api/client.test.ts`.
- Test BE lẻ: `ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/m01-auth.e2e-spec.ts`.
  Chỉ dùng coverage một phần khi phát triển; full gate xoá biến bỏ qua coverage.
- Sửa tài liệu không bắt chạy toàn bộ test; sửa hook/rule phải có ca được phép và bị chặn.
- Không bỏ test, nới assertion hay tắt kiểm tra để báo xanh. Stop hook thất bại vì
  môi trường phải ghi rõ blocker; không lặp sửa vô hạn.

## Skills
- `.agents/skills/vcworkspace-change/SKILL.md`: sửa mã và bàn giao.
- `.agents/skills/vcworkspace-contract/SKILL.md`: thay đổi hợp đồng API.
- `.agents/skills/vcworkspace-research/SKILL.md`: kiểm chứng nghiên cứu.
- Cách kích hoạt, giới hạn và quyền cần chủ dự án thiết lập:
  `docs/huong-dan/quan-tri-ai.md`.
