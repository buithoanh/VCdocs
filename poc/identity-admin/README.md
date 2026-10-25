# Identity/Admin PoC (chat 12)

Stack cô lập dùng Nextcloud 33.0.10 và Authentik OSS 2026.8.5, chỉ bind
loopback. Không dùng `.env`, Google, Stalwart, domain hoặc dữ liệu thật.

1. `node poc/identity-admin/create-secrets.mjs`
2. `docker compose -f poc/identity-admin/compose.yaml up -d`
3. `node poc/identity-admin/provision-authentik.mjs`
4. `node poc/identity-admin/configure-nextcloud.mjs`

Các secret và bootstrap env-file chỉ nằm trong `poc/identity-admin/secrets/`,
mode 0600 và bị Git bỏ qua. Bootstrap env-file là yêu cầu riêng của Authentik
(bootstrap token/password không hỗ trợ `file://`) và chỉ gắn vào worker. Không
ghi giá trị vào log/evidence. Stack 12 dùng volume và cổng riêng;
không thay runtime 33.0.5 tại cổng 18080. Application container chỉ nối
network `internal`; hai relay tối thiểu, read-only, không mount secret mới nối
network host-edge và chỉ publish trên `127.0.0.1`. Kiểm bằng
`node poc/identity-admin/verify-isolation.mjs` (gồm outbound probe phải fail).

`groupfolders` và `user_oidc` phải có sẵn trong volume bình thường. Với máy
sạch, chỉ riêng bước bootstrap được phép tải app khi đặt rõ
`IDENTITY12_ALLOW_APP_DOWNLOADS=1`; script tạm nối Nextcloud vào host-edge,
cài app rồi luôn ngắt network trong `finally`. Runtime sau bootstrap vẫn
no-egress và verifier sẽ fail nếu app còn nối host-edge.

Vì PoC chỉ chạy HTTP trên loopback và IdP nằm trong Docker network nội bộ,
`configure-nextcloud.mjs` bật hai ngoại lệ **chỉ dành cho local**:
`user_oidc.allow_insecure_http` và `allow_local_remote_servers`. Production
phải có TLS/reverse proxy và không được sao chép hai ngoại lệ này. `user_oidc`
namespace group bằng SHA-256 khi `unique-uid=1`; script tạo/bind đúng federated
group ID cho Team Folder và dùng regex vừa nhập `vcw-*`, vừa gỡ được ID 64-hex
khi claim upstream thay đổi.

Pinned ARM64 digests (kiểm 2026-10-24):

- Nextcloud 33.0.10 Apache: `sha256:431d389f...d7df33`
- Authentik 2026.8.5: `sha256:c0ce79a3...3e3a1`
- PostgreSQL 18.1 Alpine: `sha256:aa6eb304...f4ab29`
- Redis 8.2.3 Alpine: `sha256:08ad0b1d...679ba`

## Cổng và kiểm thử

- nguồn: Nextcloud `127.0.0.1:18120`, Authentik `127.0.0.1:18121`,
  portal adapter `127.0.0.1:18122`;
- ứng dụng VCworkspace 12B dùng API `127.0.0.1:18125`, web
  `127.0.0.1:18126` và OIDC client riêng `vcworkspace-application-test`;
- bản khôi phục độc lập: Nextcloud `127.0.0.1:18123`, Authentik
  `127.0.0.1:18124`;
- tên `*.localtest.me` chỉ phân giải về loopback, dùng để giữ đúng cookie/OIDC
  origin trong trình duyệt local.

Các script `provision-authentik.mjs`, `lifecycle-nextcloud.mjs` và test live
đều đọc secret qua file đã tạo, không in giá trị. Evidence đã lọc nằm ở
`evidence/`; journal lifecycle giữ correlation ID và idempotency key. Trình tự
nghiệm thu chính:

1. `node poc/identity-admin/provision-authentik.mjs`
2. `node poc/identity-admin/configure-nextcloud.mjs`;
3. `node --test poc/identity-admin/test/oidc-client.test.mjs`
4. `node poc/identity-admin/test-lifecycle.mjs`

Khi kiểm coordinator sản phẩm 12B, chạy
`node poc/identity-admin/nextcloud-token-control.mjs` trên loopback 18127.
Bridge chỉ nhận bearer token thử, chỉ chấp nhận user ID hex 64 ký tự, gọi OCC
`user:auth-tokens:delete` từng token và chỉ ACK sau readback 0 token cùng cửa sổ
cache 10 giây. Không dùng bridge này cho production.
5. `node poc/identity-admin/test-live-acl.mjs`
6. khởi động `portal-server.mjs`, Chrome CDP loopback rồi chạy
   `browser-oidc.mjs`, `browser-nextcloud-sso.mjs` và
   `test-live-security.mjs`; có thể đặt `CDP_PORT` cho một Chrome headless sạch;
7. `node poc/identity-admin/test-revoke.mjs`.

`portal-server.mjs` là **OIDC test harness độc lập**, không phải tích hợp vào
`apps/web` hay `apps/api`. `browser-nextcloud-sso.mjs` mới là proof hai relying
party: đăng nhập portal harness trước rồi sang Nextcloud `user_oidc` không nhập
lại credential; đọc Team A bằng cookie browser cho manager/member/outsider;
kiểm email đổi nhưng `sub` giữ nguyên, mover đổi claim Authentik rồi login lại
mất ACL cũ, và thu hồi phiên Nextcloud đang mở trả 401. App-password revoke là
proof riêng, không thay thế browser-session proof.

Backup trong `backup/` và secret trong `secrets/` bị Git bỏ qua. Chạy
`backup-local.mjs` để tạo hai PostgreSQL custom dump, archive HTML volume và
SHA-256 evidence. `restore-local.mjs` từ chối mặc định; chỉ khi chủ động đặt
`IDENTITY12_RECREATE_RESTORE=1` mới xóa đúng ba volume **restore TEST**, nạp
dump với `--no-owner --no-acl`, bung HTML volume và chạy script PHP reviewable
để đổi credential DB restore. Xác minh bằng `AUTHENTIK_BASE_URL=http://127.0.0.1:18124/api/v3 node poc/identity-admin/verify-restore.mjs` và
`NEXTCLOUD_BASE_URL=http://localhost:18123 ACL_EVIDENCE_FILE=restore-acl-webdav.json node poc/identity-admin/test-live-acl.mjs`.
