# Hợp đồng API VCdocs v1

Oct 19, 2026 · @Thọ Anh Bùi

Hợp đồng này cố định cách giao diện web (Next.js) và máy chủ nghiệp vụ (NestJS) nói chuyện với nhau: giao diện chỉ gọi những điểm cuối ghi ở đây, máy chủ chỉ trả đúng cấu trúc ghi ở đây. Nội dung bám theo Doc (vai trò mục 4, phân hệ mục 6, câu chuyện người dùng mục 7, quy tắc BR mục 8 và 11.3). Bản máy đọc (OpenAPI) là file contract/openapi.yaml trong kho mã, viết tay theo hợp đồng này (không sinh từ mã); giao diện và máy chủ đều code theo file đó. Khi hai bản lệch, hợp đồng này là gốc.

**Trạng thái: ĐÃ CHỐT v1 – 2026-10-19.** Từ đây mọi thay đổi phải ghi vào Lịch sử hợp đồng trước khi sửa mã.

## 1. Phạm vi và nguyên tắc chung

Một điểm cuối (endpoint) là một "cửa" của máy chủ nhận một loại yêu cầu; hợp đồng liệt kê mọi cửa, ai được gõ, gõ gì và nhận lại gì.

| Mục | Quy ước |
| --- | --- |
| Địa chỉ gốc | https://vcdocs.vcprosperous.com/api/v1 \[..\]. Số phiên bản nằm trong đường dẫn; chỉ đổi lên v2 khi có thay đổi làm giao diện cũ hỏng |
| Định dạng | JSON, UTF-8. Thời điểm: ISO 8601 kèm múi giờ (2026-10-19T21:46:00+07:00). Ngày không giờ: YYYY-MM-DD. Tháng công việc: YYYY-MM |
| Mã định danh | id của VCdocs: chuỗi 24 ký tự (MongoDB ObjectId). Id do Google cấp (file, thư mục, drive, phiên bản, quyền chia sẻ) giữ nguyên chuỗi của Google, đặt tên trường có hậu tố Google: fileId, driveId, revisionId, permissionId |
| Đăng nhập | GET /auth/google chuyển sang Google; chỉ tài khoản @vcprosperous.com. Máy chủ cấp phiên bằng cookie HttpOnly, Secure, SameSite=Lax, hết hạn 8 giờ \[..\]. Giao diện không giữ token nào |
| Chống giả mạo yêu cầu | Mọi POST, PATCH, DELETE kèm header X-CSRF-Token lấy từ GET /me |
| Quyền | Kiểm tra ở máy chủ theo ma trận BA mục 4 và mức bảo mật của drive. Thiếu quyền → 403; đối tượng thuộc drive Mật mà người gọi không được xem → 404 (không lộ sự tồn tại) |
| Công ty (tenant) | companyId suy từ tài khoản đăng nhập, gắn vào mọi truy vấn; không bao giờ nhận từ giao diện |
| Phân trang | ?page=1&limit=50 (tối đa 200). Trả { items, page, limit, total }. Sắp xếp ?sort=-createdAt,title (dấu trừ = giảm dần). Lọc bằng tham số nêu ở từng điểm cuối |
| Việc chạy lâu | Hành động phải gọi Google nhiều bước (ban hành, chốt, quét, bàn giao, huỷ) trả 202 Accepted + { jobId }; theo dõi GET /jobs/{id}; kết quả cuối ghi vào chính đối tượng |
| Chống lặp | POST tạo, ban hành, chốt, chia sẻ kèm header Idempotency-Key (chuỗi ngẫu nhiên do giao diện sinh). Gửi lại cùng key trong 24 giờ nhận lại đúng kết quả cũ, không làm hai lần |
| Mã lỗi HTTP | 400 dữ liệu sai · 401 chưa đăng nhập · 403 không có quyền · 404 không có · 409 trùng hoặc sai trạng thái · 422 vi phạm quy tắc nghiệp vụ (kèm mã BR) · 423 file đang khoá · 429 quá nhiều yêu cầu · 502 Google trả lỗi · 503 bảo trì. Thân lỗi: đối tượng Error ở mục 3 |
| Nhật ký | Mọi POST, PATCH, DELETE ghi audit\_logs; phản hồi kèm header X-Audit-Id. Mọi yêu cầu kèm X-Request-Id (giao diện sinh, máy chủ trả lại) để tra lỗi |
| Ngôn ngữ | message trong lỗi và thông báo: tiếng Việt cho người dùng; code: tiếng Anh cố định cho máy |
| Tên trường | camelCase (workMonth, fileId); danh sách số nhiều (versions, items); cờ đúng/sai bắt đầu bằng is hoặc has |

## 2. Danh sách giá trị cố định

Giá trị gửi và nhận đúng chữ như bảng; giao diện hiển thị tiếng Việt theo cột Ý nghĩa.

| Tên | Giá trị | Ý nghĩa |
| --- | --- | --- |
| documentType | QD · QT · HD · BM · EXT | Quy định · Quy trình · Hướng dẫn · Biểu mẫu · Tài liệu bên ngoài (không cấp mã nội bộ) |
| documentLevel | VCPV · DEPT | Cấp công ty · Cấp phòng |
| documentStatus | registered · coded · drafting · feedback · submitted · approved · effective · revising · withdrawn | Đã đăng ký · Đã cấp mã · Đang soạn · Đang lấy góp ý · Chờ phê duyệt · Đã duyệt chờ ban hành · Hiệu lực · Đang sửa đổi · Hết hiệu lực |
| revisionKind | minor · major | Sửa nhỏ (không đổi phiên bản) · Sửa lớn (tăng phiên bản) |
| recordKind | KH · BC · DX · TD · GV · BB · TB · OPS | Kế hoạch · Báo cáo · Đề xuất · Trình duyệt · Giao việc · Biên bản · Thông báo · Hồ sơ vận hành (tên bắt đầu bằng số định danh) |
| recordStatus | drafting · submitted · finalized · held · disposal\_proposed · disposed | Đang lập · Chờ phê duyệt · Đã chốt · Giữ lại · Đề nghị huỷ · Đã huỷ |
| approvalObjectType | document · document\_withdrawal · record · code · retention · external\_share · disposal · delegation | Đối tượng của phiếu trình duyệt |
| approvalStatus | pending · approved · changes\_requested · cancelled · expired · invalidated | invalidated = file đổi sau khi trình (BR-27) |
| systemRole | R1 … R9 | Theo BA mục 4 |
| driveRole | organizer · fileOrganizer · writer · commenter · reader | Quản lý · Quản lý nội dung · Đóng góp · Nhận xét · Xem (tên Google API) |
| securityLevel | internal · department · confidential | Nội bộ · Phòng ban · Mật |
| folderKind | docs · plan\_report · operations · area · project · closed · archive · year · month · entity | 00 · 01 · 02–09 · 10–49 · 50–89 · 98 · 99 · năm · tháng · đối tượng |
| shareRole | reader · commenter | Quyền cho người ngoài |
| shareStatus | pending\_approval · active · expired · revoked |  |
| issueType | wrong\_name · wrong\_place · non\_google\_format · public\_link · unlogged\_external\_share · finalized\_modified · unlocked · effective\_not\_catalogued · in\_my\_drive · stale\_empty\_folder · missing\_month\_folder · trashed · permanently\_deleted · moved\_out · backdated · direct\_member · foreign\_member | 17 loại lỗi tuân thủ (BA mục 7 US-12.1 và 11.3) |
| issueSeverity | red · yellow | Phải xử lý ngay · Xử lý trong hạn |
| issueStatus | open · autofixed · resolved · dismissed |  |
| jobStatus | queued · running · done · failed |  |
| notificationChannel | email · zalo · inapp | Zalo từ giai đoạn 3 |

## 3. Đối tượng dữ liệu

