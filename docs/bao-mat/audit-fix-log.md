# Nhật ký sửa đầu mối audit bảo mật

Nguồn đầu mối: `docs/bao-mat/audit-cloudflare-2026-10-25-needs-validation.md`.
Mỗi mục: fingerprint, lỗi có tái hiện trước khi sửa không (tên test, kết quả), cách sửa, kết quả `ai:check`. Mới nhất ở trên.

---

## 2026-10-25 · Đầu mối 11/12 — Đăng ký ngược coi người sửa cuối là người tạo rồi chuyển file ra khỏi drive nguồn

- **Fingerprint:** `legacy/records-claim:creator-check-uses-lastModifyingUser`.
- **Nhánh:** `claude/audit-fix-11-records-claim-creator-c6f9d9` (cắt từ `claude/audit-fix-10-approvals-r3-confidential-96b801`, commit 328e76c).
- **Kết luận:** lỗi **có thật** ở mã, đã tái hiện bằng harness Jest (Google giả, MongoDB tạm) sau khi cho bản giả trả người sửa cuối như adapter thật. Chưa quan sát được Google thật (xem "Giới hạn").

### Tái hiện trước khi sửa

Bản giả trước đây lưu người tạo thật vào `createdByEmail`, nên test cũ không chạm vào ánh xạ của adapter thật. Bước đầu chỉ sửa bản giả, chưa sửa mã: `FakeFile` có thêm người tạo (`creatorEmail`) và người sửa cuối; `editFile(fileId, text, byEmail)` đổi người sửa cuối; `meta()` trả `createdByEmail` = người sửa cuối, giống `toMeta` của bản thật lúc đó.

Test hồi quy `apps/api/test/records-claim-creator.e2e-spec.ts` (4 ca) và unit test `apps/api/test/real-google-creator.spec.ts` (3 ca). Trước khi sửa `Tests: 6 failed, 1 passed, 7 total`:

1. File trên drive chung VCPV (00), người tạo `hcns`, người sửa cuối `nv.mkt`. `nv.mkt` chỉ là Đóng góp drive MKT và Người xem drive VCPV. `nv.mkt` `POST /records/claim` vào loại hồ sơ `seoPlan` của MKT thì nhận **202** (mong đợi 403). Chạy thêm một ca dò (không commit) cho thấy job `done`, file bị chuyển sang thư mục tháng của drive MKT (`driveId: drv-11`), Record có `isClaimed: true` và `createdBy` = `nv.mkt`.
2. Người tạo thật là `nv.mkt` nhưng chỉ là Người xem drive nguồn VCPV. Claim sang drive MKT nhận **202** (mong đợi 403, vì Đóng góp hay Người xem đều không tự chuyển được file ra khỏi shared drive).
3. Đối chứng: trưởng phòng nguồn (`hcns`, trưởng VCPV, Quản lý drive HCNS) claim file VCPV sang loại hồ sơ của HCNS nhận 202. Ca này đạt cả trước lẫn sau.
4. Cùng drive MKT, người tạo `nv.mkt`, người sửa cuối `leader.mkt`. `leader.mkt` claim nhận **202** (mong đợi 403); còn `nv.mkt` thì bị chặn.
5. Unit: `toMeta` ghi `lastModifyingUser` thành `createdByEmail`, và `creatorFromRevisions` chưa có (2 ca fail vì hàm không tồn tại).

### Cách sửa

- **Kiểu dữ liệu** (`apps/api/src/google/ports.ts`): bỏ `DriveFileMeta.createdByEmail`, thay bằng `lastModifierEmail` (ghi rõ đây không phải người tạo). Thêm `drive.getCreatorEmail(fileId)`, trả email chữ thường hoặc `undefined`.
- **Adapter thật** (`real-google.ts`): `toMeta` chỉ ghi `lastModifierEmail`. `getCreatorEmail` đọc `createdTime`, rồi gọi `revisions.list` với các trường `id,modifiedTime,lastModifyingUser(emailAddress)` và đi qua hàm thuần `creatorFromRevisions`: người tạo là `lastModifyingUser` của phiên bản sớm nhất. Nếu phiên bản đó cách `createdTime` quá 1 giờ, hoặc thiếu email, hoặc không có phiên bản nào, thì trả `undefined` (fail-closed: khi đó chỉ trưởng phòng đăng ký ngược được). Không cần thêm quyền uỷ quyền toàn miền, vì scope `drive` đã có.
- **Bản giả:** `creatorEmail` là trường nội bộ, không trả qua `meta()`. `getCreatorEmail` trả trường này. `createLooseFile({ createdByEmail })` vẫn giữ tên tham số, đặt cả người tạo lẫn người sửa cuối, nên test cũ không phải đổi.
- **Claim** (`records.controller.ts`):
  - Người tạo lấy từ `getCreatorEmail`, không lấy từ metadata của file.
  - Sau `validateInput`, nếu thư mục đích nằm ở drive khác drive nguồn thì người gọi phải là trưởng phòng nguồn hoặc có vai trò Quản lý (`organizer`) trên drive nguồn. Không đạt thì nhận 403. Mức Quản lý theo BA `docs/ba/BA-dac-ta-nguoi-dung.md` dòng 528: chuyển ra drive khác cần Quản lý; Quản lý nội dung chỉ chuyển trong drive.
  - Claim trong cùng drive giữ như cũ: người tạo thật có quyền Đóng góp trên drive đích vẫn đăng ký được. Hợp đồng không đổi: claim vẫn dành cho người tạo file và R4.
- **`/records/unregistered`:** `ownerEmail` (giao diện ghi "Người tạo") lấy từ `getCreatorEmail` cho từng file chưa đăng ký. Ở bản thật, mỗi file như vậy tốn thêm một lượt `files.get` và `revisions.list`.

### Giới hạn

- Chưa chạy với Google thật. Drive API v3 không có trường người tạo cho file trên shared drive (`owners` rỗng). Cách dùng phiên bản đầu có ba giả định chưa kiểm:
  - Drive giữ phiên bản đầu của file Google Docs/Sheets.
  - File nhị phân có thể mất phiên bản cũ (sau 30 ngày hoặc khi quá 100 phiên bản, nếu không bật keepForever). Khi đó cửa sổ 1 giờ sẽ trả `undefined`.
  - Phiên bản đầu của Docs gộp các lần sửa đầu tiên của người tạo, nên `modifiedTime` của nó có thể trễ hơn `createdTime` vài phút.
