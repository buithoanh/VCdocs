# VCworkspace 17 — Bàn giao Talk (quy mô nhỏ)

Ngày kiểm: 2026-10-25. Nhánh `claude/chat17-talk` (cắt từ `claude/chat16-calendar-contacts`,
commit d93960d). Phạm vi: PoC **LOCAL** chỉ bằng container trên stack work13 đang chạy
(loopback, persona và dữ liệu giả) + Chrome headless có sẵn trên máy. Không production, deploy,
Google thật, thư thật, điện thoại hay mạng ngoài; không tải trình duyệt; không cài coturn/HPB.
PoC và bằng chứng: `poc/talk/` (README có trình tự chạy lại), `poc/talk/evidence/`. Không đổi
mã `apps/`, hợp đồng hay FE.

Cách đọc: **LOCAL PASS** = đã chạy trên runtime local lần này; **FINDING** = đã chạy, hành vi
là rủi ro phải xử lý trong thiết kế; **DOC** = đọc mã/tài liệu, chưa chạy; **NOT_TESTED** =
chưa có bằng chứng.

## 1. Kết luận

- Talk (spreed) **23.0.12** chạy trên Nextcloud 33.0.10 work13 với **signaling nội bộ** (không
  HPB, không TURN, không STUN). Phòng nhóm theo group id Team A/B (đồng bộ khi nhóm đổi), 1-1,
  chat, mention + thông báo, tìm người theo chính sách enumeration chat16, chia sẻ file vào chat
  theo ACL Files (không reshare khi thiếu quyền, gỡ khỏi phòng là mất quyền ≈ 95 ms), link Talk
  trong lời mời lịch (hai chiều Calendar↔Talk), khách có mật khẩu + lobby, offboard, restart,
  backup/restore có kiểm lại ACL (deny **264/264** live, sau restart, trên restore): **LOCAL PASS**.
- WebRTC giữa 2–3 Chrome headless trên máy (host candidate, UDP, RTT ≈ 0–1 ms): offer→connected
  **p50 2,11 s**, join→connected **p50 3,26 s** (5 vòng); nhóm 3 người (mesh, có 1 khách mật
  khẩu) đủ 3 cặp sau **2,29 s**. Thời gian chủ yếu do signaling nội bộ **poll DB mỗi 1 s** (mỗi
  chặng offer/answer ≈ 1 s), không phải do mạng.
- Flow chat14: event Talk **không** tương thích `webhook_listeners` (400). Đường đúng là **bot
  webhook của Talk** (HMAC-SHA256, bật theo từng phòng, chỉ admin cài được): đến sink nội bộ
  sau ≈ 163 ms, chữ ký đúng, không lộ phòng khác — nhưng **payload chứa nguyên văn tin nhắn** và
  uid được mention.
- Bốn phát hiện phải mang vào thiết kế trước khi mở Talk cho người dùng (chi tiết mục 6):
  1. **Moderator thêm được bất kỳ ai theo uid/group id** (Team B, outsider, nhóm outsiders) dù
     bật "chỉ chia sẻ trong nhóm"; **file chia sẻ vào phòng đó đến được người khác nhóm** qua
     Files (share trực tiếp bị 403, qua phòng Talk thì 200). `allowed_groups` khoá outsider khỏi
     Talk API nhưng **không** chặn file qua Files (200).
  2. **Thêm khách bằng email biến phòng riêng thành công khai không mật khẩu** (bỏ qua
     `force_passwords`): ai có link (8 ký tự) vào được và đọc toàn bộ lịch sử.
  3. **Share vào phòng mặc định quyền 19** (đọc + sửa + chia sẻ lại): người trong phòng ghi đè
     được file của chủ (204).
  4. **Lobby không bắt buộc** (không có cấu hình toàn cục); khách có mật khẩu đọc ngay toàn bộ
     lịch sử nếu moderator không bật lobby.

## 2. Runtime và cấu hình

