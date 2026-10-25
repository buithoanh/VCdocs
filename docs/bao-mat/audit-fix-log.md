# Nhật ký sửa đầu mối audit bảo mật

Nguồn đầu mối: `docs/bao-mat/audit-cloudflare-2026-10-25-needs-validation.md`.
Mỗi mục: fingerprint, lỗi có tái hiện trước khi sửa không (tên test, kết quả), cách sửa, kết quả `ai:check`. Mới nhất ở trên.

---

## 2026-10-25 · Đầu mối 4/12 — Nhập tài liệu ngoài tải url theo redirect, không chặn địa chỉ nội bộ

- **Fingerprint:** `m04-documents/external-import/url-fetch-redirect-ssrf`.
- **Nhánh:** `claude/audit-fix-04-url-fetch-ssrf-25262e` (cắt từ `claude/audit-fix-03-external-import-fileid-1aae87`, commit 54789a1).
- **Kết luận:** lỗi **có thật**, đã tái hiện với `RealGoogle.urls.fetch` trên fixture loopback.

### Tái hiện trước khi sửa

Thêm file `apps/api/test/url-fetch-ssrf.spec.ts`. Test tự dựng hai fixture trên `127.0.0.1`: một dịch vụ "nội bộ" chỉ nói http trả chuỗi đánh dấu (đóng vai `web:3000`, `api:4000`), và một máy chủ https "của kẻ tấn công" có `/direct` (trả chuỗi đánh dấu) và `/redirect` (302). Chứng chỉ tự ký tạo bằng `openssl` vào thư mục tạm cho từng lần chạy. `RealGoogle.urls.fetch` dùng `fetch` toàn cục, chỉ tin chứng chỉ tự ký qua `NODE_EXTRA_CA_CERTS` đặt lúc khởi động, nên test gọi hàm trong một tiến trình con (`tsx`) có biến này. Khoá service account là khoá RSA sinh tạm, không gọi Google. Không có lưu lượng ra Internet.

1. `từ chối url https trỏ thẳng vào loopback`: `https://127.0.0.1:<port>/direct`. Trước khi sửa: **FAIL**, hàm trả đúng chuỗi đánh dấu.
2. `không đi theo redirect từ https về http nội bộ`: `/redirect` trả 302 về `http://127.0.0.1:<port>/internal`. Trước khi sửa: **FAIL**, hàm đi theo redirect sang http và trả chuỗi đánh dấu của dịch vụ nội bộ.

Kết quả chạy trước khi sửa (`ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/url-fetch-ssrf.spec.ts`): `Tests: 2 failed, 2 total`.

Ghi chú: bản nháp đầu đặt `NODE_TLS_REJECT_UNAUTHORIZED=0` ngay trong Jest. `fetch` toàn cục không nhận cờ này, nên ca 1 "đạt" vì lỗi chứng chỉ chứ không phải vì bị chặn. Đã bỏ cách đó, chuyển sang tiến trình con và thêm assertion "không nhận chuỗi đánh dấu, fixture không nhận request".

Chưa thử dải private, metadata đám mây hay tên nội bộ trên mã cũ, vì mã cũ sẽ mở kết nối thật tới mạng LAN hoặc tra DNS thật. Các ca này chỉ chạy sau khi sửa, khi chúng bị từ chối trước lúc kết nối.

Ca e2e mới trong `test/external-import-source.e2e-spec.ts` (`Audit 4/12: url trỏ vào địa chỉ nội bộ bị từ chối ngay khi nhận, không tạo job`) chạy với controller cũ (gỡ tạm bản sửa controller, rồi áp lại): **FAIL**, nhận 202 thay vì 400.

### Cách sửa

