# Báo cáo audit bảo mật VCdocs / VCworkspace — run-1 (quick)

Quy trình: Cloudflare `security-audit` skill (github.com/cloudflare/security-audit-skill @ `c1c8a8c`), chế độ full audit, profile **quick**. Bản ghi máy đọc: `findings.json`, `coverage-ledger.json` (cả hai đạt `validate-findings.cjs` và `validate-coverage-ledger.cjs`). Chi tiết từng đầu mối: `NEEDS-VALIDATION.md`.

## 1. Phạm vi, cách chạy và giới hạn

- **Đây là lượt quét một phần (quick).** Một đợt săn, một lượt critic cuối, một verifier độc lập cho mỗi đầu mối (giai đoạn 3 và 5 gộp theo quy định của quick). Không có ngân sách cứng; đã dùng 13 agent: 4 trinh sát, 4 hunter, 1 critic, 4 verifier (mỗi verifier kiểm 3 đầu mối độc lập, không kiểm đầu mối do chính mình săn).
- **Mã nguồn:** commit `d0f74e7` trên nhánh `vcworkspace/chat01-12b`, cây sạch. Phạm vi: `apps/api/src`, `apps/web/src`, `apps/web/next.config.ts`, `contract/openapi.yaml`, `deploy/`. Ngoài phạm vi: `poc/`, `scripts/ai`, `.github` (giữ trong ledger dạng `out_of_scope`).
- **Chỉ rà mã nguồn, không chạy mã dự án.** Máy macOS không cưỡng chế được giới hạn bộ nhớ, số tiến trình và dung lượng đĩa cho sandbox; không có image container Node sẵn trong máy và skill cấm tải mới. Vì vậy **không bản ghi nào đạt mức `confirmed`**: skill đòi kết quả chạy thử có giới hạn mới được xác nhận. Không gửi bất kỳ yêu cầu nào tới hệ thống thật.
- **Lần chạy trước:** không có ledger tương thích. Bản review thủ công 2026-10-25 (`docs/ke-hoach/vcworkspace-review-qa-2026-10-25.md`, đã sửa F1–F6 ở commit b5ae95f) chỉ dùng làm tham khảo, không loại trừ gì.
- **Ghi chú điều phối:** kết quả của hunter VCdocs cũ thiếu trường `method` ở 8 check, cả 8 đều đọc mã, `artifact: null`; điều phối chuẩn hoá thành `source`. Một lần vô tình chạy lại script dựng ledger đã ghi đè ledger; điều phối gộp lại từ các file kết quả gốc và validator đạt.
- **Vùng hoãn (`deferred`, 7 đơn vị):**
  - Job nền chạy lại khi người yêu cầu đã mất quyền (`jobs.service.ts`).
  - Vòng đời Drive: đổi tên, di chuyển, phiên bản, khôi phục, thùng rác, xuất file, kiểm thùng rác lúc callback.
  - Catalog và mã (m02), `PATCH /users/:id`, danh sách thành viên drive, xuất danh mục.
  - Nhánh `fileId` của nhập tài liệu ngoài (trùng gốc với đầu mối số 3).
  - Đọc và sửa hộp thư nhóm qua `?mailbox=` (gắn nhãn chỉ cần quyền đọc), đồng bộ thành viên giữa CSDL và mail engine.
  - Lưu đính kèm mail vào Drive; gửi file Drive dạng đính kèm mà bỏ qua kiểm người nhận.
  - Tra người nhận theo local-part (trùng gốc với đầu mối số 5).

## 2. Tình trạng bảo mật tóm tắt

Phần nền tảng làm tốt: OIDC (PKCE S256, state/nonce một lần, RS256 kèm kiểm iss/aud/azp/exp, binding `(issuer, sub)`), CSRF theo phiên, CORS một origin, phiên lưu dạng băm, plugin tenant bắt buộc `companyId`, chặn chế độ giả ở production. Rủi ro tập trung ở **chỗ nối giữa các thành phần**: danh tính hộp thư suy ra từ local-part email, OIDC không ràng buộc tên miền, quyền Drive không thu hồi khi đổi phòng, callback editor tin dữ liệu không ký, và service account Google được dùng thay quyền của người gọi.

## 3. Lỗi đã xác nhận

Không có. Lượt này chặn chạy mã nên không đầu mối nào đủ điều kiện `confirmed`. Đây là giới hạn của lượt chạy, **không** có nghĩa là hệ thống sạch.

