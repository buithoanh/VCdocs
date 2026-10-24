# Đề nghị sửa hợp đồng – phiên BE giai đoạn 1

Phiên BE không sửa `contract/`. Chỗ hợp đồng thiếu, sai hoặc khó làm được ghi ở
đây; BE đã chọn cách an toàn nhất (ghi ở cột "BE đang làm") và làm tiếp. Chủ dự
án rà, đồng ý thì phiên cập nhật hợp đồng sửa `contract/openapi.yaml`.

Nguồn đối chiếu: `contract/openapi.yaml` 1.2.0-gd1 (commit 432bad4), hợp đồng
Claude Docs rev 20 (mục 9 D1–D20), BA rev hiện tại.

## Đề nghị sau review chat01–12B (2026-10-25) – chờ duyệt hợp đồng

BE đã làm theo cách an toàn; chỉ là thay đổi mô tả, không đổi schema.

| # | Điểm cuối | BE đang làm | Đề nghị ghi vào hợp đồng |
|---|---|---|---|
| R1 | GET /auth/google, GET /auth/google/callback | `AUTH_MODE=oidc` thì 302 `/dang-nhap?loi=provider` | Thêm `provider` vào danh sách `loi` của luồng Google; nêu rõ Google tắt khi bật OIDC |
| R2 | POST /drive/files/{fileId}/versions/{versionId}/restore | Tạo phiên bản mới số max+1 trỏ đúng blob của bản cũ | Mô tả: khôi phục tạo phiên bản mới, `versionNumber` luôn tăng |
| R3 | PATCH /drive/items/{itemId} | Gửi lại đúng tên/thư mục hiện tại trả 200 (no-op) | Mô tả: 409 chỉ khi trùng với mục khác |

## Đề nghị Drive cơ bản VCworkspace (2026-10-23) – chờ duyệt hợp đồng

Phạm vi: sáu API Drive trung tính cho PoC Nextcloud local cô lập đã được duyệt.
Chưa sửa OpenAPI, schema sinh hoặc endpoint sản phẩm; M03 Google giữ nguyên.

| # | Điểm cuối | Thành công | Quyền |
|---|---|---|---|
| D1 | GET /spaces | 200 SpaceList | Chỉ không gian người gọi là thành viên |
| D2 | GET /drive/items | 200 DriveItemList | reader trở lên; không lộ item cho người ngoài |
| D3 | POST /drive/folders | 201 DriveFolder | manager/editor; CSRF và idempotency key |
| D4 | POST /drive/files | 201 DriveFile | multipart; manager/editor; tối đa 10 MiB trong PoC |
| D5 | GET /drive/files/{fileId} | 200 DriveFile | reader trở lên; người ngoài nhận 404 |
| D6 | GET /drive/files/{fileId}/content | 200 stream | reader trở lên; PoC chưa hỗ trợ Range |

DTO gồm Space, DriveFolder, DriveFile và DriveItemList với id nội bộ, spaceId,
parentId, tên, loại, size, MIME, contentSha256, actor, thời gian và
allowedActions. Không lộ googleId, Google driveId, URL/đường dẫn Nextcloud,
provider object id hoặc credential.

Tên upload chuẩn hoá NFC và cắt khoảng trắng đầu/cuối; cấm rỗng, dấu chấm đơn,
dấu chấm đôi, slash, backslash và control character. PoC cho text/plain và
application/octet-stream. Trùng tên trong cùng không gian/thư mục trả
409 NAME_CONFLICT, không overwrite hoặc auto-rename.

Fingerprint upload do server tính từ công ty, người dùng, đích, tên chuẩn hoá,
size, MIME và SHA-256 của byte. Cùng key/cùng fingerprint replay đúng fileId;
cùng key/khác fingerprint trả 409 IDEMPOTENCY_CONFLICT và không gọi kho. Chỉ
file ready xuất hiện trong list. Sau timeout phải đối soát attempt/provider
marker trước retry, không upload mù hoặc báo thành công giả.

