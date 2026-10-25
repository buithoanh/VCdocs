# VCworkspace 14 — Bàn giao Flow

Ngày kiểm: 2026-10-25. Nhánh `claude/chat14-flow` (cắt từ
`claude/chat13-work-management-d67500`, commit aed52ad). Phạm vi: PoC **LOCAL** cô lập
trên stack chat13 (loopback, persona và dữ liệu giả); không production, deploy,
Google thật, email thật hay mua dịch vụ. Mã: `apps/api/src/modules/flow/`, test
`apps/api/test/flow-*.ts`; PoC và bằng chứng: `poc/flow/` (README có trình tự chạy lại).

Cách đọc: **LOCAL PASS** = đã chạy trên runtime local lần này; **DOC** = đọc mã/tài liệu
nhưng chưa chạy; **NOT_TESTED** = chưa có bằng chứng.

## 1. Kết luận

- Receiver NestJS cho `webhook_listeners` chạy được end-to-end: Nextcloud → worker nền
  riêng → relay nội bộ → `POST /api/v1/flow/nextcloud/webhooks` → journal Mongo → worker
  NestJS đọc lại qua API bằng app password của người chạy flow → tác động. **LOCAL PASS**
  cả ba flow nghiệm thu và các bất biến (xác thực, allowlist, replay, xoay vòng bí mật,
  restart giữa chừng, receiver tắt + đối soát, deny outsider).
- Độ trễ đo được (worker `--interval=1`): từ lúc người dùng thao tác tới lúc hiệu ứng xong
  p50 ≈ 1,0–1,1 s, p95 ≈ 1,1–1,2 s. Không có worker thì sự kiện nằm trong hàng đợi tới
  lượt cron (cron 5 phút → tới ~300 s).
- `forms_deck` 0.7.0 dùng được nhưng chép câu trả lời vào board mà **không** đối chiếu
  quyền xem kết quả form: khi board được chia sẻ, thành viên đọc được câu trả lời của
  người khác (LOCAL, mục 4.1). Receiver NestJS từ chối trường hợp này. Đề xuất mặc định:
  tạo thẻ bằng receiver; chỉ dùng `forms_deck` cho board riêng của chủ form.
- Deck **không** phát event webhook (đăng ký `CardCreatedEvent` vẫn 400). Polling bằng
  quyền chủ board phát hiện được trong ≈ nhịp poll nhưng tốn request liên tục → kết luận
  chat14: **Deck chỉ làm đích**; không viết app Nextcloud riêng.
- Hai giới hạn của Nextcloud phải mang vào thiết kế: webhook **không gửi lại** khi receiver
  lỗi (đã có đối soát bù), và `eventFilter` **không có `$regex`** (lọc thư mục ở receiver).

## 2. Runtime và kiến trúc

| Thành phần | Phiên bản / nơi chạy | Nguồn/kiểm |
|---|---|---|
| Nextcloud, Authentik, Deck/Forms/Tables | như chat13 (33.0.10, Deck 1.17.8, Forms 5.4.1, Tables 2.3.2), stack `vcworkspace-work13` đang chạy, dùng lại | `poc/work-management/evidence` |
| forms_deck / files_automatedtagging / files_accesscontrol | **0.7.0** (`>=33 <=35`) / **4.0.1** / **4.0.2** (`>=33 <=33`), ký số, `integrity:check-app` PASS | `flow-app-preflight.json`, `flow-apps.json` |
| workflowengine / webhook_listeners | 2.15.0 / 1.5.0 (bundled) | `flow-apps.json` |
| workflow_script | 4.1.0 có trên App Store, **không cài** | `flow-app-preflight.json` |
| webhook-worker | cùng digest image Nextcloud, `occ background-job:worker --interval=1 WebhookCall`, mạng internal | `poc/flow/compose.flow.yaml` |
| flow-receiver-relay | busybox `nc` → `host.docker.internal:18140`, read-only, cap_drop ALL | như trên |
| Receiver | NestJS trong spec Jest có cổng (Google giả), MongoDB local `127.0.0.1:18141` | `apps/api/test/flow-nextcloud-server.spec.ts` |

