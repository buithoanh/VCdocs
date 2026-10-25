# VCworkspace — Review, QA và bảo mật chat01–12B (2026-10-25)

Phạm vi: diff `b8c8b80..HEAD` trên nhánh `vcworkspace/chat01-12b`
(`apps/api/src`, `apps/web/src`, `contract/openapi.yaml`). Hai lượt review
độc lập (đúng/sai logic và bảo mật) chỉ đọc mã; điều phối tự kiểm chứng lại
các lỗi nghiêm trọng bằng đọc mã và chạy thật trên server QA cô lập.

## Cách đã kiểm

- `pnpm ai:check:full` trước sửa: guard 44, BE 173, endpoint 145/145, FE 76,
  typecheck/build đạt. Sau sửa: guard 44, BE 180 (9 skip), endpoint 145/145,
  FE 13 file, typecheck/build đạt.
- QA trình duyệt: `RUN_QA_FAKE_SERVER=1` (`apps/api/test/qa-fake-server.spec.ts`)
  dựng API thật với Google, Drive, Email giả và MongoDB trong bộ nhớ; web
  `next dev` với `NEXT_DIST_DIR=.next-qa`. Đăng nhập Trưởng phòng MKT giả, thử
  `/bo-nho` (thư mục, DOCX, phiên bản, khôi phục, đổi tên) và `/email`.
- **Chưa kiểm:** Docker tắt nên không chạy Nextcloud, ONLYOFFICE, Stalwart,
  Authentik thật; không thử SSO thật, editor thật, gửi/nhận mail thật.

## Đã sửa trong lượt này (commit b5ae95f)

| # | Mức | Lỗi | Bằng chứng | Cách sửa |
|---|---|---|---|---|
| F1 | Cao (bảo mật) | Không gian cá nhân/phòng ban tìm theo tên hiển thị: hai người trùng họ tên (hoặc đổi tên trên IdP) dùng chung Drive cá nhân với quyền manager | Đọc mã `ensureDefaultSpaces` | Khoá theo `ownerUserId`/`departmentId`, unique index riêng; test trùng tên |
| F2 | Cao (dữ liệu) | Khôi phục phiên bản gán lại số cũ → lần tải bản kế tiếp 409 `DUPLICATE` vĩnh viễn; key editor bị dùng lại | Tái hiện trên QA: restore v1 rồi upload → 409 | Khôi phục tạo bản mới số max+1 trỏ cùng blob bất biến |
| F3 | Cao (bảo mật) | `DOCUMENT_EDITOR_JWT_SECRET` mặc định viết cứng; `editor/content` và `editor/callback` công khai không kiểm `enabled` → tự ký vé đọc/ghi tệp | Đọc mã | Hai endpoint từ chối khi editor tắt; production chặn khoá mặc định hoặc < 32 byte |
| F4 | Cao (bảo mật) | `AUTH_MODE=oidc` nhưng đăng nhập Google vẫn mở và đặt `isSuspended:false` → người bị lifecycle khoá vào lại được | Đọc mã | Route Google trả `loi=provider` khi không ở chế độ google |
| F5 | Cao (vận hành) | Production chạy được với kho tệp/mail giả trong RAM (mất dữ liệu khi restart) | Đọc mã | Production chặn `WORKSPACE_STORAGE_MODE=fake`, `MAIL_ENGINE_MODE=fake` |
| F6 | TB | Lưu lại đúng tên cũ (không đổi gì) bị 409 | Tái hiện trên QA | Loại chính mục đó khỏi kiểm trùng tên |

Ghi chú hợp đồng R1–R3 (mô tả, không đổi schema) ở `apps/api/DE_NGHI_SUA_HOP_DONG.md`.
Lưu ý: từ giờ production phải cấu hình Nextcloud và Stalwart thật mới khởi động.

## Còn mở — cần phiên sửa riêng (ưu tiên trước khi pilot)

Cần runtime thật (ONLYOFFICE/Stalwart/Authentik) để chứng minh, nên chưa sửa ở đây.