Mọi đối tượng đều có sáu trường chung: id, companyId, createdAt, createdBy, updatedAt, updatedBy. Trường đánh dấu (\*) bắt buộc khi tạo. Phản hồi chi tiết trả cả đối tượng; danh sách trả bản rút gọn (không có versions, steps, details).

### 3.1 Document – tài liệu hệ thống

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| code | chuỗi | Mã Loại-Mã phòng-Số, ví dụ QT-MKT-01; trống khi chưa cấp; EXT không có |
| type\*, level\* | documentType, documentLevel |  |
| title\* | chuỗi | Tên tài liệu không kèm mã |
| departmentId\* | id | Phòng soạn |
| status | documentStatus |  |
| securityLevel | securityLevel | Suy từ drive chứa file |
| drafterId\*, checkerId, approverId | id | Người soạn, kiểm tra, phê duyệt (approverId do máy chủ tính theo BR-03) |
| dueDate | ngày | Hạn soạn |
| current | đối tượng | { number, fileId, revisionId, pdfFileId, pdfSha256, effectiveFrom, issuedBy, approvalId } – phiên bản đang hiệu lực |
| versions | danh sách | \[{ number, kind, changeNote, approvedBy, effectiveFrom, revisionId, pdfSha256 }\] – Lịch sử phiên bản |
| lock | đối tượng | { isLocked, lockedAt, unlockedUntil, unlockReason } |
| reviewDue | ngày | Kỳ rà soát kế tiếp |
| replacesId, replacedById | id | Tài liệu thay thế / bị thay thế |
| folderId, fileId | id, chuỗi Google | Nơi file đang nằm |
| external | đối tượng | Chỉ EXT: { source, number, issuedAt, lastCheckedAt, isSuperseded, originalUrl } |
| relatedIds | danh sách id | Tài liệu liên quan, biểu mẫu đi kèm |

### 3.2 Record – hồ sơ

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| number | chuỗi | Số duy nhất VCdocs cấp, ví dụ HS-2026-000123; in trên dấu chốt và dùng tra cứu; không nằm trong tên file |
| functionCode\* | chuỗi | Mã chức năng/kênh từ Bảng mã (SEO-PTDA) – phần \[Mã\] trong tên file |
| kind\* | recordKind | Phần \[Loại\] trong tên file |
| subject\* | chuỗi | Nội dung ngắn trong tên file |
| identifier | chuỗi | Biển số, số PO, mã lớp – bắt buộc khi kind = OPS |
| recordTypeId\* | id | Loại hồ sơ trong Danh mục hồ sơ |
| departmentId | id | Suy từ recordType |
| workMonth\* | YYYY-MM | Tháng công việc – quyết định thư mục |
| createdDate | ngày | Ngày lập trong tên file; mặc định hôm nay; sớm hơn ngày tạo file quá hạn → cần backdateReason (BR-28) |
| fileName | chuỗi | Tên máy chủ ghép, chỉ đọc |
| folderId, fileId, mimeType |  |  |
| status | recordStatus |  |
| approvalId | id | Phiếu duyệt gần nhất |
| finalized | đối tượng | { at, by, revisionId, pdfFileId, pdfSha256, vaultKey, verifyCode } – vaultKey = vị trí bản PDF trong kho riêng |
| lock | đối tượng | Như Document |
| paperLocation | chuỗi | Vị trí bản giấy |
| hold | đối tượng | { isActive, reason, by, at } – Giữ lại, không được huỷ (BR-22) |
| retention | đối tượng | { years, basis, until } – chép từ recordType lúc chốt |
| adjustsId, adjustedByIds | id | Hồ sơ Điều chỉnh trỏ về gốc và ngược lại |
| isClaimed | đúng/sai | true khi file tạo thẳng trên Drive được đăng ký ngược |

### 3.3 Approval – phiếu trình duyệt

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| objectType\*, objectId\* | approvalObjectType, id | Đối tượng trình |
| snapshot | đối tượng | { revisionId, pdfFileId, pdfSha256, takenAt } – bản chụp lúc trình; người duyệt xem đúng bản này (BR-27) |
| submittedBy, submittedAt |  |  |
| approverId | id | Máy chủ chọn theo thẩm quyền; không nhận từ giao diện |
| approverRule | chuỗi | Ví dụ "QT cấp phòng → Giám đốc khối Kinh doanh (QT-VCPV-01 mục 3)" |
| checkerId | id | Người kiểm tra trước khi duyệt (QĐ, QT cấp VCPV) |
| status | approvalStatus |  |
| decision | đối tượng | { by, at, result, comment, device, ip } – không sửa được sau khi ghi |
| dueAt | thời điểm | Hạn trả lời |
| reminders | danh sách thời điểm | Các lần nhắc |
| invalidatedReason | chuỗi | Ví dụ "revision đổi từ 0B… sang 0C… lúc 2026-10-20T09:12+07:00" |

### 3.4 Folder, ExternalShare, ComplianceIssue, Job, Error

| Đối tượng | Trường chính |
| --- | --- |
| Folder | driveId, googleId, parentId, number ("01"), code ("SEO-PTDA"), shortName, fullName, kind, path ("11 MKT / 10 SEO / 01 SEO-PTDA …"), year, month, securityLevel, status (active · closed · archived), isManagedByVcdocs |
| ExternalShare | fileId, recordId hoặc documentId, email\*, role\*, reason\*, expiresAt\*, sharedBy, approvalId (file Mật), permissionId, status, revokedAt, revokedBy, source (vcdocs · detected) |
| ComplianceIssue | type, severity, driveId, fileId hoặc folderId, itemName, detectedAt, source (webhook · audit\_log · scan), details (đối tượng tự do theo type), actorEmail (ai gây ra, từ nhật ký Google), assigneeId, dueAt, status, hasAutofix, autofixedAt, resolution |
| Job | type, status, progress (0–100), steps \[{ name, status, error }\], result, error, startedAt, finishedAt, requestedBy |
| Error | { error: { code, message, rule, details: \[{ field, issue }\], requestId } } – code ví dụ VALIDATION, RULE\_VIOLATION, STATE\_INVALID, LOCKED, DRIVE\_ERROR, NOT\_FOUND, FORBIDDEN |

Ví dụ phản hồi GET /records/{id} sau khi chốt:

```json
{
  "id": "6723f1a2b9c4d5e6f7a8b9c0",
  "number": "HS-2026-000123",
  "functionCode": "SEO-PTDA",
  "kind": "BC",
  "subject": "Báo cáo SEO tháng 10",
  "recordTypeId": "6720aa11bb22cc33dd44ee55",
  "departmentId": "671f00112233445566778899",
  "workMonth": "2026-10",
  "createdDate": "2026-10-31",
  "fileName": "SEO-PTDA Báo cáo Báo cáo SEO tháng 10 – 2026-10-31",
  "folderId": "6721ab12cd34ef56ab78cd90",
  "fileId": "1AbC...xyz",
  "mimeType": "application/vnd.google-apps.document",
  "status": "finalized",
  "approvalId": "6724cc12dd34ee56ff78aa90",
  "finalized": {
    "at": "2026-11-03T10:15:00+07:00",
    "by": "670a0000111122223333aaaa",
    "revisionId": "0B9x...",
    "pdfFileId": "1PdF...abc",
    "pdfSha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "vaultKey": "vcpv/2026/10/HS-2026-000123.pdf",
    "verifyCode": "K7Q2-9M4X"
  },
  "lock": { "isLocked": true, "lockedAt": "2026-11-03T10:15:04+07:00" },
  "hold": { "isActive": false },
  "retention": { "years": 5, "basis": "Danh mục hồ sơ VCPV – MKT", "until": "2031-12-31" },
  "companyId": "66f0000000000000000000a1",
  "createdAt": "2026-10-31T16:02:11+07:00",
  "createdBy": "670a0000111122223333aaaa"
}
```

