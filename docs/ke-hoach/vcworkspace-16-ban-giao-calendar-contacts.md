# VCworkspace 16 — Bàn giao Groupware Calendar/Contacts

Ngày kiểm: 2026-10-25. Nhánh `claude/chat16-calendar-contacts` (cắt từ
`claude/chat15-sync-nas`, commit dfc6a28). Phạm vi: PoC **LOCAL** chỉ bằng container trên
stack work13 đang chạy (loopback, persona và dữ liệu giả). Không production, deploy, Google
thật, email thật, đổi MX hay mua dịch vụ; không cài app lên máy Mac, không dùng điện thoại
hay client desktop thật. PoC và bằng chứng: `poc/calendar-contacts/` (README có trình tự chạy
lại), `poc/calendar-contacts/evidence/`. Không đổi mã `apps/`, hợp đồng hay FE.

Cách đọc: **LOCAL PASS** = đã chạy trên runtime local lần này; **DOC** = đọc mã/tài liệu
nhưng chưa chạy; **NOT_TESTED** = chưa có bằng chứng.

## 1. Kết luận

- Calendar 6.6.3, Contacts 8.9.2 và calendar_resource_management 0.12.2 chạy trên Nextcloud
  33.0.10 work13; CalDAV/CardDAV bằng uid 64-hex bất biến + app password. Lịch/sổ địa chỉ
  chia sẻ theo group id Team A/B (đọc-ghi và chỉ đọc), lời mời họp nội bộ + iMIP qua Stalwart
  local (chỉ tới hộp thư `.test`), phòng/tài nguyên có xung đột, múi giờ + DST, lịch lặp có
  ngoại lệ, free/busy không lộ chi tiết, vCard round-trip, sync-token, deny Team B/outsider
  (150/150 probe), offboard, restart, backup/restore có kiểm lại ACL: **LOCAL PASS**.
- Flow chat14: event lịch `OCP\Calendar\Events\CalendarObject*Event` **tương thích webhook**
  (đăng ký được, giao được, lọc theo lịch bằng `eventFilter`), nhưng payload chứa **toàn bộ
  iCalendar, kể cả sự kiện PRIVATE**. Event danh bạ/sổ địa chỉ của DAV **không** tương thích
  (400). Kết luận chat16: Calendar làm nguồn được (receiver chưa nhận lớp này: 422 FLOW-01,
  DOC); **Contacts chỉ làm đích** cho Flow — nếu sau này cần nguồn thì đối soát bằng
  sync-token (đã chứng minh sync-token chạy đúng, mục 3).
- Năm phát hiện phải mang vào thiết kế (chi tiết mục 5):
  1. **Mất cập nhật khi ghi đồng thời**: hai client PUT cùng `If-Match` ETag cùng lúc → **cả
     hai 204**, bản sau ghi đè (10/10 vòng). Tuần tự với ETag cũ thì 412 đúng.
  2. **Link "Chấp nhận" trong thư mời hỏng** khi bật `shareapi_only_share_with_group_members`
     (chính sách chat13): trang báo lỗi, organizer không nhận trả lời. Tắt chính sách thì
     chạy. Link là GET công khai: trình quét link của hộp thư có thể tự "chấp nhận".
  3. **Sổ địa chỉ hệ thống mặc định lộ toàn bộ người dùng** (outsider thấy Team A/B, kể cả
     `admin13`) dù đã bật "chỉ chia sẻ trong nhóm". Phải bật thêm
     `shareapi_restrict_user_enumeration_to_group=yes` (+ `..._full_match=no`).
  4. **Người khác nhóm bị coi là khách ngoài**: mời Team B từ Team A → không giao nội bộ mà
     gửi thư iMIP; free/busy chéo nhóm trả "3.7 Could not find principal".
  5. **CONFIDENTIAL chỉ bị che với người được chia sẻ chỉ đọc**; người có quyền ghi thấy đủ
     tiêu đề/địa điểm/mô tả (DOC + LOCAL). PRIVATE ẩn với mọi người được chia sẻ.

## 2. Runtime