## 4. Chi tiết lỗi đã xác nhận

Không có (xem mục 3).

## 5. NEEDS VALIDATION (đầu mối ưu tiên, không gán mức nghiêm trọng)

Thứ tự là ưu tiên kiểm, không phải mức nghiêm trọng. Mỗi dòng đều đã được một verifier độc lập đọc lại mã và giữ ở `needs_validation`.

| # | Đầu mối | Đường mã chính | Điều đang chặn | Bước kiểm local | Việc chủ hệ thống tự xem |
|---|---|---|---|---|---|
| 1 | OIDC tạo hoặc đổi email người dùng mà không kiểm tên miền công ty | `m01-auth/auth.controller.ts:97-124`; `oidc.service.ts:70` | Authentik có cho tự đăng ký hoặc tự sửa email kèm `email_verified=true` không | Ca mới trong `oidc-auth.e2e-spec.ts`: token `nv.mkt@other.example` → kiểm user mới và hộp thư trùng | Xem cấu hình enrollment và email trong Authentik |
| 2 | Hộp thư gắn theo local-part email | `mail-basic.service.ts:19,23`; `stalwart-mail.port.ts:28` | Như số 1 (chính sách email của IdP) | Seed 2 user cùng local-part khác tên miền, gọi `GET /mail/messages` | Liệt kê user trùng local-part |
| 3 | Nhập tài liệu ngoài: service account sao chép fileId bất kỳ vào phòng do người gọi chọn | `m04-documents/documents.controller.ts:534-555`; biến thể `record-types templateId` | Service account có thật là Manager trên drive mật không | Fake Google: R6 nhập file của drive mật vào phòng A | Kiểm quyền service account trong Workspace admin |
| 4 | SSRF: nhập tài liệu ngoài theo redirect, không chặn địa chỉ nội bộ | `google/real/real-google.ts:409-425` | Chính sách egress của container API | Fixture loopback: https 302 → http nội bộ | Từ container, xem được tới host nội bộ nào |
| 5 | Quyền vào không gian Drive phòng ban không thu hồi khi đổi phòng hoặc mất R4 | `drive-basic.service.ts:31-36,46-74` | Chỉ thiếu chạy thử (mã nguồn không có đường thu hồi) | Đổi phòng hoặc bỏ R4 rồi upload vào không gian cũ → mong 404 | — |
| 6 | Callback ONLYOFFICE nhận mọi JWT ký bằng khoá editor (kể cả token trong trình duyệt), tin `key/url/status` không ký | `drive-basic.service.ts:429,480-539` | Document Server có trả file cache của tài liệu khác theo đường đoán được không; `internalOrigin` trỏ đi đâu | Gửi callback với `config.token` của trình duyệt, url tuỳ ý trên internalOrigin | Xem secret browser/inbox/outbox và secure-link của ONLYOFFICE |
| 7 | Ai cũng chiếm được địa chỉ alias hoặc hộp thư nhóm (`hr@`, người sắp vào) | `mail-basic.controller.ts:35-37`; `mail-basic.service.ts:27-40,96-98` | Stalwart xử lý alias trùng địa chỉ user mới thế nào | Tạo alias `newhire@`, seed user, gửi thư, kiểm `mailboxOwner` | Rà alias và hộp thư nhóm hiện có |
| 8 | Production chấp nhận cổng identity-lifecycle giả: khoá/hạ quyền báo "done", lần đăng nhập sau khôi phục quyền | `config.ts:160,259-266`; `identity-lifecycle.port.ts:14-27`; `auth.controller.ts:122-124` | Production có chạy `AUTH_MODE=oidc` không, chế độ lifecycle nào | Hạ quyền R9 rồi đăng nhập lại → kiểm quyền | Xem `AUTH_MODE` và `IDENTITY_LIFECYCLE_MODE` trong api.env |
| 9 | Trang soạn thảo: `fileId` không encode → có thể nạp script từ origin do kẻ tấn công chọn | `apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/page.tsx:16-35` | Next.js 15.5 có decode `%2F`/`%23` trong param không; proxy có thêm CSP không | Thử trình duyệt local với fixture loopback | Kiểm header CSP của web |
| 10 | R3 đọc được phiếu duyệt của drive mật | `m05-approvals/approvals.controller.ts:61-69` | Chính sách: R3 có được xem phiếu drive mật không | Tạo phiếu ở drive mật, R3 ngoài phòng gọi `GET /approvals/:id` | Chủ dự án chốt chính sách |
| 11 | Nhận hồ sơ: lấy người sửa cuối làm "người tạo" rồi service account chuyển file | `google/real/real-google.ts:38,76`; `m07-records/records.controller.ts:163-170` | Hành vi `lastModifyingUser` thật trên shared drive | Sửa fake theo real, B claim file của A | Thử trên domain test |
| 12 | Client IMAP tách thư bằng regex, bỏ qua độ dài literal | `mail-basic/stalwart-mail.port.ts:48,52,92`; `tls-client.ts:7` | Mail engine có nhận thư từ ngoài API không | Unit test với socket giả phát lại transcript IMAP | Xem cấu hình SMTP inbound |

