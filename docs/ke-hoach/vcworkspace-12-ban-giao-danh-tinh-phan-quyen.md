# VCworkspace 12 — Bàn giao danh tính và phân quyền local

Ngày nghiệm thu: 2026-10-24. Phạm vi: PoC local cô lập, dữ liệu/persona giả;
không production, không Google thật, Stalwart, LDAP, domain thật, IAM hay deploy.

## 1. Kết luận

Chat12 **PASS trong phạm vi PoC local** sau review điều phối bổ sung. Review này
phát hiện bằng chứng cũ chỉ bao phủ portal harness và một lỗi thật: `user_oidc`
namespace group thành ID băm nhưng Team Folder chỉ gắn nhóm local, nên manager
OIDC nhận 404 và mover có thể giữ nhóm cũ. Đã sửa binding federated group, regex
gỡ nhóm đã namespace và lifecycle local/federated; browser thật hiện chứng minh
portal harness → Nextcloud không nhập lại credential, ba persona ACL, email đổi
giữ nguyên `sub`, mover relogin mất ACL cũ, current-session revoke 200→401.
Restart, backup/restore mới và ACL restore đã chạy lại sau bản sửa.

## 2. Runtime và cổng

| Thành phần | Phiên bản / digest ARM64 | Cổng host |
|---|---|---:|
| Nextcloud Apache | 33.0.10, `sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33` | 18120 |
| Authentik OSS | 2026.8.5, `sha256:c0ce79a3fc4533045bfd203254d0c2f71a871d8607a3412f181da247b542e3a1` | 18121 |
| Portal adapter | Node 22, source trong repo | 18122 |
| Nextcloud restore | cùng digest nguồn | 18123 |
| Authentik restore | cùng digest nguồn | 18124 |
| PostgreSQL | 18.1 Alpine, `sha256:aa6eb304ddb6dd26df23d05db4e5cb05af8951cda3e0dc57731b771e0ef4ab29` | không publish |
| Redis | 8.2.3 Alpine, `sha256:08ad0b1d280850169a790dba1393ff7a90aef951fc19632cf4d3ce4f78e679ba` | không publish |

Tất cả cổng chỉ bind `127.0.0.1`. Application container chỉ ở Docker network
`internal`; relay read-only, drop toàn bộ capability, không mount secret, mới
nối host-edge. Outbound probe từ Nextcloud trả exit 6 (DNS/network fail-closed),
evidence `poc/identity-admin/evidence/isolation.json`.

## 3. OIDC và phiên

- Hai client confidential có redirect URI `strict`: portal callback/logged-out
  và Nextcloud callback; discovery, JWKS RS256, issuer, audience, expiry, iat,
  nonce, subject và `azp` cho multi-audience đều được kiểm.
- Trình duyệt Chrome headless thật đi qua authorization-code + PKCE S256; state
  one-time, callback replay bị 401, cookie tấn công cố định bị thay bằng session
  ID mới.
- Portal cổng 18122 là OIDC test harness độc lập, **không phải** `apps/web` hay
  `apps/api`. Cùng phiên Authentik từ harness được dùng sang Nextcloud
  `user_oidc` mà không nhập lại credential; authorize và callback Nextcloud đều
  xuất hiện. Đây là proof hai relying party local, chưa phải cổng VCworkspace đã
  tích hợp SSO vào sản phẩm.
- Logout local chỉ xóa portal cookie. Provider application logout đi qua
  Authentik end-session; Authentik SSO toàn cục có thể còn. Global revoke xóa
  portal sessions + Authentik authenticated sessions, disable identity và
  Nextcloud; browser đang mở nhận 401. Sau test baseline được enable/readback lại.
- Phiên Nextcloud browser thật được kiểm riêng: trước global revoke OCS current
  user trả 200; sau xóa Authentik sessions, disable identity/Nextcloud và xóa
  toàn bộ auth token của user thì chính browser đang mở trả 401. App password
  Nextcloud là proof độc lập:
  WebDAV 207 trước revoke, 401 sau revoke.