Download trả Content-Type, Content-Length, Content-Disposition, ETag nội bộ,
Digest SHA-256 và Accept-Ranges none. ETag nhà cung cấp không thay checksum byte.

Mã lỗi đề nghị: 400 VALIDATION, 401 AUTH_REQUIRED, 403 FORBIDDEN,
404 NOT_FOUND, 409 NAME_CONFLICT, 409 IDEMPOTENCY_CONFLICT,
409 STORAGE_STATE_CONFLICT, 413 PAYLOAD_TOO_LARGE,
415 UNSUPPORTED_MEDIA_TYPE, 429 STORAGE_RATE_LIMITED kèm Retry-After,
502 STORAGE_INTEGRITY_MISMATCH, 503 STORAGE_UNAVAILABLE và
504 STORAGE_TIMEOUT. Chỉ retry lỗi kho tạm thời, có backoff, jitter và giới hạn.

Audit create/upload/download/denied gồm actor nội bộ, company/space, action,
object id khi an toàn, request id, result, error class và thời gian; không ghi

## Đề nghị Drive an toàn dữ liệu VCworkspace (2026-10-23) – đã được giao áp dụng

Nguồn quyết định: chủ dự án giao chat 03 thực hiện trọn đầu-cuối và giao rõ quyền
cập nhật hợp đồng sau khi đối chiếu hành vi Nextcloud local. Đây là phần nối tiếp
Drive cơ bản `1.5.0-gd1`, không lấy từ Claude Docs rev mới và không thay hợp đồng
M03 Google hiện có.

| Mã | Điểm cuối | Kết quả | Quy tắc an toàn |
|---|---|---|---|
| S1 | `PATCH /drive/items/{itemId}` | item đã đổi tên/di chuyển | manager; giữ `itemId`; tên đích trùng trả 409; MOVE kho xong mới cập nhật metadata |
| S2 | `POST /drive/files/{fileId}/versions` | bản mới và metadata tệp | manager; multipart tối đa 10 MiB; checksum; idempotency; bản cũ bất biến |
| S3 | `GET /drive/files/{fileId}/versions` | danh sách bản | reader trở lên; không lộ người ngoài |
| S4 | `POST /drive/files/{fileId}/versions/{versionId}/restore` | metadata tệp trỏ bản được khôi phục | manager; đọc lại byte/hash trước khi chuyển bản hiện hành; tạo audit |
| S5 | `POST /drive/items/{itemId}/trash` | item trong thùng rác | manager; lưu cha cũ; item không còn ở danh sách thường; không xoá vĩnh viễn blob |
| S6 | `GET /drive/trash` | danh sách thùng rác theo space | reader trở lên; vẫn áp dụng membership/tenant |
| S7 | `POST /drive/items/{itemId}/restore` | item về đúng cha cũ | manager; kiểm cha còn hoạt động và xung đột tên trước khôi phục |

`WorkspaceDriveFile` bổ sung `currentVersionId`, `versionNumber`, `trashedAt` và
allowed actions `rename`, `move`, `upload-version`, `list-versions`, `restore-version`,
`trash`, `restore`. `WorkspaceDriveVersion` có id, fileId, number, size, MIME,
checksum, createdAt/createdBy; không trả storage credential/path. Thư mục trong
thùng rác kéo theo con cháu bị ẩn theo ancestry; phiên bản không bị xoá. Không có
API xoá vĩnh viễn trong chat03.

## Đề nghị soạn thảo văn bản VCworkspace (2026-10-23) – đã được giao áp dụng

Nguồn quyết định: chủ dự án giao chat04 thực hiện tạo DOCX từ mẫu, nhúng
ONLYOFFICE, callback lưu thành phiên bản Drive bất biến, quyền xem/sửa và xuất.
Không lấy từ Claude Docs rev mới. Phạm vi local cô lập, không production.