| Thành phần | Phiên bản / nơi chạy | Bằng chứng |
|---|---|---|
| Nextcloud | 33.0.10, container work13 (image `vcworkspace-sync15/nextcloud-smb:33.0.10-1` của chat15, volume giữ nguyên) | `environment.json` |
| Calendar / Contacts / calendar_resource_management | **6.6.3** (`>=32 <=35`) / **8.9.2** (`>=33 <=36`) / **0.12.2** (`>=31 <=35`), bản stable cao nhất App Store cho 33.0.10 ngày 2026-10-25, ký số, `integrity:check-app` PASS | `app-metadata-preflight.json`, `apps.json` |
| dav / contactsinteraction (bundled) | 1.36.1 / 1.14.1 | `apps.json` |
| Stalwart chat16 `mail16` | 0.16.27, cùng digest chat07 (`sha256:c429b311…836c`), **volume mới** `vcworkspace_cal16_mail_data`, chỉ ở mạng internal work13; host chỉ qua `127.0.0.1:18160` (HTTP/JMAP) | `stalwart-config.json`, `isolation.json` |
| Gửi thư Nextcloud | SMTP 465 SSL có xác thực `calendar@vcworkspace.test` → `mail16` (mật khẩu qua `occ config:import` stdin); bỏ kiểm chứng chỉ tự ký (chỉ PoC) | `nextcloud-config.json` |
| Webhook | `webhook_listeners` 1.5.0 + worker chat14 (`--interval=1`) → hook-sink nội bộ work13 | `acceptance-flow-events.json` |
| Restore | project `vcworkspace-cal16-restore`, `localhost:18163` (Nextcloud) + `127.0.0.1:18164` (Stalwart), volume `vcworkspace_cal16_restore_*` | `verify-restore.json` |

Cô lập (`isolation.json`): mạng work13 `internal: true`; probe từ mạng đó tới `1.1.1.1:443`
và MX Gmail cổng 25 đều bị chặn; hàng đợi gửi ra của Stalwart rỗng; Nextcloud không còn nối
`host_edge` sau khi cài app. Miền giả: `team-a.test`, `team-b.test`, `outsider.test`,
`partner.test`, `vcworkspace.test` (11 hộp thư thử, kể cả hộp của phòng/máy chiếu để quan sát).

Persona (uid bất biến từ chat13): successor-a (chủ lịch Team A), member-a (Team A),
manager-b (chủ lịch Team B, người kế nhiệm), member-b (Team B, người nghỉ việc), outsider
(email `manager-a@outsider.test`). manager-a vẫn ở trạng thái offboard của chat13.

Chính sách thư mục người dùng sau chat16 (`acceptance-contacts.json`):
`shareapi_only_share_with_group_members=yes` (chat13), **mới**
`shareapi_restrict_user_enumeration_to_group=yes`, `shareapi_restrict_user_enumeration_full_match=no`.