Evidence: `browser-oidc.json/png`, `browser-nextcloud-sso.json/png`,
`security-live.json`, `revoke.json`; unit security 11/11 gồm
issuer/audience/expiry/nonce/signature,
multi-audience `azp`, state expiry/replay, callback race, discovery outage và
metadata hỏng fail-closed.

## 4. Lifecycle và binding

Nguồn danh tính Authentik được preview claim rồi reconcile qua Nextcloud OCS;
không truy cập DB Nextcloud trực tiếp. `sub` là user ID bất biến, email là thuộc
tính có thể đổi.

| Ca | Kết quả |
|---|---|
| Joiner | bind đúng immutable `sub`, email và nhóm |
| Rename email | email đổi/readback, `sub` giữ nguyên |
| Mover | bỏ `vcw-team-a`, thêm nhóm mới; quyền Team A cũ trả 404 |
| Leaver | disable, WebDAV fail-closed; enable lại trả 207 |
| Partial failure | inject lỗi sau thao tác remove-group, journal còn pending; retry cùng correlation hoàn tất, idempotent |
| Race | lock directory atomic; hai reconcile đồng thời có đúng một winner, loser fail `LIFECYCLE_RECONCILE_ALREADY_RUNNING` |

Journal lưu correlation ID, operation key, attempts và trạng thái; ghi file tạm
rồi rename. Evidence: `identity-bindings.json`, `lifecycle.json`,
`lifecycle-journal.json`.

Browser mover đổi group ngay tại Authentik từ `vcw-team-a` sang
`vcw-outsiders-b`, đăng nhập lại và thấy Nextcloud chỉ còn federated group mới;
Team A trả 404. Khi khôi phục claim và đăng nhập lại, Team A trả 200. Regex
`^(vcw-|[0-9a-f]{64}$)` vừa giới hạn claim nguồn, vừa cho phép gỡ ID 64-hex đã
namespace; tránh lỗi claim cũ tự cấp lại quyền.

## 5. ACL và audit

Team Folder `Team A` gắn cả group lifecycle local và federated group ID của
`vcw-team-a`. Browser OIDC cookie chứng minh manager/member GET 200 và outsider
tenant B 404; live WebDAV nguồn và restore độc lập còn chứng minh
manager PUT 204, member GET 200 đúng SHA-256, outsider read/write 404/404.
`admin_audit` ghi 11 record đã lọc, cùng correlation ID với ca ACL, gồm
user/method/path; không chứa credential.

Evidence: `acl-webdav.json`, `restore-acl-webdav.json`,
`audit-correlation.json`.

## 6. Backup, restart và restore

`backup-local.mjs` tạo custom dump cho hai PostgreSQL và archive toàn bộ
Nextcloud HTML volume, chmod 0600, ghi SHA-256 vào `backup.json`. PostgreSQL 18
mount đúng `/var/lib/postgresql` bằng named volume ổn định; không dựa anonymous
volume của image.

`restore-local.mjs` mặc định từ chối. Chỉ với
`IDENTITY12_RECREATE_RESTORE=1`, script mới xóa đúng ba volume restore TEST,
bung archive, nạp dump `--no-owner --no-acl`, rebind DB credential bằng PHP
script reviewable rồi bật relay. Bản cuối đã được tái tạo bằng chính script này.
Readback qua API/OCC xác nhận 4 persona, 3 nhóm, 2 app, 4 immutable binding,
Nextcloud 33.0.10, ba app `admin_audit/groupfolders/user_oidc`, regex gỡ group
OIDC và federated Team A binding, image IDs, checksum backup, cổng nguồn/restore
tách biệt và ACL/hash live.

Evidence: `backup.json`, `restore-readback.json`, `restore-acl-webdav.json`.

## 7. Ma trận nghiệm thu