| Mã | Điểm cuối | Quy tắc |
|---|---|---|
| W1 | `POST /drive/documents` | manager tạo DOCX từ mẫu; idempotency; cùng quy tắc tên/cha của Drive |
| W2 | `GET /drive/files/{fileId}/editor-config` | manager nhận edit, reader nhận view; config/JWT ngắn hạn; key gồm fileId + version |
| W3 | `GET /drive/editor/content?ticket=` | máy-máy bằng vé HMAC hết hạn; chỉ trả bản hiện hành |
| W4 | `POST /drive/editor/callback?ticket=` | bắt buộc vé + JWT; URL cùng origin editor; tải/kiểm DOCX rồi mới tạo version và trả `error: 0` |
| W5 | `GET /drive/files/{fileId}/export?format=` | reader trở lên; DOCX lấy bản hiện hành, PDF qua converter có JWT và kiểm magic byte |

Editor không ghi đè blob. Callback status 2/6 idempotent; lỗi tải, SSRF, chữ ký,
định dạng hoặc kho trả `error: 1`, không cập nhật currentVersion.

## Đề nghị bảng tính VCworkspace (2026-10-23) – đã được giao áp dụng

Nguồn quyết định: chủ dự án giao chat05 thực hiện XLSX trọn đầu-cuối và giao rõ
quyền cập nhật contract. Không lấy từ Claude Docs rev mới; không mở rộng sang
Apps Script/macro hoặc dữ liệu thật.

| Mã | Điểm cuối | Quy tắc |
|---|---|---|
| S01 | `POST /drive/spreadsheets` | manager tạo XLSX mẫu nghiệp vụ; tên/cha/idempotency như Drive |
| S02 | `GET /drive/files/{fileId}/editor-config` | XLSX dùng `documentType=cell`; manager edit, reader view; key fileId + version |
| S03 | `POST /drive/editor/callback?ticket=` | vé + JWT + same-origin; kiểm gói OOXML XLSX có workbook/worksheet trước khi tạo version |
| S04 | `GET /drive/files/{fileId}/export?format=xlsx|pdf` | reader trở lên; XLSX lấy current version, PDF qua converter và kiểm magic |

Mẫu có tiếng Việt, ngày, số lượng, tiền tệ, SUM/IF/SUMIF/VLOOKUP, auto-filter
và sort state. Giá trị công thức được kiểm độc lập trong test và bằng chứng
engine thật; không suy rộng thành tương thích mọi hàm Excel.

## Đề nghị Slide chat06 — đã được giao trực tiếp (2026-10-23)

| Mục | Điểm cuối | Nội dung đã chốt trong phạm vi local |
|---|---|---|
| P01 | `POST /drive/presentations` | Tạo PPTX ba slide từ mẫu tiếng Việt, có title/body/shape/table; lưu version 1 |
| P02 | `GET /drive/files/{fileId}/editor-config` | PPTX dùng `documentType=slide`; manager edit, reader view; key fileId + version |
| P03 | `POST /drive/editor/callback?ticket=` | Tái dùng vé/JWT/same-origin/stale-key/idempotency; kiểm package PPTX trước tạo version |
| P04 | `GET /drive/files/{fileId}/export?format=pptx|pdf` | Native lấy current version; PDF qua converter, kiểm magic; không dùng V1 thay V2 |

Mẫu dùng Liberation Sans có sẵn trong Document Server, tỷ lệ 16:9. Phạm vi
không cam kết mọi hiệu ứng/chuyển cảnh/font bên ngoài, tải đồng thời hoặc fidelity
production; trình chiếu và bố cục phải được kiểm trên engine/browser thật.
byte, tên làm lộ đối tượng kín, cookie, Authorization, credential, đường dẫn tạm
hoặc URL kho. Sáu API chỉ vào OpenAPI sau khi chủ hợp đồng duyệt; 10 MiB và hai
MIME là giới hạn PoC, chưa phải quyết định production.

## Tình trạng (2026-10-20)

