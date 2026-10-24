# PR: VCworkspace chat01–12B (Drive, Office, Email, liên thông, OIDC)

Nhánh `vcworkspace/chat01-12b` vào `dev`.

## Tóm tắt

Đưa vào Git toàn bộ lát cắt VCworkspace đã nghiệm thu LOCAL qua chat01–12B
(trước đây là WIP chưa commit):

- Hợp đồng `contract/openapi.yaml` 1.5.0-gd1 → **2.3.0-gd2**.
- BE: `drive-basic` (Drive, phiên bản, thùng rác, DOCX/XLSX/PPTX qua ONLYOFFICE),
  `mail-basic` (Stalwart), `workspace-interop` (Email ↔ Drive), OIDC + identity
  lifecycle trong `m01-auth`. Đăng nhập Google cũ giữ nguyên.
- FE: `/bo-nho`, `/email`, đăng nhập OIDC.
- PoC local `poc/` (Nextcloud 33, ONLYOFFICE 9.4, Stalwart 0.16, Authentik 2026.8)
  và bằng chứng nghiệm thu; quản trị AI (`AGENTS.md`, skills, hooks, `scripts/ai`, CI).
- Sửa sau review/QA (F1–F6): không gian Drive theo ID thay vì tên, khôi phục
  phiên bản tạo bản mới, khoá editor và endpoint công khai, tắt Google khi
  `AUTH_MODE=oidc`, production chặn kho/mail giả.
- Có cả commit nghiên cứu khả thi b8c8b80 (nhánh cắt từ `claude/nghien-cuu-vcworkspace`).

## Kiểm tra

- `pnpm ai:check:full` (2026-10-25, sau sửa): guard 44/44, BE 180 đạt (9 skip
  cần runtime thật), endpoint 145/145, FE đạt, typecheck/build đạt.
- QA trình duyệt trên server giả cô lập (`RUN_QA_FAKE_SERVER=1`).
- **Chưa chạy** runtime thật Nextcloud/ONLYOFFICE/Stalwart/Authentik trong lượt này.

## Lưu ý trước khi merge

- Production nay **bắt buộc** cấu hình Nextcloud + Stalwart thật và
  `DOCUMENT_EDITOR_JWT_SECRET` ≥ 32 byte, nếu không API không khởi động.
- Còn 15 lỗi mở O1–O15, xem `docs/ke-hoach/vcworkspace-review-qa-2026-10-25.md`
  (ưu tiên O1–O4 trước pilot). Không deploy nhánh này lên production.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
