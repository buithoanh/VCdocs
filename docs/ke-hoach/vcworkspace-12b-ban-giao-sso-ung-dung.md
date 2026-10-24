# VCworkspace 12B — Bàn giao SSO trong ứng dụng

Ngày kiểm: 2026-10-24. Phạm vi: local TEST cô lập; không production, deploy,
Google thật, dữ liệu thật hoặc gửi thư thật.

## Kết luận

12B **PASS LOCAL SAU REVIEW VÒNG CUỐI**. Cây cuối đã đóng cửa đua tranh khi cấp
subject revision và cửa mất fence giữa hai ghi app-commit, có test tái hiện lỗi
và full gate sau sửa. OIDC đã nằm trong `apps/api`/`apps/web`, không còn là portal
harness: authorization-code + PKCE S256, state/nonce một lần, chữ ký RS256,
issuer/audience/azp/exp/iat, binding bất biến `(issuer, sub)`, session MongoDB,
CSRF và policy group→role phía server đều có test. Google auth cũ giữ nguyên.

Browser thật đã đi từ trang đăng nhập `apps/web` → Authentik 2026.8.5 → callback
`apps/api`, tạo phiên manager R4; `GET /me` cùng origin trả 200. Browser còn phát
hiện và đã sửa lỗi callback khác origin làm mất cookie state. Lỗi shell đứng ở
“Đang mở VCdocs…” được truy ra do browser dev và full build dùng chung `.next`;
cache riêng `.next-oidc12` hydrate đúng. Manager đã mở Drive, thấy nút tạo
DOCX/XLSX/PPTX, mở Email và sang Nextcloud bằng cùng phiên Authentik mà không
nhập lại credential. Browser cuối đã kiểm đủ manager, member và outsider trên
app thật: manager/member nhận R4, outsider không nhận role tùy ý; cả ba render
Drive/Office/Email bằng session OIDC.
Persistence ứng dụng nay đã được kiểm qua instance NestJS thứ hai dùng lại đúng
MongoDB TEST: binding và session OIDC đọc lại được, rồi binding disable làm
`/me` chuyển 200→401 ngay ở instance mới.

Coordinator lifecycle nay là mã sản phẩm trong `apps/api`, không gọi script PoC:
API R9 ghi journal MongoDB, bind Idempotency-Key với toàn projection, lấy CAS
lease, áp dụng app→Authentik→Nextcloud, readback từng bước và giữ `partial` để
retry/reconcile sau lỗi hoặc restart. Integration live đã chạy mover, rename,
disable/global revoke, re-enable và restore baseline qua chính API sản phẩm.

Review điều phối sau gate đầu đã phát hiện và bản cuối đã sửa các blocker:
subject-level revision/CAS fencing chặn hai Idempotency-Key cùng subject ghi đè;
operation được tạo unique trước khi reserve revision, retry cùng key khôi phục
đúng reservation nếu worker chết giữa cấp revision và cập nhật operation;
app giữ `pending-deny` đến khi Authentik và Nextcloud readback xong; Authentik
users/groups/sessions đọc hết pagination và xác nhận session còn lại bằng 0;
Nextcloud global revoke xóa từng browser/app token qua control bridge OCC, chờ
token-cache 10 giây rồi mới ACK. Live `active=true` giữ account enabled nhưng
app-password cũ chuyển `207→401`.

## Thay đổi chính

- OpenAPI `2.3.0-gd2`: thêm `GET /auth/oidc` và
  `GET /auth/oidc/callback`; schema FE sinh lại bằng `gen:api`.
- `AUTH_MODE=google|oidc`; OIDC bắt buộc issuer/client/company domain rõ ràng.
- `OidcIdentity` khóa unique toàn cục `(issuer, subject)` và unique
  `(companyId,userId)`; không auto-link theo email. Binding mới chỉ tạo khi
  `email_verified=true`; binding quản trị có sẵn không dùng email chưa verified
  để đổi địa chỉ.
- Role claim chỉ qua `OIDC_GROUP_ROLE_MAP_JSON`; claim lạ không tự thành R1–R9.
- Phiên OIDC giữ `identityId`; guard hủy phiên khi binding thiếu/disabled hoặc
  projection quá hạn (`OIDC_PROJECTION_MAX_AGE_SECONDS`, mặc định 300 giây).
- Authentik có client thử riêng `vcworkspace-application-test`; redirect callback
  đi qua cùng origin web để cookie state/session đúng mô hình triển khai.
- OpenAPI thêm `POST/GET /identity/lifecycle-operations*`; chỉ R9, CSRF và
  Idempotency-Key. Journal giữ step/attempt/error/version, CAS chặn hai process.