| Hạng mục | Trạng thái | Bằng chứng chính |
|---|---|---|
| Pinned version/digest, loopback, no-egress | PASS | compose + `isolation.json` |
| 3 nhóm, 4 persona giả, 2 OIDC app | PASS | `provisioning.json` |
| Portal browser OIDC + security/session | PASS | `browser-oidc.json/png`, 11 unit tests |
| Nextcloud browser OIDC + immutable binding | PASS | `browser-nextcloud-sso.json/png` |
| Joiner/mover/leaver/rename | PASS | `lifecycle.json` |
| Idempotency, injected partial failure, race fencing | PASS | lifecycle journal/test |
| Team Folder ACL bằng phiên browser OIDC, cross-tenant deny | PASS | manager/member 200, outsider 404; mover 404 rồi restore 200 |
| App-password revoke | PASS | `revoke.json` |
| Current Nextcloud browser session/global revoke | PASS | OCS browser 200→401, auth token readback rỗng |
| Audit correlation | PASS | 11 records trong `audit-correlation.json` |
| Restart/readback sau binding OIDC mới | PASS | browser suite đầy đủ chạy lại sau restart |
| Backup/restore độc lập sau binding OIDC mới | PASS | backup mới; verifier regex/binding + restore ACL |
| `pnpm ai:check` | PASS | guard 44/44, API 157/157, endpoint 140/140, FE 76/76, build |
| `pnpm ai:check:full` | PASS | cùng số liệu, chạy lại độc lập trên cây cuối |
| Production/HA/load/domain thật/LDAP | NOT_TESTED | ngoài phạm vi đã duyệt |

## 8. Lệnh kiểm cuối

Các lệnh live đã chạy trên local stack:

- `node --test poc/identity-admin/test/oidc-client.test.mjs` — PASS 11/11;
- `node poc/identity-admin/test-lifecycle.mjs` — PASS;
- `node poc/identity-admin/test-live-acl.mjs` — PASS;
- `node poc/identity-admin/browser-oidc.mjs` — PASS;
- `CDP_PORT=19231 node poc/identity-admin/browser-nextcloud-sso.mjs` — PASS:
  3 persona, SSO không nhập lại, browser ACL, mover, rename và revoke 200→401;
- `node poc/identity-admin/test-live-security.mjs` — PASS;
- `node poc/identity-admin/test-revoke.mjs` — PASS;
- `node poc/identity-admin/verify-isolation.mjs` — PASS;
- restore API/OCC readback + restore ACL — PASS.
- `pnpm ai:check` — PASS: guard 44/44, OpenAPI hợp lệ (181 warning hiện
  có), API 157/157, coverage endpoint 140/140, FE 76/76, typecheck/build;
- `pnpm ai:check:full` — PASS với cùng số liệu trên cây cuối.

## 9. Giới hạn và quyết định còn mở

- Đây là adapter/PoC quản trị local, chưa phải UI quản trị production.
- Portal 18122 chỉ là test harness; `apps/web`/`apps/api` hiện chưa tích hợp SSO.
- Do PoC chỉ dùng HTTP loopback và IdP trên Docker internal network, Nextcloud
  bật `allow_insecure_http` và `allow_local_remote_servers`; production phải có
  TLS/reverse proxy và bỏ hai ngoại lệ này.
- Bootstrap app marketplace là bước ngoại lệ có cờ rõ; sau bootstrap verifier
  buộc application container quay lại no-egress.
- Relay dùng image Redis đã pin chỉ để tận dụng BusyBox `nc`; production cần
  reverse proxy chuyên dụng, TLS, rate limit và network policy ngoài Docker.
- Relay không mang secret/read-only nhưng vẫn cùng network nội bộ với app/DB để
  chuyển TCP; production cần tách DMZ/proxy subnet. Restore PoC dùng readiness
  wait cố định 4 giây; production cần health-gated retry/backoff. Lock lifecycle
  có thể thành stale nếu tiến trình bị `SIGKILL`; production cần lease TTL/fencing
  trên shared durable store.
- Authentik application logout không đồng nghĩa global SSO revoke; UI/vận hành
  production phải diễn đạt đúng ba mức local / provider / global.
- Chưa chọn HA, sizing, retention audit, external IdP/LDAP, domain/TLS thật,
  disaster-recovery RPO/RTO hay chính sách phê duyệt quyền production.

Không thay hợp đồng `contract/openapi.yaml`; không deploy, commit, push hay thao
tác dữ liệu thật.