- Muốn có nguồn chắc chắn hơn thì dùng Admin Reports (sự kiện `create` của Drive; scope `admin.reports.audit.readonly` đã có). Cách này có độ trễ và giới hạn thời gian lưu nhật ký, nên phiên này chưa dùng.
- Quyền chỉ được kiểm lúc nhận yêu cầu. Job chạy sau đó không kiểm lại; việc này giống trước khi sửa.

### Sau khi sửa

- `records-claim-creator.e2e-spec.ts` + `real-google-creator.spec.ts` + `m06-m07-records.e2e-spec.ts`: `Test Suites: 3 passed`, `Tests: 27 passed`. `tsc --noEmit` của API đạt.
- `pnpm ai:check`: **PASS** (exit 0). Guard 44/44, OpenAPI hợp lệ, typecheck API đạt, BE `Test Suites: 9 skipped, 35 passed`, `Tests: 9 skipped, 293 passed, 302 total`. Không chạy test FE vì không đổi FE.
- Chưa chạy `pnpm ai:check:full`.

### Việc của chủ dự án

- Trên Workspace thử với tài khoản giả: xác nhận `revisions.list` của file trên shared drive có phiên bản đầu với `lastModifyingUser` là người tạo (cả Docs lẫn file tải lên), và độ lệch giữa `modifiedTime` của phiên bản đó với `createdTime`. Đồng thời xác nhận nhân viên thường có vai trò gì trên drive chung 00.
- Chốt chính sách: đăng ký ngược sang drive khác chỉ dành cho trưởng phòng nguồn hoặc Quản lý drive nguồn. Người tạo là Đóng góp phải nhờ trưởng phòng, hoặc chuyển file vào drive đích trước rồi mới claim.

---

## 2026-10-25 · Đầu mối 10/12 — R3 đọc phiếu duyệt của drive Mật mình không là thành viên

- **Fingerprint:** `legacy/approvals-load:R3-bypass-confidential-drive`.
- **Nhánh:** `claude/audit-fix-10-approvals-r3-confidential-96b801` (cắt từ `claude/audit-fix-09-editor-page-fileid-d6e01c`, commit 1c45df9).
- **Kết luận:** lỗi **có thật**, đã tái hiện bằng harness Jest (Google giả, MongoDB tạm). Phạm vi là lộ dữ liệu khi đọc. Check, decide và cancel vẫn bị service giới hạn cho người trên phiếu. Riêng remind lại ghi thêm một lần nhắc và trả toàn bộ phiếu.

### Tái hiện trước khi sửa

Test hồi quy `apps/api/test/approvals-r3-confidential.e2e-spec.ts` (5 ca). `ktt` tạo hồ sơ trên drive Mật TC – KT rồi chia sẻ ngoài file đó, tạo phiếu `external_share` đang chờ duyệt với `objectTitle` chứa email người nhận. Người gọi là R3 `hcns`, thành viên HCNS, không thuộc TC – KT và không liên quan đến phiếu. Trước khi sửa `Tests: 2 failed, 3 passed, 5 total`:

1. `GET /approvals/:id` trả **200** (mong đợi 404).
2. `POST /approvals/:id/remind` trả **200** và trả toàn bộ phiếu (mong đợi 404, không ghi nhắc).
3. Danh sách `GET /approvals` (mặc định, `inbox`, `sent`, lọc `external_share`) không có phiếu đó: đạt cả trước lẫn sau, vì `list` chỉ lấy phiếu người gọi trình, duyệt hoặc kiểm tra.
4. Đối chứng: người trình (`ktt`) và người duyệt ngoài drive (`gdk.vhnb`) vẫn xem được, còn `nv.kd` không phải R3 nhận 404.
5. Đối chứng: R3 vẫn xem và nhắc được bản sao phiếu đặt trên drive không Mật (MKT) và trên drive Mật mà R3 là thành viên (HCNS).

### Cách sửa

`ApprovalsController.load` (`apps/api/src/modules/m05-approvals/approvals.controller.ts`):

- Người liên quan (người trình, người duyệt, người kiểm tra) được đi tiếp.
- R3 đi qua `AccessService.assertVisibleOrR3(ctx, a.driveId)`: drive không Mật thì được; drive Mật thì phải là thành viên, nếu không nhận 404.
- Người khác giữ như cũ: `assertVisible` trả 404 nếu là drive Mật, còn lại trả 403.

`load` dùng chung cho `get`, `check`, `decide`, `cancel` và `remind`, nên R3 ngoài phòng không còn nhắc được phiếu của drive Mật. Bản sửa chọn theo hợp đồng hiện tại: `openapi.yaml` dòng 28 quy định đối tượng ở drive Mật mà người gọi không được xem thì trả 404. `/approvals/{id}/remind` ghi "submittedBy, R3" nhưng không nói gì về ngoại lệ cho drive Mật. Câu hỏi chính sách đã ghi ở mục 4 của sổ tay. Không sửa hợp đồng.

Đã rà các đường khác đọc `Approval`: `preview` vốn đã gọi `assertVisible`; `documents.controller.ts:413` chỉ đọc nội bộ khi ban hành; `autoRemind` là tác vụ hệ thống, không trả gì cho người dùng.

### Sau khi sửa

- `approvals-r3-confidential.e2e-spec.ts`: `Tests: 5 passed`. Chạy cùng `m04-m05-documents`, `m06-m07-records`, `m08-m09-m14`: `Test Suites: 4 passed`, `Tests: 63 passed`.
- `pnpm ai:check`: **PASS** (exit 0). Guard 44/44, OpenAPI hợp lệ, typecheck API đạt, BE `Test Suites: 9 skipped, 33 passed`, `Tests: 9 skipped, 286 passed, 295 total`. Không chạy test FE vì không đổi FE.
- Chưa chạy `pnpm ai:check:full`.

### Việc của chủ dự án

- Quyết định R3 có cần xem hoặc nhắc phiếu duyệt ở drive Mật ngoài phòng không (đây cũng là mục owner-observed của audit). Nếu cần "nhắc mà không xem" thì phải đổi hợp đồng `remind`: ví dụ trả 204, hoặc trả phiếu đã lược bớt.

---