## 4. Điểm cuối theo phân hệ

112 điểm cuối cho 15 phân hệ và việc nền. "Ai gọi" ghi vai trò BA mục 4; "Đã đăng nhập" = mọi vai trò trong phạm vi drive được xem. Hành động kèm "202 job" trả jobId. Tham số lọc viết sau dấu ?.

### M01 Đăng nhập, người dùng

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /auth/google | Bắt đầu đăng nhập Google | Mọi người | Chuyển hướng sang Google |
| GET /auth/google/callback | Google trả về, tạo phiên | Google | Đặt cookie, về trang đầu; tên miền khác → 403 |
| POST /auth/logout | Đăng xuất | Đã đăng nhập |  |
| GET /me | Tôi là ai: vai trò hệ thống, phòng, vai trò trên từng drive, csrfToken | Đã đăng nhập |  |
| GET /users ?departmentId&role&status&q | Danh sách nhân sự | R3, R9; R4 phòng mình | Trả tối thiểu: tên, email, chức danh, phòng |
| GET /users/{id} | Chi tiết | như trên |  |
| PATCH /users/{id} | Đổi vai trò hệ thống; ghi ngày nghỉ việc | R9 vai trò; R3 ngày nghỉ | Ngày nghỉ → tự tạo handover |
| POST /sync/google | Đồng bộ nhân sự, nhóm, thành viên drive | R9 | 202 job; việc nền hằng đêm |
| GET /drives | 11 drive và vai trò của tôi trên từng drive | Đã đăng nhập |  |
| GET /drives/{id}/members ?anomalies | Thành viên drive; anomalies=true chỉ thành viên lẻ, ngoài tên miền | R3, R9; R4 drive mình |  |

### M02 Danh mục nền, Bảng mã

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /blocks · /departments · /divisions | Khối, phòng–drive, division | Đã đăng nhập |  |
| POST, PATCH /blocks/{id} · /departments/{id} · /divisions/{id} | Sửa danh mục nền | R9, R3 |  |
| GET /codes ?type&departmentId&status&q | Bảng mã | Đã đăng nhập |  |
| POST /codes | Đề nghị mã mới { code, type, meaning, scope, reason } | R4 | Trùng → 409; trạng thái pending, chưa dùng được (BR-12) |
| POST /codes/{id}/decide | Ban Điều hành duyệt { result, comment } | R1 |  |
| POST /codes/export | Xuất Google Sheets | R3 | 202 job → fileId |

### M03 Cây thư mục

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /folders ?driveId&parentId&kind&depth | Cây thư mục từ sổ VCdocs | Theo quyền drive |  |
| GET /folders/{id} · GET /folders/{id}/children | Một thư mục và con | Theo quyền drive |  |
| GET /folders/next-number ?parentId&kind | Số kế tiếp còn trống | R4, R5 |  |
| POST /folders | Tạo thư mục đúng khung { driveId, parentId, kind, code, shortName, fullName } | R4; R5 mảng mình | 202 job; area/project cần code đã duyệt; tên máy chủ ghép (BR-11) |
| POST /folders/{id}/rename | Đổi tên đúng mẫu { shortName, fullName } | R4 | Giữ số và mã |
| POST /folders/{id}/close-project | Kết thúc dự án → 98 | R4 | Số không cấp lại |
| POST /folders/ensure-periods | Tạo thư mục năm, tháng còn thiếu { driveId?, month } | R3; việc nền ngày \[..\] hằng tháng | 202 job |
| POST /folders/{id}/resync | Đọc lại từ Drive khi lệch | R3, R4 |  |

### M04 Tài liệu hệ thống

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /documents ?type&level&departmentId&status&q&reviewDueBefore | Danh mục tài liệu | Đã đăng nhập | Tài liệu Mật chỉ hiện mã và tên với người không có quyền |
| GET /documents/{id} | Chi tiết kèm versions | Theo quyền drive |  |
| GET /documents/similar ?title | Tài liệu tên gần giống | R4 | Tránh soạn trùng |
| POST /documents | Đăng ký { type, level, title, departmentId, drafterId, dueDate } | R4 | QD chỉ VCPV (BR-02) → registered |
| POST /documents/{id}/assign-code | Cấp mã kế tiếp | R3 | → coded; mã đã huỷ không cấp lại (BR-01) |
| POST /documents/{id}/create-draft | Tạo file nháp từ BM khung, điền bảng nhận diện | drafterId | 202 job → drafting |
| POST /documents/{id}/request-feedback | Lấy góp ý { reviewerIds, departmentIds, dueDate } | drafterId | Cấp quyền Nhận xét cho người ngoài drive, thông báo → feedback |
| GET /documents/{id}/feedback | Số nhận xét chưa đóng (đọc từ Drive) | drafterId, R4 |  |
| POST /documents/{id}/submit | Trình duyệt { overrideOpenComments?, reason? } | R4 | Tạo Approval, khoá tạm, chụp phiên bản → submitted; còn nhận xét mở → 422 trừ khi override |
| POST /documents/{id}/issue | Ban hành { effectiveFrom, notifyGroupIds } | R3 cấp VCPV; R4 cấp phòng | 202 job: bảng đầu file, chuyển thư mục, khoá, danh mục, thông báo; cần approval approved |
| POST /documents/{id}/revise | Mở sửa { kind, reason, unlockDays } | R4 | minor: mở khoá có hạn, ghi dòng lịch sử; major: → revising, bản cũ vẫn hiệu lực (BR-06, BR-07) |
| POST /documents/{id}/withdraw | Trình huỷ bỏ { reason, replacedById? } | R4 | Approval document\_withdrawal; duyệt xong job đổi tên \[HẾT HIỆU LỰC\], chuyển 99 (BR-08) |
| POST /documents/{id}/review | Kết quả rà soát định kỳ { result, note } | R4 | keep · revise · withdraw |
| GET /documents/{id}/integrity | Khoá còn không, phiên bản hiện tại có khớp bản hiệu lực | R3, R4 |  |
| POST /documents/{id}/relock | Khoá lại ngay | R3, R4, việc nền |  |
| POST /external-documents | Nhập tài liệu bên ngoài { source, number, issuedAt, title, departmentId, fileId? hoặc url? } | R6 trở lên | 202 job: sao chép vào 00 Tài liệu (BR-31) |
| PATCH /external-documents/{id} | { isSuperseded, lastCheckedAt } | R6 trở lên | isSuperseded → trả relatedIds đang dẫn chiếu |
| POST /documents/catalog/export | Xuất Danh mục tài liệu VCPV | R3 | 202 job |

### M05 Phê duyệt

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /approvals ?box=inbox·sent·all&status&objectType | Danh sách phiếu; inbox = chờ tôi | Đã đăng nhập |  |
| GET /approvals/{id} | Chi tiết + link bản chụp | Người liên quan |  |
| GET /approvals/preview ?objectType&objectId | Ai sẽ duyệt theo thẩm quyền | Người trình | BR-03, BR-24, uỷ quyền khối |
| POST /approvals/{id}/check | Người kiểm tra xác nhận | checkerId | QĐ, QT cấp VCPV |
| POST /approvals/{id}/decide | { result: approve · changes\_requested, comment } | approverId | comment bắt buộc khi yêu cầu sửa; phiên bản lệch snapshot → 409 + invalidated (BR-27); ghi device, ip |
| POST /approvals/{id}/cancel | Rút phiếu | submittedBy |  |
| POST /approvals/{id}/remind | Nhắc lại | submittedBy, R3 | Tự nhắc sau \[..\] ngày |
| GET, POST /delegations · PATCH /delegations/{id} | Bảng uỷ quyền của khối { blockId, task, limitAmount, delegateId, from, to } | R2 | Vượt hạn mức hoặc việc liên khối → 422 BR-24 |