- File mới `apps/api/src/common/safe-url.ts`:
  - `isBlockedAddress(ip)` chặn IPv4: 0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4 (multicast), 240/4. IPv6 chỉ nhận unicast toàn cầu `2000::/3`, trừ Teredo `2001::/32`, `2001:db8::/32` và 6to4 `2002::/16`. Địa chỉ IPv4-mapped (`::ffff:a.b.c.d`, cả dạng hex) và IPv4-compatible được xét như IPv4. Địa chỉ có zone (`%en0`) hoặc không phải IP đều bị chặn. Dùng `net.BlockList` của Node.
  - `urlProblem(url)` kiểm hình thức, không tra DNS: chỉ `https:`, không có user/password trong url, IP literal không thuộc dải chặn, tên không có dấu chấm, `localhost` và các đuôi `.localhost`, `.local`, `.localdomain`, `.internal`, `.intranet`, `.lan`, `.home.arpa` bị từ chối. Dấu chấm cuối được bỏ trước khi kiểm. Dạng `2130706433` hoặc `0x7f.1` đã được WHATWG URL chuẩn hoá về `127.0.0.1`.
  - `safeFetch(url)` tự xử lý redirect, tối đa 5 bước. Mỗi bước gọi lại `urlProblem`, tra DNS (`dns.lookup` all). Chỉ cần một địa chỉ bị chặn là từ chối cả tên. Sau đó mở `https.request` với `lookup` cố định vào địa chỉ vừa kiểm, nên không có lần phân giải thứ hai (chặn DNS rebinding). Tên máy vẫn dùng cho SNI và kiểm chứng chỉ. Giới hạn 100 MB: kiểm `content-length` trước, rồi đếm byte khi đọc luồng và huỷ kết nối ngay khi vượt. Quá 30 giây thì huỷ. Gửi `accept-encoding: identity` để kích thước đếm được là kích thước thật.
  - Thông báo lỗi không còn chứa tên máy (`Tải về lỗi HTTP <status>`). Địa chỉ nội bộ bị chặn trước khi kết nối, nên lỗi không còn dùng để dò máy nội bộ.
- `real-google.ts` `urls.fetch` gọi `safeFetch`.
- `documents.controller.ts` `importExternal` gọi `urlProblem` thay cho regex tiền tố `https://`. url sai scheme vẫn trả 400 `https_only` như cũ. url nội bộ trả 400 `internal_address` và không tạo job. Việc tra DNS chỉ làm ở job, vì kết quả DNS lúc nhận không còn đúng lúc tải.
- `safeFetch` có ba tham số chỉ dùng cho test: `lookup` (thay DNS), `ca` (tin chứng chỉ tự ký) và `isBlocked` (coi `127.0.0.1` là công khai để fixture loopback đóng vai máy chủ ngoài). `RealGoogle` không truyền tham số nào, nên mã chạy thật luôn dùng chính sách mặc định.
- Không thêm thư viện. Không đổi hợp đồng (`issue` của lỗi 400 là chuỗi tự do).

### Sau khi sửa

- `test/url-fetch-ssrf.spec.ts`: `Tests: 70 passed, 70 total`. Gồm 2 ca `RealGoogle` ở trên, và các ca `safeFetch`:
  - Tải hợp lệ qua tên `entry.test` (DNS giả → `127.0.0.1`, chỉ phân giải một lần).
  - Chính sách mặc định chặn loopback, cả IP lẫn tên, mà fixture không nhận request.
  - Tên phân giải ra private, hoặc lẫn một địa chỉ private, bị chặn.
  - Redirect về http, tên không dấu chấm, tên trỏ private, metadata `169.254.169.254`, `[::ffff:a9fe:a9fe]` và `localhost` đều bị chặn ở bước đó, dịch vụ nội bộ không nhận request.
  - Vòng redirect dừng sau `maxRedirects`.
  - Vượt kích thước theo `content-length`, và vượt khi đang đọc luồng không có `content-length`: máy chủ chưa gửi hết 200 khối 64 KB thì kết nối đã bị huỷ.
  - Chứng chỉ không tin cậy bị từ chối.
  - Bảng địa chỉ bị chặn và được phép, bảng url bị từ chối và hợp lệ.