| Thành phần | Phiên bản / nơi chạy | Bằng chứng |
|---|---|---|
| Nextcloud | 33.0.10, PHP 8.4.27, container work13 (image `vcworkspace-sync15/nextcloud-smb:33.0.10-1`, volume giữ nguyên) | `environment.json` |
| Talk (spreed) | **23.0.12** (`>=33 <=33`, phát hành 2026-10-15), bản stable cao nhất App Store cho 33.0.10 ngày 2026-10-25 (lộ trình chat11 ghi ứng viên 23.0.11); ký số, `integrity:check-app` PASS; egress tạm ≈ 4,9 s rồi ngắt | `app-metadata-preflight.json`, `apps.json` |
| Signaling | nội bộ (không `signaling_servers`), không TURN, `stun_servers=[]` + `has_internet_connection=false` | `nextcloud-config.json`, `isolation.json` |
| Trình duyệt WebRTC | Google Chrome 155.0.8059.85 có sẵn (headless, camera giả, audio WebAudio), CDP chỉ `127.0.0.1` | `acceptance-call.json` |
| Restore | project `vcworkspace-talk17-restore`, `localhost:18173`, volume `vcworkspace_talk17_restore_*` (đã dừng, giữ volume) | `verify-restore.json` |

Cấu hình spreed (`configure-talk.mjs`): `force_passwords=true`, `call_recording=no`,
`sip_dialout=no`, `federation_enabled=no`, `allowed_groups=[]` (mọi người dùng; xem 6.1),
`start_conversations` mặc định. Chính sách danh bạ chat13/16 giữ nguyên
(`only_share_with_group_members=yes`, `restrict_user_enumeration_to_group=yes`,
`..._full_match=no`, `shareapi_allow_links=no`).

Vì sao `has_internet_connection=false`: khi danh sách STUN rỗng Talk tự thêm
`stun.nextcloud.com:443` (DOC `lib/Config.php::getStunServers`), và **trình duyệt** (nằm ngoài
mạng internal) sẽ gọi STUN đó. Chỉ cờ này bỏ được fallback; tác dụng phụ: Nextcloud coi máy chủ
không có Internet (không kiểm cập nhật/App Store, push proxy) — đúng thực tế PoC.

Cô lập (`isolation.json`): mạng work13 `internal: true`; Nextcloud chỉ ở mạng đó sau khi cài;
probe ra `1.1.1.1:443` và `stun.nextcloud.com:443` bị chặn; host chỉ thấy `127.0.0.1:18130`;
`signaling/settings` trả cho client `stunservers: []`, 0 TURN, không server ngoài, mode
`internal`.