Chủ dự án đã chốt toàn bộ mục A, B, C bên dưới ("Đồng ý theo đề xuất cho nhóm 1,
nhận cả nhóm 2 và các giả định nhóm 3"); hợp đồng 1.1.0-gd1 đã ghi lại. BE đã sửa
theo bản mới:

| Mục cũ | Đã xử lý theo |
|---|---|
| A1, A2 thư mục gốc drive | D8: `parentId` không bắt buộc ở POST /folders; `GET /folders/next-number?driveId=` |
| A3 R4 lập hồ sơ | D1: POST /records, /records/upload nhận R4 |
| A4 ai trình tài liệu | D2: người soạn được giao hoặc R4 phòng soạn (bỏ qua nhận xét mở vẫn chỉ R4) |
| A5 chia sẻ phát hiện | D7: không `expiresAt`, `reason`; có `detectedAt` |
| A6 lý do giữ lại | D5: `reasonType` enum HoldReasonType, bỏ đoán từ khoá |
| A7 uỷ quyền | D6: `recordTypeId` + `isLegalSignature` (true hoặc loại hồ sơ thuộc khối khác → 422 BR-24) |
| A8 nghỉ việc | D4: giữ như đang làm (leaving + handover_needed cho R3) |
| B mã lỗi | Đã khai báo 409, 422, 403, 413; còn 400 VALIDATION và 403 CSRF là mã chung |
| C1–C20 giả định | Nhận cả; C20 đổi: 413 PAYLOAD_TOO_LARGE thay cho 400 |

Phần mới của 1.1 cũng đã làm: GET /users/lookup (D3), allowedActions đúng enum từng
đối tượng (D9, hồ sơ `edit` → `update`), `people` ở mọi phản hồi chi tiết, trang
danh sách và từng phần tử (D10), Job.type + Job.result (D11), /me `blockId` +
`limits` (D12), callback lỗi → 302 `/dang-nhap?loi=` (D13), 429 Retry-After,
trường lạ bị loại.

## Đề nghị sau hợp đồng 1.1 – đã xử lý (2026-10-20, hợp đồng 1.2.0-gd1)

Chủ dự án đồng ý cả N1–N4; BE đã sửa:

| Mục | Đã xử lý theo |
|---|---|
| N1 | D15: duyệt phiếu huỷ bỏ trả 200 ngay, tạo việc nền `document.withdraw` (Google lỗi tự thử lại tối đa 3 lần); Approval có `jobId`; tài liệu sang withdrawn khi việc xong |
| N2 | D16: `Job.summary` đã có trong hợp đồng; `result` trống với google.sync, folder.ensure_periods, share.revoke_all |
| N3 | D17: danh sách chỉ có `people` ở cấp trang; chi tiết một đối tượng có `people` ở cấp đối tượng |
| N4 | D18: thêm `feedback` vào allowedActions của tài liệu cho người soạn, trưởng phòng soạn |

Cùng đợt: D19 (GET /blocks, /departments, /divisions, /delegations kèm `people`),
D20 (gốc drive chỉ cho thư mục đánh số; year, month, entity thiếu parentId → 422 BR-11).

## Đề nghị mới (sau hợp đồng 1.3.0-gd1, 2026-10-20) – chờ chủ dự án

| # | Điểm cuối / đối tượng | Vấn đề | Đề nghị | BE đang làm |
|---|---|---|---|---|
| N5 | `GET /auth/google/callback` (lỗi D13) | Tài khoản đúng tên miền nhưng CSDL chưa có bản ghi công ty (máy chủ thật mới cài, chưa khởi tạo) thì BE trả `loi=domain`, người dùng đọc thành "chỉ tài khoản @vcprosperous.com được đăng nhập" – sai và khó dò | Thêm giá trị `loi=setup`: "Hệ thống chưa được khởi tạo, liên hệ quản trị". FE thêm câu tương ứng ở trang /dang-nhap | Trả `loi=setup` và ghi log lỗi kèm lệnh `khoi-tao`. **Đã chốt 2026-10-20 → D22, hợp đồng v1.4 (rev 22), openapi 1.4.0-gd1**; FE đã có câu báo |

## Đề nghị mới (sau hợp đồng 1.1) – lưu lại để đối chiếu

| # | Điểm cuối / đối tượng | Vấn đề | Đề nghị | BE đang làm |
|---|---|---|---|---|
| N1 | `Job.type` | Enum không có `document.withdraw`, nhưng duyệt phiếu huỷ bỏ phải đổi tên, chuyển 99 trên Drive | Thêm `document.withdraw` nếu muốn chạy nền | Làm ngay trong `POST /approvals/{id}/decide` (Drive lỗi → phiếu về chờ, trả 502) |
| N2 | `Job.result` (oneOf) | `google.sync`, `folder.ensure_periods`, `share.revoke_all` không có một đối tượng hay file kết quả; số liệu thêm (số người tạo, số thư mục, số lượt gỡ, tên thư mục) không có chỗ | Khai báo `Job.summary` (object tự do) | Bỏ `result` với các việc này; số liệu thêm để ở trường `summary` (ngoài hợp đồng, FE bỏ qua được) |
| N3 | `people` trong từng phần tử danh sách | Schema Code, Approval, RecordType, ExternalShare, Job có `WithPeople` nên mỗi phần tử trong trang cũng phải có `people`, lặp với `people` của trang | Chỉ để `people` ở cấp trang | Gắn cả hai (đúng schema hiện tại) |
| N4 | `DocumentActions` | Không có hành động xem số nhận xét (`GET /documents/{id}/feedback`) | FE dựa vào trạng thái `feedback` để hiện; hoặc thêm `feedback` vào enum | Bỏ `feedback` khỏi allowedActions |


## Đề nghị sửa

### A. Cần sửa để chạy đúng nghiệp vụ

| # | Điểm cuối / đối tượng | Vấn đề | Đề nghị | BE đang làm |
|---|---|---|---|---|
| A1 | `POST /folders` | `parentId` bắt buộc, nhưng mảng 10–49, dự án 50–89, vận hành 02–09 nằm ngay gốc drive (không có thư mục cha) → không tạo được (US-03.1) | `parentId` không bắt buộc; thiếu = gốc drive `driveId` | Nhận thiếu `parentId` (BE lỏng hơn hợp đồng, FE gửi đủ vẫn chạy) |
| A2 | `GET /folders/next-number` | `parentId` bắt buộc nên không hỏi được số kế tiếp ở gốc drive | Thêm `driveId`, `parentId` không bắt buộc | Theo hợp đồng (bắt buộc `parentId`); ở gốc drive FE chưa hỏi trước được, `POST /folders` vẫn tự cấp số |
| A3 | `POST /records`, `/records/upload` | Hợp đồng: R5, R6, R8. Ma trận BA mục 4 "Lập, chốt hồ sơ": R4 cũng "L" | Thêm R4 | Theo hợp đồng: trưởng phòng (chỉ R4) bị 403 |
| A4 | `POST /documents/{id}/submit` | Hợp đồng: R4. BA vai trò R6 "soạn nháp tài liệu được giao, trình duyệt" | Chốt ai trình: R4 (như hiện tại) hay người soạn | Chỉ trưởng phòng (R4) của phòng soạn |
| A5 | `ExternalShare.expiresAt` | Bắt buộc, nhưng chia sẻ phát hiện từ nhật ký Google (`source = detected`) không có hạn | `expiresAt` không bắt buộc khi `source = detected`; thêm `detectedAt` | Ghi `expiresAt` = thời điểm trong nhật ký Google |
| A6 | `POST /records/{id}/hold` | "Lý do thuộc BR-22" nhưng `reason` là chữ tự do | Thêm `reasonType` enum (tranh chấp, thanh tra, bảo hành, công nợ, hợp đồng chưa thanh lý, BĐH yêu cầu) + `reason` | Kiểm `reason` có chứa một trong các cụm trên (không dấu), sai → 422 BR-22 |
| A7 | `Delegation.task` | Chữ tự do, không biết việc nào ứng với loại hồ sơ nào; "việc luật yêu cầu" không có cờ | Thêm `recordTypeId` (hoặc danh mục việc) và cờ `isLegalSignature` | So `task` với id hoặc tên loại hồ sơ, hoặc `record:<kind>`; chặn `task` có chữ "liên khối", "luật" (422 BR-24) |
| A8 | `PATCH /users/{id}` lastWorkingDay | "Ngày nghỉ → tự tạo handover" nhưng M10 Bàn giao thuộc giai đoạn 2 | Ghi rõ giai đoạn 1 chỉ đổi `status = leaving` | Đổi `leaving`, gửi thông báo `handover_needed` cho R3 |

### B. Mã trạng thái BE trả nhưng điểm cuối chưa khai báo

Thân luôn là `Error`. Phần lớn là mã chung ở hợp đồng mục 1 (400, 403); đề nghị
khai báo thêm cho điểm cuối có nghĩa nghiệp vụ riêng:

| Điểm cuối | Mã | Khi nào |
|---|---|---|
| `PATCH /users/{id}` | 422 | Gỡ vai trò đang cấp qua nhóm Google (BR-15) |
| `POST /approvals/{id}/decide` | 422 | Phiếu QĐ, QT cấp VCPV chưa được người kiểm tra xác nhận (BR-04) |
| `PATCH /departments/{id}`, `/blocks/{id}`, `/divisions/{id}` | 409 | Trùng mã, số hoặc driveId |
| `GET /approvals/{id}`, `GET /records/{id}` | 403 | Không liên quan / không thuộc drive phòng ban (drive Mật vẫn 404) |
| `POST /auth/logout` | 403 | Thiếu X-CSRF-Token |
| Mọi điểm cuối có tham số | 400 | Sai kiểu, thiếu Idempotency-Key, sai `sort` |

Danh sách đủ do test tự ghi: chạy `TEST_UNDECLARED_REPORT=/tmp/x.txt pnpm --filter @vcdocs/api test`.

### C. Giả định BE đã chọn, cần chủ dự án xác nhận

| # | Chỗ | BE chọn |
|---|---|---|
| C1 | Tên nhóm Google ↔ vai trò (BA còn `[..]`) | `<số drive>-<mã phòng>-<quan-ly\|quan-ly-noi-dung\|dong-gop\|nhan-xet\|xem>@` → R4/R5/R6/R7/R7 và vai trò drive; nhóm hệ thống `vcdocs-r1@` … `vcdocs-r9@`. Nhóm "xem" của drive Nội bộ không tính vai trò |
| C2 | Mã tài liệu loại QD | Chuỗi mã dùng chữ Đ như tài liệu gốc: `QĐ-VCPV-01` (enum vẫn `QD`); `/documents/by-code/QD-VCPV-01` cũng tìm được |
| C3 | Tên file hồ sơ (BR-09) | `SEO-PTDA KH Nội dung – 2026-10-19` (mã loại viết tắt KH, BC…); hồ sơ vận hành `30A-12345 SEO-PTDA Nội dung – 2026-10-19` |
| C4 | Hạn lưu đến (BR-21 còn `[..]`) | Ngày cuối tháng công việc + số năm; `retentionYears = 0` = vĩnh viễn, không có `until` |
| C5 | Bản chụp lúc trình (BR-27) | PDF để cùng thư mục file, tên `… – bản trình YYYY-MM-DD.pdf`, khoá; `snapshot.viewUrl` = link Drive của PDF |
| C6 | Bảng nhận diện | Điền bằng thay chữ: lúc soạn `v1 (nháp)`, `Nháp – chưa hiệu lực`; lúc ban hành thay bằng `v1`, `Hiệu lực`, ngày, link phiếu. BM khung phải có `{{MA}}`, `{{PHIEN_BAN}}`, `{{TRANG_THAI}}`, `{{NGUOI_SOAN}}`, `{{NGAY_HIEU_LUC}}`, `{{LINK_DUYET}}`. Về sau nên dùng named range |
| C7 | Người duyệt BM cấp VCPV không kèm tài liệu chính | GĐ khối Vận hành nội bộ (như HD cấp VCPV); HD cấp VCPV có HCNS (R3) kiểm tra (BR-04) |
| C8 | Hồ sơ nghiệp vụ: người duyệt | Uỷ quyền khối còn hiệu lực → trưởng phòng → GĐ khối (người lập là trưởng phòng) |
| C9 | Chia sẻ file Mật do chính trưởng phòng trình | GĐ khối duyệt (BR-05) |
| C10 | "R6 trở lên" (tài liệu bên ngoài) | R1–R6 và R8; không gồm R7, R9 |
| C11 | Tài liệu bên ngoài | `level = DEPT`, `status = effective`, file sao chép vào `00 Tài liệu` của phòng; URL chỉ nhận https |
| C12 | Tài liệu cấp VCPV | Nằm ở drive 00 VCPV Chung (mức Nội bộ) |
| C13 | Xem chi tiết tài liệu drive phòng ban | Ai đăng nhập cũng xem được siêu dữ liệu (danh mục toàn công ty); drive Mật → chỉ mã và tên, chi tiết 404 |
| C14 | R3 kiểm toàn vẹn (`/integrity`) | Không cần là thành viên drive, trừ drive Mật |
| C15 | Phiên đăng nhập | 8 giờ, tự gia hạn khi đang dùng (hợp đồng Q4) |
| C16 | Ngày hiệu lực khi ban hành | Không lùi quá 1 tháng |
| C17 | Số thư mục ở gốc drive | Mảng bước 10 (10, 20, 30, 40), hết thì lấp số trống 11–49; trong thư mục con đánh 01–97 |
| C18 | Giá trị còn `[..]` | Để trong `.env`: hạn duyệt 3 ngày, nhắc lại sau 24 giờ, rà soát 12 tháng, mở khoá sửa nhỏ 3 ngày, lùi ngày lập 3 ngày làm việc, chia sẻ tối đa 30 ngày, nhắc trước 3 ngày, hạn mức uỷ quyền 500.000.000 đ, ngày 25 tạo thư mục tháng sau |
| C19 | Trường lạ trong thân | Theo hợp đồng mục 7: bị loại, không báo lỗi (OpenAPI ghi `additionalProperties: false`; máy giả Prism có thể báo 400) |
| C20 | 413 (quá lớn) | Không có trong danh sách mã lỗi → BE trả 400 VALIDATION |
# Đề nghị Email cơ bản chat07 — đã được giao áp dụng 2026-10-23

Nguồn: chủ dự án giao trực tiếp chat07 và cho phép sửa hợp đồng trong phạm vi
mail cơ bản local cô lập. Các điểm cuối M01–M06 gồm danh sách mailbox, hội thoại,
tạo/đọc/sửa draft, gửi multipart có idempotency và tải raw MIME. Chỉ miền
`vcworkspace.test`; aliases/shared mailbox/labels/filter thuộc chat08.

# Đề nghị Quản lý Email chat08 — đã được giao áp dụng 2026-10-23

Nguồn: chủ dự án giao trực tiếp chat08 và cho phép sửa hợp đồng trong phạm vi
mail local cô lập. Mở rộng M01 để tìm theo mailbox/folder/from/subject/body và
lọc nhãn; thêm API nhãn, filter hữu hạn, alias identity, shared mailbox và
membership `read/send/manage`. Thu hồi dùng roles rỗng và có hiệu lực ở lần gọi
kế tiếp. Alias không đồng nhất với shared mailbox; không có forwarding/MX.

# Đề nghị liên thông chat09 — đã được giao áp dụng 2026-10-24

Nguồn: chủ dự án giao trực tiếp chat09 và cho phép sửa hợp đồng. Thêm ba luồng:
`POST /mail/messages/{messageId}/attachments/{part}/save-to-drive`, `POST
/mail/send-drive-file` và `GET /drive/shared-links/{token}`. Lưu attachment phải
authorize cả mailbox nguồn và folder Drive đích, giữ provenance/hash và
idempotency. Gửi attachment cố định version/hash lúc compose; gửi link không tự
cấp ACL, yêu cầu đăng nhập và người nhận có quyền đọc sẵn.
