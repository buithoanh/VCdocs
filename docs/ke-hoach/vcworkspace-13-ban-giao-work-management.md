# VCworkspace 13 — Bàn giao Work management

Ngày kiểm: 2026-10-25. Nhánh `claude/chat13-work-management-d67500` (cắt từ nhánh
sửa audit 12/12, commit 98f8025). Phạm vi: PoC **LOCAL** cô lập, persona và dữ
liệu giả; không production, deploy, Google thật, gửi thư hay mua dịch vụ.
Mã và bằng chứng: `poc/work-management/` (README có trình tự chạy lại).

## 1. Kết luận

Năm app Work management của Nextcloud 33 chạy được cho hai phòng giả với OIDC
Authentik, và **LOCAL PASS** các mục ma trận áp dụng được: share theo nhóm,
ACL, comment, attachment, chặn Team B/outsider qua cả UI lẫn API trực tiếp,
tìm kiếm không lộ chéo, export, chuyển quyền sở hữu/offboard, restart và
backup/restore có kiểm lại ACL. Một số ô là **N/A** vì app không có tính năng đó
(Forms/Tables không có comment, Tables không có upload file).

Với Flow (chat14): Forms, Tables và Files phát event dùng được qua
`webhook_listeners`; **Deck 1.17.8 không có event tương thích webhook**, và bộ
lọc `userIdFilter` không bắn cho request API bằng app password (phải dùng
`eventFilter`). Chi tiết ở mục 5.

Đây không phải parity với Jira, Notion hay Google Sheets: không đo tính năng
nâng cao, hiệu năng, mobile hay đồng biên tập nhiều người.

## 2. Runtime

| Thành phần | Phiên bản | Nguồn/kiểm |
|---|---|---|
| Nextcloud | 33.0.10, digest ARM64 `431d389f…d7df33` (như chat12) | `nextcloud-config.json` |
| Authentik | 2026.8.5, digest `c0ce79a3…3e3a1` | compose |
| PostgreSQL / Redis | 18.1 / 8.2.3 Alpine (digest như chat12) | compose |
| Deck / Notes / Forms / Tables / Collectives | 1.17.8 / 6.1.0 / **5.4.1** / 2.3.2 / 4.7.1 | App Store API platform 33.0.10, kiểm 2026-10-25 |
| user_oidc | 8.11.0 | như trên |
| Bundled | circles 33.0.0, text 7.0.1, comments, activity, admin_audit, webhook_listeners 1.5.0 | `occ app:list` |

- Forms lên 5.4.1 (phát hành 2026-10-22) thay 5.3.6 ghi trong lộ trình chat11:
  đây là bản stable cao nhất cho 33.0.10 ngày kiểm. Range Collectives nay là
  `>=32 <=35`. Preflight lấy bản stable cao nhất, ghi vào
  `app-metadata-preflight.json`; `configure-nextcloud.mjs` từ chối nếu bản cài lệch.
- `occ integrity:check-app` PASS cho cả 6 app store.
- Stack mới hoàn toàn: project `vcworkspace-work13`, volume `vcworkspace_work13_*`,
  cổng 18130 (Nextcloud), 18131 (Authentik), 18133 (restore). Không đụng volume
  hay container của chat02–12B.
- Cô lập: container ứng dụng chỉ ở mạng Docker `internal`; probe ra Internet
  trả exit 6; relay chỉ bind `127.0.0.1`, không mount secret (`isolation.json`).
  Chỉ bước bootstrap tải app mới tạm nối egress, rồi ngắt trong `finally`.
- Personas (Authentik → Nextcloud qua OIDC): manager-a, member-a, successor-a
  (Team A); manager-b, member-b (Team B); outsider (nhóm `vcw-outsiders`, email
  cố ý trùng local-part với manager-a). Mọi share/ACL/script dùng user ID
  64-hex bất biến và group ID federated, không dùng username hay email.
- Chia sẻ: chỉ trong nhóm của mình, tắt public link.