## 2026-10-25 · Đầu mối 9/12 — Trang soạn thảo ghép fileId vào đường dẫn API và nạp script từ origin bất kỳ

- **Fingerprint:** `web/bo-nho-soan-thao:fileId-path-injection-editor-config-script-src`.
- **Nhánh:** `claude/audit-fix-09-editor-page-fileid-d6e01c` (cắt từ `claude/audit-fix-08-lifecycle-fake-prod-6561dc`, commit 085a99b).
- **Kết luận:** lỗi **có thật** ở mã trang, đã tái hiện bằng Vitest + Testing Library + MSW (jsdom). Chưa dựng trọn chuỗi tấn công với tệp JSON tải lên thật và Document Server giả trên trình duyệt; trình duyệt chỉ dùng để kiểm bản đã sửa (dưới đây).

### Tái hiện trước khi sửa

Test hồi quy `apps/web/src/app/(app)/bo-nho/soan-thao/[fileId]/soan-thao.test.tsx` (5 ca). MSW trả JSON của kẻ tấn công `{"documentServerUrl":"https://attacker.example",...}` cho `GET /drive/files/:id/content` (dạng `text/plain`) và `GET /drive/files/:id`. Trước khi sửa `Tests: 4 failed | 1 passed (5)`:

1. fileId `<id>/content#`: request tới `/api/v1/drive/files/<id>/content`, **có** thẻ `<script src="https://attacker.example/web-apps/apps/api/documents/api.js">`.
2. fileId `<id>?x=`: request tới `/api/v1/drive/files/<id>` (phần `/editor-config` thành query), **có** script của attacker.
3. fileId `<id>/content`: request tới `/api/v1/drive/files/<id>/content/editor-config` (route khác; không có script vì không có handler).
4. `editor-config` hợp lệ về đường dẫn nhưng trả `documentServerUrl` lạ: **có** script của attacker.
5. Ca đối chứng (origin `http://127.0.0.1:18082`) nạp `api.js`: đạt cả trước lẫn sau.

Test giả định Next giao param đã giải mã (`%2F` → `/`, `%23` → `#`), như audit mô tả. Chưa kiểm hành vi giải mã thật của Next 15.5 trên trình duyệt với bản cũ; bản sửa từ chối cả dạng đã giải mã lẫn chưa giải mã.

### Cách sửa

- **fileId:** `isObjectId` (24 hex) trước khi gọi API, sau đó `encodeURIComponent`. Sai định dạng → "Mã tệp không hợp lệ.", không request nào.
- **Origin Document Server:** `apps/web/src/lib/document-server.ts`. Danh sách lấy lúc build từ `NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS` (phẩy ngăn cách, khớp `DOCUMENT_EDITOR_PUBLIC_ORIGIN` của API). Không đặt biến: ngoài production mặc định `http://127.0.0.1:18082` và `http://localhost:18082` (PoC); production không có origin nào nên editor báo lỗi, khớp mặc định API `DOCUMENT_EDITOR_ENABLED=false` ở production. URL phải là http/https, không có user/pass, query hay hash, và `origin` phải khớp đúng. Path tiền tố vẫn giữ.
- **CSP:** `next.config.ts` đổi sang dạng hàm theo `phase` và đặt `Content-Security-Policy: script-src 'self' 'unsafe-inline' <origin DS>; object-src 'none'; base-uri 'self'` cho mọi phase trừ `next dev` (dev cần eval/HMR). Không dùng `NODE_ENV` vì lúc `next build` nạp config thì biến này chưa là `production` (đã thử: manifest không có header). App Router chèn script inline khi hydrate nên phải giữ `'unsafe-inline'`; muốn bỏ thì cần nonce qua middleware (ngoài phạm vi). CSP này vẫn chặn script `src` ngoài origin, là đường của đầu mối này. **Không thêm CSP vào Caddyfile** để chỉ có một nguồn giữ danh sách origin.
- `deploy/web.Dockerfile` thêm `ARG/ENV NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS` (mặc định rỗng). `apps/api/.env.example` thêm chú thích về việc giữ hai giá trị khớp nhau. `docker-compose.prod.yml` chưa truyền build arg vì production chưa bật editor.
- **Rà trang khác:** các trang có tham số route (`kiem-tra/[code]`, `tai-lieu/[id]`, `tai-lieu/ma/[code]`, `danh-muc-ho-so/[id]`, `nhan-su/[id]`, `phe-duyet/[id]`, `ho-so/[id]`, `drive/[id]`) đều gọi qua `openapi-fetch`, mà bản 0.14.1 `encodeURIComponent` tham số path (`defaultPathSerializer`). Chỉ trang soạn thảo ghép thẳng param vào `fetch`. Ở `bo-nho/page.tsx` và `email/page.tsx` còn ghép `item.id`/`selected.id` vào đường dẫn, nhưng giá trị lấy từ phản hồi API chứ không từ URL. Không sửa ở đây, ghi lại để rà sau.

### Kiểm trên trình duyệt local

API giả `RUN_QA_FAKE_SERVER=1` (cổng 14100) cùng web build `NEXT_DIST_DIR=.next-qa NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS=http://127.0.0.1:18082`, `next build` + `next start -p 13100`, đăng nhập Google giả:

- `/` và `/bo-nho` có header CSP trên, trang hydrate và tải dữ liệu bình thường. Console không có vi phạm CSP; chỉ có một 401 từ lúc chưa đăng nhập.
- Chèn thử `<script src="http://127.0.0.1:9/evil.js">` thì nhận `securitypolicyviolation` `script-src-elem`.
- `/bo-nho/soan-thao/<id>%2Fcontent%23` hiện "Mã tệp không hợp lệ.", không request `drive/files` nào. `/bo-nho/soan-thao/<id>` gọi đúng `GET /api/v1/drive/files/<id>/editor-config` (404 vì tệp không tồn tại).
- Chưa mở editor thật với ONLYOFFICE (không chạy Document Server). Origin cho phép có trong `script-src`.

### Sau khi sửa

- `soan-thao.test.tsx`: `Tests: 5 passed (5)`. `src/lib/document-server.test.ts` (production không có origin; origin giống/khác cổng/giao thức/userinfo; ObjectId): `3 passed`.
- `pnpm ai:check`: **PASS** (exit 0). FE `Test Files 15 passed`, `Tests 84 passed`; typecheck web/API đạt; BE `Tests: 9 skipped, 281 passed, 290 total`. `ai:check` không build web. `next build` (dist `.next-qa`) đã chạy riêng sau thay đổi `next.config.ts` cuối cùng và đạt.
- Chưa chạy `pnpm ai:check:full`.