Overlay là project Compose riêng `vcworkspace-flow14`, gắn vào mạng và volume có sẵn của
work13, không tạo volume mới, không tạo lại container work13. Bước cài app tạm nối
Nextcloud ra `host_edge` và luôn ngắt trong `finally` (như chat13).

Personas: successor-a (chủ form/board/bảng/thư mục, cũng là **runner** của mọi rule),
member-a (Team A, người nộp/thêm dòng/tải file), manager-b (Team B), outsider. Mọi
cấu hình dùng uid 64-hex bất biến và group id federated.

## 3. Receiver NestJS

Hợp đồng `contract/openapi.yaml` 2.3.0 → **2.4.0-gd2** (chỉ thêm, tương thích; ghi ở
`contract/NGUON.md`; FE `schema.d.ts` sinh lại bằng `gen:api`):

| Điểm cuối | Quyền | Ghi chú |
|---|---|---|
| `POST /flow/nextcloud/webhooks` | header `X-VCW-Flow-Token` (security `flowWebhookToken`), không phiên/CSRF | 202 `{journalId, duplicate, status}`; 401 sai/thiếu header; 422 `FLOW-01` lớp ngoài allowlist; 400 payload sai; 503 khi tắt |
| `GET /flow/events`, `GET /flow/events/{id}` | R9 | journal: trạng thái, số lần thử, replay, `correlationId`, `deliveryLagMs`, `processingMs`, kết quả từng rule |

Thiết kế (mã `apps/api/src/modules/flow/`):

- **Xác thực:** guard riêng chạy trước kiểm hợp đồng, so `safeEqual` với từng bí mật còn
  hiệu lực (`FLOW_WEBHOOK_SECRETS`, ≥ 32 byte); request chưa xác thực không ghi journal
  hay audit (chỉ log có giới hạn). Nextcloud gửi không có `Content-Type` → route đọc mọi
  kiểu thân là JSON, tối đa 256 KB.
- **Allowlist:** `FormSubmittedEvent`, `Row{Added,Updated,Deleted}Event`,
  `Node{Created,Written,Deleted,Renamed}Event`. Chỉ lấy lớp, id số nguyên, `time`, `user.uid`;
  không lưu `authentication` (token tạm), không tải URL nào trong payload.
- **Journal + idempotency:** khoá `sha256(lớp | tài nguyên | time)` unique theo công ty; gửi
  lại → 202 `duplicate=true`, tăng `replayCount`, audit `flow.event.duplicate` (kèm
  `payloadMismatch`). Hiệu ứng có khoá nghiệp vụ riêng (`FlowEffect`, vd
  `submission:5:10`) nên cùng phiếu đến với `time` khác hoặc từ đối soát chỉ ra
  `already_done`. `companyId` lấy từ cấu hình, không từ payload.
- **Readback trước tác động, quyền runner:** Forms đọc câu trả lời qua
  `GET /forms/{id}/submissions/{sid}` (payload không có câu trả lời); runner phải còn
  quyền `results` và `PERMISSION_EDIT` board; board có ACL (rộng hơn quyền xem kết quả)
  → `board_wider_than_results`. Tables đọc dòng và danh sách share; người nhận chỉ là
  chủ bảng hoặc người được share trực tiếp có quyền đọc, đã bind sang tài khoản
  VCworkspace còn hoạt động (share theo nhóm không giải được bằng quyền runner → đóng an
  toàn). Files tìm fileid trong cây của runner (WebDAV SEARCH) rồi đọc systemtags.
  401/403 của runner → `runner_unauthenticated`/`runner_forbidden`, không thử lại, không
  dùng tài khoản khác. Không có credential admin nào trong receiver.
- **Worker nền, thứ tự, retry:** poll 200–500 ms, claim có lease (`FLOW_LEASE_MS`);
  không lấy event nếu còn event sớm hơn cùng tài nguyên chưa xong (thứ tự theo
  tài nguyên); lỗi tạm (mạng, 5xx, 429, chưa thấy tag) thử lại giãn cách luỹ thừa tới
  `FLOW_MAX_ATTEMPTS` rồi `failed`. Trước khi tạo thẻ luôn tìm thẻ có marker
  `vcw-flow:<rule>:<form>:<phiếu>` (vá trường hợp chết sau khi tạo, trước khi ghi effect);
  marker giả trong câu trả lời bị làm sạch.