## 3. Ma trận nghiệm thu

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Phòng nhóm theo group id (POST room `invite=<group id>`, `source=groups`); member-a thấy `talk17-team-a`, không thấy Team B; manager-b ngược lại; outsider không thấy gì | **LOCAL PASS** | `conversations.json`, `acceptance-chat.json` `visible` |
| Đồng bộ thành viên theo nhóm (nhóm tạm local): thêm vào nhóm → thấy phòng sau ≈ 275 ms, đọc 200; gỡ khỏi nhóm → mất phòng, đọc 404 | **LOCAL PASS** | `groupSync` |
| 1-1 trong Team A (người thứ hai được thêm khi có tin đầu); 1-1 với Team B/outsider theo uid → **403** (`currentUserCanEnumerateTargetUser`) | **LOCAL PASS** | `setup-conversations`, `crossGroupPolicyProbes` |
| Chat: đăng 201, chủ phòng thấy sau ≈ 102 ms; tiếng Việt giữ nguyên | **LOCAL PASS** | `chat` |
| Mention `@"uid"` → thông báo cho người được nhắc; `@all` → thông báo thành viên; mention người ngoài phòng (outsider) **không** tạo thông báo; Team B không nhận gì | **LOCAL PASS** | `mentions` |
| Autocomplete mention trong phòng chỉ gợi ý thành viên | **LOCAL PASS** | `mentionAutocomplete` |
| Tìm người như hộp thoại Talk (core autocomplete `itemType=call`, user/group/email/team): 0 kết quả chéo nhóm cho member-a, manager-b, outsider (kể cả đúng email, đúng uid 64-hex); đối chứng dương cùng nhóm có | **LOCAL PASS** | `userSearch`, `userSearchCrossGroupHits` |
| Email gõ đúng được trả lại như ứng viên "mời khách bằng email" (không phải lộ danh bạ) | Ghi nhận | `typedEmailEchoedAsGuestCandidate` |
| Moderator thêm Team B / outsider theo uid, thêm nhóm outsiders theo id | **FINDING** (200; outsider đọc/đăng được) | `crossGroupPolicyProbes` |
| Chia sẻ file vào chat (share type 10): tin `{file}` trong chat, thành viên đọc qua `/Talk/…`, shared-items API | **LOCAL PASS** | `acceptance-files.json` |
| Người ngoài phòng (Team B, outsider, ẩn danh) với file đó: shared-items 404, không có trong "shared with me", link `/f/<id>` 303 (không nội dung), WebDAV đoán đường dẫn 404, preview 404, share theo id 404, meta 404 | **LOCAL PASS** | `nonParticipants` |
| Theo ACL Files: người chỉ có quyền đọc (không reshare) đẩy file vào phòng → **404** "not allowed to share"; share phòng chỉ đọc (perm 1) → thành viên ghi 403 | **LOCAL PASS** | `reshareWithoutPermission`, `readOnlyRoomShare` |
| Thu hồi: gỡ khỏi phòng → file 404 sau ≈ 95 ms; thêm lại 200; xoá share 404 | **LOCAL PASS** | `revocation` |
| Share phòng mặc định quyền 19 → thành viên ghi đè file của chủ 204 | **FINDING** | `participant.overwrite` |
| Phòng có người khác nhóm (thêm theo uid): share trực tiếp cho Team B 403 nhưng qua phòng Team B đọc 200; xoá phòng thì mất | **FINDING** | `crossGroup` |
| Deny Team B (manager-b, member-b), outsider, ẩn danh với phòng Team A, 1-1 Team A, và Team A/outsider/ẩn danh với Team B: 24 probe mỗi người (GET phòng/thành viên/chat/context, POST chat/reaction, shared items/overview, mentions, share file vào phòng, join phòng, join call, peers, signaling settings/gửi/pull, tự thêm mình, make public, đổi tên, tắt lobby, pin, xoá phòng, avatar, trang `/call/<token>`) | **LOCAL PASS 264/264** (404 ×222, 401 ×12, 403 ×8; `/call` cho người đăng nhập là vỏ app không có dữ liệu phòng 200 ×8, ẩn danh 303 → login ×3; signaling POST 200/null, tin bị bỏ ×11); fixture không đổi; đối chứng dương 6/6 | `verify-acl-live.json` |
| Signaling: kẻ ngoài gửi offer đúng định dạng nhắm session của callee trong lúc gọi → callee chỉ nhận từ đúng caller (1 offer); pull của kẻ ngoài 404 | **LOCAL PASS** | `acceptance-call.json` `rounds[0].intrusion` |
| Link Talk trong lời mời (Calendar → Talk, như `calendar-main.js`): phòng riêng `objectType=event`, chỉ member-a được giải tên → thêm; Team B, đối tác bị bỏ qua; PUT sự kiện có `LOCATION=/call/<token>`; bản của member-a có link; SCHEDULE-STATUS 1.1 cho cả ba (thư iMIP qua mail16 chat16) | **LOCAL PASS** | `acceptance-calendar.json` |
| Ai mở được link: member-a 200/join 200; manager-b, outsider, ẩn danh 404 | **LOCAL PASS** | `linkAccess` |
| Talk → Calendar ("Lên lịch họp" `POST room/{token}/meeting`): sự kiện có link vào lịch chủ + member-a, không tới Team B | **LOCAL PASS** sau khi persona có múi giờ; **FINDING** 500 khi chưa có tuỳ chọn múi giờ | `talkToCalendar`, `scheduleMeetingWithoutUserTimezone` |
| Calendar tuỳ chọn phòng "công khai" (roomType 3 không mật khẩu) dưới `force_passwords` | **400** (UI Calendar sẽ báo lỗi tạo phòng — DOC) | `calendarPublicRoomWithoutPassword` |
| Khách: tạo phòng công khai không mật khẩu 400, make public không/yếu mật khẩu 400, có mật khẩu 200; thành viên thường make public 403 | **LOCAL PASS** | `acceptance-guest.json` |
| Khách vào không mật khẩu 403, sai mật khẩu 403 (6 lần), đúng 200 (actor `guests`); khách đọc/đăng chat, xem shared items; không xem danh sách thành viên (403), không tìm người (401) | **LOCAL PASS** (ghi nhận: khách đọc **toàn bộ lịch sử** trước khi vào) | như trên |
| Người đăng nhập khác nhóm tự vào phòng công khai: không mật khẩu 403, có mật khẩu 200 (self-joined) | **LOCAL PASS** (thiết kế Talk) | `otherTeamSelfJoin` |
| Lobby bật: khách và thành viên thường → chat/đăng/join call/thành viên **412**; moderator 200; tắt lobby → khách 200 | **LOCAL PASS** | `lobby` |
| Đổi mật khẩu: khách đang trong phòng vẫn đọc 200; khách mới với mật khẩu cũ 403 | **LOCAL PASS** (ghi nhận: không đá khách cũ) | `afterPasswordChange` |
| Thêm khách email vào phòng riêng → phòng thành công khai, `hasPassword=false`, người lạ có link vào 200 và đọc tin nội bộ | **FINDING** | `emailGuestMakesRoomPublic` |
| `allowed_groups=[Team A, Team B]`: outsider bị 403 toàn bộ Talk API, không thấy capability spreed; moderator vẫn thêm outsider theo uid (200) và **file share vào phòng vẫn tới outsider qua Files (200)** | **FINDING** (biện pháp chưa đủ); cấu hình đã trả lại `[]` | `hardening-allowed-groups.json` |
| Offboard member-b: `talk:user:transfer-ownership --remove-source-user` → manager-b thành owner phòng dự án, member-b bị gỡ, lịch sử giữ (actorId = uid leaver); `talk:user:remove` gỡ khỏi mọi phòng (kể cả nhóm Team B) | **LOCAL PASS** | `acceptance-offboard.json` |
| Thu hồi app password khi đang dùng 2 thiết bị: thiết bị 1 vẫn 200 tới ≈ **9,4 s** rồi 401; thiết bị 2 vẫn 200 | **LOCAL PASS có trễ** (cache token như chat15/16) | `revoke.timeline` |
| Disable tài khoản: thiết bị 2 nhận **401 ngay** ở Talk OCS (khác DAV chat16: 503); xoá hết token → 401 | **LOCAL PASS** | `afterDisable`, `afterAllTokensDeleted` |
| File do người nghỉ chia sẻ vào phòng **biến mất** với người kế nhiệm sau khi disable | **FINDING** (phải chuyển sở hữu Files trước) | `fileAfterOwnerDisabled` |
| Restart Nextcloud + Redis (volume giữ): status sẵn sàng ≈ 1,8 s, Talk API 200 ≈ 2,1 s; trạng thái 5 persona (phòng, thành viên, hash id + nội dung tin, số file) giống hệt; chat sau restart chạy; deny 264/264 | **LOCAL PASS** | `restart.json`, `state-compare-before-restart-vs-after-restart.json`, `verify-acl-after-restart.json` |
| Backup (maintenance ≈ 36 s, pg_dump + tar volume, SHA-256) → restore stack riêng 18173 → trạng thái giống bản trước backup; chat, file phòng đọc được, Team B 0 share, `force_passwords` + không STUN giữ; deny 264/264 | **LOCAL PASS** | `backup.json`, `state-compare-before-backup-vs-restore.json`, `verify-restore.json`, `verify-acl-restore.json` |
| Flow: event Talk qua `webhook_listeners` | **Không tương thích** (400 ×5 lớp) | `acceptance-flow-events.json` |
| Flow: bot webhook Talk (cài `--no-setup`, bật bằng `occ` cho Team A): 1 lần giao, chữ ký HMAC đúng, chỉ phòng Team A, có nguyên văn tin + uid mention; moderator tự bật bot 400, Team B 404, thành viên xem danh sách bot 403 | **LOCAL PASS** (payload nhạy cảm) | như trên |
| WebRTC 1-1 (2 Chrome) trong phòng Team A, 5 vòng: video + audio đi qua, cặp host/host UDP IP nội bộ | **LOCAL PASS** | `acceptance-call.json` `oneToOne` |
| Gọi nhóm nhỏ 3 người (mesh, 1 khách mật khẩu) | **LOCAL PASS** | `groupCall` |
| UI web Talk thật trong Chrome headless: member mở `/call/<Team A>` thấy phòng (≈ 3,3 s); outsider thấy "Cuộc trò chuyện không tồn tại" | **LOCAL PASS** | `browser-ui.json`, `browser-*-team-a.png` |
| Bấm "Bắt đầu cuộc gọi" trong UI thật (headless, không có micro giả) | **NOT_TESTED** — UI mở hộp thoại thiết bị ("Không có âm thanh/máy ảnh"), cuộc gọi không bắt đầu; WebRTC được kiểm bằng harness nói đúng giao thức signaling nội bộ | `browser-ui.json` `uiCall` |
| TURN (coturn nội bộ) | **NOT_TESTED** — không cần cho trình duyệt cùng máy; không có image coturn offline, không tải | — |
| Điện thoại (Talk iOS/Android), push, 4G/NAT, screenshare qua mạng, recording, SIP, HPB, tải | **NOT_TESTED** (ngoài phạm vi) | — |