## 3. Ma trận nghiệm thu

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Lịch chia sẻ nhóm: member-a thấy `cal16-team-a` (đọc-ghi) và `cal16-team-a-thongbao` (chỉ đọc) qua `*_shared_by_<uid>`; Team B/outsider không thấy | **LOCAL PASS** | `acceptance-calendar.json` `shared` |
| Đọc-ghi: member-a tạo sự kiện, chủ đọc được; chỉ đọc: PUT/DELETE của member-a 404, không tạo/xoá gì | **LOCAL PASS** | như trên |
| ETag: ghi tuần tự bằng ETag cũ → PUT/DELETE 412, `If-None-Match: *` trên bản có sẵn 412 | **LOCAL PASS** | `etagConflict.sequential` |
| Ghi **đồng thời** cùng ETag (10 vòng) | **FAIL (phát hiện)**: 10/10 vòng cả hai 204 — mất một bản | `etagConflict.concurrentSameEtag10Rounds` |
| PRIVATE trong lịch chia sẻ: ẩn với người được chia sẻ (GET 404, không có trong query/sync) | **LOCAL PASS** | `classification` |
| CONFIDENTIAL: chỉ đọc → "Busy", không địa điểm/mô tả; đọc-ghi → thấy đủ | **LOCAL PASS** chỉ đọc; đọc-ghi là thiết kế Nextcloud (phát hiện 5) | như trên |
| Lịch lặp tuần ×6 + EXDATE + 1 lần đổi giờ (RECURRENCE-ID), sau đó huỷ 1 lần (STATUS:CANCELLED) — expand phía server đúng 5 lần, đúng giờ UTC | **LOCAL PASS** | `recurrence` |
| Múi giờ: họp 09:00 New York hằng tuần qua mốc hết DST 2026-11-01 → 13:00Z, 13:00Z, 14:00Z, 14:00Z (HCM 20:00 → 21:00); 09:00 HCM luôn 02:00Z | **LOCAL PASS** | `timezones` |
| DST biên: 2026-03-08 02:30 NY (không tồn tại) → 07:30Z (= 03:30 EDT); 2026-11-01 01:30 NY (lặp) → 05:30Z (lần EDT đầu) | **LOCAL PASS** (ghi nhận hành vi) | như trên |
| CalDAV sync-token: thêm/sửa/xoá đúng 1 thay đổi mỗi lần, không đổi → rỗng; token rác 403 `valid-sync-token`; token "tương lai" 207 rỗng; Team B dùng token hợp lệ 404 | **LOCAL PASS** | `syncToken` |
| Free/busy qua outbox (cách attendee picker của Calendar làm): Team A thấy khoảng bận của đồng đội, **không** có SUMMARY/LOCATION/DESCRIPTION/CLASS/attendee khác; Team B, outsider → "3.7 Could not find principal" (không có khoảng bận); giả organizer → 403; `free-busy-query` trên lịch Team A bởi Team B → 404 | **LOCAL PASS** | `freeBusy` |
| Lời mời: Team A mời member-a (giao nội bộ vào `personal` sau ≈ 45 ms, **kèm cả thư**), manager-b (khác nhóm → **thư iMIP**), partner ngoài (thư iMIP `METHOD:REQUEST`, From `calendar@vcworkspace.test`, Reply-To organizer), phòng P301, máy chiếu | **LOCAL PASS** | `acceptance-scheduling.json` `invitation` |
| Trả lời qua CalDAV (member-a đổi PARTSTAT bản của mình) → bản organizer ACCEPTED | **LOCAL PASS** | `replies` |
| Trả lời qua link "Chấp nhận" trong thư (ẩn danh) | **FAIL với chính sách nhóm** (trang lỗi, PARTSTAT không đổi); **LOCAL PASS** khi tạm tắt `shareapi_only_share_with_group_members` (đã bật lại) | `replies.partnerAcceptLink` |
| Phòng: P301 tự nhận lịch trống, **tự từ chối** khi trùng giờ; Team B đặt P301 (giới hạn Team A) → không nhận (NEEDS-ACTION, không thư); P302 chung: Team B đặt trước được, Team A trùng giờ bị từ chối; huỷ họp → khung giờ trống lại | **LOCAL PASS** | `rooms`, `updateCancel` |
| Free/busy phòng với Team B: P301 "không tìm thấy", P302 chỉ khoảng bận; lịch của phòng không liệt kê được (404) | **LOCAL PASS** | `rooms.roomFreeBusyAsTeamB` |
| Đổi giờ (SEQUENCE 1) → partner/manager-b nhận "Invitation updated", bản của member-a dời giờ; xoá → `METHOD:CANCEL`, bản member-a `STATUS:CANCELLED` | **LOCAL PASS** | `updateCancel`, `mailboxes` |
| Thư chỉ tới hộp `.test` local; hộp phòng/máy chiếu không nhận thư; hàng đợi ra rỗng | **LOCAL PASS** | `mailboxes`, `isolation.json` |
| Sổ địa chỉ hệ thống, mặc định: mọi persona (cả outsider) thấy 6 thẻ gồm Team A/B, outsider, admin13 | **FAIL mặc định (phát hiện 3)** | `acceptance-contacts.json` `directory.defaultsSnapshot` |
| Sổ địa chỉ hệ thống sau chính sách nhóm: member-a thấy member-a/successor-a; manager-b thấy Team B; outsider chỉ thấy chính mình; GET thẻ ẩn 403; sync-collection ban đầu và tăng dần (sau khi thẻ member-a đổi) không lộ href ẩn, Team A thì thấy thay đổi | **LOCAL PASS** | `directory.restricted`, `outsiderIncrementalAfterHiddenCardChange` |
| Tìm người như UI (autocomplete OCS, sharees, unified search, contacts menu, attendee autocomplete của Calendar, principal-property-search): 0 kết quả chéo nhóm (kể cả tìm đúng email); đối chứng dương cùng nhóm tìm thấy | **LOCAL PASS** (cả mặc định lẫn sau chính sách) | `directory.*.search` |
| Sổ địa chỉ nhóm Team A (đọc-ghi): member-a thêm thẻ, chủ đọc; Team B/outsider không thấy | **LOCAL PASS** | `groupAddressBook` |
| vCard 3.0 tiếng Việt (N/FN/ORG/ADR có dấu, 2 EMAIL, 2 TEL, NOTE có `\n` `\,` `\;`, CATEGORIES, PHOTO base64, X-) | **LOCAL PASS**: round-trip không mất dòng | `vcard.v3` |
| vCard 4.0 | **LOCAL PASS** với `Accept: text/vcard; version=4.0` (giữ nguyên); GET không Accept → Nextcloud trả 3.0 (đổi `PHOTO` data-URI, `PREF`, `TEL VALUE=uri`) | `vcard.v4*` |
| Export `?export` + import lại từng thẻ vào sổ khác: FN và ảnh giữ nguyên | **LOCAL PASS** | `vcard.export`, `reimport` |
| CardDAV sync-token + If-Match (ETag cũ 412) | **LOCAL PASS** | `acceptance-contacts.json` `syncToken` |
| Deny Team B (manager-b, member-b), outsider, ẩn danh với lịch/sổ Team A và Team A với Team B: 30 probe mỗi bên (PROPFIND, GET, đường dẫn share giả, `?export`, calendar-query, sync-collection, free-busy, PUT/ghi đè/DELETE/MOVE, PROPPATCH, ACL, tự share cho mình/nhóm mình, endpoint `/remote.php/caldav|carddav` cũ, unified search) | **LOCAL PASS 150/150**: 404 (người đăng nhập), 401 (ẩn danh), search 200 rỗng; fixture không đổi ETag; đối chứng dương đạt | `verify-acl-live.json` |
| Offboard member-b: export lịch bằng `occ calendar:export` (không cần credential người nghỉ), sổ địa chỉ bằng token của chính họ trước khi thu hồi; `occ dav:move-calendar` → manager-b (giữ share Team B, sự kiện); nhập thẻ vào sổ mới của manager-b | **LOCAL PASS** | `acceptance-offboard.json` |
| Thu hồi app password bằng `occ` khi đang dùng 2 thiết bị | **LOCAL PASS có trễ**: thiết bị 1 vẫn 207 tới ≈ 9 s rồi 401 (cache token như chat15); thiết bị 2 vẫn 207 | `revoke.timeline` |
| Disable tài khoản | **LOCAL PASS**: thiết bị 2 nhận **503** ngay (CalDAV + CardDAV); xoá hết token → 401 sau ≈ 8,8 s | `revoke.afterDisable`, `device2AfterAllTokensDeleted` |
| Sau chuyển: sự kiện do member-b tổ chức vẫn `ORGANIZER = member-b` ở bản chủ mới và bản của người được mời | **Phát hiện** (mục 5.6) | `readback` |
| Restart Nextcloud + Redis + Stalwart (`docker restart`, volume giữ): sẵn sàng sau ≈ 2,8 s / 6,3 s; số thư giữ nguyên; ma trận deny lặp lại 150/150; toàn bộ acceptance chạy lại PASS sau restart | **LOCAL PASS** | `restart.json`, `verify-acl-after-restart.json` |
| Backup (maintenance mode ≈ 35 s; Stalwart dừng ≈ 1,4 s để chép RocksDB) → restore stack riêng → 5 bộ sưu tập giống hệt (sync-token, href + ETag, sharees), share của member-a, phòng/tài nguyên, chính sách danh bạ, số thư; lời mời mới trên bản restore đi qua Stalwart restore; ma trận deny 150/150 | **LOCAL PASS** | `backup.json`, `verify-restore.json`, `verify-acl-restore.json` |
| Flow: event lịch webhook | **LOCAL PASS** (mục 4) | `acceptance-flow-events.json` |
| Client thật: iOS/macOS Calendar, Android DAVx⁵, Thunderbird, Outlook (CalDAV Synchronizer) | **NOT_TESTED** (không có thiết bị/container client trong máy; không cài app lên Mac) | — |
| UI trình duyệt Calendar/Contacts (đăng nhập OIDC) | **NOT_TESTED** trong chat16 — đã kiểm bằng chính các request UI gửi (CalDAV/CardDAV + OCS/route app) với cùng persona | — |