### M06 Danh mục hồ sơ

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /record-types ?departmentId · GET /record-types/{id} | Loại hồ sơ | Đã đăng nhập |  |
| POST /record-types | Khai báo { departmentId, name, kind, namingRule, example, folderId, keeperTitle, retentionYears, retentionBasis, disposalMethod, securityLevel, templateId? } | R4 | Thời hạn chưa duyệt → chưa lập được hồ sơ (BR-20) |
| PATCH /record-types/{id} | Sửa | R4 | Đổi thời hạn → phải trình lại |
| POST /record-types/{id}/submit-retention | Trình thời hạn lưu | R4 | Approval retention: R1; kế toán thêm R8, nhân sự thêm R3 |
| POST /record-types/catalog/export | Xuất Danh mục hồ sơ VCPV | R3 | 202 job |

### M07 Hồ sơ

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /records ?recordTypeId&departmentId&workMonth&status&kind&q&identifier&createdBy | Danh sách | Theo quyền drive |  |
| GET /records/{id} | Chi tiết | Theo quyền drive |  |
| POST /records | Lập từ biểu mẫu { recordTypeId, kind, functionCode, subject, identifier?, workMonth, createdDate?, backdateReason? } | R5, R6, R8 | 202 job: tạo file, đặt tên, đặt chỗ (BR-09, BR-10, BR-28) |
| POST /records/upload | Tải file lên (multipart) cùng trường trên | R5, R6, R8 | 202 job; chuyển định dạng Google trừ PDF, XML, scan (BR-14) |
| PATCH /records/{id} | Sửa { subject, identifier, workMonth, paperLocation } | Người lập | Chỉ khi drafting, khác → 409 |
| POST /records/{id}/submit | Trình duyệt | Người lập | Như tài liệu: khoá tạm, chụp phiên bản |
| POST /records/{id}/finalize | Chốt | Người lập, R4 | 202 job: PDF + dấu chốt + QR, khoá, mã băm, kho riêng (BR-13, BR-26, BR-29) |
| POST /records/{id}/adjust | Tạo hồ sơ Điều chỉnh { reason } | R5, R6 | Trả record mới có adjustsId |
| POST /records/{id}/scan | Gắn bản scan (multipart) { paperLocation } | Người lập | Ghi vị trí vào Mô tả file |
| POST /records/{id}/hold · /release-hold | Giữ lại { reason } / bỏ giữ | R4, R1, R8 | BR-22 |
| GET /records/{id}/integrity | Khoá, mã băm, phiên bản có khớp | R3, R4 |  |
| GET /verify/{verifyCode} | Tra mã trên dấu chốt (QR) | Đã đăng nhập, không cần quyền drive | Trả number, status, finalizedAt, pdfSha256; không trả nội dung |
| GET /records/unregistered ?driveId | File trên Drive chưa đăng ký | R4, R5 |  |
| POST /records/claim | Đăng ký ngược { fileId, recordTypeId, kind, functionCode, workMonth } | Người tạo file, R4 | Tên sai → máy chủ đổi tên đúng |

### M08 Tra cứu

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /search ?q&scope&departmentId&workMonth&status&createdBy | Tìm theo mã, tên, số định danh | Đã đăng nhập | Chỉ trả thứ được xem; ≤ 2 giây |
| GET /search/suggest ?q | Gợi ý khi gõ | Đã đăng nhập |  |
| GET /documents/by-code/{code} | Mở bản hiệu lực theo mã | Đã đăng nhập | Bản cũ chỉ qua versions |

### M09 Chia sẻ ngoài

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /external-shares ?departmentId&status&fileId | Sổ chia sẻ ngoài | R4 phòng mình, R3; người chia sẻ |  |
| POST /external-shares | { fileId, email, role, reason, expiresAt } | R5, R6, R8 | Tài khoản máy thực hiện; file Mật → pending\_approval (R4); expiresAt ≤ \[..\] ngày (BR-17) |
| POST /external-shares/{id}/revoke · /extend | Gỡ / gia hạn { expiresAt } | Người chia sẻ, R4 |  |
| POST /external-shares/revoke-all ?departmentId | Gỡ hết | R4 |  |
| GET /external-shares/anomalies | Chia sẻ trong nhật ký Google không có trong sổ | R4, R3 | Tự gỡ trong \[..\] phút |

### M10 Bàn giao

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| POST /handovers | Lập biên bản { userId, lastWorkingDay, receiverId } | R3 | 202 job: tự liệt kê hồ sơ, tài liệu, phiếu chờ, chia sẻ, file Drive của tôi |
| GET /handovers ?status · GET /handovers/{id} | Danh sách, chi tiết | R3, receiverId, userId |  |
| POST /handovers/{id}/confirm-receiver | Trưởng phòng nhận | receiverId |  |
| POST /handovers/{id}/verify | HCNS kiểm tra | R3 | Trước ngày làm việc cuối (BR-25) |
| POST /handovers/{id}/execute | Chuyển quyền sở hữu, gỡ nhóm, chuyển phiếu chờ | R9 | 202 job; không đảo ngược → giao diện hỏi xác nhận hai lần |
| POST /handovers/{id}/export | Xuất BM-VCPV-08 | R3 | 202 job |

### M11 Rà soát, huỷ hồ sơ

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /records/expired ?departmentId&asOf | Hồ sơ hết hạn lưu, trừ held | R4, R5 |  |
| POST /disposals | Lập danh sách đề nghị huỷ { departmentId, year } | R5 người giữ, R4 | Việc nền tháng \[..\] |
| GET /disposals/{id} · PATCH /disposals/{id}/items/{itemId} | Xem; loại dòng { isExcluded, reason } | R4, R1, R8 |  |
| POST /disposals/{id}/submit | Trình duyệt huỷ | R4 | Approval disposal: R1; chứng từ kế toán thêm R8 |
| POST /disposals/{id}/execute | Xoá vĩnh viễn trên Drive và kho riêng, lập phần B | R4 (tài khoản máy thay mặt) | 202 job; không đảo ngược (BR-23) |
| POST /disposals/{id}/export | Biên bản BM-VCPV-06 | R4, R3 | 202 job |

### M12 Kiểm tra tuân thủ

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /compliance/issues ?departmentId&type&severity&status&assigneeId | Danh sách lỗi | R3; R4, R5 phòng mình; người được giao |  |
| GET /compliance/issues/{id} | Chi tiết | như trên |  |
| POST /compliance/issues/{id}/autofix | Sửa giúp: đổi tên, trả về chỗ, khôi phục, khoá lại, gỡ chia sẻ | R3, R4, R5 | 202 job |
| POST /compliance/issues/{id}/assign · /resolve · /dismiss | Giao { assigneeId, dueAt } / đã xử lý { note } / bỏ qua { reason } | R3, R4 | dismiss ghi nhật ký |
| POST /compliance/scan | Quét đối chiếu toàn bộ { driveId? } | R3, R4 | 202 job; việc nền hằng đêm |
| GET /compliance/summary ?departmentId | Số lỗi theo loại, theo phòng | R1, R3, R4 |  |
| GET /compliance/downloads ?from&to&min | Tải xuống bất thường từ nhật ký Google | R3, R4 |  |
| POST /webhooks/google/drive | Google báo thay đổi | Google | Xác thực X-Goog-Channel-Token; trả 200 ngay, xử lý nền |
| POST /internal/google/renew-watch | Gia hạn kênh nhận thay đổi | Việc nền | Không mở ra ngoài |