### Việc của chủ dự án

- Khi bật editor ở môi trường triển khai, build web với `--build-arg NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS=<origin công khai DS>`. Không truyền thì editor không nạp và CSP không cho origin DS.
- Kiểm header CSP trên tên miền đã deploy sau khi bản này lên (theo audit, owner-observed).

---

## 2026-10-25 · Đầu mối 8/12 — Production chấp nhận cổng identity-lifecycle giả

- **Fingerprint:** `m01-auth/identity-lifecycle/fake-port-allowed-in-production`.
- **Nhánh:** `claude/audit-fix-08-lifecycle-fake-prod-6561dc` (cắt từ `claude/audit-fix-07-address-claim-0a082f`, commit 0075629).
- **Kết luận:** lỗi **có thật** ở mã nguồn, đã tái hiện bằng harness Jest với OIDC giả (JWKS ký RSA trong test) và cổng lifecycle giả. Chưa biết production có chạy `AUTH_MODE=oidc` không (không đọc file môi trường trên máy chủ); mẫu `deploy/api.env.example` dùng Google.

### Tái hiện trước khi sửa

Test hồi quy `apps/api/test/identity-lifecycle-fake-prod.e2e-spec.ts` (6 ca), trước khi sửa `Tests: 6 failed, 6 total`:

1. `production OIDC không đặt IDENTITY_LIFECYCLE_MODE thì không rơi về cổng giả`: `loadConfig` với cấu hình production hợp lệ khác (OIDC, HTTPS, `COOKIE_SECURE=true`, storage nextcloud, mail stalwart, khoá editor 40 byte) **không ném lỗi**, mode = `fake`.
2. `production đặt tường minh IDENTITY_LIFECYCLE_MODE=fake bị chặn khi khởi động`: không ném lỗi (cả OIDC lẫn Google).
3. `production Google hiện tại vẫn khởi động được, lifecycle tắt`: mode = `fake` (mong `disabled`).
4. `POST trả 503, không tạo operation…`: mode `disabled` chưa tồn tại, `loadConfig` từ chối.
5. `R9 bị hạ quyền không lấy lại R9 khi đăng nhập lại với nhóm IdP cũ`: subject S đăng nhập với nhóm `vcw-admin` → `systemRoles ['R9']`; `it` (R9) `POST /identity/lifecycle-operations {groups: [], active: true}` → `status: done`, `systemRoles []`; S đăng nhập lại với cùng nhóm `vcw-admin` → **`systemRoles ['R9']`** và 302 về `/bo-nho`.
6. `email đổi qua lifecycle không bị email cũ trong token đè lại`: operation đổi email thành `renamed.admin@` báo `done`; đăng nhập với token email cũ ghi lại **`demoted.admin@`**.

### Cách sửa

Giả định và lựa chọn:

- **Mode mới `disabled`, mặc định ở production.** Chưa có cổng lifecycle dùng được ngoài máy local (`local` chỉ cho loopback/localtest.me). Ném lỗi khi thiếu biến sẽ làm production Google hiện tại không khởi động (mẫu deploy không đặt biến này), nên chọn mặc định an toàn: `NODE_ENV=production` không đặt biến → `disabled`. Đặt tường minh `fake` ở production → `loadConfig` ném lỗi (fail-fast, cùng khối với storage/mail giả). Dev/test giữ mặc định `fake`.
- **`disabled` từ chối trước khi có tác dụng phụ.** `IdentityLifecycleService.create`/`reconcile` trả 503 `STORAGE_UNAVAILABLE` (đã có trong hợp đồng của hai route) trước khi tạo operation hay chạy `app-deny`, để không khoá user ở app rồi bỏ dở. `M01Module` cấp `DisabledIdentityLifecyclePort` (mọi bước upstream ném `IDENTITY_LIFECYCLE_DISABLED`) cho `disabled` và cả khi `fake` lọt vào production qua override: không đường nào báo `done` mà không chạm upstream.
- **Sau khi lifecycle commit, app là nguồn sự thật; token phải khớp, lệch thì chặn.** `commitApp` ghi `OidcIdentity.projectionRevision` (trường mới). Ở `oidcCallback`, binding có `projectionRevision` mà email đã verified trong token khác `binding.email`, hoặc vai trò suy từ nhóm token khác vai trò suy từ `binding.groups`, thì trả `loi=locked`, không ghi gì vào `User`/binding, ghi audit `auth.oidc.projection_mismatch` (`emailMatches`, `rolesMatch`) và log cảnh báo. Chọn chặn thay vì lấy giao vì đơn giản, không âm thầm hạ hay nâng quyền, và với cổng thật thì token đã hội tụ (Authentik đọc lại khớp desired) nên không cản đăng nhập bình thường. So theo vai trò, không theo toàn bộ nhóm, để nhóm Authentik không map vai trò không khoá người dùng. Binding chưa từng qua lifecycle giữ hành vi cũ (IdP là nguồn).
  - Hệ quả: nếu quản trị sửa nhóm/email thẳng trên Authentik sau một operation, người dùng bị khoá đăng nhập đến khi R9 tạo operation mới khớp IdP.

### Biến môi trường

`IDENTITY_LIFECYCLE_MODE` nhận `fake | local | disabled`. `deploy/api.env.example` thêm `IDENTITY_LIFECYCLE_MODE=disabled` kèm chú thích; `apps/api/.env.example` cập nhật chú thích. Không có giá trị bí mật.

### Hợp đồng

Không sửa `contract/openapi.yaml`: 503 đã khai báo cho `POST /identity/lifecycle-operations` và `/{id}/reconcile`.

### Việc của chủ dự án

- Kiểm trên máy chủ (không chia sẻ giá trị) `AUTH_MODE` và `IDENTITY_LIFECYCLE_MODE`. Nếu đã chạy OIDC với lifecycle giả: các operation `done` trước đây chưa chạm Authentik/Nextcloud, cần rà trong Authentik/Nextcloud tài khoản đã "khoá" hay "hạ quyền" còn hoạt động không. Binding commit trước bản sửa không có `projectionRevision`, nên chưa được bảo vệ cho tới operation kế tiếp.
- Production muốn dùng lifecycle cần một cổng thật cho Authentik/Nextcloud ngoài localtest (chưa có; ngoài phạm vi phiên này).