## Ma trận nghiệm thu

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| PKCE S256, state/nonce, one-time callback | PASS | `oidc-auth.e2e-spec.ts` |
| RS256/JWKS/issuer/aud/azp/exp/iat | PASS | service + E2E; test PoC 12 giữ 11 security cases |
| Immutable issuer+sub; không auto-link cùng email | PASS | E2E cùng email/subject khác bị `loi=identity` |
| Email rename cùng sub | PASS (E2E) | giữ một user; chỉ đổi khi verified |
| Server-side group→role; claim tùy ý bị bỏ | PASS | manager nhận R4, `untrusted-R9` không cấp R9 |
| Provider outage/discovery drift fail-closed | PASS | không tạo OAuth state/session |
| Session rotation, CSRF, cookie local | PASS | callback xóa session cũ; gate auth cũ + E2E mới |
| Disabled/stale identity thu hồi app session | PASS | current `/me` thành 401 |
| Browser apps/web→Authentik→apps/api | PASS | manager callback và `/me` 200/R4 |
| Browser Drive/Office/Email bằng session OIDC | PASS 3 persona | manager/member/outsider render app thật; role lần lượt R4/R4/none |
| SSO app→Nextcloud không nhập lại | PASS manager | VCworkspace→Nextcloud dashboard, không nhập lại credential |
| 3 persona app UI, direct API/WebDAV deny | PASS LOCAL | browser đủ ba; OIDC API outsider 403/404; WebDAV live manager 204, member 200, outsider 404/404 |
| Mover/leaver/rename/re-enable qua app lifecycle | PASS LOCAL | API sản phẩm + Mongo journal/CAS/readback; live Authentik/Nextcloud restore baseline |
| Global revoke đồng thời app+Authentik+Nextcloud | PASS LOCAL | app session 200→401; IdP pagination→0; Nextcloud active=true, token/app-password 207→401 |
| Restart/persistence app DB | PASS (E2E TEST) | instance NestJS mới đọc lại binding/session cùng MongoDB; disable trả 401 |
| Reservation/fence race | PASS | barrier cùng key: 1 operation/1 revision; crash-window retry giữ revision; mất lease giữa app multiwrite vẫn pending-deny |
| `pnpm ai:check:full` | PASS | guard 44; BE 173; endpoint 145/145; FE 76; typecheck/build PASS |
| Production TLS/HA/load/domain thật | NOT_TESTED | ngoài phạm vi |

## Security/fault/race đã kiểm

E2E mới kiểm callback replay, state cookie, PKCE, provider outage, cùng email
khác subject, rename cùng subject, role claim lạ, binding disable và session
401. Unit/PoC 12 trước đó còn kiểm chữ ký/nonce/audience/azp/race callback và
lifecycle journal. Bản 12B mới có test coordinator sản phẩm: R9/CSRF/idempotency,
partial fail-closed, retry sau instance restart, global revoke và direct API deny.
Test review bổ sung two-key same-subject race, delayed upstream, lease-expiry
takeover, stale-operation recovery, pending-login deny và Authentik page 2. Vòng
cuối bổ sung barrier cho hai create cùng Idempotency-Key, fault injection đúng
khe sau reserve revision, và lease theft giữa hai ghi `app-commit`; binding không
được publish khi fence mất. Integration Authentik/Nextcloud local chạy lại 1/1.

Rà soát bảo mật cuối không phát hiện blocker mới trong redirect/discovery/JWKS,
token claims, tenant binding, cookie/session và revoke guard. Cấu hình được siết
thêm: OIDC production bắt buộc issuer/API/web đều HTTPS, cookie Secure bật và
projection TTL dương; test xác nhận cấu hình HTTP production bị chặn.

## Hash cây kiểm

- `oidc.service.ts`: `812bac1c0545c34b9a7e28970a3c56d995cbcadf39f7c732be6bcbfcdeb84d32`
- `auth.controller.ts`: `ed3e2b30682e4d4ca83b547d42a6f560c4bcbcc5a0aec59bb3cdb747d47969d4`
- `identity-lifecycle.service.ts`: `ab98a6843be4a5a124bf3fd05758cf77a24eeb74414c9431c1492d30e8294dc0`
- `identity-lifecycle.port.ts`: `9a8a466eacd1a53ac1f1b15b4f3d26325f9be678f8fda8a49520c9175bf55d3b`
- `oidc-auth.e2e-spec.ts`: `cc6513aef895749487d816c5b6840b11c098721443a7dede01523af9aea03fd8`
- `identity-lifecycle.e2e-spec.ts`: `b0bcf1edea87feb9514694d6af7a49295efb5edd26a5e4bab3cc24ca2c818cba`
- `db/models.ts`: `7571599170f192260d7b07b9ef6518e4a6f10270ea00b16b7ca43f88dd2a7eaf`
- `identity-lifecycle-local.integration.spec.ts`: `31b35df219145f57e9521ece16ed515b727500472d77384b2938fb3484ec0fd6`
- `identity-lifecycle-pagination.spec.ts`: `b91cdc8bfca41e68e60aef165bb5e9240b268bdb0c46215de5667671adc0ef0f`
- `nextcloud-token-control.mjs`: `5b62ae1c40c53d36aae332e976f8259fb66a77da7bd71d6fcb4cd5ee7765ac7c`
- `contract/openapi.yaml`: `1b1547f8ceb8f315845821eb34dcd6a36520dbbec691d8a4fca897e98db01f6a`
- schema FE sinh: `3804eba0c76ce6ab3f0223d14ae17f8245babe6cacc28b323b6a5a92be4852a3`

## Giới hạn production và việc còn lại

Chưa được deploy. Production phải dùng HTTPS, cookie Secure, secret manager,
reverse proxy same-origin, JWKS cache/rotation có giới hạn, health/metrics,
retry scheduler tự động cho journal partial, HA fencing và migration binding do
admin duyệt. Kết luận PASS chỉ cho local TEST; không suy ra production-ready.