### M13 Bảng điều khiển · M14 Thông báo · M15 Nhật ký · Việc nền

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| GET /dashboard/me | Chờ tôi duyệt, tôi đang trình, sắp rà soát, chia sẻ sắp hết hạn, lỗi giao tôi | Đã đăng nhập |  |
| GET /dashboard/department/{id} | Tình hình phòng | R2, R4 |  |
| GET /dashboard/company | Toàn công ty | R1, R3 |  |
| GET /metrics ?from&to&departmentId | Chỉ số BA mục 2 | R1, R3, R4 |  |
| GET /notifications ?unread · POST /notifications/{id}/read · POST /notifications/read-all | Thông báo trong ứng dụng | Đã đăng nhập |  |
| GET, PATCH /notification-settings | Kênh nhận { channels, digest } | Đã đăng nhập | zalo từ giai đoạn 3 |
| GET /audit-logs ?objectType&objectId&actorId&action&from&to | Nhật ký thao tác | R1, R3, R9; R2, R4 phạm vi mình | Chỉ đọc |
| GET /audit-logs/anchor | Mã băm cuối chuỗi và lần neo gần nhất | R1, R3 |  |
| POST /auditor-access · DELETE /auditor-access/{id} | Quyền xem tạm { email, departmentIds, expiresAt } | R1 | Mọi lượt xem ghi nhật ký |
| POST /evidence-pack | Gói bằng chứng { documentId hoặc recordId } | R1, R3 | 202 job → ZIP: PDF, phiếu duyệt, nhật ký |
| GET /jobs/{id} · GET /jobs ?mine | Theo dõi việc chạy lâu | Người yêu cầu, R9 |  |

### M16 Kiểm tra quy cách (bổ sung 19/10, giai đoạn 2)

| Điểm cuối | Việc | Ai gọi | Ghi chú |
| --- | --- | --- | --- |
| POST /format-checks | Kiểm tra một file { fileId } hoặc { documentId } / { recordId } | Người soạn, người lập, R4, R5 | 202 job → FormatCheck; tự gọi khi submit |
| GET /format-checks/{id} | Kết quả: findings \[{ rule, severity, location, message, hasAutofix }\] | Người gọi, người duyệt |  |
| POST /format-checks/{id}/autofix | Sửa giúp { findingIds } | Người soạn, R4 | 202 job; file đang khoá → 423 |
| GET /format-rules · PUT /format-rules | Bộ quy cách theo loại file (Docs, Sheets) và loại tài liệu | Đọc: đã đăng nhập; sửa: R3 | Lấy theo HD-VCPV-02, HD-VCPV-04 hiệu lực (BR-32) |
| POST /approvals/{id}/ai-review | AI đọc bản chụp lúc trình, trả nhận xét | Tự gọi khi submit; approverId gọi lại | 202 job; chạy với mọi drive kể cả Mật; mỗi lượt ghi audit\_logs |
| PATCH /approvals/{id}/ai-review/items/{itemId} | Người duyệt đánh dấu { verdict: accepted · dismissed } | approverId | Lưu kèm phiếu (BR-34) |

Đối tượng mới: **FormatCheck** { targetType, targetId, fileId, revisionId, ruleSetVersion, findings, startedAt, finishedAt } · **AiReview** { approvalId, revisionId, model, items \[{ id, category, text, location, verdict }\], createdAt }. Giá trị mới: issueType thêm format\_violation; approvalObjectType không đổi. Kết quả không chặn submit, issue, finalize (BR-33). AI gọi qua Claude API từ máy chủ; nội dung file không lưu lại sau khi có nhận xét.

## 5. Hành động làm đổi trạng thái

Máy chủ chỉ chấp nhận hành động khi đối tượng đang ở đúng trạng thái "Từ"; sai → 409 STATE\_INVALID; vi phạm điều kiện → 422 kèm mã BR. Giao diện chỉ hiện nút khi hành động hợp lệ (máy chủ trả allowedActions trong mỗi đối tượng).

### 5.1 Tài liệu

| Hành động | Từ | Sang | Điều kiện |
| --- | --- | --- | --- |
| POST /documents | — | registered | QD chỉ cấp VCPV (BR-02); liên quan ≥ 2 phòng → VCPV |
| assign-code | registered | coded | Số kế tiếp theo Loại-Mã phòng, mã đã dùng không cấp lại (BR-01) |
| create-draft | coded | drafting | BM khung bản hiệu lực tồn tại |
| request-feedback | drafting | feedback |  |
| submit | drafting, feedback, revising | submitted | Không còn nhận xét mở (hoặc override của R4); người trình ≠ người duyệt (BR-05); khoá tạm + snapshot (BR-27) |
| decide = changes\_requested | submitted | drafting (hoặc revising nếu đang sửa lớn) | Mở khoá tạm |
| decide = approve | submitted | approved | snapshot khớp phiên bản hiện tại; có check của người kiểm tra với QĐ, QT cấp VCPV |
| issue | approved | effective | Chỉ một phiên bản effective mỗi mã (BR-06); bản trước đó (nếu là sửa lớn) sang versions; khoá (BR-26) |
| revise minor | effective | effective | Mở khoá có hạn, ghi dòng "sửa nhỏ", không đổi số phiên bản (BR-07) |
| revise major | effective | revising | Tạo versions\[n+1\] nháp; bản n vẫn là current |
| withdraw (duyệt xong) | effective | withdrawn | Không xoá file (BR-08) |
| review | effective | effective | Ghi kết quả và reviewDue mới |

### 5.2 Hồ sơ

| Hành động | Từ | Sang | Điều kiện |
| --- | --- | --- | --- |
| POST /records · upload · claim | — | drafting | recordType có thời hạn đã duyệt (BR-20); functionCode đã duyệt (BR-12); createdDate hợp lệ (BR-28) |
| submit | drafting | submitted | Loại hồ sơ cần duyệt; khoá tạm + snapshot |
| decide = changes\_requested | submitted | drafting |  |
| decide = approve | submitted | drafting (cờ isApproved) | Chờ người lập chốt |
| finalize | drafting | finalized | Loại cần duyệt thì isApproved = true và snapshot khớp; PDF, dấu chốt, khoá, mã băm, kho riêng, retention.until (BR-13, BR-21, BR-26, BR-29) |
| adjust | finalized | finalized (hồ sơ mới drafting) | Hồ sơ gốc không đổi; hồ sơ mới có adjustsId |
| hold | finalized | held | Lý do thuộc BR-22 |
| release-hold | held | finalized |  |
| disposal submit (duyệt xong) | finalized, hết hạn | disposal\_proposed | retention.until ≤ hôm nay; không held |
| disposal execute | disposal\_proposed | disposed | Danh sách đã duyệt; chứng từ kế toán có R8 (BR-23) |
| PATCH /records/{id} | drafting | drafting | Không đổi khi đã submitted trở đi |

## 6. Tích hợp Google

Máy chủ gọi Google bằng hai tài khoản máy (service account): một chỉ đọc để quét, một ghi để thao tác; cả hai là Quản lý trên 11 Bộ nhớ dùng chung và được uỷ quyền toàn tên miền để đọc nhân sự, nhóm, nhật ký và Drive của tôi của từng người. Giao diện không bao giờ gọi Google trực tiếp.

