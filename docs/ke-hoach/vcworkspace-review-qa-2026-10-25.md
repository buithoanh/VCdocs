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

## Xử lý O1–O15 (2026-10-26, nhánh `claude/bao-mat-o1-o15-3028d0`)

Kiểm lại từng mục trên mã sau các lượt audit Cloudflare 1–12/12, giao diện Ant
Design và Email (Cc/Bcc, khung đọc, Trả lời). Mỗi mục sửa có test tái hiện: chạy
trên mã cũ thì fail, trên mã mới thì đạt; không nới assertion. Chỉ dùng Google,
Drive, Mail giả và MongoDB tạm. **Chưa** chạy với ONLYOFFICE, Stalwart, Authentik
hay Nextcloud thật.

| # | Trạng thái | Commit | Ghi chú |
|---|---|---|---|
| O1 | Đã xong trước | (audit 6/12) | Vé callback 24 giờ, tách vé nội dung 15 phút |
| O2 | **Đã sửa** | acce271 | Forcesave (status 6) giữ phiên và key; người mở sau vào chung phiên; status 2 đóng phiên; version tải lên/khôi phục làm phiên cũ thành cũ. Test stale chat04 giữ nguyên. Đề nghị hợp đồng R9 |
| O3 | **Chờ chủ dự án quyết** | — | Xem câu hỏi Q1 dưới bảng |
| O4 | Đã xong trước | (audit 1/12, 2/12, 7/12) | OIDC kiểm tên miền; hộp thư gắn email đúng tên miền; hộp nhóm/alias tên tự do chỉ R3/R9 |
| O5 | **Đã sửa phần còn lại** | 931daec | key/url/status từ payload ký (audit 6/12), quyền hiện tại (audit 5/12); thêm kiểm thùng rác lúc callback |
| O6 | Đã xong trước | (audit 12/12) | Đóng socket trong `finally`; `NO`/`BAD` trả ngay |
| O7 | **Đã sửa** | 49ee3a6, 96dc5f0 | Đồng bộ Đã gửi không xếp thư người khác vào Đã gửi; chỉ tải `BODY[]` của thư chưa có trong CSDL; FE tìm thư chờ 300 ms ngừng gõ. Thư thiếu Message-ID đã sửa ở audit 12/12 |
| O8 | **Đã sửa** | b15fb82 | Lượt tải có lease; nhận lượt nguyên tử; retry dùng lại item/version đã tạo. Đề nghị hợp đồng R7 |
| O9 | **Đã sửa** | 847a754 | Nhận XLSX/PPTX; MIME phải trùng tệp; gói Office phải hợp lệ. Đề nghị hợp đồng R8 |
| O10 | **Đã sửa** | 1435c1f | Unique index tên thêm `trashedAt`; `Db.ready()` gỡ index cũ; khôi phục khi tên đã dùng trả 409 |
| O11 | **Đã sửa** | 96dc5f0 (+92c547f trước) | `/bo-nho` (hiện lỗi, thư mục con, giao diện) đã làm ở 92c547f; nút Gửi dùng lại Idempotency-Key khi nội dung không đổi, khoá khi đang gửi |
| O12 | **Đã sửa** | c7e6757 | Fence gia hạn lease khi còn giữ token; chỉ revision mới là superseded; mất lease là `partial` (retry được). Test chat12B đổi kỳ vọng theo đúng O12 |
| O13 | **Chờ chủ dự án quyết** (hạ tầng) | — | Xem Q3 |
| O14 | **Đã sửa 5/6 ý, 1 ý chờ quyết** | 21f2be0, acc802c, 5c49843, 79d4938 | `parentId` cùng không gian/chưa bỏ thùng rác; xoá token rõ sau khi thư gửi xong; header bảo mật (không thêm helmet); tạo nhãn hộp nhóm cần `manage`; sanitizer đã thay trước đó. Gán nhãn hộp nhóm: xem Q2 |
| O15 | **Đã sửa** | 740c081, c5b4d94 | OIDC đổi sang email đã có người dùng → `loi=identity` + audit; lưới `/email` theo bề rộng vùng nội dung (container query), hàng nút đọc thư xuống dòng |

Câu hỏi cho chủ dự án:

- **Q1 (O3).** Phiên OIDC hết sau `OIDC_PROJECTION_MAX_AGE_SECONDS` (300 giây) vì
  app chỉ biết trạng thái IdP lúc đăng nhập. Chọn: (a) refresh token: thêm scope
  `offline_access` trên Authentik, API lưu refresh token đã mã hoá (cần khoá mới)
  và tự làm mới nhóm/email ở guard; (b) chuyển hướng im lặng `prompt=none` khi
  hết hạn (form đang soạn có thể mất); (c) nâng biến lên bằng thời lượng phiên và
  dựa vào lifecycle (app-deny huỷ phiên ngay) cho thu hồi; khoá thẳng trên
  Authentik ngoài lifecycle thì có hiệu lực sau tối đa thời lượng đó. Đề xuất
  (c) cho pilot, (a) trước khi mở rộng.
- **Q2 (O14).** Thành viên chỉ có quyền `read` của hộp thư nhóm có được gán nhãn
  thư không? Hiện được (test chat08 dùng vậy); tạo nhãn mới đã cần `manage`.
- **Q3 (O13).** Nextcloud đang lưu tệp bằng credential của từng người: tệp phòng
  ban nằm trong home người tải lên. Chọn tài khoản dịch vụ hay Team Folder
  (Group Folders) cho không gian phòng ban? Cần môi trường Nextcloud thử để làm.

Việc còn lại sau lượt này: chạy lại trên ONLYOFFICE thật (forcesave status 6),
Stalwart thật (`UID FETCH 1:*` header, thư mục Đã gửi), Authentik thật; dọn
`token` rõ của các link tạo trước bản acc802c (`workspace_drive_share_links`).

## Còn mở lúc review 2026-10-25 (bảng gốc, xem trạng thái ở trên)

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