- `test/external-import-source.e2e-spec.ts` (6 ca, gồm ca mới), `m04-m05-documents`, `m06-m07-records`: đạt.
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 261 passed, 270 total`, độ phủ hợp đồng 145/145.
- Chưa chạy `pnpm ai:check:full`, chưa thử với Google thật hay trong container triển khai.

### Còn để chủ dự án kiểm

- Egress của container API (tường lửa, proxy) vẫn nên chặn dải nội bộ, vì đó là lớp bảo vệ thứ hai.
- Nếu triển khai sau proxy egress bắt buộc (biến `HTTPS_PROXY`), `safeFetch` không dùng proxy mà kết nối thẳng. Cần kiểm lại đường ra mạng khi đó.
- Tài liệu chỉ có trên máy chủ IPv6 hoặc trên tên miền nội bộ của đối tác sẽ không nhập được bằng url nữa. Người dùng tải file lên drive phòng rồi nhập bằng `fileId`.

---

## 2026-10-25 · Đầu mối 3/12 — Nhập tài liệu ngoài chép fileId bất kỳ bằng service account

- **Fingerprint:** `legacy/external-documents-import:fileId-service-account-copy-without-source-authorization` (kèm biến thể `templateId` của loại hồ sơ).
- **Nhánh:** `claude/audit-fix-03-external-import-fileid-1aae87` (cắt từ `claude/audit-fix-02-mailbox-owner-f16a35`, commit 690fdec).
- **Kết luận:** lỗi **có thật**, cả hai biến thể, đã tái hiện bằng harness Jest với Google giả và Mongo in-memory.

### Tái hiện trước khi sửa

Thêm file `apps/api/test/external-import-source.e2e-spec.ts`. Trong `beforeAll`, tạo file F trên drive Mật `drv-01` (01 BĐH) bằng Google giả, nội dung `Nội dung mật của Ban Điều hành`. `nv.mkt` (R6, writer drive 11 MKT) và `tp.mkt` (R4 MKT) không là thành viên drive 01.

1. `R6 writer phòng MKT không chép được file của drive Mật vào phòng mình`: `nv.mkt` POST `/external-documents` với `fileId: F`, `departmentId: MKT`. Trước khi sửa: **FAIL**, nhận 202 thay vì 400.
2. `R6 không phải thành viên drive Mật không ghi được tài liệu ngoài vào phòng đó`: như trên nhưng `departmentId: BDH`. Trước khi sửa: **FAIL**, nhận 202 thay vì 403.
3. `trưởng phòng MKT không đặt được templateId là file của drive Mật`: `tp.mkt` PATCH `/record-types/{seoPlan}` và POST `/record-types` với `templateId: F`, rồi `nv.mkt` lập hồ sơ loại đó. Trước khi sửa: **FAIL**, PATCH nhận 200 thay vì 400.
4. Hai ca đối chứng (vẫn phải đạt sau khi sửa): nhập file nằm trên drive MKT vào MKT (202, bản sao đúng nội dung), và đặt `templateId` là `current.fileId` của BM-VCPV-04 (drive Nội bộ, hiệu lực) được 200. Cả hai đạt trước khi sửa.

Kết quả chạy trước khi sửa (`ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/external-import-source.e2e-spec.ts`): `Tests: 3 failed, 2 passed, 5 total`.

Một test thăm dò tạm (xoá ngay sau khi chạy, không bỏ assertion của file chính) ghi hậu quả thật trước khi sửa:
- Nhập vào MKT: job `done`, Document EXT `effective` trên `drv-11`, bản sao (fileId khác F) chứa đúng nội dung mật, `nv.mkt` GET `/documents/:id` được 200.
- Nhập vào BDH: job `done`, Document EXT `effective` trên drive Mật `drv-01` do `nv.mkt` tạo, dù `nv.mkt` không là thành viên (GET trả 404 với chính người tạo).
- `templateId`: PATCH 200, hồ sơ mới trên `drv-11` có file chép từ F, chứa nội dung mật.

### Cách sửa

- `documents.controller.ts` `importExternal`:
  - Người gọi phải có quyền drive `writer` trở lên trên drive của phòng đích (`requireDriveRole`). Không có thì trả 403.
  - Khi có `fileId`, đọc siêu dữ liệu file, tra `driveId` về một phòng của công ty (`deptByDrive`), rồi yêu cầu người gọi xem được drive đó (`canViewDrive`, gồm drive Nội bộ). File không thuộc drive phòng nào, hoặc thuộc drive người gọi không xem được, trả cùng lỗi 400 `fileId not_found` như file không tồn tại. Cách này không lộ việc file có tồn tại trên drive Mật hay không.
- `record-types.controller.ts` `checkRefs` (dùng cho cả tạo và sửa): `templateId` khác rỗng phải là `current.fileId` của một Document `type: BM` đang `effective` hoặc `revising`, trên drive người gọi xem được. Sai thì trả 400 `templateId not_found`. Điều kiện này khớp hợp đồng mục 8: "files.copy từ fileId của BM", "BM phải đang hiệu lực".
- Không đổi hợp đồng. POST `/external-documents` đã khai báo 400 và 403, POST/PATCH `/record-types` đã khai báo 400.

### Giả định (chọn cách an toàn)

- "File Google đã có" nghĩa là file đã nằm trên một drive dùng chung của công ty mà người nhập xem được. File ở My Drive hoặc được chia sẻ thẳng cho service account không còn nhập bằng `fileId` được. Người dùng tải file lên drive phòng mình trước, hoặc dùng `url`.
- Nhập tài liệu ngoài cần quyền Đóng góp (writer) trên drive phòng đích, kể cả với R1–R3. Đây là quyền tối thiểu để tự tạo file ở đó trên Google Drive.
- `templateId` chỉ nhận BM đã đăng ký. Biểu mẫu dán từ một link Drive bất kỳ (FE `danh-muc-ho-so` cho phép) sẽ bị 400. BM trên drive Mật mà trưởng phòng là thành viên vẫn được chọn. Khi đó người lập hồ sơ trong phòng sẽ thấy bản sao, cùng mức rủi ro như trưởng phòng tự chép tay.
- Chưa kiểm lại tại lúc chạy job `record.create`. Loại hồ sơ đã lưu `templateId` tuỳ ý trước bản sửa vẫn được chép. Chủ dự án cần rà `RecordType.templateId` hiện có trong dữ liệu thật, tìm giá trị không phải `current.fileId` của BM đã đăng ký.
- Nhánh `url` (SSRF theo redirect) là đầu mối riêng, không sửa ở đây.

### Sau khi sửa

- `test/external-import-source.e2e-spec.ts`: `Tests: 5 passed, 5 total`.
- Test sẵn có `m04-m05-documents`, `m06-m07-records` cùng file mới: `Tests: 51 passed, 51 total`.
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 190 passed, 199 total`, độ phủ hợp đồng 145/145.
- Chưa chạy `pnpm ai:check:full`, chưa thử với Google thật.