## 4. Thời gian thiết lập cuộc gọi (đo, không phải tải)

| Chỉ số (Chrome headless ↔ Chrome headless, cùng máy, signaling nội bộ) | p50 | p95/max |
|---|---:|---:|
| Join call → thấy peer trong `usersInRoom` | 1 163 ms | 1 213 ms |
| Offer → answer về tới caller | ≈ 2 076 ms | 2 088 ms |
| Offer → `connectionState=connected` | **2 109 ms** | 2 140 ms |
| Offer → khung video đầu tiên ở callee | 2 198 ms | 2 228 ms |
| Join call → connected | **3 263 ms** | 3 311 ms |
| Nhóm 3 người: join → cả 3 thấy nhau / offer đầu → đủ mesh | 1 283 ms / **2 290 ms** | — |

Giải thích: signaling nội bộ là long-poll HTTP, server kiểm hàng đợi **mỗi 1 giây**
(DOC `SignalingController::pullMessages`), nên mỗi chặng offer/answer/candidate ≈ 1 s; ICE trên
loopback/LAN chỉ vài ms. Mỗi người trong phòng giữ một PHP worker long-poll tới 30 s; mesh P2P:
mỗi người gửi n-1 luồng. Mạng thật/4G sẽ thêm thời gian ICE và cần TURN.

