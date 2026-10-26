# VCworkspace B1: Drive/Office lên production

- Ngày: 2026-10-26. Nhánh `claude/b1-drive-office-prod` (nền: `claude/prod-cau-hinh-vcworkspace-2fe0b0`,
  phương án A).
- Bối cảnh: chủ dự án chốt đi A trước (Drive/Office/Email/SSO tắt), sau đó bật dần theo B:
  Drive/Office trước, Email sau cùng. Xem `vcworkspace-20-production-phuong-an.md`.
- Phạm vi phiên này: mã và test. Không chạm máy chủ thật, không tạo user hay app password thật.

## 1. Đã làm trong mã (không cần duyệt thêm)

| Việc | Ở đâu | Hành vi |
|---|---|---|
| Kiểm URL dịch vụ dùng chung | `apps/api/src/common/service-url.ts` | Không nhận user/pass, query, fragment. Luôn nhận https. http chỉ tới loopback ngoài production; hoặc tới tên dịch vụ Docker một nhãn (`http://onlyoffice`) khi gọi với `internalHttp`. |
| Adapter Nextcloud | `nextcloud-storage.ts`, `drive-basic.module.ts` | Bỏ giới hạn "chỉ http loopback". Production bắt buộc https, kể cả loopback, vì Basic auth không được đi trên http. dev/test giữ http loopback cho PoC. Adapter tự kiểm lại URL dù cấu hình được dựng ngoài `loadConfig`. |
| Kiểm khi khởi động | `config.ts` | `WORKSPACE_STORAGE_MODE=nextcloud` mà `WORKSPACE_STORAGE_BASE_URL` thiếu hoặc sai luật thì API dừng ngay, không đợi tới request đầu. |
| ONLYOFFICE production | `config.ts` (`validateEditorOrigins`) | Chỉ áp dụng khi bật editor. `DOCUMENT_EDITOR_PUBLIC_ORIGIN` và `DOCUMENT_EDITOR_INTERNAL_ORIGIN` phải đặt tường minh, không được rơi về giá trị PoC `127.0.0.1:18082`. Origin công khai bắt buộc https. Origin nội bộ và `DOCUMENT_EDITOR_API_ORIGIN` nhận https, hoặc http tới tên dịch vụ một nhãn. Giá trị mặc định `host.docker.internal` bị chặn. Luật khoá JWT ≥ 32 byte và luật "kho tắt thì không bật editor" giữ nguyên. |
| CSP web | `apps/web/src/lib/document-server.ts`, `next.config.ts` | Bản build production dừng nếu `NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS` có origin http mạng. Vẫn nhận http loopback để giữ bản build QA local. CSP và danh sách nạp `api.js` dùng chung một hàm. |
| Mẫu env | `deploy/api.env.example` | Khối Drive/Office ghi đúng luật mới. Ghi rõ credential JSON là tạm, chờ thiết kế mục 2. |

Không sửa logic `drive-basic.service.ts`, vì phiên bảo mật O1 đang sửa luồng lưu ONLYOFFICE. Phần
credential ở mục 2 chỉ đổi 3 dòng ở đó, để truyền `companyId` vào `StorageActor`. Callback hiện
so `url` Document Server trả về với `internalOrigin` (protocol, host, port). Khi bật production,
Document Server phải trả URL tải về theo đúng origin nội bộ đó. Mục 4 có bước kiểm.

Test: `apps/api/test/prod-drive-office-b1.e2e-spec.ts` (luật URL, cấu hình Nextcloud và ONLYOFFICE
production, e2e Drive qua WebDAV giả trên http loopback) và
`apps/web/src/lib/document-server.test.ts`.

## 2. Thiết kế credential theo người dùng (ĐÃ DUYỆT 2026-10-26: P1 cho B1, P2 sau SSO)

### Vấn đề