## 4. Flow (chat14): event Calendar/Contacts

| Lớp event | Đăng ký `webhook_listeners` | Giao | Ghi chú |
|---|---|---|---|
| `OCP\Calendar\Events\CalendarObjectCreatedEvent` / `Updated` / `Deleted` / `MovedToTrash` | 200 (4/4) | Created ×3, Updated ×1, MovedToTrash ×2 (xoá đi vào thùng rác lịch nên **không** có `Deleted`) | payload: `calendarId`, `calendarData` (uri, principaluri, displayname, sync-token…), `shares` (có group id), `objectData` (uid, etag, classification, **calendardata đầy đủ**), `user.uid` = người thao tác (member-a khi ghi qua share); không có `Content-Type`; có trường `authentication` như chat14 |
| `OCA\DAV\Events\CardCreatedEvent`, `CardUpdatedEvent`, `AddressBookUpdatedEvent`, `OCA\DAV\Events\CalendarObjectCreatedEvent` | **400** "not an event class compatible with webhooks" | — | |

- `eventFilter` theo `event.calendarData.principaluri` + `event.calendarData.uri` giới hạn đúng
  một lịch (không cần đọc DB để lấy id): sự kiện của Team B và bản sao lời mời trong lịch
  `personal` của member-a **không** được gửi.