### Sau khi sửa

- `test/identity-lifecycle-fake-prod.e2e-spec.ts`: `Tests: 6 passed, 6 total`.
- `identity-lifecycle`, `identity-lifecycle-pagination`, `oidc-auth`, `review-fixes`, `m01-auth`, `mail-address-claim`: `Tests: 1 skipped, 48 passed, 49 total` (`oidc-browser-server.spec.ts` tự bỏ qua khi không bật biến chạy browser).
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 281 passed, 290 total`, độ phủ hợp đồng 145/145 (chạy trước khi viết tài liệu; sau đó chỉ sửa tài liệu).
- Chưa chạy `pnpm ai:check:full`, chưa thử với Authentik/Nextcloud thật.

---

## 2026-10-25 · Đầu mối 7/12 — Ai đăng nhập cũng chiếm được địa chỉ nội bộ bằng alias hoặc hộp thư nhóm

- **Fingerprint:** `mail-basic/self-service-address-claim`.
- **Nhánh:** `claude/audit-fix-07-address-claim-0a082f` (cắt từ `claude/audit-fix-06-editor-callback-jwt-b6ea2c`, commit 9274401).
- **Kết luận:** lỗi **có thật**, đã tái hiện bằng harness Jest với mail port giả và Google giả. Không chạy Stalwart thật.

### Tái hiện trước khi sửa

Test dò tạm (đã xoá sau khi chạy) theo đúng kế hoạch trong audit: `tp.mkt` (không có R3/R9) `POST /mail/aliases {address: newhire@vcworkspace.test}`, rồi `newhire@vcprosperous.com` đăng nhập lần đầu qua Google giả (đường `User.create` thật), `nv.mkt` gửi thư tới `newhire@vcworkspace.test`, `tp.mkt` gửi với `fromIdentity: newhire@vcworkspace.test`. Kết quả:

`{"alias":201,"mailboxOwner":"tp.mkt@vcworkspace.test","nhInbox":false,"aInbox":true,"spoof":201,"from":"newhire@vcworkspace.test"}`

Tức là: alias tạo được; dòng thư đến được gắn hộp `tp.mkt`; người mới không thấy thư, `tp.mkt` thấy; `tp.mkt` gửi được dưới tên người mới. Mail port giả cũng chuyển thư ở mức engine về chủ alias (`aliases` được ưu tiên), nên `tp.mkt` còn nhận lại thư qua đồng bộ engine.

Test hồi quy `apps/api/test/mail-address-claim.e2e-spec.ts` (5 ca), trước khi sửa `Tests: 5 failed, 5 total`:

1. `người dùng thường chỉ tạo alias dạng <tên mình>+<nhãn>`: `tp.mkt` tạo `newhire@` nhận 201 (mong 403).
2. `chỉ HCNS (R3) hoặc quản trị (R9) tạo hộp thư nhóm như hr@`: `nv.mkt` tạo `hr@` nhận 201 (mong 403).
3. `user mới đăng nhập lần đầu lấy lại địa chỉ từ alias`: alias `newstaff@` do `it` (R9) tạo trước, `newstaff` đăng nhập, `nv.mkt` gửi thư tới: dòng thư có `mailboxOwner = it@vcworkspace.test` (mong `newstaff@`).
4. `đồng bộ danh bạ tạo user cũng giải phóng alias`: sau `GoogleSyncService.syncAll` tạo `synchire`, alias `synchire@` vẫn `active: true`.
5. `hộp thư nhóm cũ trùng địa chỉ người dùng thật bị gắn cờ`: hộp nhóm `ketoan.moi@` (dữ liệu cũ, `tp.mkt` quản lý) không sinh audit cờ khi `ketoan.moi` đăng nhập.

### Cách sửa

Giả định và lựa chọn:

- **Hộp thư nhóm:** `POST /mail/shared-mailboxes` thêm `@Roles('R3','R9')`, giống offboarding. Lý do: R3 (HCNS) quản vòng đời nhân sự và đã có quyền offboarding mail; R9 là quản trị hệ thống. Người tạo vẫn nhận read/send/manage và có thể giao manage cho trưởng phòng bằng `PATCH …/members`.
- **Alias:** R3/R9 tạo được tên tự do (thuộc chính họ). Người khác chỉ tạo `<local-part mình>+<nhãn>@vcworkspace.test`, nhãn `[a-z0-9._-]+`; tên khác 403. Biến thể `+` không trùng được email Google Workspace (Google không cho `+` trong tên người dùng). Kiểm trùng (409) chạy trước kiểm quyền để giữ thông báo trùng hộp thư cá nhân như cũ.
- **Hộp thư cá nhân luôn thắng** (`isPersonalMailbox`: địa chỉ suy ra email của một `User` đang có): `recipientMailbox` xét hộp cá nhân trước alias/hộp nhóm; `sendingIdentity` từ chối alias trùng hộp cá nhân; `shared()` (đọc/gửi/quản lý hộp nhóm) từ chối khi địa chỉ là hộp cá nhân của người khác. Lớp này giữ an toàn cả với dữ liệu cũ và user chèn thẳng DB.
- **Khi tạo user hoặc đổi email** gọi `MailBasicService.releaseAddressFor`: alias đang giữ địa chỉ bị `active: false` và gỡ ở engine (`MailPort.releaseAlias`, mới: Stalwart xoá alias khỏi tài khoản chủ rồi đọc lại; port giả xoá ánh xạ), ghi audit `workspace_mail.alias.release` (`previousOwner`, `engineReleased`). Hộp nhóm trùng chỉ gắn cờ: audit `workspace_mail.shared.conflict` và log cảnh báo; quyền đọc/gửi hộp đó đã bị chặn bởi lớp trên. Không chặn đăng nhập của người mới; engine lỗi thì vẫn tắt ở app và ghi `engineReleased: false`.
  - Đường gọi: OIDC tạo user và đổi email theo claim đã verified (`auth.controller.ts`), Google đăng nhập lần đầu, `google-sync.service.ts` tạo user, `identity-lifecycle.service.ts` `commitApp` đổi email. `M01Module` import `MailBasicModule`.

### Test có sẵn phải đổi

`test/mail-management.e2e-spec.ts`: alias `marketing@` của `tp.mkt` đổi thành `tp.mkt+marketing@`; ca trùng alias↔hộp nhóm do `it` (R9) gọi; hộp `mkt-team@` do `it` tạo rồi giao read/send/manage cho `tp.mkt`, phần còn lại giữ nguyên. Không bỏ hay nới assertion nào. Biến thể chạy với Stalwart thật (`RUN_MAIL_ENGINE_MANAGEMENT=1`) **chưa chạy**; ở chế độ đó `it` cần có tài khoản mail thử.

Thêm ca vào `test/oidc-auth.e2e-spec.ts`: user OIDC mới và email đổi tắt alias đang giữ địa chỉ (viết sau khi sửa, không chạy trước sửa).

### Hợp đồng

Không sửa `contract/openapi.yaml` (không được giao thay đổi hợp đồng). Hai route trả 403 chưa khai báo; đề nghị R5 ở `apps/api/DE_NGHI_SUA_HOP_DONG.md`. Test 403 gọi thẳng agent.

### Việc của chủ dự án

- Rà `workspace_mail_aliases` và `workspace_shared_mailboxes` hiện có so với danh sách nhân sự và địa chỉ vai trò (hr@, ketoan@…): alias/hộp nhóm tên tự do do người không có R3/R9 tạo từ trước vẫn còn (bản sửa chỉ tự xử lý khi có user trùng địa chỉ).
- Kiểm hành vi Stalwart thật: `releaseAlias` gỡ alias khỏi tài khoản chủ có làm thư tới địa chỉ đó vào tài khoản người mới hay không (blocker của audit, chưa chạy).
- FE `/email` vẫn hiện nút tạo alias tên tự do và tạo hộp nhóm cho mọi người; BE trả 403.

### Sau khi sửa

- `test/mail-address-claim.e2e-spec.ts`: `Tests: 5 passed, 5 total`.
- `mail-management` 5/5, `mail-basic` 2/2, `mail-durability` 7/7, `mailbox-owner` 3/3, `workspace-interop` 4/4, `oidc-auth` 8/8, `identity-lifecycle` 10/10, `m01-auth` 17/17.
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 275 passed, 284 total`, độ phủ hợp đồng 145/145 (chạy trước khi viết tài liệu; sau đó chỉ sửa tài liệu).
- Chưa chạy `pnpm ai:check:full`, chưa thử với Stalwart thật.

