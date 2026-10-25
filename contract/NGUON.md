# Nguồn của openapi.yaml

| Ngày | Bản hợp đồng (rev tab Claude Docs) | Mục đã đưa vào | Ghi chú |
|------|-------------------------------------|----------------|---------|
| 2026-10-25 | Chủ dự án giao trực tiếp (soạn thư Email: Cc/Bcc + định dạng) | `MailCompose` thêm `cc`, `bcc` (JSON và form multipart dạng chuỗi JSON array), mô tả allowlist `html` (≤ 512 KiB); `MailMessage` thêm `cc`, `bcc` (bcc chỉ ở bản "Đã gửi" của người gửi); mô tả `/mail/send` | Cùng luật địa chỉ nội bộ như `to`, bỏ trùng giữa To/Cc/Bcc, tổng ≤ 50; SMTP envelope = To ∪ Cc ∪ Bcc, MIME không có header Bcc; Idempotency-Key bind cả Cc/Bcc. HTML lọc allowlist bằng htmlparser2 (thay regex, review O14). Thay đổi tương thích (chỉ thêm trường tuỳ chọn). Không lấy từ rev Claude Docs mới. Phiên bản 2.5.0-gd2. |
| 2026-10-25 | Chủ dự án giao trực tiếp chat 14 (Flow) | Receiver nội bộ `POST /flow/nextcloud/webhooks` (security `flowWebhookToken`: header `X-VCW-Flow-Token`, nhiều bí mật khi xoay vòng); journal R9 `GET /flow/events`, `GET /flow/events/{id}` | Allowlist Forms `FormSubmittedEvent`, Tables `Row*Event`, Files `Node{Created,Written,Deleted,Renamed}Event` (lớp khác 422 FLOW-01); thân đọc mọi Content-Type, ≤ 256 KB; idempotency (lớp, tài nguyên, time) → 202 `duplicate`; companyId lấy từ cấu hình. Thay đổi tương thích (chỉ thêm). Không lấy từ rev Claude Docs mới. Phiên bản 2.4.0-gd2. |
| 2026-10-24 | Chủ dự án giao trực tiếp chat 12B | OIDC/SSO cho ứng dụng thật: `/auth/oidc`, `/auth/oidc/callback`; lifecycle journal `/identity/lifecycle-operations*` | Authorization-code + PKCE S256, binding bất biến issuer+sub, company và role mapping do server cấu hình; coordinator Mongo subject-revision/CAS/pending-deny/readback cho app+Authentik+Nextcloud, global revoke token. Giữ Google cũ để tránh hồi quy. Không lấy từ rev Claude Docs mới. Phiên bản 2.3.0-gd2. |
| 2026-10-19 | rev 7 | 1–6 (mục 7 Bảo mật, 8 Sửa đổi BA còn trống) | Giai đoạn 1: M01–M09, M14, /jobs |
| 2026-10-19 | rev 16 | 7, 8 (đối chiếu lại 1–6) | Mục 7: 429 kèm Retry-After (600/phút/người, tìm kiếm 60/phút), thân ≤ 1 MB, file ≤ 100 MB (413, giả định), trường lạ bị loại không báo lỗi → bỏ additionalProperties: false ở schema đầu vào. Mục 8 Q4: phiên 8 giờ tự gia hạn. M16 (giai đoạn 2), format_violation, MAIL_MODE: ngoài phạm vi, không đổi openapi. Thân tài liệu ghi "ĐÃ CHỐT v1" nhưng tên vẫn [Đề xuất] |
| 2026-10-20 | rev 19 | 9 (chốt sau lần code đầu) + sửa đầu tài liệu, mục 7, 8 | D1–D14: R4 lập hồ sơ; người soạn được trình; GET /users/lookup; nghỉ việc → leaving; hold.reasonType; Delegation.recordTypeId + isLegalSignature; chia sẻ detected không cần hạn; thư mục gốc drive; enum allowedActions từng đối tượng; people; Job.type + result; /me blockId + limits; callback lỗi → 302 /dang-nhap?loi=; thêm mã lỗi 403/409/413/422. Phiên bản 1.1.0-gd1 |
| 2026-10-20 | rev 20 | 9.4 (chốt thêm sau khi ghép) | D15–D20: việc nền document.withdraw + Approval.jobId; Job.summary, result không bắt buộc với việc không tạo đối tượng; people chỉ ở cấp trang, chi tiết dùng XDetail; hành động feedback của Document; people cho danh sách khối, phòng, division, uỷ quyền; loại thư mục được tạo ở gốc drive. Phiên bản 1.2.0-gd1 |
| 2026-10-20 | rev 21 | 9.4 D21 | Trưởng phòng trình huỷ bỏ HD, BM cấp phòng → GĐ khối phụ trách duyệt. Chỉ đổi mô tả POST /documents/{id}/withdraw. Phiên bản 1.3.0-gd1 |
| 2026-10-20 | rev 22 | 9.4 D22 | Đề nghị N5 (BE): callback đăng nhập thêm loi=setup khi đúng tên miền nhưng CSDL chưa có công ty. Chỉ đổi mô tả GET /auth/google/callback. Phiên bản 1.4.0-gd1 |
| 2026-10-23 | Chủ dự án duyệt trực tiếp trong chat 02 | Drive cơ bản VCworkspace: `/spaces`, `/drive/items`, `/drive/folders`, `/drive/files`, `/drive/files/{fileId}`, `/drive/files/{fileId}/content` | Hợp đồng trung lập kho; tải đồng bộ tối đa 10 MiB, chỉ `text/plain` và `application/octet-stream` trong PoC; trùng tên 409 không ghi đè/tự đổi; checksum SHA-256, idempotency và lỗi kho riêng. Không lấy từ rev Claude Docs mới. Phiên bản 1.5.0-gd1. |
| 2026-10-23 | Chủ dự án giao trực tiếp trong chat 03 | Drive an toàn dữ liệu: đổi tên/di chuyển giữ id, phiên bản/khôi phục, thùng rác/khôi phục | Đối chiếu trên adapter Nextcloud local; bản bất biến theo checksum, không có xoá vĩnh viễn, tenant/quyền manager-reader-none giữ nguyên. Không lấy từ rev Claude Docs mới. Phiên bản 1.6.0-gd1. |
| 2026-10-23 | Chủ dự án giao trực tiếp trong chat 04 | Soạn thảo DOCX: tạo từ mẫu, editor-config, content ticket và callback ONLYOFFICE | Callback chỉ báo thành công sau khi tải/kiểm và tạo phiên bản Drive bất biến; manager sửa, reader xem; vé/JWT và chặn SSRF. Không lấy từ rev Claude Docs mới. Phiên bản 1.7.0-gd1. |
| 2026-10-23 | Chủ dự án giao trực tiếp trong chat 05 | Bảng tính XLSX: tạo từ mẫu, mở/sửa qua ONLYOFFICE, công thức/lọc/sort, lưu version và xuất XLSX/PDF | Tái dùng vé/JWT/callback/version của chat04; kiểm cấu trúc OOXML theo loại, manager sửa, reader xem; không cam kết Apps Script/macro tương thích. Không lấy từ rev Claude Docs mới. Phiên bản 1.8.0-gd1. |
| 2026-10-23 | Chủ dự án giao trực tiếp trong chat 06 | Slide PPTX: tạo mẫu ba slide, mở/sửa nội dung và bố cục qua ONLYOFFICE, trình chiếu, lưu version và xuất PPTX/PDF | Tái dùng vé/JWT/callback/version của chat04; thêm `documentType=slide`, kiểm cấu trúc OOXML presentation, manager sửa và reader xem. Không lấy từ rev Claude Docs mới. Phiên bản 1.9.0-gd1. |
# Chat07 Email cơ bản — nguồn giao trực tiếp 2026-10-23