## 3. Ma trận nghiệm thu

| Hạng mục | Deck | Notes | Forms | Tables | Collectives |
|---|---|---|---|---|---|
| Share cho nhóm Team A | LOCAL PASS (ACL nhóm, edit) | LOCAL PASS (share thư mục category, đọc+sửa) | LOCAL PASS (share nhóm, quyền submit) | LOCAL PASS (đọc/tạo/sửa, không xoá/quản lý) | LOCAL PASS (nhóm là thành viên Team/circle) |
| ACL trong nhóm | member không re-share được (403) | sửa qua WebDAV, chủ thấy thay đổi | member chỉ thấy bài của mình, export CSV 403 | member xoá/re-share 403 | member tạo trang, sửa qua WebDAV |
| Comment | LOCAL PASS | LOCAL PASS (Files comments) | N/A | N/A | LOCAL PASS (Files comments trên trang) |
| Attachment | LOCAL PASS (SHA-256 khớp) | LOCAL PASS (ảnh, SHA-256 khớp) | LOCAL PASS (câu hỏi file, có uploadToken) | N/A (chỉ có cột link) | LOCAL PASS |
| Team B + outsider, API trực tiếp | 8/8 deny | 9/9 deny | 9/9 deny | 10/10 deny | 11/11 deny |
| Team B + outsider, UI trình duyệt | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS |
| Tìm kiếm hợp nhất | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS |
| Export | `occ deck:export` JSON | Markdown | CSV | scheme + rows JSON (API) | zip thư mục qua WebDAV (kèm attachment) |
| Chuyển sở hữu + offboard | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS |
| Restart | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS |
| Backup/restore + ACL | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS | LOCAL PASS |
| Event cho Flow | **Không có** (đăng ký bị từ chối) | LOCAL PASS (event Files) | LOCAL PASS | LOCAL PASS | Chưa thử riêng (trang là file, dự kiến event Files) |

Deny probe gồm đọc/sửa/tạo/xoá, comment, tải attachment, đọc share và tự cấp
quyền cho chính mình; tất cả ≥400 và không có marker trong body. Danh sách
(board/note/form/table/collective) của Team B và outsider không chứa tài nguyên Team A.

### Bằng chứng (`poc/work-management/evidence/`)

| Mục | File |
|---|---|
| Preflight app, cấu hình, cô lập | `app-metadata-preflight.json`, `nextcloud-config.json`, `isolation.json` |
| Personas và binding ID | `provisioning.json`, `identity-bindings.json` |
| Từng app | `acceptance-{deck,notes,forms,tables,collectives}.json` |
| Trình duyệt | `browser-ui.json`, `browser-*.png` (manager-a, member-a, outsider với Deck/Forms) |
| Tìm kiếm, event | `acceptance-search.json`, `acceptance-events.json` |
| Restart | `restart.json` (9 container), `verify-acl-after-restart.json` |
| Export, backup, restore | `export.json`, `backup.json` (SHA-256), `verify-acl-restore.json`, `restore-readback.json` |
| Offboard | `acceptance-offboard.json`, `browser-offboard.json`, `browser-offboard-*.png` |

## 4. Chi tiết theo nhóm kiểm

**Tìm kiếm.** 14 provider (deck card/comment, notes, forms, tables,
collectives/pages/page-content, files, comments, circles…). Manager-a và
member-a thấy marker của cả 5 app; manager-b và outsider 0 kết quả trên mọi
provider. Nội dung trang Collectives cần `occ collectives:index` trước.

**Chuyển sở hữu và offboard** (manager-a rời, successor-a nhận):
Deck `occ deck:transfer-ownership --remap` (lệnh hỏi xác nhận, script trả lời
`y`); Tables `occ tables:owner`; Forms PATCH `ownerId` bằng API của chủ cũ;
Collectives thêm successor làm thành viên Team rồi nâng level owner; Files/Notes
`occ files:transfer-ownership --use-user-id`. Sau đó vô hiệu user ở Authentik,
xoá phiên Authentik, `occ user:disable`, xoá mọi app password/token.
Readback: app password cũ 401; browser manager-a dừng ở form đăng nhập
Authentik; successor là owner của board/table/form/team, thấy toàn bộ bài nộp
Forms, sửa được board; member-a vẫn dùng đủ 5 app (kể cả note share đã chuyển
chủ); outsider vẫn bị chặn.