---

## 2026-10-25 · Đầu mối 6/12 — Callback ONLYOFFICE nhận mọi JWT ký bằng khoá editor và tin body chưa ký

- **Fingerprint:** `drive-basic/editor-callback/jwt-signature-only-unbound-payload`.
- **Nhánh:** `claude/audit-fix-06-editor-callback-jwt-b6ea2c` (cắt từ `claude/audit-fix-05-space-membership-54dd1c`, commit 8924e50).
- **Kết luận:** lỗi **có thật**, đã tái hiện bằng harness Jest, editor bật, server fixture loopback đóng vai Document Server (`internalOrigin`). Không chạy ONLYOFFICE thật.

### Tái hiện trước khi sửa

Thêm file `apps/api/test/editor-callback-jwt.e2e-spec.ts`. Fixture trả DOCX hợp lệ ở `/saved…` (bản "Document Server lưu") và ở `/cache/other/…` (đóng vai output của tài liệu khác trong cache), ghi lại mọi đường dẫn bị gọi.

1. `token cấu hình trình duyệt không dùng được làm token callback`: `tp.mkt` (manager) lấy `config.token` từ `editor-config`, gửi callback `status 2`, key hiện tại, url `<internalOrigin>/cache/other/output.docx`, token ở header rồi ở `body.token`. Trước khi sửa: **FAIL**, nhận `{error:0}`; API tải `/cache/other/output.docx` và lưu thành phiên bản 2.
2. `key/status/url lấy từ payload đã ký, không lấy từ body`: token ký đúng (`url` = `/saved.docx`) nhưng body ghi url `/cache/other/output.docx`. Trước khi sửa: **FAIL**, API tải đường dẫn trong body. Ca phụ: payload ký `status 1`, body `status 2` thì không được lưu.
3. `bắt buộc HS256 và exp còn hạn`: token thiếu `exp`, `exp` đã qua, header `alg: none` và `alg: HS512` (chữ ký vẫn HMAC-SHA256), khoá khác. Trước khi sửa: **FAIL** ngay ở token thiếu `exp` (`{error:0}`).
4. `nhận đúng hai dạng token của ONLYOFFICE`: token trong header bọc nội dung trong `payload` (kèm `iat`, `exp`), và token trong body mang thẳng các trường. Đạt cả trước và sau khi sửa (ca tương thích).
5. `O1: callback sau 15 phút vẫn lưu, còn vé callback không dùng để tải nội dung`: vé ở `callbackUrl` gọi `editor/content`, rồi giả đồng hồ +40 phút gửi callback. Trước khi sửa: **FAIL**, vé callback tải được nội dung (200) vì một vé dùng chung cho content và callback.

Kết quả trước khi sửa (`ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/editor-callback-jwt.e2e-spec.ts`): `Tests: 4 failed, 1 passed, 5 total`.

### Cách sửa

Chỉ `apps/api/src/modules/drive-basic/drive-basic.service.ts`:

- `verifyJwt` trả về nội dung callback đã ký hoặc `undefined`: đúng 3 phần, chữ ký HMAC-SHA256 so bằng `timingSafeEqual`, header phải `alg: HS256`, payload phải có `exp` dạng số còn hạn (`nbf` nếu có phải đã tới, lệch tối đa 60 giây). Nội dung callback là `payload.payload` khi có (token ONLYOFFICE ở header), ngược lại là chính payload (token ở body).
- `editorCallback` lấy `key`, `status`, `url` từ nội dung đã ký, bỏ qua body. Dấu vân tay chống lặp và audit dùng giá trị đã ký. Các kiểm sẵn có giữ nguyên: tiền tố key theo fileId, key đúng phiên bản hiện tại, url cùng protocol/host/port `internalOrigin`, không theo redirect, kiểm OOXML, quyền manager hiện tại (5/12).
- **Tách token trình duyệt khỏi token callback bằng claim:** `jwt()` (token cấu hình trình duyệt, token converter) luôn thêm `iss: "vcworkspace-api"` và `exp` (cấu hình trình duyệt 24 giờ, converter 5 phút). `verifyJwt` từ chối token có `iss` này ở cả lớp ngoài và `payload`. Ngoài ra token cấu hình không có `status`/`url` ở cấp đầu nên cũng không thể là callback lưu.
  - Không chọn khoá riêng cho outbox: Compose `poc/onlyoffice/docker-compose.yml` đặt một `JWT_SECRET` chung cho browser/inbox/outbox; dùng khoá riêng cần đổi cấu hình Document Server (`local.json`) ở phía vận hành. Đây vẫn là khuyến nghị cho chủ dự án (xem dưới).