`WORKSPACE_STORAGE_CREDENTIALS_JSON` hiện là `{email: {username, password}}`, nằm trong env:
- Mỗi lần thêm hoặc bớt người phải sửa env và khởi động lại API.
- Mọi app password nằm chung một biến. Lộ env là lộ quyền mọi người.
- Không có cách xoay vòng, không thu hồi khi nghỉ việc, không biết credential nào còn dùng.

Ràng buộc từ mã hiện tại:
- Khoá kho có dạng `personal/...` và `department/...`. Chúng được hiểu trong thư mục nhà của từng
  người (`/remote.php/dav/files/<uid>/`). Không gian phòng ban dựa vào Team Folder của Nextcloud
  gắn cùng tên cho mọi thành viên.
- API đã tự kiểm quyền space (manager/reader). ACL của Nextcloud là lớp phòng thủ thứ hai.
- Production đăng nhập bằng Google (`AUTH_MODE=google`). Authentik chưa có trên production.

### Các phương án

**P1: App password theo người, do API cấp, lưu mã hoá trong Mongo (đề xuất cho B1)**
- Cấp: identity lifecycle (đã gọi OCS provisioning bằng admin) tạo user Nextcloud với mật khẩu
  đăng nhập ngẫu nhiên và không lưu. Sau đó gọi `GET /ocs/v2.php/core/getapppassword` bằng Basic
  auth của chính user đó để lấy app password, rồi đặt lại mật khẩu đăng nhập thành một giá trị
  ngẫu nhiên khác và bỏ đi. Kết quả: chỉ còn app password, và chỉ API giữ nó.
- Lưu: collection mới `WorkspaceStorageCredential`, gồm `companyId`, `userId`, `email`,
  `ncUid`, `kid`, `iv`, `ciphertext`, `tag`, `status` (`active|revoked`), `createdAt`,
  `rotateAfter`, `lastUsedAt`.
  - Mã hoá AES-256-GCM. AAD là `companyId|userId|ncUid`, để không chép được bản mã sang người khác.
  - Khoá chủ lấy từ `WORKSPACE_CREDENTIAL_KEYS`, dạng keyring có phiên bản, vd
    `k2:<base64 32 byte>,k1:<...>`. Khoá đầu tiên dùng để mã hoá; mọi khoá trong danh sách đều
    dùng được để giải mã. Trên máy chủ, keyring là file secret mode 600 (cùng kiểu
    `secrets/vcdocs-sa.json`), không nằm trong Mongo hay git.
- Dùng: adapter đổi `credential(actor)` sang `CredentialStore.get(actor)`, giải mã khi cần và cache
  trong bộ nhớ tối đa 5 phút. Không ghi log, audit hay thông báo lỗi chứa bí mật.
- Xoay vòng: job theo `rotateAfter` (đề xuất 90 ngày). Job cấp app password mới như bước cấp, ghi
  bản mới, rồi xoá app password cũ bằng `DELETE /ocs/v2.php/core/apppassword` (xác thực bằng chính
  app password cũ). Lỗi giữa chừng thì giữ bản cũ đang chạy và báo lỗi job. Đổi khoá chủ: thêm
  `kid` mới lên đầu keyring, job mã hoá lại toàn bộ, sau đó gỡ khoá cũ.
- Thu hồi: khi nghỉ việc, luồng lifecycle sẵn có (`globalRevoke` + disable) xoá mọi token
  Nextcloud. API đánh dấu `revoked` và xoá bản mã.
- Ưu: không đổi khoá kho hay dữ liệu, ACL Nextcloud vẫn theo từng người, audit Nextcloud đúng tên
  người, chạy được với `AUTH_MODE=google`.
- Nhược: thêm collection, job và keyring cần sao lưu riêng; mất keyring thì phải cấp lại toàn bộ.
  Identity lifecycle phải có chế độ production thật (hiện `local` chỉ nhận `*.localtest.me`).
