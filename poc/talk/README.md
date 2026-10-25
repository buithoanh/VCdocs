# Talk PoC (chat 17, quy mô nhỏ)

Chạy trên stack work13 đang chạy (Nextcloud 33.0.10 + Authentik chat13, Calendar/Contacts
chat16). Talk (spreed) **23.0.12** dùng **signaling nội bộ** của Nextcloud: không HPB, không
TURN, không STUN (Nextcloud không có đường ra Internet; trình duyệt chỉ dùng host candidate).
Không đọc `.env`, không đọc secret của chat trước: app password `talk17-api` (và `talk17-api-2`
= thiết bị thứ hai) do chat17 tự mint bằng `occ` vào `secrets/` (0600, Git bỏ qua).
Bàn giao: `docs/ke-hoach/vcworkspace-17-ban-giao-talk.md`.

| Thành phần | Cổng host | Ghi chú |
|---|---:|---|
| Nextcloud work13 | 18130 | `http://localhost:18130` (trusted domain `localhost`, là secure context cho WebRTC) |
| Restore Nextcloud | 18173 | `compose.restore.yaml`, volume `vcworkspace_talk17_restore_*` |
| Chrome headless (CDP) | 19271–19273, 19281–19283 | chỉ `127.0.0.1`, profile tạm `chrome-profile-*` (Git bỏ qua, xoá sau khi chạy) |

## Trình tự

1. `node preflight-app-metadata.mjs` (App Store 33.0.10 → pin spreed) rồi
   `TALK17_ALLOW_APP_DOWNLOADS=1 node install-talk.mjs` (chỉ lần bootstrap: tạm nối
   `host_edge`, luôn ngắt trong `finally`; integrity:check-app)
2. `node configure-talk.mjs` (không STUN/TURN/HPB, `has_internet_connection=false`,
   `force_passwords`, tắt recording/SIP/federation)
3. `node mint-app-passwords.mjs`, `node create-secrets.mjs`
4. `node setup-conversations.mjs` (phòng nhóm Team A/B theo group id, 1-1 Team A)
5. `node run-acceptance.mjs` = `acceptance-chat`, `acceptance-files`, `acceptance-guest`,
   `acceptance-calendar`, `acceptance-flow-events`, `acceptance-call` (WebRTC 2–3 Chrome
   headless), `verify-acl live`, `acceptance-offboard`, `verify-isolation`
6. `node restart-talk17.mjs` → `node verify-acl.mjs after-restart`
7. `node backup-talk17.mjs` → `node restore-talk17.mjs` (`TALK17_RECREATE_RESTORE=1` khi chạy lại)
   → với `TALK17_NC_BASE=http://localhost:18173 CAL16_NC_CONTAINER=vcworkspace-talk17-restore-restore-nextcloud-1 CAL16_RELAY_CONTAINER=vcworkspace-talk17-restore-restore-relay-1 CAL16_RELAY_NETWORK=vcworkspace-talk17-restore_restore_internal`
   chạy `node verify-state.mjs snapshot restore`, `node verify-state.mjs compare before-backup restore`,
   `node verify-acl.mjs restore`, `node verify-restore-talk17.mjs`; sau đó
   `docker compose -f compose.restore.yaml stop` (giữ volume)
8. `node environment.mjs`, `node scan-secrets.mjs` trước khi commit

Phụ: `browser-ui.mjs` mở **UI Talk thật** trong Chrome headless (phiên mở bằng Basic auth app
password do CDP chèn header) để chụp màn hình member/outsider; bước bấm "Bắt đầu cuộc gọi"
trong UI chưa tạo được cuộc gọi (xem bàn giao). `probe.mjs` = một request debug (không in
credential). `call-harness.js` = mã chạy trong trang: nói đúng giao thức signaling nội bộ của
Talk (join phòng → join call → long-poll `signaling/{token}` → offer/answer/candidate).

## Ghi chú vận hành PoC

- Mọi định danh là uid 64-hex bất biến (user_oidc) và group id federated; email chỉ là địa chỉ
  lịch. Không ghi DB/data directory: chỉ `occ`, OCS/Talk API, WebDAV, CalDAV.
- Talk chặn tra token phòng sai theo IP (429, brute-force `talkRoomToken`); mọi request đi qua
  một IP relay nên script reset `security:bruteforce:reset` trước mỗi khối probe (bảo vệ vẫn bật).
- `acceptance-offboard` luôn bật lại member-b, mint token mới và thêm lại vào `talk17-team-b`
  trong `finally` (chỉ để chạy lại PoC).
- Trạng thái để lại: spreed 23.0.12 bật trên work13; cấu hình ở mục 2 bàn giao; phòng fixture
  `talk17-team-a`, `talk17-team-b`, 1-1 Team A; không còn bot/webhook chat17; stack restore dừng
  (giữ volume); successor-a có tuỳ chọn múi giờ `Asia/Ho_Chi_Minh`.
