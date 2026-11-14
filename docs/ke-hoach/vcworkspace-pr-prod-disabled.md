# PR: Production tắt rõ Drive/Email VCworkspace khi chưa có engine thật

Nhánh `claude/prod-cau-hinh-vcworkspace-2fe0b0` vào `dev`. Cắt từ `dev` 6656766 (PR #14), gộp không xung đột.

| Commit | Nội dung |
|---|---|
| ffda448 | Chế độ `disabled` cho kho Drive và mail engine, guard 503, FE ẩn menu/trang, mẫu env deploy |
| 004b5c6 | Ghi quyết định production: phương án A trước, rồi Drive/Office, Email sau |

## Vì sao cần gấp

Ngày 2026-10-26 production kéo `main` sau PR #15 và API khởi động lại liên tục với lỗi
"Không được chạy WORKSPACE_STORAGE_MODE=fake ở production". Nguyên nhân: `api.env` cũ không có biến
VCworkspace, nên `WORKSPACE_STORAGE_MODE`/`MAIL_ENGINE_MODE` lấy mặc định `fake`, mà production chặn
`fake`. Bật bản thật cũng không được vì chưa có Nextcloud/Stalwart. Máy đã được đưa về 39e02f7.
**`main` không deploy được cho tới khi PR này vào `dev` rồi `main`.**

## Thay đổi

- **API:** thêm chế độ `disabled` cho `WORKSPACE_STORAGE_MODE` và `MAIL_ENGINE_MODE`. Đây là mặc định
  khi `NODE_ENV=production` và không khai báo biến. Ngoài production mặc định vẫn là `fake`.
  Ở production, đặt `fake` tường minh vẫn bị chặn khi khởi động.
- `common/workspace-modules.ts`: decorator `@RequiresWorkspace` trả 503 `STORAGE_UNAVAILABLE` trước khi
  chạm service cho `/spaces`, `/drive/*`, `/mail/*` và các route liên thông. Cổng thay thế `disabledPort`
  báo 503 cho mọi lời gọi, không rơi về bản giả trong bộ nhớ.
- Chặn `DOCUMENT_EDITOR_ENABLED=true` khi Drive tắt.
- **Web:** `lib/workspace-modules.ts` + `WorkspaceModuleGate`. Cờ build `NEXT_PUBLIC_WORKSPACE_MODULES`
  (`drive`, `mail`; rỗng = ẩn hết). Production không khai báo thì ẩn menu và trang Bộ nhớ, Email.
- **Deploy:** `api.env.example` có khối "Phân hệ VCworkspace"; `.env.example` thêm `WORKSPACE_MODULES`,
  `DOCUMENT_SERVER_ORIGINS`, `AUTH_PROVIDER`; compose truyền build args; `web.Dockerfile` thêm ARG;
  `deploy/README.md` ghi cách bổ sung biến khi cập nhật từ 39e02f7.
- Tài liệu: `docs/ke-hoach/vcworkspace-20-production-phuong-an.md` (so sánh phương án A/B, đã chọn A rồi B).
- Đề nghị hợp đồng (chưa sửa `openapi.yaml`): khai báo 503 cho route Drive/Email; tuỳ chọn
  `Me.workspaceModules` để bỏ cờ build. Ở `apps/api|web/DE_NGHI_SUA_HOP_DONG.md`.

## Kiểm tra

- BE `test/prod-workspace-disabled.e2e-spec.ts` 8 ca: không khai báo thì khởi động được và các phân hệ
  tắt; `fake` tường minh bị chặn; editor khi Drive tắt bị chặn; giá trị lạ bị chặn; ngoài production vẫn
  `fake`; đăng nhập Google, `/me`, tra cứu tài liệu chạy khi tắt; Drive/Email/liên thông trả 503 không chạm
  dữ liệu; route editor công khai cũng bị chặn.
- `review-fixes.e2e-spec.ts`: không khai báo nay thành `disabled` (thay cho lỗi `fake`); `fake` tường minh
  vẫn bị chặn. Không nới assertion.
- FE `workspace-modules.test.ts` 3 ca.
- Đã đọc lại: đăng nhập Google gọi `mail.releaseAddressFor`, hàm này chỉ chạm mail engine khi có alias và
  bắt lỗi, nên không vỡ khi Email tắt.
- `pnpm ai:check:full`: PASS 2026-11-06 — guard, lint hợp đồng, typecheck, BE 379 đạt / 10 skip, độ phủ hợp đồng 149/149, FE 104/104, build production.
- Chưa chạy: build Docker, chạy trên máy ảo thật.

## Sau khi merge

1. PR `dev` → `main` (chủ dự án quyết).
2. Trên máy chủ: so `deploy/*.example` với `api.env`/`.env` thật, thêm khối biến mới (để tắt hết),
   sao lưu + snapshot, rồi `git pull` và `docker compose -f docker-compose.prod.yml up -d --build`.
   Kiểm hồi quy nghiệp vụ VCdocs trên bản sao CSDL trước (phương án A). Làm bằng phiên vận hành riêng.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