## 5. Flow (chat14) với Talk

- `webhook_listeners`: `OCA\Talk\Events\{ChatMessageSent,RoomCreated,AttendeesAdded,CallStarted,SystemMessageSent}Event`
  → **400** "not an event class compatible with webhooks" (không lớp nào trong Talk 23 cài
  `IWebhookCompatibleEvent`, DOC).
- Bot webhook Talk là đường thay thế: `occ talk:bot:install --no-setup --feature=webhook` (admin),
  `occ talk:bot:setup <bot> <token>` từng phòng. POST JSON ActivityStreams (`type: Create`,
  `actor.id = users/<uid>`, `target.id = <token>`, `object.content` = **nguyên văn tin nhắn**)
  với `X-Nextcloud-Talk-Random`, `-Signature` = HMAC-SHA256(secret, random + body), `-Backend`.
  Receiver phải kiểm chữ ký, coi nội dung là nhạy cảm và chưa tin cậy, đọc lại bằng quyền runner
  trước khi tác động (bất biến audit). Receiver chat14 chưa có đường nhận Talk (DOC; chưa thêm vì
  chưa có flow nghiệp vụ dùng chat).
- File đính kèm trong chat đi qua Files (thư mục `/Talk` của người gửi) nên event Files của chat14
  vẫn áp dụng (DOC, không chạy lại).
