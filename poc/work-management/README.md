# Work management PoC (chat 13)

Stack local cô lập: Nextcloud 33.0.10 + Authentik 2026.8.5 (cùng digest chat12),
project Compose `vcworkspace-work13`, volume `vcworkspace_work13_*`, chỉ bind
`127.0.0.1`. Không dùng `.env`, Google, Stalwart, domain hay dữ liệu thật.
Bàn giao: `docs/ke-hoach/vcworkspace-13-ban-giao-work-management.md`.

| Thành phần | Cổng host | Ghi chú |
|---|---:|---|
| Nextcloud (`nc13.localtest.me`) | 18130 | relay busybox, alias trong mạng nội bộ |
| Authentik (`ak13.localtest.me`) | 18131 | IdP OIDC |
| Nextcloud restore | 18133 | `compose.restore.yaml`, volume riêng |
| hook-sink | không publish | nhận webhook trong mạng nội bộ |

App pin theo App Store NC 33.0.10 (kiểm 2026-10-25, `evidence/app-metadata-preflight.json`):
Deck 1.17.8, Notes 6.1.0, Forms 5.4.1, Tables 2.3.2, Collectives 4.7.1, user_oidc 8.11.0.
`configure-nextcloud.mjs` từ chối chạy nếu bản cài lệch bản pin.

## Trình tự

1. `node create-secrets.mjs` (secret 0600 trong `secrets/`, Git bỏ qua)
2. `docker compose -f compose.yaml up -d` rồi `node wait-ready.mjs`
3. `node provision-authentik.mjs` — 3 nhóm, 6 persona, 1 client OIDC
4. `node preflight-app-metadata.mjs` rồi `WORK13_ALLOW_APP_DOWNLOADS=1 node configure-nextcloud.mjs`
   (chỉ lần bootstrap: tạm nối Nextcloud ra host_edge để tải app, luôn ngắt trong `finally`)
5. `node browser-login.mjs` — đăng nhập OIDC thật bằng Chrome headless, ghi binding ID
6. `node mint-app-passwords.mjs` — app password cho kiểm API trực tiếp
7. `node acceptance-{deck,notes,forms,tables,collectives}.mjs`
8. `node acceptance-search.mjs`, `node sink-selftest.mjs`, `node acceptance-events.mjs`
9. `node browser-ui.mjs`, `node verify-acl.mjs <nhãn>`, `node verify-isolation.mjs`
10. `node restart-stack.mjs` → `wait-ready` → `verify-acl.mjs after-restart` → `browser-ui.mjs`
11. `node export-all.mjs`, `node backup-local.mjs`,
    `WORK13_RECREATE_RESTORE=1 node restore-local.mjs`, rồi
    `WORK13_NC_BASE=http://nc13.localtest.me:18133 WORK13_NC_CONTAINER=vcworkspace-work13-restore-restore-nextcloud-1 WORK13_RELAY_CONTAINER=vcworkspace-work13-restore-restore-nextcloud-loopback-relay-1 node verify-acl.mjs restore`
    và `node verify-restore.mjs`
12. `node acceptance-offboard.mjs`, `node browser-offboard.mjs`
13. `node scan-secrets.mjs` trước khi commit

Bước 12 là trạng thái cuối: manager-a bị vô hiệu ở Authentik và Nextcloud, tài
nguyên đã chuyển cho successor-a. Muốn chạy lại bước 7–11 phải bật lại manager-a
(Authentik `is_active`, `occ user:enable`) và mint lại app password.

## Ghi chú vận hành PoC

- Mọi định danh dùng user ID bất biến 64-hex do `user_oidc` dẫn xuất từ `sub`
  (unique-uid) và group ID federated; persona `outsider` cố ý có cùng local-part email với manager-a.
- Brute-force protection của Nextcloud bị kích hoạt bởi chính các probe deny
  (403 hàng loạt từ IP relay); script reset bộ đếm cho IP relay trước mỗi ma
  trận, protection vẫn bật.
- `apache-keepalive-off.conf`: qua relay busybox, request trình duyệt dùng lại
  kết nối keep-alive đôi khi không tới Apache (không có trong access log) và
  Chrome treo. Tắt KeepAlive thì các lần chạy browser sau đó đều sạch
  (4/4 ma trận + offboard), bật thì 2 lần treo. Chưa chứng minh nguyên nhân gốc; production dùng reverse proxy thật.
- `nc-log.mjs` chỉ để đọc log khi debug.