- **Vé editor có mục đích (`purpose: content | callback`).** `editorConfig` cấp hai vé: vé content 15 phút cho `document.url`, vé callback 24 giờ cho `callbackUrl`. `readTicket` kiểm đúng mục đích. Vé export PDF là `content`. Vé cũ (không có `purpose`) cấp trước khi triển khai bị từ chối; phiên đang mở lúc triển khai cần mở lại editor.

Tương thích ONLYOFFICE thật (theo bàn giao chat04 và tài liệu callback handler): Document Server 9.4 bật JWT ký callback outbox bằng HS256 và thêm `exp` (mặc định `services.CoAuthoring.token.outbox.expires` 5 phút). Token ở header `Authorization` bọc nội dung trong `payload`, token ở body mang thẳng trường. Cả hai dạng có trong test 4. Token cấu hình trình duyệt nay có thêm `iss` và `exp`; Document Server bỏ qua claim lạ và kiểm `exp`. **Chưa chạy lại** với Document Server thật (`poc/onlyoffice/run-integration.mjs` và luồng trình duyệt chat04).

### Lỗi chức năng liên quan (review QA 2026-10-25)

- **O1 (đã sửa):** callback dùng vé 15 phút nên phiên soạn dài hơn 15 phút lưu khi đóng bị 403. Nay vé callback sống 24 giờ. Rủi ro của vé dài được bù bằng: callback bắt buộc JWT Document Server còn hạn ràng buộc key/status/url, và quyền manager được tra lại lúc callback (5/12). Phiên soạn dài hơn 24 giờ vẫn sẽ bị từ chối khi lưu.
- **O2 (chưa sửa):** forcesave (status 6) tăng phiên bản, các callback sau cùng key bị loại `EDITOR_STALE_VERSION`. Không sửa trong phiên này: sửa O2 nghĩa là chấp nhận callback cùng key sau khi key đó đã tạo phiên bản, mâu thuẫn với assertion "callback thứ hai mang key cũ sau khi version mới đã persist bị từ chối" trong `drive-documents`, `drive-spreadsheets`, `drive-presentations` (quyết định ở bàn giao chat04). Cần chủ dự án chốt ngữ nghĩa trước: với ONLYOFFICE, cùng key nghĩa là cùng phiên đồng soạn, nên hướng đề xuất là nhớ phiên bản do mỗi key tạo và nhận callback cùng key khi phiên bản hiện tại chính là phiên bản key đó đã tạo.
- O5 (body không ký) được xử lý bởi bản sửa này; phần "thùng rác và quyền thành viên lúc callback" đã có từ 5/12 (callback tìm tệp không lọc thùng rác vẫn còn, chưa sửa).

### Test có sẵn phải đổi

Helper `jwt()` trong `drive-documents`, `drive-spreadsheets`, `drive-presentations`, `space-membership` ký callback không có `exp`. Đã thêm `exp` (now + 300 giây), đúng như Document Server thật gửi. Không đổi assertion nào.

### Không đổi hợp đồng

`contract/openapi.yaml` không đổi: `config.token` vẫn là chuỗi, callback vẫn trả `{error}`. Không ghi đề nghị hợp đồng.

### Việc của chủ dự án

- Kiểm `local.json` Document Server triển khai: nếu tách `secret.browser`/`inbox`/`outbox`, `DOCUMENT_EDITOR_JWT_SECRET` phải khớp cả browser (API ký cấu hình), inbox (converter) và outbox (callback). Muốn tách khoá outbox cần thêm cấu hình riêng ở API (chưa làm).
- Kiểm `DOCUMENT_EDITOR_INTERNAL_ORIGIN` chỉ trỏ tới Document Server, và đường cache/output có secure-link md5/expires. Bản sửa chặn url do người dùng chọn, nhưng url do Document Server ký vẫn được tải từ `internalOrigin`.
- Chạy lại bài tích hợp ONLYOFFICE thật trước khi triển khai.

### Sau khi sửa

