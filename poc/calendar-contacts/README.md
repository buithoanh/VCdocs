# Calendar/Contacts PoC (chat 16)

Chạy trên stack work13 (Nextcloud 33.0.10 + Authentik, chat13) đang chạy, cộng overlay
`vcworkspace-cal16`: một Stalwart 0.16.27 **mới** (`mail16`, volume
`vcworkspace_cal16_mail_data`, chỉ ở mạng internal work13, không có đường ra Internet) để
nhận thư mời iMIP vào hộp thư `.test` giả. Không dùng volume Stalwart chat07, không đọc
`.env`, không đọc secret của chat13 (app password do chat16 tự mint bằng `occ`).
Bàn giao: `docs/ke-hoach/vcworkspace-16-ban-giao-calendar-contacts.md`.

| Thành phần | Cổng host | Ghi chú |
|---|---:|---|
| Nextcloud work13 | 18130 | gọi bằng `http://localhost:18130` (trusted domain `localhost`) |
| Stalwart chat16 (HTTP/JMAP) | 18160 | relay loopback; SMTP 465 chỉ trong mạng internal |
| Restore Nextcloud / Stalwart | 18163 / 18164 | `compose.restore.yaml`, volume `vcworkspace_cal16_restore_*` |

App pin theo App Store NC 33.0.10 (kiểm 2026-10-25, `evidence/app-metadata-preflight.json`):
Calendar 6.6.3, Contacts 8.9.2, calendar_resource_management 0.12.2 (ký số, integrity PASS).

## Trình tự

1. `node create-secrets.mjs` (secret 0600 trong `secrets/`, Git bỏ qua)
2. `node preflight-app-metadata.mjs` rồi `CAL16_ALLOW_APP_DOWNLOADS=1 node install-apps.mjs`
   (chỉ lần bootstrap: tạm nối Nextcloud ra `host_edge`, luôn ngắt trong `finally`)
3. `node up-cal16.mjs up -d` → `node configure-stalwart.mjs` → `node configure-nextcloud.mjs`
4. `node mint-app-passwords.mjs` (token `cal16-dav` cho 5 persona + admin13)
5. `node setup-resources.mjs` (tòa nhà/tầng/phòng P301 giới hạn Team A, P302, máy chiếu)
6. `node setup-collections.mjs` (lịch/sổ địa chỉ chia sẻ theo group id + fixture)
7. `node acceptance-calendar.mjs`, `node acceptance-scheduling.mjs`, `node acceptance-contacts.mjs`
   (`acceptance-contacts` bật chính sách danh bạ theo nhóm — xem bàn giao mục 2)
8. `node verify-acl.mjs live`, `node acceptance-flow-events.mjs`, `node acceptance-offboard.mjs`
9. `node restart-cal16.mjs` → `node verify-acl.mjs after-restart`
10. `node backup-cal16.mjs` → `node verify-restore-cal16.mjs snapshot` →
    `CAL16_RECREATE_RESTORE=1 node restore-cal16.mjs` → với
    `CAL16_NC_BASE=http://localhost:18163 CAL16_NC_CONTAINER=vcworkspace-cal16-restore-restore-nextcloud-1 CAL16_RELAY_CONTAINER=vcworkspace-cal16-restore-restore-relay-1 CAL16_RELAY_NETWORK=vcworkspace-cal16-restore_restore_internal CAL16_MAIL_BASE=http://127.0.0.1:18164`
    chạy `node verify-restore-cal16.mjs compare` và `node verify-acl.mjs restore`
11. `node verify-isolation.mjs`, `node environment.mjs`, `node scan-secrets.mjs` trước khi commit

Debug (chỉ đọc): `probe.mjs`, `debug-mail.mjs`, `debug-search.mjs`, `inspect-stalwart.mjs`,
`occ.sh`. `debug-accept.mjs` bấm link chấp nhận mới nhất của hộp partner và **tạm** đổi
loglevel/chính sách chia sẻ (khôi phục trong `finally`).

## Ghi chú vận hành PoC

- Mọi định danh là uid 64-hex bất biến (user_oidc) và group id federated; email chỉ dùng
  làm địa chỉ lịch (`mailto:`), không dùng làm khoá phân quyền.
- Script reset brute-force cho IP relay trước ma trận deny (protection vẫn bật).
- `acceptance-scheduling` xoá lịch hẹn của chính nó từ lần chạy trước (CalDAV DELETE, vào
  thùng rác lịch) để phòng trống lại; `acceptance-offboard` luôn bật lại member-b và mint
  token mới trong `finally` (chỉ để chạy lại PoC).
- Trạng thái để lại: overlay `vcworkspace-cal16` chạy; stack restore dừng (giữ volume);
  không còn webhook chat16 nào đăng ký.