- **Đối soát:** `webhook_listeners` không gửi lại; `FLOW_RECONCILE_MS` > 0 thì worker đọc
  danh sách phiếu/dòng bằng quyền runner, chỉ từ mốc kích hoạt rule (`FlowCursor`), đưa
  phần chưa có journal vào hàng đợi (`source=reconcile`).
- **Audit correlation:** mọi dòng `audit_logs` của một event có `requestId = correlationId`
  (`flow-<journalId>`): `flow.event.received` → `flow.deck.card_created` /
  `flow.notify.inapp` / `flow.notify.denied` / `flow.files.tag_verified` /
  `flow.rule.skipped` → `flow.event.done|skipped|failed|retry`. POST trả `X-Audit-Id`.
- **Cấu hình** (`FLOW_*`, mẫu ở `apps/api/.env.example`, mặc định tắt) được kiểm lúc khởi
  động: bí mật ngắn, URL có credential/query, http tới máy không phải loopback/localtest.me,
  production không https, rule thiếu runner/id sai/kind lạ → dừng ngay.

## 4. Nghiệm thu theo flow

| Flow / hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| (a) Form → thẻ Deck qua receiver, 10 phiếu | **LOCAL PASS**: 10/10 `card_created`, tiêu đề = câu trả lời đầu, mô tả có đủ câu trả lời đọc qua API, 0 trùng | `acceptance-forms-deck.json` |
| (a) ACL người xem thẻ (board không ACL) | **LOCAL PASS**: chủ 200; member-a, manager-b, outsider 403 board/thẻ receiver/thẻ forms_deck, board không có trong danh sách; member-a chỉ thấy phiếu của mình trong Forms | như trên |
| (a) Board bị chia sẻ (Team A xem) | **LOCAL PASS** cho receiver: `board_wider_than_results`, không tạo thẻ. forms_deck vẫn tạo thẻ và member-a đọc được câu trả lời của successor-a (200) | như trên, `sharedBoardComparison` |
| (a) forms_deck 0.7.0 | **LOCAL PASS** chức năng: thẻ có ngay khi request nộp trả về (đồng bộ), marker `NC-Form-<form>-<phiếu>`, tạo bằng quyền chủ mapping | như trên |
| (b) Tables thêm dòng → thông báo trong ứng dụng, 10 dòng | **LOCAL PASS**: mỗi dòng `notified` 2 người (successor-a, member-a); manager-b, outsider bị từ chối `no_table_read`; hộp thông báo 10/10/0/0; outbox email giả không đổi (`emailState=none`) | `acceptance-tables-notify.json` |
| (b) Deny trực tiếp | manager-b, outsider thêm dòng 404, đọc dòng 403 (không sinh event) | như trên |
| (c) Flow core: tag + kiểm soát truy cập | **LOCAL PASS**: mọi file trong `Flow14-HoSo` có tag restricted `flow14-hoso`; `*-mat.*` thêm `flow14-mat`; member-a (có share ghi) đọc file mat 404, ghi đè/xoá 403; chủ (nhóm `flow14-reviewers`) đọc 200; Team B/outsider 404 | `acceptance-flow-core.json`, `flow-core-rules.json` |
| (c) Receiver kiểm tag | **LOCAL PASS**: `NodeCreated`+`NodeWritten` của file thường và file mat → `tag_verified` (đọc tag bằng quyền chủ); file riêng của member-a ngoài thư mục → `not_visible_to_runner`, không leo thang | `acceptance-files-flow.json` |
| Xác thực/allowlist trực tiếp | **LOCAL PASS**: thiếu/sai header 401, lớp Deck 422, journal không đổi | `acceptance-receiver-invariants.json` |
| Replay đúng body Nextcloud đã gửi | **LOCAL PASS**: 2 lần replay → 202 `duplicate`, cùng `journalId`, `replayCount=2`, vẫn 1 thẻ | như trên |
| Xoay vòng bí mật | **LOCAL PASS**: nhận bí mật cũ trong lúc xoay, đổi webhook sang bí mật mới, gỡ bản cũ → bản cũ 401 | như trên |
| Restart giữa chừng | **LOCAL PASS**: receiver tự `SIGKILL` ngay sau khi Deck tạo thẻ; chạy lại → lease hết hạn, `card_recovered`, 1 thẻ | như trên |
| Receiver tắt (event bị lỡ) | **LOCAL PASS**: Nextcloud log `Webhook(...) call failed` và không gửi lại; bật lại có đối soát → 1 thẻ + 1 lượt thông báo (`source=reconcile`), 1 journal | như trên |
| Worker riêng so với cron | **LOCAL PASS**: dừng worker → 10 s không có gì giao, 1 job `WebhookCall` chờ; chạy `cron.php` → giao trong ~1,3 s | `latency-cron-vs-worker.json` |
| Deck làm nguồn (polling) | **LOCAL PASS** cho probe; kết luận Deck chỉ làm đích (mục 6) | `deck-polling-probe.json` |
| E2E receiver (fake Nextcloud) | **LOCAL PASS** 13/13 (mục 8) | `apps/api/test/flow-receiver.e2e-spec.ts` |