**Restart.** `docker compose restart` cả 9 container; readback ACL API đủ
5 app, ma trận browser và kiểm cô lập đều chạy lại sau restart.

**Backup/restore.** Backup trong maintenance mode: dump PostgreSQL Nextcloud và
Authentik, tar volume Nextcloud (777 MB, gồm data). Restore sang stack riêng
(volume, mạng, cổng 18133). Phải tạo lại role DB `oc_admin` do installer
Nextcloud sinh (role là đối tượng cluster, không nằm trong `pg_dump`): script
đọc `config.php` đã khôi phục, không in giá trị. Trên bản restore: Nextcloud
và 12 app cùng version, 6 persona có mặt theo ID, readback ACL đủ 5 app
(cùng ma trận cho phép/chặn như bản gốc, hash attachment Deck khớp).

## 5. Event và API cho Flow (chat14)

Probe dùng `webhook_listeners` (bundled), sink HTTP trong mạng nội bộ, header
xác thực tĩnh, chạy `cron.php` để đẩy job. Kết quả LOCAL:

| Event | `userIdFilter` = member | `eventFilter {"user.uid": member}` | Payload |
|---|---|---|---|
| `OCA\Forms\Events\FormSubmittedEvent` | 0 | 1 | `form`, `submission` (không chứa câu trả lời) |
| `OCA\Tables\Event\RowAddedEvent` | 0 | 1 | `tableId`, `rowId`, `values`, `previousValues`, `dataByAlias` |
| `OCP\Files\Events\Node\NodeWrittenEvent` | 0 | 1 | `node` (id, path) |
| `OCA\Deck\Event\CardCreatedEvent` | bị từ chối | bị từ chối | "not an event class compatible with webhooks" |

- `user.uid` trong payload là ID bất biến; header xác thực khớp ở mọi request.
- `userIdFilter` không bắn với request API dùng app password. Đọc mã cho thấy
  listener được đăng ký lúc app boot theo user hiện tại; giả thuyết là lúc đó
  phiên Basic auth chưa đăng nhập. Với phiên trình duyệt: NOT_TESTED.
- Không có chữ ký HMAC hay nonce chống replay; chỉ header tĩnh do admin cấu
  hình. Giao đi bất đồng bộ qua background job, độ trễ theo nhịp cron/worker.
- Forms chỉ gửi form + submission id; receiver phải gọi API đọc câu trả lời.

## 6. Phát hiện và giới hạn

1. **Notes**: note share qua Files/WebDAV; app Notes của người nhận chỉ liệt kê
   note trong thư mục Notes của chính họ. Sau `files:transfer-ownership`, note
   nằm trong thư mục "Chuyển từ <uid> tại <ngày>" của successor; app Notes không
   tự hiện nếu chưa chuyển vào thư mục Notes.
2. **Forms**: member chỉ có quyền submit vẫn gọi được danh sách submissions,
   nhưng chỉ nhận bài của chính mình (theo thiết kế). Câu trả lời file bắt buộc
   `uploadToken`, nên không dùng lại được file người khác đã upload.
3. **Tables**: `GET /rows/{id}` của người ngoài trả 403 với row có thật và 404
   với row không có, tức lộ sự tồn tại của row ID. Không lộ nội dung.
4. **Collectives**: người ngoài liệt kê attachment của trang trả 500 (exception
   NotFound không được bắt) thay vì 404. Không lộ nội dung.