- Sự kiện **PRIVATE** vẫn đi kèm toàn bộ nội dung trong payload → receiver/hệ thống nhận
  webhook là nơi giữ dữ liệu nhạy cảm; luôn lọc theo lịch, và receiver phải coi payload là
  dữ liệu chưa tin cậy, đọc lại qua CalDAV bằng quyền runner trước khi tác động (bất biến audit).
- Receiver chat14 hiện từ chối lớp lịch (allowlist → 422 `FLOW-01`, DOC đọc
  `apps/api/src/modules/flow/flow.service.ts`); giới hạn thân 256 KB có thể chặn sự kiện có
  mô tả/đính kèm lớn. Chưa thêm vì chưa có flow nghiệp vụ dùng lịch (đề xuất ở mục 8).
- Contacts: **chỉ làm đích**. Nếu cần nguồn: đối soát bằng `REPORT sync-collection` với quyền
  runner (sync-token đã chứng minh đúng add/modify/delete, token sai 403 → chụp lại gốc).

## 5. Phát hiện và giới hạn

1. **Lost update CalDAV/CardDAV khi ghi đồng thời** (10/10 vòng, LOCAL): `If-Match` được kiểm
   rồi ghi mà không khoá; hai thiết bị sửa cùng lúc đều nhận 204 và ETag mới, một bản biến
   mất. Khác Files (chat15 có khoá 423). Rủi ro thấp với lịch cá nhân, đáng kể với lịch phòng
   dùng chung; client thật thường có resync. Cần báo upstream; NOT_TESTED với client thật.
2. **Link "Chấp nhận/Từ chối" iMIP + chính sách "chỉ chia sẻ trong nhóm"**: controller công
   khai gọi `Principal::findByUri()`, hàm trả `null` khi chính sách bật mà không có phiên người
   dùng (DOC `apps/dav/lib/Connector/Sabre/Principal.php`) → organizer "không tìm thấy" →
   trang lỗi (LOCAL). Tạm tắt chính sách thì link chạy (LOCAL); trong lúc tắt, lời mời của
   manager-b được giao nội bộ (SCHEDULE-STATUS 1.2) — tác dụng phụ đã ghi. Lựa chọn: khách
   ngoài trả lời bằng ứng dụng thư (iMIP REPLY tới Reply-To — cần Mail app/IMAP xử lý, NOT_TESTED),
   hoặc bỏ chính sách nhóm và dựa vào `restrict_user_enumeration_to_group`. Link là GET công
   khai không xác nhận: máy quét link có thể "chấp nhận" thay người nhận.
3. **Sổ địa chỉ hệ thống mặc định lộ toàn bộ người dùng** (LOCAL), kể cả khi tìm kiếm/
   autocomplete đã bị chặn chéo nhóm: client CardDAV (điện thoại) sẽ đồng bộ cả công ty và
   outsider. Bắt buộc `shareapi_restrict_user_enumeration_to_group=yes`; `..._full_match=no`
   để không tra được bằng đúng email. Chưa có cách ẩn riêng một người khỏi sổ hệ thống ngoài
   cơ chế nhóm (DOC).
4. **Khác nhóm = khách ngoài** với `only_share_with_group_members=yes`: lời mời Team A → Team B
   đi bằng thư (Team B không có bản tự động trong lịch, trả lời bằng link — vướng mục 2);
   free/busy chéo nhóm không có. Nếu công ty cần họp liên phòng thường xuyên, cần quyết định
   chính sách (câu hỏi mở).