- Kết luận: Talk **làm nguồn được qua bot** (từng phòng, có chữ ký); không dùng `webhook_listeners`.

## 6. Phát hiện và giới hạn

1. **Thêm người khác nhóm vào phòng bỏ qua chính sách chia sẻ** (LOCAL): `addParticipantToRoom`
   (source users/groups) không kiểm `shareapi_only_share_with_group_members` (DOC
   `RoomController.php`); tìm kiếm thì đã ẩn, nhưng uid/group id đã biết (log, sự kiện lịch, API
   khác) là đủ. Hệ quả qua Files: file chia sẻ vào phòng tới người khác nhóm. 1-1 thì có kiểm
   (403). `allowed_groups` chỉ khoá Talk API của outsider, **không** khoá file. Lựa chọn: (a)
   chấp nhận Talk là kênh liên phòng có chủ đích (moderator chịu trách nhiệm), (b) chặn ở reverse
   proxy/patch upstream `POST …/participants` cho người ngoài nhóm, (c) audit định kỳ thành viên
   phòng so với nhóm (bot/poller). Câu hỏi mở cho chủ dự án.
2. **Email guest → phòng công khai không mật khẩu** (LOCAL): đường `source=emails` gọi
   `setType(PUBLIC)` không kiểm `force_passwords` (DOC). Talk gửi thư mời (tới mail16 local).
   `shareapi_allow_links=no` cũng không được Talk xét. Đề xuất: chặn `source=emails` ở reverse
   proxy cho tới khi upstream sửa; báo lỗi upstream.
3. **Quyền mặc định share phòng = 19** (đọc + sửa + chia sẻ lại; Talk UI dùng mặc định): mọi
   thành viên sửa được file gốc và chia sẻ lại. Muốn chỉ đọc phải share perm 1 (LOCAL 403 khi
   ghi) hoặc đổi `shareapi_default_permissions` (ảnh hưởng mọi share, DOC).
4. **Lobby và lịch sử với khách**: lobby là lựa chọn từng phòng; khách có mật khẩu đọc toàn bộ
   lịch sử từ trước khi vào; đổi mật khẩu không đá khách đang trong phòng. Quy trình: phòng khách
   tách riêng, bật lobby, xoá khách sau họp.
5. **Payload bot/thông báo chứa nội dung**: bot nhận nguyên văn; thông báo mention chứa câu chữ
   (push qua push proxy ra Internet — NOT_TESTED, bị tắt khi `has_internet_connection=false`).
6. **Lên lịch họp từ Talk trả 500** khi người dùng chưa có tuỳ chọn múi giờ (chưa từng mở web;
   persona API/OIDC mới). Web UI đặt múi giờ khi đăng nhập; PoC đặt bằng `occ user:setting`.
7. **Calendar "phòng công khai"** không dùng được dưới `force_passwords` (400) — họp có khách
   ngoài phải tạo phòng công khai có mật khẩu trong Talk rồi dán link. Người khác nhóm được mời
   qua lịch nhận link nhưng **không vào được** phòng riêng (404) vì Calendar không giải được tên
   họ (chính sách enumeration) — trùng câu hỏi họp liên phòng chat16.
8. **STUN fallback ra Internet** khi danh sách rỗng; phải `has_internet_connection=false` (hoặc
   STUN/TURN nội bộ). Bản thật cần coturn của mình (UDP/TCP/TLS, IP công khai, chứng chỉ).