- Cần kiểm chứng trên PoC trước khi code: `getapppassword` với user local vừa tạo, xoá app password
  qua OCS, và việc admin đổi mật khẩu không làm mất app password đã cấp.

**P2: Bearer token OIDC (Nextcloud `user_oidc` bearer validation), đích dài hạn**
- API gửi access token Authentik của người dùng làm `Authorization: Bearer`. Nextcloud kiểm token
  với IdP. API không giữ secret dài hạn nào ngoài refresh token của phiên.
- Cần `AUTH_MODE=oidc` trên production (Authentik thật) và cấu hình bearer validation của
  `user_oidc`. Đây là khả năng cần kiểm chứng; chat12B mới chứng minh SSO trình duyệt, chưa chứng
  minh WebDAV bằng bearer.
- Hợp khi chuyển SSO. User do `user_oidc` tạo không có mật khẩu local, nên P1 không áp dụng được
  cho họ.

**P3: Một tài khoản dịch vụ + Team Folder, API là nơi kiểm quyền duy nhất**
- Một app password duy nhất, quản lý dễ nhất.
- Phải đổi sơ đồ khoá: `personal/...` của mọi người đang trùng nhau trong nhà tài khoản dịch vụ,
  nên cần thêm namespace theo người. Mất lớp ACL Nextcloud theo người, và audit Nextcloud chỉ
  thấy một tài khoản. Không khuyến nghị.

### Đề xuất

Đi P1 cho B1 vì chạy được ngay với đăng nhập Google. Khi production có Authentik, thì chuyển sang
P2 (adapter giữ `CredentialStore` làm điểm cắm, nên chỉ thay phần lấy credential).
`WORKSPACE_STORAGE_CREDENTIALS_JSON` chỉ còn cho dev/staging.

### Đã làm (P1, phần lưu trữ)

Chủ dự án duyệt P1 ngày 2026-10-26. Câu 2–4 dưới đây chưa được trả lời, nên phần đã làm giữ các giá
trị cấu hình được và không giả định câu trả lời.

| Phần | Ở đâu | Hành vi |
|---|---|---|
| Mã hoá | `apps/api/src/common/credential-cipher.ts` | AES-256-GCM, IV 12 byte ngẫu nhiên, tag 16 byte bắt buộc (tag bị cắt ngắn thì bị từ chối). Keyring `kid:<base64 32 byte>`: khoá đầu dùng để mã hoá, mọi khoá đều giải mã được. AAD = `companyId|userId|ncUid`. Mọi lỗi giải mã chỉ trả mã chung. |
| Cấu hình | `config.ts` | `WORKSPACE_STORAGE_CREDENTIAL_SOURCE` = `env` hoặc `store`; production mặc định và bắt buộc `store`. `WORKSPACE_CREDENTIAL_KEYS` hoặc `WORKSPACE_CREDENTIAL_KEYS_FILE` bắt buộc khi dùng `store`. `WORKSPACE_CREDENTIAL_ROTATE_DAYS` là số nguyên 1–365, mặc định 90. Production đặt `WORKSPACE_STORAGE_CREDENTIALS_JSON` thì API dừng khi khởi động. |
| Lưu | collection `workspace_storage_credentials` | Mỗi người một dòng. Chỉ lưu bản mã. Có `rotateAfter` và `lastUsedAt`. Thu hồi thì xoá bản mã nhưng giữ dòng để đối soát. |
| Dùng | `StorageCredentialStore` (`drive-basic/storage-credential.store.ts`), adapter Nextcloud | Bản giải mã được cache tối đa 5 phút. Nextcloud trả 401 thì bỏ cache để lần sau đọc bản mới. `StorageActor` thêm `companyId`; `drive-basic.service.ts` chỉ đổi 3 dòng truyền `companyId`. |
| Xoay vòng | `dueForRotation`, `rotate(issuer)`, `reencrypt` | Xoay app password chạy theo thứ tự cấp mới → lưu → xoá cũ. Cấp mới lỗi thì giữ nguyên bản cũ. Xoá cũ lỗi thì trả `oldRevoked: false` để người vận hành xoá tay. Xoay khoá chủ: `reencrypt` mã hoá lại bằng khoá đầu keyring. |
| Vận hành | `pnpm --filter @vcdocs/api run kho-credential -- nap\|thu-hoi\|den-han\|ma-hoa-lai` | App password chỉ nhận qua stdin; truyền qua tham số dòng lệnh bị từ chối. |