- Chủ dự án giao chat07 thực hiện mailbox thử nội bộ `.test`, gửi/nhận,
  draft, reply/forward/thread, attachment/MIME và trạng thái sau ACK; cho phép
  cập nhật contract trong phạm vi này. Không lấy từ rev Claude Docs mới.
- OpenAPI `2.0.0-gd1` thêm `/mail/messages`, `/mail/threads/{id}`,
  `/mail/drafts`, `/mail/drafts/{id}`, `/mail/send` và raw MIME.
- Mailbox/MIME gốc thuộc mail server; Mongo chỉ giữ mapping ID/trạng thái.
  Chỉ nhận địa chỉ `@vcworkspace.test`; không có API cấu hình MX/alias/shared mailbox.

# Chat08 Quản lý Email — nguồn giao trực tiếp 2026-10-23

- Chủ dự án giao chat08 thực hiện trọn UI/API/Stalwart local cho nhãn, tìm kiếm,
  bộ lọc thư đến, alias identity, hộp thư nhóm và thu hồi thành viên; cho phép
  thay đổi hợp đồng đúng phạm vi này. Không lấy từ rev Claude Docs mới.
- OpenAPI `2.1.0-gd1` mở rộng tìm thư và thêm API labels, filters, aliases,
  shared mailboxes/members. Alias chỉ là danh tính gửi; shared mailbox là mailbox
  riêng với quyền `read/send/manage`. MIME vẫn thuộc mail engine; metadata nghiệp
  vụ, ACL, nhãn và ánh xạ folder được lưu riêng, có kiểm tenant.

# Chat09 Liên thông Email–Drive–Office — nguồn giao trực tiếp 2026-10-24

- Chủ dự án giao chat09 thực hiện nhận attachment → lưu Drive đúng folder/quyền
  → sửa qua ONLYOFFICE/version → gửi lại dưới dạng snapshot hoặc link xác thực;
  cho phép thay đổi contract đúng phạm vi này. Không lấy từ rev Claude Docs mới.
- OpenAPI `2.2.0-gd2` thêm lưu attachment theo MIME part/hash, gửi đúng Drive
  version/hash và link cần đăng nhập + ACL có sẵn. Gửi link không tự cấp quyền;
  attachment là snapshot bất biến. Chỉ miền `.test`, local cô lập.