9. **Signaling nội bộ 1 s/poll + 1 PHP worker/người**: hợp cho 1-1 và nhóm nhỏ; mesh P2P tăng
   uplink theo số người. Ngưỡng HPB cần đo bằng thiết bị/mạng thật (chat18).
10. **Thu hồi token trễ ≈ 9,4 s** (lặp lại chat15/16); disable → 401 ngay ở Talk OCS.
11. **File của người nghỉ mất khỏi phòng khi disable**: offboard phải `occ files:transfer-ownership`
    (chat13) trước khi khoá; tin nhắn vẫn giữ tên/uid người nghỉ.
12. Người dùng **đã khoá** (manager-a chat13) vẫn hiện là thành viên phòng nhóm (vẫn trong nhóm).
13. Talk chặn tra token sai theo **IP** (429): sau reverse proxy phải có `trusted_proxies`, nếu
    không mọi người chung một IP sẽ bị chặn lẫn nhau (như ghi chú chat16).
14. UI Talk coi `HeadlessChrome` là trình duyệt không hỗ trợ; micro giả không chạy trong Chrome
    headless trên macOS (NotReadableError) — harness dùng audio WebAudio.
15. Signaling POST trả 200/null cho mọi người và âm thầm bỏ tin không thuộc session của người
    gọi (DOC + LOCAL) — không phải lỗ hổng, nhưng không có log từ chối.
16. Quyền hiển thị của file nhận (`permissions` 9/27 ↔ 1/19, bit "xoá khỏi cây của tôi") đổi theo
    cache sau restart; quyền ghi thật không đổi (kiểm ở `readOnlyRoomShare`).
17. Dữ liệu thử còn lại: phòng `talk17-team-a/-b`, 1-1, tin nhắn/file thử trong `/talk17` và
    `/Talk` của persona, sự kiện "Hop tu Talk …" trong lịch personal của successor-a/member-a,
    thư mời trong mail16.

## 7. Bất biến đã giữ

| Bất biến | Cách giữ / bằng chứng |
|---|---|
| ID bất biến | Phòng nhóm gắn group id federated; người theo uid 64-hex; token phòng Talk là định danh phòng (không phải quyền) |
| Không leo thang | Thành viên thường không make public (403), không bật bot (403/400); Team B không đổi tên/lobby/xoá/tự thêm vào phòng Team A (404); reshare thiếu quyền 404; phát hiện 6.1–6.2 là hành vi của moderator, đã ghi |
| Deny Team B/outsider qua Talk API | `verify-acl-*.json` 264/264 (live, sau restart, restore) + file `acceptance-files.json` |
| Không ghi DB/data directory | Chỉ `occ`, OCS/Talk, WebDAV, CalDAV; DB/volume chỉ đọc khi backup; log chỉ đọc khi debug |
| Không tin dữ liệu chưa xác thực | Payload bot chỉ ghi nhận hình dạng + kiểm chữ ký; đề xuất receiver đọc lại bằng quyền runner |
| Không tải URL tuỳ ý / không ra Internet | Egress chỉ trong `install-talk` (≈ 4,9 s); không STUN/TURN; trình duyệt chỉ mở `localhost:18130` |
| Secret | `poc/talk/secrets/` (0600, Git bỏ qua); `scan-secrets.mjs` PASS (12 giá trị, cả tiền tố base64) |

## 8. Cần thiết bị/mạng thật (NOT_TESTED trong chat17)

1. **Talk iOS/Android** đăng nhập Login Flow v2 qua OIDC Authentik: chat, thông báo push (cần push
   proxy hoặc bản tự host), gọi 1-1/nhóm qua **4G/NAT** với **coturn** (UDP 3478, TCP/TLS 443),
   đổi mạng giữa cuộc gọi, rejoin, pin/CPU.
2. **Desktop**: Talk desktop/trình duyệt thật có micro/camera; **screenshare** qua mạng khác;
   mạng công ty có firewall chỉ mở 443.