5. **Phân loại**: PRIVATE ẩn với mọi sharee; CONFIDENTIAL chỉ che với sharee chỉ đọc (đọc-ghi
   thấy đủ, DOC `CalendarObject::get`). Lịch nhóm đọc-ghi không dùng được để giữ bí mật.
6. **Chuyển lịch người nghỉ không đổi ORGANIZER**: sự kiện do leaver tổ chức vẫn ghi organizer
   là leaver (bản chủ mới và bản người được mời); sửa/huỷ về sau sẽ gửi iMIP nhân danh địa chỉ
   cũ, trả lời của người được mời đi về địa chỉ leaver. Quy trình offboard nên: huỷ/tạo lại
   họp định kỳ do người kế nhiệm tổ chức. Sổ địa chỉ: không có lệnh `occ` export/move, phải
   export bằng CardDAV **trước** khi thu hồi token (hoặc chia sẻ cho người kế nhiệm).
7. **Thu hồi token trễ ≈ 9 s** và **disable → 503** (lặp lại chat15): client CalDAV/CardDAV
   hiểu 503 là bảo trì và thử lại; offboard phải xoá token (đã kiểm: 401 sau ≈ 8,8 s).
8. **Thành viên nội bộ nhận cả thư** lời mời/cập nhật/huỷ (ngoài bản giao nội bộ) — cần biết
   khi bật mail thật (số thư tăng). Thư iMIP chứa đủ tiêu đề/địa điểm/mô tả gửi tới khách ngoài.
9. **Tên phòng bị giới hạn vẫn liệt kê được** qua `PROPFIND principals/calendar-rooms` với mọi
   người dùng (outsider thấy "Phong hop P301 (Team A)"); tìm/đặt/free-busy thì bị chặn.
10. **Server ở UTC, không đặt `default_timezone`**: thông báo "7h behind" trong contacts menu;
    lịch dùng TZID của sự kiện nên kết quả đúng; múi giờ người dùng NOT_TESTED trên UI.
11. Link trong thư lấy host theo request (PoC gọi qua `localhost:18130`); bản thật cần
    `overwrite.cli.url`/`overwritehost` đúng tên miền.
12. Stalwart PoC dùng chứng chỉ tự ký; Nextcloud đặt `verify_peer=false` cho SMTP (chỉ PoC).
13. Dữ liệu thử còn lại: lịch `cal16-member-b-*` đã chuyển cho manager-b qua các lần chạy,
    sổ `ab16-from-member-b-*`, sự kiện trong thùng rác lịch, thư thử trong Stalwart chat16.

## 6. Bất biến đã giữ

| Bất biến | Cách giữ / bằng chứng |
|---|---|
| ID bất biến | Đường dẫn DAV theo uid 64-hex, share theo group id federated, phòng theo uid `vcw-room-*`; email chỉ là địa chỉ lịch |
| Không leo thang | Tự share/ACL/PROPPATCH/MOVE trên tài nguyên đội khác 404; phòng giới hạn Team A không đặt được bởi Team B; giả organizer free/busy 403 |
| Deny Team B/outsider qua API kiểu UI và CalDAV/CardDAV trực tiếp | `verify-acl-*.json` (live, sau restart, restore), `acceptance-contacts.json` |
| Không ghi DB/data directory Nextcloud | Chỉ `occ`, CalDAV/CardDAV, OCS; DB/volume chỉ đọc khi backup; log chỉ đọc khi debug |
| Không tin dữ liệu chưa xác thực | Payload webhook lịch chỉ ghi nhận hình dạng, không dùng để quyết định; đề xuất readback CalDAV |
| Quyết định quyền ở điểm cuối | Nextcloud kiểm ở từng request DAV; khuyến nghị receiver đọc lại bằng quyền runner |
| Không tải URL tuỳ ý | Script chỉ bấm link trong thư sau khi kiểm host là Nextcloud của PoC |
| Secret | `poc/calendar-contacts/secrets/` (0600, Git bỏ qua); `scan-secrets.mjs` PASS 19 giá trị / 104 file |

## 7. Cần thiết bị thật (NOT_TESTED trong chat16)