5. **Brute-force protection** bị chính các probe deny kích hoạt (403 hàng loạt
   từ một IP relay, cuối cùng HTTP 500 "Reached maximum delay"). Script reset
   bộ đếm cho IP relay trước mỗi ma trận, protection vẫn bật. Production sau
   reverse proxy phải cấu hình `trusted_proxies`, nếu không mọi người dùng
   chung một IP và bị throttle lẫn nhau.
6. **Relay busybox + keep-alive**: request trình duyệt đôi khi không tới Apache
   và Chrome treo. Với `KeepAlive Off` (chỉ trong PoC) các lần chạy browser sau
   đó đều sạch (4/4 ma trận và offboard), không có thì 2 lần treo. Chưa chứng
   minh nguyên nhân gốc; production dùng reverse proxy thật.
7. Script offboard dùng `find` chỉ đọc trong data directory để tìm đường dẫn
   note sau chuyển. Không ghi DB hay data directory trực tiếp ở bước nào.
8. Một board và một collective thừa từ lần chạy lỗi đầu vẫn còn (dữ liệu thử).
   Card "Event …" trên board là do probe event tạo.
9. Trạng thái cuối: manager-a đã offboard. Muốn chạy lại các bước acceptance
   phải bật lại manager-a (xem README).

**NOT_TESTED:** OIDC browser login trên bản restore (Authentik không được restore
trong stack restore; ACL kiểm bằng app password khôi phục); đồng biên tập
nhiều người trong Text; mobile/desktop client; notification và email; Deck
calendar; public link (đã tắt); view/context của Tables; `userIdFilter` với
phiên trình duyệt; hiệu năng và quy mô; HA; production.

**Không làm:** không sửa `apps/web`/`apps/api` (không cần link shell cho PoC này),
không đổi `contract/openapi.yaml`.

## 7. Lệnh đã chạy

Các script trong `poc/work-management/` theo trình tự README, lần chạy cuối đều
PASS: acceptance deck/notes/forms/tables/collectives, search, sink-selftest,
events, browser-ui (trước và sau restart), verify-acl (after-restart, restore),
verify-isolation, restart-stack, export-all, backup-local, restore-local,
verify-restore, acceptance-offboard, browser-offboard, scan-secrets (22 giá trị
secret, không có trong file commit).

## 8. Kiểm repo

`pnpm install --frozen-lockfile` rồi `pnpm ai:check` trong worktree: **PASS**,
changed gate 65 file, guard 44/44. Không có mã `apps/` hay hợp đồng thay đổi
nên gate không chạy BE/FE/typecheck; `ai:check:full` chưa chạy.

## 9. Đề xuất phạm vi chat14 (Flow)

1. **Receiver NestJS** cho `webhook_listeners`: endpoint nội bộ, header bí mật
   xoay vòng, allowlist event (Forms `FormSubmittedEvent`, Tables `Row*Event`,
   Files `Node*Event`), lọc bằng `eventFilter` (không dùng `userIdFilter`),
   journal + idempotency theo (event, id, time), readback qua API trước khi tác
   động (Forms phải đọc câu trả lời qua API), retry/ordering, audit correlation.
   Chạy background worker thay vì cron mặc định để giảm độ trễ; đo độ trễ.
2. **Ba flow nghiệm thu**: (a) Form → thẻ Deck: so `forms_deck` 0.7.0
   (`>=33 <=35`) với tạo card qua Deck API từ NestJS, kiểm ACL người xem card;
   (b) Tables row → NestJS → thông báo (không gửi thư thật); (c) file vào thư
   mục chia sẻ → tag/kiểm soát truy cập bằng Flow core.
3. **Deck làm nguồn event**: không có webhook; cần PoC polling Deck API/Activity
   hoặc chỉ dùng Deck làm đích. Không viết app Nextcloud riêng nếu chưa duyệt.
4. Giữ: dùng ID bất biến, quyền người chạy flow, deny test cho outsider, replay
   không nhân đôi, restart giữa chừng, không dùng thành phần deprecated
   (External App Flow/Windmill), không bật `workflow_script` tuỳ ý.