---

## 2026-10-25 · Đầu mối 2/12 — Hộp thư suy từ local-part, không gắn danh tính duy nhất

- **Fingerprint:** `mail-basic/mailbox-owner-local-part`.
- **Nhánh:** `claude/audit-fix-02-mailbox-owner-f16a35` (cắt từ `claude/audit-fix-01-oidc-domain-36359f`, commit c005415).
- **Kết luận:** lỗi **có thật**, đã tái hiện bằng harness Jest với Google giả và Mongo in-memory.

### Tái hiện trước khi sửa

Thêm file `apps/api/test/mailbox-owner.e2e-spec.ts`. User trùng `nv.mkt@other.example` được chèn thẳng vào DB, cùng công ty và cùng thuộc tính với user mẫu `nv.mkt@vcprosperous.com`, phiên tạo bằng `SessionService.create` (OIDC đã chặn email ngoài tên miền từ 1/12, nên đây là dữ liệu cũ hoặc nhập tay).

1. `user khác tên miền cùng local-part không đọc được hộp thư của user gốc`: `tp.mkt` gửi thư cho `nv.mkt@vcworkspace.test`, phiên user trùng gọi `GET /mail/messages?folder=inbox`.
   Trước khi sửa: **FAIL**, nhận 200 thay vì 403. Bản copy tạm bỏ assertion status (xoá ngay sau khi chạy) xác nhận body chứa thư `Thư riêng nv.mkt` với `mailboxOwner: nv.mkt@vcworkspace.test`.