| Hành động VCdocs | Gọi Google | Ghi chú |
| --- | --- | --- |
| Đăng nhập | OAuth 2.0, tham số hd=vcprosperous.com; máy chủ kiểm tra lại tên miền trong thông tin trả về | Không tin tham số hd một mình |
| Đồng bộ nhân sự, nhóm | Admin SDK Directory: users.list, groups.list, members.list | Hằng đêm và khi bấm |
| Thành viên drive | Drive: drives.list, permissions.list trên driveId | Đối chiếu với nhóm → direct\_member, foreign\_member |
| Tạo thư mục | files.create (mimeType folder, parents, supportsAllDrives) |  |
| Tạo file từ biểu mẫu | files.copy từ fileId của BM sang thư mục đích | BM phải đang hiệu lực |
| Điền bảng nhận diện, dòng lịch sử phiên bản | Docs API documents.batchUpdate (replaceAllText và insertTableRow); Sheets API values.update với biểu mẫu dạng bảng tính | BM khung phải có chỗ giữ {{MA}}, {{PHIEN\_BAN}}, {{TRANG\_THAI}}, {{NGUOI\_SOAN}}, {{NGAY\_HIEU\_LUC}}, {{LINK\_DUYET}} |
| Tải file lên, chuyển định dạng | files.create (multipart) với mimeType đích là định dạng Google → Drive tự chuyển | PDF, XML, scan giữ nguyên |
| Đổi tên, di chuyển, mô tả | files.update (name, description, addParents, removeParents) |  |
| Khoá, mở khoá | files.update contentRestrictions \[{ readOnly, reason, ownerRestricted: true }\] | Chỉ Quản lý mở; phải kiểm tra capabilities trước |
| Chặn tải, in, sao chép | files.update downloadRestrictions.itemDownloadRestriction { restrictedForReaders, restrictedForWriters } | File Mật và hồ sơ đã chốt |
| Chụp phiên bản | revisions.list → revisionId mới nhất; files.export (PDF) → SHA-256 | So revisionId khi duyệt và chốt |
| Xuất PDF chốt, đóng dấu | files.export → VCdocs đóng dấu chốt + QR → files.create PDF cùng thư mục → khoá → ghi kho riêng | md5Checksum của PDF trên Drive dùng đối chiếu hằng đêm |
| Nhận xét chưa đóng | comments.list, đếm resolved = false |  |
| Chia sẻ ngoài | permissions.create { type user, role, emailAddress, expirationTime }, permissions.delete | Google không nhận hạn với file nào thì VCdocs tự gỡ khi đến hạn |
| Nhận thay đổi | changes.getStartPageToken, changes.list theo driveId; changes.watch → POST /webhooks/google/drive | Kênh có hạn, việc nền gia hạn; cần tên miền HTTPS đã xác minh với Google |
| Nhật ký kiểm tra Google | Admin SDK Reports activities.list (applicationName = drive): chia sẻ, tải, xoá, di chuyển, đổi quyền | Đọc mỗi \[..\] phút; Google ghi có độ trễ |
| Thùng rác, khôi phục, xoá vĩnh viễn | files.list q=trashed=true; files.update trashed=false; files.delete | files.delete chỉ trong job huỷ đã duyệt |
| Drive của tôi của từng người | Uỷ quyền toàn tên miền, files.list q='me' in owners | Chỉ đọc tên, loại, ngày; không đọc nội dung |
| Bàn giao | Admin SDK Data Transfer: chuyển Drive của tôi sang trưởng phòng; Directory members.delete | Tài khoản bị khoá do quản trị viên làm trong Admin console |
| Thông báo email | Gmail API users.messages.send từ hộp thư vcdocs@vcprosperous.com \[..\] |  |
| Xuất danh mục | Sheets API: tạo bản sao mẫu Sheets chuẩn, values.update | Đúng quy cách HD-VCPV-02 |

Phạm vi quyền (scopes) của tài khoản máy ghi: drive, documents, spreadsheets, gmail.send, admin.directory.user.readonly, admin.directory.group.readonly, admin.datatransfer, admin.reports.audit.readonly. Tài khoản máy đọc: drive.readonly, admin.directory.\*.readonly, admin.reports.audit.readonly.

**Giới hạn của Google phát hiện khi viết hợp đồng** (đổi so với BA):

1. Google **không có API đặt tên phiên bản** cho Docs, Sheets, Slides ("đặt tên phiên bản vN – hiệu lực…" trong QT-VCPV-01 bước 7 và QT-VCPV-02 bước 4 chỉ làm được bằng tay). VCdocs thay bằng: lưu revisionId + PDF + mã băm, và tự ghi dòng vào bảng Lịch sử phiên bản cuối file. Đặt tên phiên bản trên Google thành việc tùy chọn.
2. **Khoá file không chặn di chuyển và chia sẻ** → đã bịt bằng vai trò drive và cài đặt (BA 11.4).
3. files.export giới hạn **10 MB mỗi lần xuất** → slide nhiều ảnh có thể không xuất được PDF; cách xử lý \[..\] (tách file hoặc xuất tay rồi tải lên).
4. Nhật ký kiểm tra của Google **có độ trễ** (thường vài phút, có lúc hàng giờ) → "phát hiện ≤ 10 phút" chỉ chắc với thay đổi file (Changes); chia sẻ và tải xuống theo độ trễ của Google.
5. **Hạn ngạch gọi Google theo phút** → không liệt kê lại toàn bộ Drive mỗi lần; quét đêm chạy theo lô và dùng Changes làm nguồn chính.
6. BM khung và biểu mẫu hồ sơ phải có **chỗ giữ** ({{MA}}…) thì máy chủ mới điền tự động → sửa BM-VCPV-02, 03, 04 trước giai đoạn 1.
7. Tài khoản máy phải được quản trị viên **thêm làm Quản lý trên từng drive** và bật uỷ quyền toàn tên miền trong Admin console — việc làm tay một lần.

## 7. Bảo mật và giới hạn của API

| Mục | Quy ước |
| --- | --- |
| Nguồn gọi | Chỉ nhận từ tên miền giao diện (CORS); webhook của Google là ngoại lệ duy nhất, xác thực bằng X-Goog-Channel-Token và channelId đã đăng ký |
| Giới hạn tần suất | 600 yêu cầu/phút/người \[..\]; tìm kiếm 60/phút; vượt → 429 kèm Retry-After |
| Kích thước | Thân JSON ≤ 1 MB; tải file ≤ 100 MB \[..\]; danh sách ≤ 200 dòng mỗi trang |
| Kiểm tra đầu vào | Mọi trường kiểm tra kiểu và độ dài ở máy chủ (DTO + class-validator); trường lạ bị loại, không báo lỗi |
| Quyền ba tầng | (1) vai trò hệ thống R1–R9; (2) phạm vi phòng/khối; (3) vai trò trên drive chứa file. Ba tầng đều đạt mới được; kết quả kiểm tra ghi vào nhật ký khi từ chối |
| Drive Mật | Truy vấn luôn lọc theo danh sách drive người gọi được xem ngay ở tầng cơ sở dữ liệu; không lọc sau khi lấy |
| Quản trị hệ thống (R9) | Không có điểm cuối nào cho R9 đọc nội dung drive Mật; việc sửa vai trò của chính mình bị chặn |
| Bí mật | Khoá tài khoản máy, chuỗi kết nối CSDL, khoá ký cookie nằm trong két bí mật của máy chủ (biến môi trường mã hoá hoặc secret manager), xoay 90 ngày \[..\]; không bao giờ nằm trong mã nguồn |
| Nhật ký | Không ghi nội dung file, không ghi token; ghi email người gọi, hành động, đối tượng, giá trị trước – sau, requestId, ip, thiết bị |
| Dữ liệu cá nhân | /users trả tối thiểu; hồ sơ nhân sự, học viên, khách hàng chỉ là liên kết tới file trên drive xử lý nó (BR-18) |
| Đổi hợp đồng | Thêm trường, thêm điểm cuối: không đổi phiên bản. Bỏ trường, đổi kiểu, đổi nghĩa: lên v2, giữ v1 chạy song song 90 ngày. Mọi thay đổi ghi vào Lịch sử cuối tài liệu này trước khi sửa mã |
| Kiểm thử hợp đồng | Mỗi điểm cuối có ít nhất một bài thử tự động cho trường hợp đúng, sai quyền, sai trạng thái; bài thử kiểm mọi phản hồi khớp contract/openapi.yaml; mỗi lần gộp mã chạy lại toàn bộ |