- `test/editor-callback-jwt.e2e-spec.ts`: `Tests: 5 passed, 5 total`.
- Cùng `drive-documents`, `drive-spreadsheets`, `drive-presentations`, `space-membership`, `review-fixes`, `drive-basic*`: `Tests: 1 skipped, 25 passed, 26 total`.
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 269 passed, 278 total`, độ phủ hợp đồng 145/145.
- Chưa chạy `pnpm ai:check:full`, chưa thử với ONLYOFFICE thật.

---

## 2026-10-25 · Đầu mối 5/12 — Quyền không gian Drive không thu hồi khi đổi phòng hoặc mất R4

- **Fingerprint:** `drive-basic/space-membership/never-reconciled-after-role-or-department-change`.
- **Nhánh:** `claude/audit-fix-05-space-membership-54dd1c` (cắt từ `claude/audit-fix-04-url-fetch-ssrf-25262e`, commit 857dfb3).
- **Kết luận:** lỗi **có thật**, đã tái hiện bằng harness Jest với Google giả, kho giả và Mongo in-memory. Phạm vi rộng hơn mô tả audit: vé editor cấp trước khi đổi quyền vẫn lưu được phiên bản mới.

### Tái hiện trước khi sửa

Thêm file `apps/api/test/space-membership.e2e-spec.ts` (bật editor giả như `drive-documents`). Đổi phòng/vai trò bằng `GoogleSyncService.applyAccess` (đúng đường đồng bộ Google: rời nhóm, `groupRoles: []`, `departmentId` = KD) và bằng `PATCH /users/:id` của R9 (`it`).

1. `đổi phòng và mất R4 qua đồng bộ Google…`: `tp.mkt` (R4) và `nv.mkt` mở `GET /spaces`, `tp.mkt` tải tệp, tạo văn bản, lấy cấu hình editor (vé `edit`), gửi link Drive cho `nv.mkt`. Sau đó chuyển `nv.mkt` rồi `tp.mkt` sang KD, `tp.mkt` mất R4. Trước khi sửa: **FAIL** ở assertion đầu (không gian MKT vẫn có trong `GET /spaces` của `nv.mkt`).
2. `đối chứng: người chưa từng ở MKT nhận 404…`: `nv.kd` upload và liệt kê không gian MKT nhận 404, `leader.mkt` vẫn liệt kê được. Đạt cả trước và sau khi sửa.
3. `R9 gỡ R4 gán tay qua PATCH /users/:id…`: `it` gán R4 tay cho `xem.mkt`, `xem.mkt` upload được (201), rồi `it` gỡ R4. Trước khi sửa: **FAIL**, upload vẫn 201 thay vì 403.

Kết quả trước khi sửa (`ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/space-membership.e2e-spec.ts`): `Tests: 2 failed, 1 passed, 3 total`.

Một test thăm dò tạm (xoá ngay sau khi chạy) ghi trạng thái của mọi bước sau khi chuyển phòng, trên mã cũ:
- `nv.mkt` đã sang KD: không gian MKT vẫn liệt kê (vai trò cũ), `GET /drive/items` 200, tải nội dung tệp MKT 200, link Drive cũ 200, và `tp.mkt` gửi link mới cho `nv.mkt` vẫn 201. Không gian KD không xuất hiện.
- `tp.mkt` đã sang KD và mất R4: không gian MKT vẫn liệt kê với vai trò `manager`, upload 201, tạo thư mục 201, đọc nội dung 200, `editor-config` 200. Không gian đầu tiên loại `department` trong `GET /spaces` vẫn là MKT, không phải KD.
- Vé editor cấp trước khi chuyển: `editor/content` 200, `editor/callback` trả `{error:0}`, tệp lên phiên bản 2.
- `xem.mkt` bị gỡ R4: upload 201, tạo thư mục 201, `GET /spaces` vẫn `manager`.

### Cách sửa

Chọn **kiểm động**: quyền không còn đọc từ `WorkspaceSpaceMember`, mà suy từ `WorkspaceSpace` và trạng thái hiện tại của user. Lý do: `ctx.user` được nạp lại từ DB mỗi request (`auth.guard.ts`), nên đổi phòng/vai trò bằng bất kỳ đường nào (đồng bộ Google, PATCH R9, OIDC ghi lại `systemRoles`, sửa tay DB) có hiệu lực ngay ở request kế tiếp, không cần móc vào từng đường ghi.

- `drive-basic.service.ts`:
  - `roleIn(space, user)`: không gian cá nhân chỉ cho `ownerUserId` (manager). Không gian phòng ban chỉ khi `space.departmentId` khớp `departmentId` hiện tại; vai trò `manager` nếu user đang có R4, ngược lại `reader`. Không gian thiếu khoá (`ownerUserId`/`departmentId`) bị từ chối.
  - `member()` (dùng cho `items`, `file`, `content`, `versionContent`, `upload`, `createFolder`, `updateItem`, `trash`, `restore`, `editorConfig`, `exportDocument`) gọi `memberOf` → 404 nếu không có quyền. Vai trò manager/reader lấy theo R4 hiện tại.
  - `ensureDefaultSpaces` đối soát bảng thành viên: `$set` vai trò hiện tại (thay `$setOnInsert`), và xoá mọi dòng của user cho không gian khác không gian cá nhân và phòng ban hiện tại. `spaces()` lọc lại bằng `roleIn`, nên danh sách luôn khớp quyền thật.
  - Vé editor: `editorContent` và `editorCallback` tra lại user của vé (còn active, không bị treo) và quyền hiện tại trên không gian chứa tệp. `editor/content` cần còn đọc được (404 nếu không). `editor/callback` cần còn là manager, nếu không ghi `EDITOR_FORBIDDEN` vào `WorkspaceEditorSave` và trả `{error:1}`. Vé cấp trước khi đổi quyền hết tác dụng ngay, không đợi 15 phút.
  - `canRead(companyId, user, spaceId)` công khai cho liên thông.
- `workspace-interop.service.ts` `assertRecipientsCanRead` dùng `drive.canRead` thay cho kiểm dòng `WorkspaceSpaceMember`. Tải link (`downloadLink`) vốn đi qua `versionContent` → `member()` của người nhận, nên cũng theo quyền hiện tại.
- Không đổi hợp đồng, không đổi schema.

### Thành viên thêm thủ công

Không có API hay đường mã nào thêm thành viên ngoài `ensureDefaultSpaces` (chỉ test chèn thẳng DB). Sau bản sửa, **dòng `WorkspaceSpaceMember` không cấp quyền**: dòng thêm tay vào không gian không khớp phòng ban/chủ sở hữu bị bỏ qua khi kiểm quyền, và bị xoá ở lần user đó gọi `GET /spaces`. Nếu sau này cần chia sẻ không gian cho người ngoài phòng, phải thêm trường nguồn (ví dụ `source: 'manual'`, người cấp, hạn) và cho `roleIn` xét riêng loại đó.

Hệ quả khác:
- Người nhận link Drive cùng phòng nay được nhận link dù chưa từng mở Drive (trước đây phải có dòng thành viên).
- Không gian phòng ban/cá nhân tạo trước khi có khoá `departmentId`/`ownerUserId` (trước b5ae95f) sẽ không ai vào được. Chủ dự án cần rà `workspace_spaces` thiếu khoá trong dữ liệu thật trước khi triển khai.
- User không có `departmentId` chỉ còn không gian cá nhân.

### Sau khi sửa

- `test/space-membership.e2e-spec.ts`: `Tests: 3 passed, 3 total`.
- Test sẵn có `drive-basic`, `drive-documents`, `drive-spreadsheets`, `drive-presentations`, `drive-basic-storage`, `workspace-interop`, `mailbox-owner`, `review-fixes` cùng file mới: `Tests: 27 passed, 27 total`.
- `pnpm ai:check`: **PASS** (exit 0). Toàn bộ test BE `Tests: 9 skipped, 264 passed, 273 total`, độ phủ hợp đồng 145/145.
- Chưa chạy `pnpm ai:check:full`, chưa thử với Nextcloud thật hay ONLYOFFICE thật.

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