2. `link Drive gửi cho user gốc không tải được bằng phiên user khác tên miền`: user trùng được thêm làm reader của space phòng ban để chỉ còn kiểm người nhận link quyết định. Link gửi cho `nv.mkt@vcworkspace.test`.
   Trước khi sửa: **FAIL**, phiên user trùng tải được (200 thay vì 403).
3. `kiểm ACL người nhận link khớp chính xác email công ty, không lấy user ngoài tên miền cùng local-part`: chỉ có `ghost.audit02@other.example` (reader của space). Gửi link cho `ghost.audit02@vcworkspace.test`.
   Trước khi sửa: **FAIL**, nhận 201 thay vì 403. Regex `^local@` mọi tên miền đã lấy user ngoài tên miền làm người nhận hợp lệ.

Kết quả chạy trước khi sửa (`ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/mailbox-owner.e2e-spec.ts`): `Tests: 3 failed, 3 total`. Đã chạy bằng cách tạm gỡ bản sửa khỏi `src` (lưu patch), rồi áp lại.

### Cách sửa

- `mail-basic.service.ts`: thêm hàm `mailboxAddress(email, companyDomain)`. Hàm chỉ trả `local@vcworkspace.test` khi email (chữ thường) có tên miền đúng bằng `Company.domain` của công ty phiên, ngược lại trả null. Vì `User.email` là chữ thường và unique theo `(companyId, email)`, local-part trong cùng một tên miền là duy nhất, nên mỗi user có đúng một hộp thư và không trùng. Tên miền công ty đọc từ DB một lần và nhớ theo `companyId`.
- `owner()` dùng hàm trên. User ngoài tên miền nhận 403 ở mọi endpoint mail (danh sách, nháp, gửi, nhãn, bộ lọc, alias, hộp thư nhóm). Credential engine và quyền thành viên hộp thư nhóm khoá theo địa chỉ này nên cũng được bảo vệ.
- `assertAddressFree`: kiểm khớp chính xác `local@<tên miền công ty>`, không quét local-part của mọi user.
- `offboardUser`: user không có hộp thư nội bộ trả 404. Trước đây offboard user ngoài tên miền sẽ khoá nhầm hộp thư, alias và quyền nhóm của user gốc cùng local-part.
- `workspace-interop.service.ts`: `assertRecipientsCanRead` đổi địa chỉ hộp thư sang đúng email công ty rồi tra khớp chính xác, bỏ regex. `downloadLink` dùng cùng hàm, user không có hộp thư bị 403.
- Hợp đồng: GET `/mail/messages` và vài endpoint mail chưa khai báo 403. Mã đã trả 403 cho hộp thư nhóm không có quyền từ trước. Đã ghi đề nghị R4 vào `apps/api/DE_NGHI_SUA_HOP_DONG.md`, không sửa `contract/openapi.yaml`.

### Sau khi sửa