**Chưa làm, chờ câu 3:**
- Bản production của `AppPasswordIssuer`: gọi OCS `getapppassword`/`apppassword` và đặt lại mật khẩu
  bằng admin. Hiện chỉ có bản giả trong test.
- Job tự xoay theo lịch.

Trong lúc chờ, người vận hành tạo app password trên Nextcloud rồi nạp bằng lệnh `nap`. Lệnh
`den-han` liệt kê những credential đã tới hạn xoay.

Hợp đồng API không đổi: credential là nội bộ. Nếu cần trang quản trị xem trạng thái cấp hoặc xoay
credential, sẽ ghi đề nghị riêng vào `apps/api/DE_NGHI_SUA_HOP_DONG.md` khi được duyệt.

### Câu hỏi cần chủ dự án chốt

1. ~~Duyệt P1 cho B1 và P2 làm đích sau SSO?~~ Đã duyệt 2026-10-26.
2. Chu kỳ xoay app password (đề xuất 90 ngày) và ai giữ bản sao lưu keyring
   `WORKSPACE_CREDENTIAL_KEYS`?
3. Có cho phép làm chế độ production cho identity lifecycle (gọi Nextcloud OCS thật bằng admin quyền
   tối thiểu) trong cùng giai đoạn B1 không? P1 cần nó để cấp credential.
4. Nextcloud production đặt sau Caddy cùng máy (`https://cloud.vcprosperous.com`) hay máy riêng?
   Luật mới bắt buộc https cả khi API gọi Nextcloud trong cùng mạng Docker.

## 3. Biến môi trường khi bật B1 (tham khảo, chưa áp dụng)

Xem khối Drive/Office trong `deploy/api.env.example`. Tóm tắt:
- `WORKSPACE_STORAGE_MODE=nextcloud`, `WORKSPACE_STORAGE_BASE_URL=https://...` (không có user/pass
  hay query).
- `WORKSPACE_STORAGE_CREDENTIAL_SOURCE=store` (mặc định ở production),
  `WORKSPACE_CREDENTIAL_KEYS_FILE` trỏ tới file secret, `WORKSPACE_CREDENTIAL_ROTATE_DAYS` (mặc định 90).
- `DOCUMENT_EDITOR_ENABLED=true`, `DOCUMENT_EDITOR_PUBLIC_ORIGIN=https://office...`,
  `DOCUMENT_EDITOR_INTERNAL_ORIGIN=http://onlyoffice` (hoặc https),
  `DOCUMENT_EDITOR_API_ORIGIN=http://api:4000`, `DOCUMENT_EDITOR_JWT_SECRET` ≥ 32 byte.
- Web build: `DOCUMENT_SERVER_ORIGINS` (trong `deploy/.env`) phải khớp origin công khai, dùng https.
  `WORKSPACE_MODULES=drive`.

## 4. Việc vận hành còn lại (phiên vận hành riêng, không làm ở đây)

- Dựng Nextcloud và ONLYOFFICE production (cùng CSDL, Redis, cron, sao lưu) và diễn tập khôi phục.
- Kiểm `local.json` của Document Server: tách secret browser/inbox/outbox, secure-link cho
  cache/files. Kiểm URL trong callback có trùng `DOCUMENT_EDITOR_INTERNAL_ORIGIN` không (xem
  `docs/bao-mat/audit-fix-log.md`).
- Kiểm giới hạn 20 kết nối của bản ONLYOFFICE Community.