Payload thật của 4 event (sau khi bỏ `authentication`) ở `webhook-payloads.json`; dạng
phản hồi API Forms/Deck/Tables/WebDAV dùng cho fake Nextcloud lấy từ đó.

### 4.1 So sánh forms_deck 0.7.0 và receiver NestJS

| Tiêu chí | forms_deck 0.7.0 | Receiver NestJS |
|---|---|---|
| Thời điểm tạo thẻ | Đồng bộ trong request nộp (nộp chậm thêm ≈ 7 ms: p50 53 ms so với 45 ms khi tắt mapping) | Bất đồng bộ, xong sau ≈ 1,05 s (p50) |
| Quyền | Chủ mapping; kiểm lại `results` form và quyền sửa board, mất quyền thì tự tắt mapping | Runner cấu hình; kiểm `results`, `PERMISSION_EDIT`, cột thuộc board; mất quyền → skip, ghi audit |
| Board rộng hơn quyền xem kết quả | Vẫn chép câu trả lời (app chỉ ghi chú trong mô tả) → lộ câu trả lời người khác | Từ chối (`board_wider_than_results`) trừ khi rule bật `allowSharedBoard` |
| Idempotency | Marker trong mô tả thẻ | Journal + effect + marker; replay/đối soát không nhân đôi |
| Journal/audit/đo đạc | `last_error` trên mapping, log Nextcloud | Journal R9, audit theo correlationId, độ trễ |
| Tag, file đính kèm, điều kiện định tuyến | Có (tag theo câu trả lời, đính kèm file upload, điều kiện câu chọn) | Chưa làm (chỉ tiêu đề + mô tả) |
| Rủi ro | App cộng đồng một người duy trì (`mrmvn`), phát hành 2026-10-16, range tới 35 | Mã của mình, phải tự bảo trì |

## 5. Độ trễ đo được (LOCAL, máy dev, worker `--interval=1`, receiver poll 200 ms)

| Flow (n) | Nhận webhook sau thao tác | Hiệu ứng xong sau thao tác | Xử lý trong receiver |
|---|---|---|---|
| (a) Form → Deck (10) | p50 757 ms, p95 912 ms | p50 1 046 ms, p95 1 224 ms | p50 288 ms (5 lần gọi API + audit) |
| (b) Tables → thông báo (10) | p50 905 ms, p95 946 ms | p50 1 068 ms, p95 1 109 ms | p50 161 ms |
| (c) File → kiểm tag (6 event, gồm 2 `not_visible_to_runner`) | — | p50 990 ms, p95 1 089 ms | — |
| Không worker, chờ cron | 10 s không giao gì | ~1,3 s sau khi `cron.php` chạy | — |

`eventTime` của Nextcloud chỉ chính xác tới giây nên `deliveryLagMs` trong journal lệch
tới 1 s; các số ở bảng trên đo bằng đồng hồ của script từ lúc bắt đầu thao tác. Mẫu
nhỏ, một máy, không tải đồng thời → không dùng cho sizing.

## 6. Deck làm nguồn event