## 6. Ghi chú hardening và điểm làm tốt

**Hardening (không phải lỗi; chưa thấy vượt ranh giới):**
- **Phiên đăng nhập:**
  - Phiên Google tạo trước khi chuyển sang OIDC vẫn dùng được và gia hạn mãi (không có hạn tuyệt đối).
  - OIDC đặt `isSuspended:false` không điều kiện, có thể đua với lifecycle deny.
  - Callback Google không huỷ sid cũ.
  - Phiên OIDC bị huỷ sau 300 giây vì `lastSeenAt` không được làm mới (mục O3 cũ).
- **Drive và editor:**
  - Upload không kiểm `parentId`; `createFolder` cho tạo dưới thư mục đã vào thùng rác; `restoreItem` thiếu điều kiện `spaceId`.
  - Vé editor nằm trên query string nên lọt vào log.
  - `DOCUMENT_EDITOR_INTERNAL_ORIGIN` mặc định bằng origin công khai.
  - Không gian phòng ban trên Nextcloud nằm trong home của từng người.
- **Mail và liên thông:**
  - `sanitizeHtml` dùng regex; tên đính kèm chưa escape dấu nháy.
  - Link chia sẻ lưu token dạng rõ và chưa có đường thu hồi.
  - Kiểm địa chỉ trùng không chạy trong transaction.
- **VCdocs cũ:**
  - Gia hạn chia sẻ file mật không cần duyệt lại.
  - Thu hồi tài liệu cho phép liên kết sang tài liệu mật mà người gọi không xem được (để lộ ID tồn tại).
  - Drive không xác định mặc định trả 403 thay vì 404.
- **Web:** `returnTo` phía web không chặn ký tự tab/CR/LF (chỉ chạm tới khi bật chế độ mock).
- **Cấu hình:** mẫu `deploy/api.env.example` chưa khai báo các biến mode mới.
- **Ngoài phạm vi, phát hiện khi trinh sát:** `.claude/settings.json` chặn đọc `.env*` nhưng không chặn `poc/*/secrets/**` và `poc/*/backup/**`; hiện chỉ hook regex che một phần.

**Điểm làm tốt (đã kiểm):**
- Đăng nhập và phiên: chuỗi kiểm OIDC và Google; xoay phiên khi đăng nhập; CSRF theo phiên; CORS một origin.
- Lifecycle: chỉ R9, khoá CAS/lease/fence, Idempotency-Key gắn fingerprint.
- Drive: storage key lấy từ ObjectId (không path traversal); vé editor ràng buộc file và tenant, file vào thùng rác thì vé hết hiệu lực.
- Mail và liên thông: chặn header injection; escape Sieve/IMAP; link chia sẻ không cấp thêm quyền ngoài quyền thành viên.
- Web: không có `dangerouslySetInnerHTML`.
- VCdocs cũ: đọc dữ liệu có lọc drive mật ở tầng CSDL.

## 7. Độ phủ (từ ledger)

23 đơn vị: 9 `candidate`, 5 `covered`, 7 `deferred`, 2 `out_of_scope`, 0 `blocked`. Critic cuối đề xuất 5 vùng thiếu, không yêu cầu giao lại đơn vị nào; theo luật quick, 5 vùng này thành `deferred` (`quick_profile_final_critic`). **Không thể khẳng định đã phủ đủ.** Một lượt standard, hoặc một lượt quick nhắm vào 7 vùng hoãn, cùng một sandbox đủ điều kiện để chạy kiểm local, là bước tiếp theo để chuyển đầu mối thành `confirmed` hoặc `rejected`.