## 8. Sửa đổi BA rút ra và câu hỏi cần chốt

| Mục BA | Sửa gì |
| --- | --- |
| Mục 3 trạng thái | Tách "Đang soạn" thành registered → coded → drafting; thêm feedback, approved; hồ sơ thêm held tách khỏi finalized |
| Mục 3 đối tượng Hồ sơ | "Mã hồ sơ" tách làm hai: functionCode (mã chức năng trong tên file) và number (số duy nhất VCdocs cấp, chỉ in trên dấu chốt) |
| US-04.4, US-07.2 | Bỏ "đặt tên phiên bản trong lịch sử phiên bản của Google" (không có API); thay bằng lưu revisionId + PDF + mã băm và tự ghi dòng Lịch sử phiên bản trong file |
| US-04.2 | BM-VCPV-02, 03, 04 và biểu mẫu hồ sơ phải có chỗ giữ {{MA}}, {{PHIEN\_BAN}}, {{TRANG\_THAI}}, {{NGUOI\_SOAN}}, {{NGAY\_HIEU\_LUC}}, {{LINK\_DUYET}} |
| US-12.1 | "≤ 10 phút" chỉ cam kết cho thay đổi file; chia sẻ, tải xuống phụ thuộc độ trễ nhật ký Google |
| Mục 9.1 | Hai tài khoản máy (đọc, ghi); hộp thư gửi thông báo vcdocs@vcprosperous.com \[..\]; tên miền ứng dụng vcdocs.vcprosperous.com \[..\] |
| Mục 9.3 | Thêm: mỗi điểm cuối có bài thử tự động; phản hồi kiểm khớp contract/openapi.yaml (viết tay) mỗi lần gộp mã |
| QT-VCPV-01 bước 7, QT-VCPV-02 bước 4 | Câu "đặt tên phiên bản" đổi thành "VCdocs ghi số phiên bản và bản PDF; đặt tên phiên bản trên Google là tùy chọn" khi sửa lại hai quy trình |

**Quyết định (anh chốt 19/10, tất cả theo đề xuất; Q2 kèm điều kiện bên dưới)**:

- Q1. Tên miền ứng dụng: đề xuất vcdocs.vcprosperous.com.
- Q2. Hộp thư gửi thông báo: đề xuất tạo vcdocs@vcprosperous.com, không dùng email cá nhân.
- Q3. Kho mã nguồn: đề xuất GitHub tổ chức của công ty \[..\], kho riêng tên vcdocs, hai thư mục apps/api (NestJS) và apps/web (Next.js).
- Q4. Phiên đăng nhập: đề xuất 8 giờ, tự gia hạn khi đang dùng.
- Q5. Trạng thái hợp đồng: đề xuất coi là "Đã chốt v1" ngay khi anh trả lời Q1–Q4; từ đó mọi thay đổi ghi vào Lịch sử dưới đây.

**Q2 khi đang phát triển:** chưa tạo hộp thư vcdocs@. Biến môi trường MAIL\_MODE = simulate: máy chủ không gửi email thật mà ghi thư vào bảng outbox và trang /dev/mailbox để xem; chế độ redirect gửi thật nhưng mọi thư chuyển về buithoanh@vcprosperous.com (tiêu đề ghi người nhận gốc). Chỉ bật MAIL\_MODE = live sau khi có hộp thư vcdocs@. Q3: tên tổ chức GitHub của công ty vẫn \[..\], kho tên vcdocs.

## 9. Chốt sau lần code đầu (2026-10-20)

Hai phiên code giao diện và máy chủ giai đoạn 1 ghi lại chỗ hợp đồng thiếu hoặc chưa rõ. Anh Thọ Anh chốt ngày 2026-10-20: nhận toàn bộ theo đề xuất dưới đây. Các thay đổi chỉ thêm trường, thêm điểm cuối hoặc nới điều kiện nên vẫn là v1 (mục 7 "Đổi hợp đồng").

### 9.1 Quyền và nghiệp vụ

| # | Chỗ | Chốt |
| --- | --- | --- |
| D1 | POST /records, /records/upload | Thêm R4 (ma trận BA mục 4: trưởng phòng được lập hồ sơ) |
| D2 | POST /documents/{id}/submit | Người soạn được giao (drafterId) hoặc R4 của phòng soạn đều được trình |
| D3 | GET /users/lookup ?q | Điểm cuối mới: mọi người đã đăng nhập tra người để chọn (người soạn, góp ý, uỷ quyền…). Chỉ trả người đang làm việc, dạng UserRef { id, name, email, title, departmentId }, tối đa 20 |
| D4 | PATCH /users/{id} lastWorkingDay | Giai đoạn 1: đổi status = leaving và gửi thông báo handover\_needed cho R3. Tự tạo biên bản bàn giao từ giai đoạn 2 (M10) |
| D5 | POST /records/{id}/hold | Thêm reasonType bắt buộc: dispute (tranh chấp) · inspection (thanh tra, kiểm toán) · warranty (bảo hành) · receivable (công nợ) · contract\_open (hợp đồng chưa thanh lý) · board\_request (Ban Điều hành yêu cầu); reason là diễn giải |
| D6 | Delegation | Thêm recordTypeId (loại hồ sơ được uỷ quyền duyệt; task chỉ còn là mô tả) và isLegalSignature. isLegalSignature = true hoặc việc liên khối → 422 BR-24 |
| D7 | ExternalShare | expiresAt không bắt buộc khi source = detected; thêm detectedAt |

### 9.2 Làm rõ cho giao diện và máy chủ

| # | Chỗ | Chốt |
| --- | --- | --- |
| D8 | Thư mục ở gốc drive | POST /folders: parentId không bắt buộc, thiếu = gốc drive. GET /folders/next-number nhận driveId, parentId không bắt buộc. GET /folders không có parentId = thư mục cấp 1 của drive; depth tính từ đó |
| D9 | allowedActions | Tên hành động kebab-case, trùng đoạn cuối đường dẫn; sửa thông tin (PATCH) là update. Danh sách cố định từng đối tượng — Document: assign-code, create-draft, request-feedback, submit, issue, revise, review, withdraw, relock, integrity, update-external. Approval: check, decide, cancel, remind. Code: decide. RecordType: update, submit-retention. Record: update, submit, finalize, adjust, scan, hold, release-hold, share, integrity. ExternalShare: extend, revoke. Thêm allowedActions cho User (update-roles, update-leave), Folder (create-child, rename, close-project, resync), Block, Department, Division, Delegation (update) |
| D10 | Tên người | Mọi phản hồi chi tiết và mọi trang danh sách kèm people: { id → UserRef } cho mọi id người xuất hiện trong đó |
| D11 | Việc chạy lâu | Job.type cố định: google.sync, codes.export, folder.create, folder.close\_project, folder.ensure\_periods, document.create\_draft, document.issue, documents.catalog\_export, external\_document.import, record\_types.catalog\_export, record.create, record.upload, record.claim, record.finalize, record.scan, share.revoke\_all. Job.result: { objectType, objectId } khi tạo hoặc đổi đối tượng; { fileId } khi xuất file |
| D12 | GET /me | Thêm blockId (khối tôi làm giám đốc) và limits { shareMaxDays, backdateWorkingDays, approvalDueDays, minorUnlockDays, uploadMaxMb } để giao diện báo trước, máy chủ vẫn là nơi quyết định |
| D13 | GET /auth/google/callback lỗi | Không trả JSON: chuyển hướng 302 về /dang-nhap?loi=domain · locked · expired · state |
| D14 | Mã lỗi khai báo thêm | PATCH /users/{id} 422 BR-15 (gỡ vai trò đang cấp qua nhóm Google); POST /approvals/{id}/decide 422 BR-04 (chưa có xác nhận của người kiểm tra); PATCH /blocks · /departments · /divisions 409 trùng mã, số hoặc driveId; GET /approvals/{id}, /records/{id} 403 (không liên quan, drive Mật vẫn 404); 413 PAYLOAD\_TOO\_LARGE khi vượt kích thước mục 7 |