- `test/mailbox-owner.e2e-spec.ts`: `Tests: 3 passed, 3 total`.
- Test mail và liên thông sẵn có (`mail-basic`, `mail-management`, `mail-durability`, `workspace-interop`, cùng file mới): `Tests: 20 passed, 20 total`.
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 185 passed, 194 total`, độ phủ hợp đồng 145/145.
- Chưa chạy `pnpm ai:check:full`, chưa thử Stalwart thật. Chủ dự án cần liệt kê user hiện có ngoài tên miền công ty, vì sau bản sửa họ mất quyền dùng hộp thư.

---

## 2026-10-25 · Đầu mối 1/12 — OIDC callback không kiểm tên miền email

- **Fingerprint:** `m01-auth/oidc-callback/email-domain-not-bound-to-company-domain` (mục 7 trong file needs-validation).
- **Nhánh:** `claude/audit-fix-01-oidc-domain-36359f` (cắt từ `vcworkspace/chat01-12b`).
- **Kết luận:** lỗi **có thật**, đã tái hiện bằng harness Jest với Google giả và Mongo in-memory.

### Tái hiện trước khi sửa

Đã thêm hai test vào `apps/api/test/oidc-auth.e2e-spec.ts`:

1. `lần đầu đăng nhập với email verified ngoài tên miền công ty bị chặn, không tạo user hay binding`
   Token: sub `outsider`, `email_verified=true`, email `nv.mkt@other.example`.
   Trước khi sửa: **FAIL**. Callback trả 302 về `http://localhost:3000/bo-nho` (đăng nhập thành công), có cookie `vcdocs_sid`, và User `nv.mkt@other.example` được tạo trong công ty. Local-part trùng với user mẫu `nv.mkt@vcprosperous.com`, nên mail và link chia sẻ (định danh theo local-part) trỏ vào cùng hộp thư.
2. `binding đã có nhưng token mang email ngoài tên miền công ty bị chặn, không ghi đè email`
   Lần đầu đăng nhập sub `subject-domain-bound` bằng `oidc.domain@vcprosperous.com`, lần sau cùng sub nhưng email `tp.mkt@other.example`.
   Trước khi sửa: **FAIL**. Callback trả 302 về `/bo-nho`, `User.email` bị ghi đè thành `tp.mkt@other.example`.

Kết quả chạy trước khi sửa (`ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/oidc-auth.e2e-spec.ts`): `Tests: 2 failed, 5 passed, 7 total`. Hai ca mới fail ở assertion redirect, nhận `/bo-nho` thay vì `/dang-nhap?loi=identity`. Để ghi được trạng thái DB, đã chạy thêm một bản copy tạm của test đã bỏ assertion redirect (xoá ngay sau khi chạy). Bản đó xác nhận cookie phiên được cấp, User ngoài tên miền được tạo và email bị ghi đè như mô tả ở trên.

Ghi chú: ở bản nháp đầu, ca 2 cũng dùng `nv.mkt@other.example` và nhận 500. Nguyên nhân là ca 1 đã tạo email đó nên trùng unique index. Đã đổi sang `tp.mkt@other.example` để hai ca không phụ thuộc nhau.

### Cách sửa

`apps/api/src/modules/m01-auth/auth.controller.ts`, `oidcCallback`: ngay sau khi chuẩn hoá `email` và trước khi rẽ nhánh binding/tạo mới, từ chối khi `email` không kết thúc bằng `@` + `cfg.oidc.companyDomain` (so chữ thường, tên miền rỗng cũng bị từ chối). Khi từ chối, callback redirect `/dang-nhap?loi=identity` và không tạo/sửa User, OidcIdentity hay session. Đây cũng là bất biến mà luồng Google đang áp dụng. `loi=identity` đã có trong hợp đồng (`contract/openapi.yaml` dòng 123), nên không cần đề nghị sửa hợp đồng.

Kiểm áp cả khi `email_verified` không phải `true` trên nhánh binding: token mang email ngoài tên miền đều bị từ chối, không quay về `binding.email`. Cách này chặt hơn trước. Nếu IdP đổi email của nhân viên sang tên miền ngoài, nhân viên đó sẽ không đăng nhập được cho đến khi admin sửa ở IdP.

### Sau khi sửa

- Test OIDC: `Tests: 7 passed, 7 total`.
- `pnpm ai:check`: **PASS** (exit 0). Gồm guard/gate tests, contract lint, typecheck API, toàn bộ test BE `Tests: 9 skipped, 182 passed, 191 total`, độ phủ hợp đồng 145/145.
- Chưa chạy `pnpm ai:check:full` và chưa thử với Authentik thật. Chính sách IdP (self-enrollment, quyền tự sửa email) vẫn để chủ dự án kiểm như kế hoạch trong file audit.
