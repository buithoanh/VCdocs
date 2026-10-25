# Nhật ký sửa đầu mối audit bảo mật

Nguồn đầu mối: `docs/bao-mat/audit-cloudflare-2026-10-25-needs-validation.md`.
Mỗi mục: fingerprint, lỗi có tái hiện trước khi sửa không (tên test, kết quả), cách sửa, kết quả `ai:check`. Mới nhất ở trên.

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