### 9.3 Giả định của máy chủ được chấp nhận

| # | Chỗ | Chốt |
| --- | --- | --- |
| C1 | Nhóm Google ↔ vai trò | \<số drive>-\<mã phòng>-quan-ly · quan-ly-noi-dung · dong-gop · nhan-xet · xem @vcprosperous.com → R4 · R5 · R6 · R7 · R7 và vai trò drive tương ứng; nhóm hệ thống vcdocs-r1@ … vcdocs-r9@. Nhóm "xem" của drive Nội bộ không tính vai trò. Cần IT (anh Hùng) tạo nhóm theo mẫu này |
| C2 | Mã Quy định | Viết QĐ-VCPV-01 (chữ Đ); giá trị documentType vẫn là QD; tra /documents/by-code/QD-VCPV-01 cũng ra |
| C3 | Tên file hồ sơ (BR-09) | SEO-PTDA KH Nội dung – 2026-10-19; hồ sơ vận hành: 30A-12345 SEO-PTDA Nội dung – 2026-10-19 |
| C4 | Hạn lưu đến (BR-21) | Ngày cuối tháng công việc + số năm; retentionYears = 0 là vĩnh viễn, không có until |
| C5 | Bản chụp lúc trình (BR-27) | PDF cùng thư mục file, tên "… – bản trình YYYY-MM-DD.pdf", khoá; snapshot.viewUrl là link của PDF đó |
| C6 | Bảng nhận diện | Điền bằng thay chỗ giữ {{…}}: lúc soạn "v1 (nháp)", "Nháp – chưa hiệu lực"; lúc ban hành đổi sang số phiên bản, "Hiệu lực", ngày và link phiếu |
| C7 | Người duyệt BM cấp VCPV | GĐ khối Vận hành nội bộ (như HD cấp VCPV); HD cấp VCPV có HCNS (R3) kiểm tra |
| C8 | Người duyệt hồ sơ nghiệp vụ | Uỷ quyền khối còn hiệu lực → trưởng phòng → GĐ khối (khi người lập là trưởng phòng) |
| C9 | Chia sẻ file Mật do trưởng phòng trình | GĐ khối duyệt (BR-05) |
| C10 | "R6 trở lên" | R1–R6 và R8; không gồm R7, R9 |
| C11 | Tài liệu bên ngoài | level = DEPT, status = effective, sao chép vào 00 Tài liệu của phòng; url chỉ nhận https |
| C12 | Nơi để tài liệu cấp VCPV | Drive 00 VCPV Chung (mức Nội bộ) |
| C13 | Xem tài liệu | Ai đăng nhập cũng xem mã, tên, trạng thái mọi tài liệu (danh mục toàn công ty); drive Mật chỉ mã và tên, chi tiết 404 |
| C14 | R3 kiểm toàn vẹn | Không cần là thành viên drive, trừ drive Mật |
| C15 | Ngày hiệu lực khi ban hành | Không lùi quá 1 tháng |
| C16 | Đánh số thư mục ở gốc drive | Mảng theo bước 10 (10, 20, 30, 40), hết thì lấp số trống 11–49; trong thư mục con đánh 01–97 |
| C17 | Các con số còn \[..\] (cấu hình, đổi không cần sửa mã) | Hạn trả lời phê duyệt 3 ngày; nhắc lại sau 24 giờ; rà soát tài liệu 12 tháng; mở khoá sửa nhỏ 3 ngày; lùi ngày lập tối đa 3 ngày làm việc; chia sẻ ngoài tối đa 30 ngày, nhắc trước 3 ngày; hạn mức uỷ quyền 500.000.000 đ; ngày 25 hằng tháng tạo thư mục tháng sau |

### 9.4 Chốt thêm sau khi ghép (2026-10-20, v1.2)

Sau khi ghép giao diện và máy chủ, hai phên ghi thêm 6 đề nghị. Anh Thọ Anh đồng ý toàn bộ theo đề xuất.

| # | Chỗ | Chốt |
| --- | --- | --- |
| D15 | Duyệt phiếu huỷ bỏ tài liệu | Thêm việc nền document.withdraw: POST /approvals/{id}/decide vẫn trả 200 ngay; phần trên Drive (đổi tên \[HẾT HIỆU LỰC\], chuyển 99) chạy nền, lỗi thì tự thử lại; Approval có jobId để theo dõi. Tài liệu sang withdrawn khi việc xong |
| D16 | Job.summary | Thêm summary (số liệu tóm tắt, tự do) cho mọi việc; result không bắt buộc với việc không tạo đối tượng hay file (google.sync, folder.ensure\_periods, share.revoke\_all) |
| D17 | people | Danh sách: people chỉ ở cấp trang, không lặp trong từng dòng. Chi tiết một đối tượng: people ở cấp đối tượng |
| D18 | Hành động xem góp ý | Thêm feedback vào danh sách hành động của Document (GET /documents/{id}/feedback) |
| D19 | Danh sách danh mục nền | GET /blocks, /departments, /divisions, /delegations kèm people như mọi danh sách khác |
| D20 | Thư mục ở gốc drive | Được tạo ở gốc: docs (00), plan\_report (01), operations (02–09), area (10–49), project (50–89), closed (98), archive (99). year, month, entity bắt buộc có parentId; thiếu → 422 BR-11 |
| D21 | Huỷ bỏ HD, BM cấp phòng (POST /documents/{id}/withdraw) | Trưởng phòng trình huỷ bỏ thì GĐ khối phụ trách phòng duyệt (như C9), vì trưởng phòng vừa là người trình duy nhất vừa là người duyệt HD, BM cấp phòng (BR-05). Phát hiện khi chạy thử 2026-10-20; anh Thọ Anh chốt cùng ngày |
| D22 | Lỗi đăng nhập khi hệ thống chưa khởi tạo (GET /auth/google/callback) | Thêm loi=setup vào danh sách lỗi của D13: tài khoản đúng tên miền nhưng CSDL chưa có bản ghi công ty thì chuyển về /dang-nhap?loi=setup ("Hệ thống chưa được khởi tạo, liên hệ quản trị"), không trả loi=domain. Quản trị chạy lệnh khởi tạo công ty ở máy chủ. Phát hiện khi chạy Google thật 2026-10-20 (đề nghị N5); anh Thọ Anh chốt cùng ngày |

## Lịch sử hợp đồng

| Phiên bản | Ngày | Thay đổi |
| --- | --- | --- |
| v1 (đã chốt 19/10) | 2026-10-19 | Soạn lần đầu: 112 điểm cuối, 15 phân hệ, theo BA và rà soát mục 11; bổ sung M16 Kiểm tra quy cách (7 điểm cuối, FormatCheck, AiReview) |
| v1.1 | 2026-10-20 | Mục 9: chốt 14 đề nghị (D1–D14) và 17 giả định (C1–C17) sau lần code đầu giai đoạn 1; OpenAPI viết tay là gốc (đầu tài liệu, mục 7, mục 8) |
| v1.2 | 2026-10-20 | Mục 9.4: D15–D20 sau khi ghép giao diện và máy chủ (việc nền huỷ bỏ tài liệu, Job.summary, people chỉ ở cấp trang, hành động feedback, people cho danh mục nền, loại thư mục ở gốc drive) |
| v1.3 | 2026-10-20 | Mục 9.4 D21: trưởng phòng trình huỷ bỏ HD, BM cấp phòng thì GĐ khối phụ trách duyệt |
| v1.4 | 2026-10-20 | Mục 9.4 D22: lỗi đăng nhập loi=setup khi hệ thống chưa khởi tạo công ty |