- Webhook: đăng ký `OCA\Deck\Event\CardCreatedEvent` trả **400** (không tương thích
  webhook), như chat13. **LOCAL**.
- Polling bằng quyền chủ board, nhịp 1 s, member-a tạo/sửa thẻ ở thời điểm ngẫu nhiên
  (5 lần): `GET /boards/{id}/stacks` + `If-Modified-Since` (Deck trả thẻ đổi từ mốc,
  độ phân giải giây → cửa sổ chồng 2 s, khử trùng `(cardId, lastModified)`) phát hiện
  tạo p50 ≈ 0,4 s, max ≈ 1,1 s, sửa max ≈ 1 s; Activity API (`since=<activityId>`)
  phát hiện tạo max ≈ 0,8 s. Chi phí: 2 request/giây/board kể cả khi không có thay
  đổi. Outsider poll 403, không thấy activity. **LOCAL PASS** cho probe.
- Kết luận: chat14 dùng Deck **chỉ làm đích**. Nếu sau này cần Deck làm nguồn: poller
  trong NestJS bằng app password runner, checkpoint + khử trùng như trên, nhịp ≥ 30 s cho
  board ít đổi; không viết app Nextcloud riêng khi chưa duyệt.

## 7. Bất biến đã giữ

| Bất biến | Cách giữ / bằng chứng |
|---|---|
| ID bất biến | uid 64-hex, group id federated, fileid/rowId/submissionId số nguyên; người nhận thông báo bind uid → email ở cấu hình |
| Quyền người chạy flow, không leo thang | Mọi gọi Nextcloud bằng app password runner; test khẳng định không có request bằng tài khoản khác; runner mất quyền → skip |
| Deny outsider | Forms/Tables/Deck/Files 4xx cho manager-b, outsider; người nhận ngoài share bị từ chối ở điểm cuối; request không có header 401 |
| Replay không nhân đôi | Journal dedupe + effect + marker (e2e và LOCAL với body thật) |
| Đúng sau restart giữa chừng | Lease + readback marker (e2e app thứ hai cùng CSDL; LOCAL SIGKILL) |
| Không thành phần deprecated | Không dùng External App Flow/Windmill; không cài `workflow_script` (`install-flow-apps.mjs` từ chối nếu đang bật) |
| Không tin dữ liệu chưa xác thực | Guard trước mọi xử lý; payload chỉ để định tuyến, dữ liệu đọc lại qua API |
| Quyết định quyền ở điểm cuối | Kiểm `results`/`PERMISSION_EDIT`/ACL board/share bảng/người nhận còn hoạt động ngay trước tác động |
| Không tải URL tuỳ ý | Chỉ gọi origin cấu hình, không theo redirect, id phải là số nguyên; test khẳng định payload có URL nội bộ không bị gọi. Không có chỗ nào tải URL người dùng đưa nên không cần `safe-url.ts`; nếu sau này cần thì bắt buộc dùng nó |

## 8. Phát hiện và giới hạn

1. **Không gửi lại:** `WebhookCall` là `QueuedJob`, exception bị bắt và bỏ (DOC đọc mã +
   LOCAL log). Receiver tắt/lỗi → mất event nếu không bật đối soát. Đối soát chỉ có cho
   Forms và Tables (Files chưa: cần quét theo thư mục).
2. **Không có `$regex` trong `eventFilter`**, toán tử lạ ném exception (DOC đọc mã; chưa thử
   xem có làm hỏng request của người dùng không) → kiểm kỹ filter khi đăng ký.
3. **Không có Content-Type, không HMAC/nonce:** chỉ header tĩnh; chống replay dựa hoàn
   toàn vào journal. Header bí mật lưu trong DB Nextcloud (`authData`; đọc mã thấy giải mã bằng
   `getAuthDataClear` khi gửi, DOC) — admin Nextcloud đọc/sửa được.
4. **Độ phân giải giây:** khoá dedupe có `time` (giây): hai lần ghi cùng file trong cùng
   giây chỉ giữ một event (receiver đọc lại trạng thái hiện tại nên không sai dữ liệu).
5. **Thứ tự theo tài nguyên** chỉ chặt trong một worker; nhiều instance receiver đồng
   thời chưa thử (claim CAS + lease, nhưng kiểm "event sớm hơn" không nguyên tử).
