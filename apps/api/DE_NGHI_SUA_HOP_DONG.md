# Đề nghị sửa hợp đồng – phiên BE giai đoạn 1

Phiên BE không sửa `contract/`. Chỗ hợp đồng thiếu, sai hoặc khó làm được ghi ở
đây; BE đã chọn cách an toàn nhất (ghi ở cột "BE đang làm") và làm tiếp. Chủ dự
án rà, đồng ý thì phiên cập nhật hợp đồng sửa `contract/openapi.yaml`.

Nguồn đối chiếu: `contract/openapi.yaml` 1.1.0-gd1 (commit bbebac3), hợp đồng
Claude Docs rev 19 (mục 9 D1–D14), BA rev hiện tại.

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

## Đề nghị mới (sau hợp đồng 1.1)

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