3. **Quy mô**: số người/cuộc họp thường gặp, số cuộc gọi đồng thời, băng thông uplink văn phòng —
   quyết định HPB (chat18).
4. Khách ngoài thật nhận thư mời Talk (email guest — chặn trước theo 6.2), recording/SIP (đang tắt).

## 9. Lệnh đã chạy

Trong `poc/talk/` (đều PASS lần chạy cuối): `preflight-app-metadata`, `install-talk` (egress tạm
rồi ngắt), `configure-talk`, `mint-app-passwords`, `create-secrets`, `setup-conversations`,
`run-acceptance` (chat, files, guest, calendar, flow-events, call, verify-acl live, offboard,
isolation), `probe-allowed-groups` (cấu hình trả lại), `browser-ui` (không assert; ghi NOT_TESTED
cho nút gọi), `restart-talk17` → `verify-acl after-restart`, `backup-talk17` → `restore-talk17` →
`verify-state snapshot/compare`, `verify-acl restore`, `verify-restore-talk17` → dừng stack restore,
`environment`, `scan-secrets`. Lần đầu `verify-state compare` lệch vì trường hiển thị (link/icon có
host 18130↔18173, bit quyền hiển thị 8) — đã chuẩn hoá các trường đó, chụp lại bản live (không có
ghi mới từ lúc backup) và so khớp lại.

Gate: xem mục 11.

## 10. Đề xuất chat18 và chat19

**Chat18 (Talk HPB/load): chưa nên mở** cho tới khi chủ dự án chốt quy mô họp. Với 1-1 và nhóm
≤ 4–5 người trong LAN, signaling nội bộ + P2P đủ dùng (đo được ≈ 2–3 s thiết lập); tài liệu Talk
khuyến nghị HPB khi nhóm 5–20+ người hoặc nhiều cuộc gọi đồng thời. Việc cần làm trước HPB (có
thể gộp vào pilot nhỏ): coturn thật + thiết bị thật (mục 8), xử lý phát hiện 6.1–6.4. Mở chat18 khi
có câu trả lời: số người tối đa/cuộc họp, số cuộc họp đồng thời giờ cao điểm, tỷ lệ bật video,
uplink văn phòng/chi nhánh. Phạm vi chat18 khi mở: signaling OSS + Janus + NATS + coturn
container nội bộ, đo SFU với n trình duyệt headless (CPU/băng thông/độ trễ), failover signaling,
so sánh với ngưỡng P2P đo ở chat17.

**Chat19 (Assistant AI read-only) — đề xuất phạm vi:** Nextcloud Assistant (bản stable cao nhất cho
33.0.10, preflight như chat14/16/17) + provider **local CPU** (không gọi API ngoài), chỉ tác vụ
đọc/tóm tắt/soạn nháp; corpus Team A/B (Files, Notes/Collectives, Deck, có thể chat Talk) để kiểm
**RAG theo ACL** (Team B/outsider không trích được tài liệu Team A, kể cả qua câu hỏi gián tiếp);
citation trỏ đúng file có quyền; prompt injection trong tài liệu/tin nhắn (không làm lộ hay gọi
tool ghi); audit ai hỏi gì/được trả nguồn nào; tắt mọi tool ghi/gửi/xoá; đo CPU baseline (thời
gian/tác vụ, RAM) và ghi rõ GPU/cost là quyết định human. Không index dữ liệu thật.

## 11. Gate

`pnpm ai:check` (changed gate) trong worktree chat17 (sau `pnpm install --offline --frozen-lockfile`):
**PASS** — guard 44/44, "changed gate; 63 file thay đổi" (chỉ `poc/talk/`, bàn giao này và sổ tay; chạy lại
sau khi sửa sổ tay — xem nhật ký). Không đổi mã BE/FE/hợp đồng nên gate không chạy test
BE/FE/typecheck. `pnpm ai:check:full`: chưa chạy (thay đổi chỉ PoC/tài liệu).