| # | Mức | Lỗi | Vị trí |
|---|---|---|---|
| O1 | Cao | Callback ONLYOFFICE dùng chung vé editor hạn 15 phút: phiên soạn dài hơn thì lưu khi đóng bị 403, mất nội dung | `drive-basic.service.ts` `editorConfig`/`editorCallback` |
| O2 | Cao | Sau forcesave (status 6) tăng version, các callback sau cùng key cũ bị loại `EDITOR_STALE_VERSION`, mất bản lưu cuối | như trên |
| O3 | Cao | Người dùng OIDC bị đăng xuất sau `OIDC_PROJECTION_MAX_AGE_SECONDS` (300 giây) vì `lastSeenAt` không được làm mới | `auth.guard.ts` |
| O4 | TB–Cao | Hộp thư gắn theo phần trước @ của email; ai cũng tạo alias/hộp thư nhóm (chiếm `hr@`, `newhire@`); OIDC lần đầu không kiểm tên miền email | `mail-basic.service.ts`, `auth.controller.ts` |
| O5 | TB | Callback editor dùng `key/url/status` từ body không ký, chưa kiểm thùng rác và quyền thành viên lúc callback | `drive-basic.service.ts` |
| O6 | TB | Rò socket IMAP/SMTP khi lỗi; phản hồi `NO/BAD` phải chờ hết 10 giây | `stalwart-mail.port.ts` |
| O7 | TB | Đồng bộ mail: `sent` ánh xạ sang INBOX; thư thiếu Message-ID làm cả danh sách 500; `list` tải lại toàn bộ thư theo từng phím gõ | `mail-basic.service.ts`, `email/page.tsx` |
| O8 | TB | Idempotency tải tệp có thể kẹt 409 vĩnh viễn khi lỗi giữa chừng; hai request cùng key chạy song song | `drive-basic.service.ts` upload |
| O9 | TB | `uploadVersion` thiếu MIME XLSX/PPTX (415), cho đổi DOCX thành PDF | `drive-basic.service.ts` |
| O10 | TB | Tên đã bỏ vào thùng rác không dùng lại được (unique index tính cả thùng rác) | `models.ts` |
| O11 | TB | FE `/bo-nho`: không hiện lỗi cho người dùng (QA: tạo thư mục 400 im lặng); không mở được thư mục con; mỗi lần bấm Gửi tạo Idempotency-Key mới (nguy cơ gửi đôi); giao diện là form thô, chưa thiết kế | `bo-nho/page.tsx`, `email/page.tsx` |
| O12 | TB | Lifecycle: lease quá 30 giây bị coi là `LIFECYCLE_SUPERSEDED` vĩnh viễn dù không có revision mới | `identity-lifecycle.service.ts` |
| O13 | Thấp | Nextcloud dùng credential từng người: tệp phòng ban nằm trong home người tải lên, người đọc khác 404; cần tài khoản dịch vụ hoặc Team Folder | `nextcloud-storage.ts` |
| O14 | Thấp | Link chia sẻ lưu token rõ cạnh `tokenHash`; `createLabel/setLabels` hộp nhóm chỉ cần quyền đọc; thiếu `helmet`/`nosniff`; `sanitizeHtml` bằng regex (chưa khai thác được vì FE hiện text; **đã thay** bằng allowlist htmlparser2 trên nhánh `claude/mail-compose-cc-bcc-richtext`, 2026-10-25); `upload` không kiểm `parentId` cùng space | nhiều file |
| O15 | Thấp | Trang `/email` ở bề rộng 800px cắt cột đọc thư; OIDC đổi sang email đã có người dùng trả 500 | `email/page.tsx`, `auth.controller.ts` |

## Đã kiểm và thấy ổn

OIDC (PKCE S256, state/nonce một lần, RS256 + iss/aud/azp/exp, binding
`(issuer, sub)`, không tự liên kết theo email, xoay session, `safeReturnTo`);
CSRF cho mọi route ghi; CORS chỉ `webOrigin`; lifecycle chỉ R9 có companyId,
CAS/lease/fence; Drive có phạm vi companyId và kiểm membership, storage key từ
ObjectId (không path traversal), giới hạn 10 MiB và whitelist MIME; mail chặn
header injection, Sieve/IMAP được escape; link chia sẻ 192 bit, hạn 7 ngày, gắn
người nhận và kiểm lại quyền khi tải; FE hiển thị thư dạng text, token link ở
fragment. Không thấy log secret. Rà file chưa commit: chỉ có secret dành riêng
cho test và mã băm định danh, không có khoá thật.