6. **Share theo nhóm** của Tables không giải được thành viên bằng quyền runner → không
   gửi thông báo cho người chỉ có quyền qua nhóm (đóng an toàn). Cần nguồn membership
   (Authentik/LDAP) nếu muốn hỗ trợ.
7. **Thông báo** chỉ trong ứng dụng; `link` `/flow/nextcloud/tables/...` chưa có trang FE
   (UI NOT_TESTED). Không có email (`emailState=none`).
8. **Flow core chặn cả người tải lên:** member-a tải `x-mat.txt` thành công (201) rồi mất
   quyền đọc/sửa chính file đó — đúng thiết kế rule, phải báo người dùng.
9. **Xoay vòng bí mật cần khởi động lại receiver** (cấu hình qua biến môi trường).
10. **Receiver PoC chạy trong spec Jest** (Google giả, Mongo local) vì phiên code không được
    khởi động BE thật; chưa có quy trình chạy dịch vụ/secret production.
11. Dữ liệu thử còn lại trên stack: form 5, board 8, bảng 5, thư mục `Flow14-HoSo`, thẻ
    trên board 4 (probe Deck), webhook đang trỏ receiver (receiver tắt thì Nextcloud log lỗi).

**NOT_TESTED:** nhiều instance receiver; tải/quy mô; payload file đổi tên/xoá (allowlist có,
chưa chạy); `RowUpdated/RowDeleted` (allowlist có, chưa có rule); đối soát Files; tag/đính
kèm khi tạo thẻ bằng receiver; UI FE cho thông báo Flow và journal; HTTPS/mTLS giữa
Nextcloud và receiver; production, deploy, backup/restore journal; `userIdFilter` với
phiên trình duyệt.

## 9. Lệnh đã chạy và kiểm repo

Trong `poc/flow/` (đều PASS lần chạy cuối): `preflight-flow-apps`, `install-flow-apps`,
`compose.flow.yaml up -d`, `setup-resources`, `configure-flow-core`, `capture-payloads`,
`acceptance-flow-core`, `acceptance-forms-deck`, `acceptance-tables-notify`,
`acceptance-files-flow`, `acceptance-receiver-invariants`, `latency-cron-vs-worker`,
`deck-poll-probe`, `scan-secrets` (23 giá trị secret, không có trong file commit).

- E2E receiver: `ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/flow-receiver.e2e-spec.ts` → 13/13.
- `pnpm ai:check:full`: **PASS** — guard 44/44, contract lint hợp lệ (193 cảnh báo kiểu
  operationId như trước), BE 314 passed / 10 skipped, độ phủ hợp đồng 148/148, FE 84 test,
  typecheck và build đạt. `pnpm ai:check` (changed gate) PASS trên bản cuối.

## 10. Đề xuất phạm vi chat15 (Sync + NAS)

1. **Sync desktop/mobile** trên stack local riêng (clone volume hoặc stack mới): Nextcloud
   Desktop trên macOS + một client thứ hai (VM/máy khác), Android/iOS nếu có thiết bị thử;
   login bằng OIDC (Authentik) → app password; offline sửa, xung đột, selective sync,
   virtual files; thu hồi thiết bị/app password và offboard (đối chiếu chat13) không còn
   đồng bộ dữ liệu.
2. **NAS/SMB:** container Samba cô lập làm "NAS" + External Storage (`files_external`,
   php-smbclient), ACL theo nhóm; sửa trực tiếp trên NAS → `occ files:scan`/notify, đo độ
   trễ và tải; rename ngoài Nextcloud có mất share/tag/comment không; Unicode/case;
   file lớn đại diện.
3. **Nối với Flow chat14:** event `Node*Event` từ External Storage (thay đổi trực tiếp trên
   NAS có sinh event không), tag/access control của Flow core trên mount SMB, đối soát
   Files theo thư mục cho receiver.
4. Giữ bất biến: uid bất biến, quyền người dùng, deny Team B/outsider qua client sync lẫn
   SMB trực tiếp, restart/backup/restore, không đọc/ghi DB hay data directory Nextcloud.