1. **iOS/iPadOS Calendar + Contacts** (CalDAV/CardDAV account bằng app password từ Login Flow v2
   qua OIDC Authentik): đồng bộ lịch nhóm, PRIVATE/CONFIDENTIAL hiển thị, trả lời lời mời,
   múi giờ thiết bị khác HCM, xoá token → thời gian client báo lỗi, phản ứng với 503.
2. **Android DAVx⁵** + ứng dụng lịch/danh bạ: sync-token thật, sổ địa chỉ hệ thống sau chính
   sách nhóm, ảnh vCard, nhóm danh bạ.
3. **macOS Calendar/Contacts, Thunderbird, Outlook** (CalDAV Synchronizer hoặc kết nối
   tương đương): lời mời từ khách ngoài (iMIP REPLY bằng ứng dụng thư), phòng họp, sửa đồng
   thời hai thiết bị (mục 5.1).
4. **Thư thật**: định dạng thư mời trên Gmail/Outlook của đối tác, link chấp nhận, SPF/DKIM
   cho `calendar@` — chỉ sau khi có tên miền/MX (ngoài phạm vi PoC).

## 8. Lệnh đã chạy và kiểm repo

Trong `poc/calendar-contacts/` (đều PASS lần chạy cuối): `create-secrets`,
`preflight-app-metadata`, `install-apps` (tải 3 app có cờ cho phép, tạm nối egress rồi ngắt),
`up-cal16 up -d`, `configure-stalwart`, `configure-nextcloud`, `mint-app-passwords`,
`setup-resources`, `setup-collections`, `acceptance-calendar`, `acceptance-scheduling`,
`acceptance-contacts`, `verify-acl live`, `acceptance-flow-events`, `acceptance-offboard`,
`restart-cal16` → `verify-acl after-restart`, `backup-cal16`, `verify-restore-cal16 snapshot`,
`restore-cal16` (tạo lại 1 lần do so khớp bị lệch thứ tự khoá, đã sửa so sánh), `verify-restore-cal16
compare`, `verify-acl restore`, `verify-isolation`, `environment`, `scan-secrets`. Chạy lại toàn bộ
acceptance sau restart: PASS.

- `pnpm ai:check`: xem mục 10.
- Không đổi `apps/`, `contract/`; không cần test BE/FE mới (không có thay đổi mã sản phẩm).

Trạng thái để lại: stack work13 + flow14 + sync15 + overlay `vcworkspace-cal16` (`mail16`,
`mail16-relay`) đang chạy; stack restore cal16 đã dừng (giữ volume); không còn webhook chat16;
member-b đã bật lại với token `cal16-dav` mới; chính sách danh bạ theo nhóm **đang bật** trên
work13; cấu hình SMTP của Nextcloud trỏ `mail16`.

## 9. Đề xuất phạm vi chat17 (Talk nhỏ)

1. Bật Talk (spreed) bản stable cao nhất cho 33.0.10 (preflight chữ ký như chat14/16), chỉ
   **chat + gọi 1-1/nhóm nhỏ trong LAN Docker**, không HPB/TURN công khai; nếu cần TURN thì
   coturn container nội bộ, không mở cổng ra ngoài.
2. Phòng chat theo nhóm Team A/B (conversation gắn group id), phòng 1-1, khách ngoài bị tắt;
   deny Team B/outsider qua OCS Talk API và UI-equivalent; tìm người tôn trọng chính sách
   enumeration theo nhóm vừa bật ở chat16.
3. Chia sẻ file Files vào chat (quyền theo share), mention, thông báo trong ứng dụng; tích hợp
   Calendar: "tạo cuộc gọi cho sự kiện" (link Talk trong lời mời), phòng họp chat16.
4. Offboard (xoá khỏi phòng, chuyển quyền moderator), restart, backup/restore có kiểm ACL;
   event Talk có tương thích webhook không (Flow chat14), nếu không thì kết luận chỉ đích.
5. Media/WebRTC: chỉ đo kết nối 2 trình duyệt headless trong máy (NOT_TESTED với mạng thật,
   điện thoại, NAT); không HPB, không recording, không SIP.

## 10. Gate

`pnpm ai:check` (changed gate) trên bản cuối trong worktree chat16: **PASS** — guard 44/44,
59 file thay đổi (chỉ `poc/calendar-contacts/`, bàn giao này và sổ tay), không có mã BE/FE
nên gate không chạy test BE/FE/typecheck. `pnpm ai:check:full`: chưa chạy (không có thay đổi
mã sản phẩm; chạy khi tích hợp nhánh).
