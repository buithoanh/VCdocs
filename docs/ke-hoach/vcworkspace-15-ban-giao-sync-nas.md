# VCworkspace 15 — Bàn giao Sync + NAS

Ngày kiểm: 2026-10-25. Nhánh `claude/chat15-sync-nas` (cắt từ `claude/chat14-flow`,
commit 05b0ced). Phạm vi: PoC **LOCAL** chỉ bằng container, trên stack chat13/14 đang chạy
(loopback, persona và dữ liệu giả). Không cài app lên máy Mac, không dùng điện thoại hay
NAS thật, không production, deploy, Google thật, email thật hay mua dịch vụ. PoC và bằng
chứng: `poc/sync-nas/` (README có trình tự chạy lại), `poc/sync-nas/evidence/`. Mã:
`apps/api/src/modules/flow/` (đối soát Files), test `apps/api/test/flow-files-reconcile.e2e-spec.ts`.

Cách đọc: **LOCAL PASS** = đã chạy trên runtime local lần này; **DOC** = đọc mã/tài liệu
nhưng chưa chạy; **NOT_TESTED** = chưa có bằng chứng.

## 1. Kết luận

- NAS giả lập (Samba 4.21 trong container, chỉ trên mạng nội bộ) gắn vào Nextcloud qua
  External Storage SMB, mỗi mount chỉ áp cho **một nhóm** (group id federated bất biến) với
  tài khoản dịch vụ NAS riêng. ACL Team A/Team B/outsider/leaver đúng qua WebDAV **và** SMB
  trực tiếp, giữ nguyên sau restart và sau backup/restore sang stack riêng. **LOCAL PASS**.
- Thay đổi trực tiếp trên NAS **không** phát `Node*Event` cho webhook (0 event bắt được, kể
  cả rename/scan; các event cache không đăng ký được webhook). Đã thêm **đối soát Files theo
  thư mục** vào receiver NestJS (opt-in `reconcile: true`), bắt được file mới/đổi/đổi tên trên
  NAS sau ≈ 1,7–1,9 s với nhịp đối soát 2 s; 8 test e2e mới. **LOCAL PASS**.
- Ngữ nghĩa sync qua WebDAV (như client làm) đạt: If-Match/If-None-Match, sửa offline bằng
  ETag cũ → 412, hai thiết bị sửa đồng thời không mất bản (423 → thử lại → 1 thắng, 1 nhận
  412), chunked upload v2 (tiếp tục từ thiết bị khác, checksum, huỷ, người khác 403), file
  1 GiB khớp SHA-256 hai chiều. **Client desktop/mobile thật: NOT_TESTED** (không có image
  `nextcloudcmd` trong máy, không cài app theo phạm vi).
- Ba phát hiện cần mang vào thiết kế (chi tiết mục 6):
  1. **Mất file**: đổi tên chỉ khác hoa/thường qua Nextcloud trên mount SMB với mặc định
     `case_sensitive=true` → HTTP 500 **và file bị xoá trên NAS** (repro 2/2). Cấu hình
     `case_sensitive=false` → từ chối an toàn (500, file còn). Đã đặt `false` cho cả hai mount.
  2. **Rename ngoài Nextcloud** (SMB/Explorer hay `mv` trên NAS) → fileid mới, **mất share,
     tag, comment** (share trả 404, người nhận mất file). Rename qua Nextcloud giữ đủ.
  3. **SMB trực tiếp bỏ qua Flow core** (tag/chặn truy cập chỉ có hiệu lực trong Nextcloud);
     NAS là danh tính riêng nên offboard phải khoá cả tài khoản NAS.
- Thu hồi app password bằng `occ` có hiệu lực sau ≈ 6 s (cache token APCu TTL 10 s của tiến
  trình web), tự đăng xuất qua API thì ngay lập tức; disable tài khoản → mọi thiết bị nhận
  **503** (không phải 401) ngay, và bật lại thì token chưa xoá dùng lại được.

## 2. Runtime

| Thành phần | Phiên bản / nơi chạy | Bằng chứng |
|---|---|---|
| Nextcloud | 33.0.10, container work13 **tạo lại** với image dẫn xuất cùng digest + `smbclient` 4.22.11 + php-smbclient 1.1.1 (`poc/sync-nas/nextcloud-smb/Dockerfile`), volume giữ nguyên | `environment.json` |
| files_external | 1.25.1 (bundled, bật trong chat15) | `nas-mounts.json` |
| NAS giả lập `nas15` | Samba 4.21.9 trên `alpine:3.22.2@sha256:4b7ce070…` (image chính thức, pull trong chat15), không publish cổng, volume mới `vcworkspace_sync15_nas`, cap_drop ALL + cap tối thiểu | `poc/sync-nas/nas/` |
| `files-notify` | `occ files_external:notify -v 1` (Team A); Team B cố ý không notify | `compose.sync15.yaml` |
| Flow | receiver chat14 (Jest có cổng, Google giả, MongoDB local 18141), webhook-worker chat14 | `acceptance-nas-flow.json` |
| Restore | project riêng `vcworkspace-sync15-restore`, `127.0.0.1:18153`, volume `vcworkspace_sync15_restore_*` | `verify-restore.json` |

Mount (cấu hình qua `occ files_external:import -` từ stdin; mật khẩu không nằm trên argv
hay evidence):

| Mount | Share NAS | Áp cho | Tài khoản NAS | Kiểm thay đổi | Notify |
|---|---|---|---|---|---|
| `/NAS-TeamA` | `team-a` (`valid users = @nas-team-a`) | nhóm Team A `35e05c4d…` | `svc-nc-team-a` | mỗi lần truy cập | có |
| `/NAS-TeamB` | `team-b` (`@nas-team-b`) | nhóm Team B `3e54c1d9…` | `svc-nc-team-b` | không bao giờ (chỉ scan) | không |

Cả hai: `enable_sharing=true`, `case_sensitive=false`, `encoding_compatibility=true` (hai
mục sau là hardening từ phát hiện mục 6). Tài khoản NAS người dùng (thay cho AD/LDAP của NAS
thật): `nas-member-a` (nhóm team-a), `nas-manager-b` (team-b), `nas-outsider`.

## 3. Ma trận nghiệm thu

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| ACL qua WebDAV: Team A thấy/ghi `NAS-TeamA`, không thấy `NAS-TeamB` (404); Team B ngược lại; outsider 404 cả hai; manager-a (leaver chat13, disabled nhưng còn trong nhóm) 401 mọi đường; truy cập đường dẫn người khác 404 | **LOCAL PASS** | `acceptance-nas-acl.json` |
| SMB trực tiếp: nas-member-a chỉ `team-a`, nas-manager-b chỉ `team-b`; outsider, ẩn danh, tài khoản dịch vụ của đội kia → `NT_STATUS_ACCESS_DENIED`; `../team-b` không thoát share | **LOCAL PASS** | như trên |
| Sửa trực tiếp trên NAS → Nextcloud thấy (độ trễ mục 4) | **LOCAL PASS** có giới hạn burst | `probe-detection.json`, `acceptance-nas-changes.json` |
| Ghi đè nội dung qua SMB giữ fileid (5/5), ETag listing đổi sau ≈ 72 ms | **LOCAL PASS** | `acceptance-nas-changes.json` |
| Rename qua Nextcloud giữ fileid, tag, comment, share | **LOCAL PASS** | như trên `renames.viaNextcloudMove` |
| Rename ngoài Nextcloud giữ metadata | **FAIL (phát hiện)**: fileid mới, mất tag/comment/share (cả SMB + notify lẫn `mv` + scan) | `renames.viaSmbRenameWithNotify`, `viaNasMvThenScan` |
| Unicode NFD tạo trên NAS | không bật `encoding_compatibility`: **không hiện**, GET 404; bật: hiện tên NFC, GET 200; PUT tên NFD qua WebDAV lưu NFC trên NAS | `repro-case-unicode.json`, `acceptance-nas-changes.json` |
| Đổi tên chỉ khác hoa/thường | qua Nextcloud, mặc định: **mất file**; `case_sensitive=false`: từ chối, file còn; qua SMB: đổi được, Nextcloud thấy tên mới, fileid mới; `dup`/`DUP` cùng tồn tại trên NAS: Nextcloud liệt kê cả hai | `repro-case-unicode.json`, `caseTests` |
| File lớn 1 GiB: chunked v2 16×64 MiB vào NAS-TeamA và ghi 1 GiB trực tiếp trên NAS; SHA-256 khớp NAS ↔ client ↔ tải về | **LOCAL PASS** | `acceptance-nas-large.json` |
| Sync WebDAV: PROPFIND Depth 0/1/infinity, thuộc tính client (etag, fileid, permissions, size, checksum), lan truyền ETag lên thư mục cha và gốc home (cả mount SMB) | **LOCAL PASS** (Depth infinity đang được phép → 207) | `acceptance-sync-webdav.json` |
| Sửa offline (If-Match ETag cũ) → PUT/DELETE/MOVE 412, nội dung giữ bản thắng; `If-None-Match: *` trên file có sẵn → 412 | **LOCAL PASS** home + NAS | như trên |
| Hai app password sửa đồng thời, cùng ETag, 10 vòng × (khác/cùng kích thước) × (home/NAS) | **LOCAL PASS**: 0 vòng mất bản; home: cả hai 423 lần đầu, thử lại → 204 + 412; NAS: 204 + 423 → 412 | như trên |
| Chunked upload v2: thiết bị 2 liệt kê chunk để tiếp tục, người khác PUT/MOVE vào upload dir 403, sai `OC-Total-Length` 400, `OC-Checksum` lưu, `X-OC-Mtime` giữ, huỷ 204 → 404 | **LOCAL PASS** home + NAS | như trên |
| Thu hồi thiết bị (admin `occ user:auth-tokens:delete`) | **LOCAL PASS có trễ**: request ngay sau vẫn 207, 401 sau ≈ 6 s; thiết bị khác vẫn 207 | như trên `revoke` |
| Tự đăng xuất thiết bị (`DELETE /ocs/v2.php/core/apppassword`) | **LOCAL PASS**: 401 ngay, cả mount NAS | như trên |
| Offboard (disable member-b khi đang upload dở) | **LOCAL PASS**: mọi thiết bị 503 ngay (home, NAS-TeamB, chunk, MOVE); file dở không xuất hiện trên NAS; SMB trực tiếp vẫn vào được tới khi khoá tài khoản NAS (`NT_STATUS_ACCOUNT_DISABLED`); persona đã bật lại | như trên `offboard` |
| Flow: ghi qua WebDAV vào mount SMB → `NodeCreated/Written` → receiver `tag_verified`; Flow core chặn file `-mat` với member-a (404), chủ 200; Team B/outsider 404 | **LOCAL PASS** | `acceptance-nas-flow.json` |
| Flow: thay đổi trực tiếp trên NAS (SMB put, rename, ghi filesystem + `occ files:scan`, Depth infinity) phát webhook? | **Không**: hook-sink không lọc bắt 0 event; `NodeAddedToCache`/`FileCacheUpdated`/`NodeRemovedFromCache` đăng ký webhook → 400 | như trên `webhooksCapturedOnSink`, `sinkHooks` |
| Flow: đối soát Files theo thư mục bắt thay đổi NAS (file mới, file đổi tên, file scan) | **LOCAL PASS**: mọi file NAS có journal `source=reconcile`; file thiếu tag → `tag_missing` + audit | như trên, `discoveryPaths` |
| E2E đối soát Files (fake Nextcloud) | **LOCAL PASS 8/8** | `apps/api/test/flow-files-reconcile.e2e-spec.ts` |
| Restart NAS + notify + Nextcloud (docker restart) → sẵn sàng sau ≈ 1,5 s, mount verify ok, notify vẫn giao, ACL lặp lại PASS | **LOCAL PASS** | `restart.json`, `acceptance-nas-acl-after-restart.json` |
| Backup (maintenance mode ≈ 34 s: pg_dump + volume Nextcloud + volume NAS) → restore sang stack riêng → mount verify ok, ACL WebDAV + SMB như bản gốc, fileid/tag/comment/share/SHA-256 của file mẫu giữ nguyên, Flow core vẫn chặn `-mat` | **LOCAL PASS** | `backup.json`, `verify-restore.json` |

## 4. Độ trễ đo được (LOCAL, một máy dev, NAS cùng máy, mẫu nhỏ — không dùng cho sizing)

| Tình huống (mount Team A, kiểm khi truy cập) | Thấy trong listing WebDAV Depth 1 |
|---|---|
| Notify bật, ghi qua SMB (người dùng) | p50 73 ms, max 86 ms (6/6) |
| Notify bật, ghi trên filesystem NAS | p50 86 ms, max 108 ms (6/6) — nhờ kiểm khi truy cập; notify **không** thấy ghi filesystem |
| Notify tắt, SMB / filesystem | p50 82 / 93 ms (6/6) — các lần ghi cách nhau ≥ 1,2 s |
| **Burst** (file 2 ghi trong cùng giây với lần listing trước) | notify + SMB: 4/4 thấy; notify + filesystem: **0/4**; notify tắt: **0/4** trong 15 s |
| Sau burst bị lỡ | truy cập thẳng đường dẫn file (Depth 0) hoặc `occ files:scan` thư mục (≈ 240–370 ms) mới thấy |
| Gốc home của người dùng đổi ETag (client sync bắt đầu tải) sau ghi SMB | p50 127 ms |
| Team B (không kiểm, không notify) | không thấy sau 10 s; `files:scan` thư mục ≈ 245–356 ms rồi thấy |
| Scan toàn mount Team A (18 thư mục, 159 file, 2,3 GB) / Team B (3, 12) | ≈ 305–392 ms / ≈ 220 ms |
| Flow: thao tác WebDAV → receiver xong | ≈ 0,8–1,2 s (webhook, worker `--interval=1`) |
| Flow: ghi SMB trên NAS → journal đối soát xong | ≈ 1,7–1,9 s (nhịp đối soát 2 s) |

Nguyên nhân burst: Nextcloud lưu `storage_mtime` theo giây và chỉ quét lại thư mục khi
mtime thư mục **lớn hơn** giá trị đã lưu; notify của Samba chỉ báo thay đổi đi qua smbd. NAS
thật có job/ứng dụng ghi trực tiếp (rsync, máy quét, Synology Drive…) phải có scan định kỳ
hoặc đối soát.

File lớn 1 GiB: PUT chunk 130 MiB/s, ghép (MOVE `.file` sang SMB) 4,9 s, đầu-cuối 80 MiB/s,
tải về 223 MiB/s; ghi 1 GiB trên NAS 3,5 s, Nextcloud liệt kê đủ kích thước sau 140 ms (notify),
scan thư mục 473 ms, tải về 231 MiB/s. `X-OC-Mtime` giữ trong cache Nextcloud nhưng **không**
áp lên NAS (NAS ghi thời điểm upload).

## 5. Thay đổi mã: đối soát Files theo thư mục (receiver Flow)

- Rule `files.verify-tag` thêm trường tuỳ chọn `reconcile: boolean` (kiểm lúc khởi động);
  chỉ chạy khi `FLOW_RECONCILE_MS > 0`. Không đổi hợp đồng API (journal đã có
  `source=reconcile`), không đổi OpenAPI.
- `NextcloudFlowClient.listFolderFiles`: PROPFIND Depth 1 đệ quy (như client sync) trong cây
  của **runner**, chỉ nhận href nằm dưới đúng thư mục rule (bỏ `../`, href lạ, URL tuyệt đối),
  giới hạn 5 000 file / 500 thư mục, chỉ gọi origin cấu hình, không theo redirect.
- `FlowService.reconcileFolder`: ảnh chụp `FlowFileState` (fileid → ETag, collection
  `flow_file_states`). Lần đầu chụp gốc, chỉ đưa vào file đổi từ mốc kích hoạt rule. Sau đó:
  fileid mới → `NodeCreatedEvent`, ETag đổi → `NodeWrittenEvent` (`source=reconcile`,
  `ruleIds=[rule]`, dedupe theo `fileid|etag`); bỏ qua nếu journal đã có event webhook cho
  file đó từ thời điểm sửa; file biến mất rời ảnh chụp (trừ khi danh sách bị cắt). Runner
  401/403/404 → không đưa gì, audit `flow.reconcile.failed`, rule khác vẫn chạy, ảnh chụp giữ.
- Event đối soát mà file không có tag mong đợi → quyết định cuối `tag_missing` + audit
  `flow.files.tag_missing` (thay đổi ngoài Nextcloud không qua Flow core nên tag không tự
  đến; event webhook vẫn giữ cách cũ: thử lại `tag_pending`).
- Test: `flow-files-reconcile.e2e-spec.ts` 8/8 (cấu hình, ảnh chụp gốc + thư mục con,
  NodeWritten, không nhân đôi với webhook, đổi tên ngoài Nextcloud, href lạ/không tải URL lạ/
  chỉ dùng runner, 403/401 đóng an toàn + bù khi có lại quyền, giới hạn cắt danh sách);
  `flow-receiver.e2e-spec.ts` chat14 vẫn 13/13.

## 6. Phát hiện và giới hạn

1. **Đổi tên chỉ khác hoa/thường làm mất file (mặc định).** `SMB::rename` (files_external
   1.25.1, DOC đọc mã) bắt `AlreadyExistsException` rồi `remove($target)` và rename lại; với
   NAS không phân biệt hoa/thường, "đích" chính là file nguồn → file bị xoá, MOVE trả 500
   (LOCAL repro 2/2, log `NotFoundException`). Bắt buộc `case_sensitive=false` cho mount SMB
   tới NAS không phân biệt hoa/thường (Windows/Synology/QNAP mặc định); khi đó Nextcloud từ
   chối đổi tên kiểu này (500) — người dùng phải đổi qua tên trung gian. Cần báo upstream.
2. **Rename/move ngoài Nextcloud mất metadata**: notify chỉ đánh dấu thư mục cũ → scan thấy
   "xoá + tạo mới" → fileid mới; share (kể cả với người trong đội), tag, comment gắn fileid
   cũ bị mất. Quy định: đổi tên/di chuyển qua Nextcloud; NAS chỉ cho sửa nội dung (ghi đè giữ
   fileid) hoặc chỉ đọc cho người dùng.
3. **SMB trực tiếp ngoài tầm Flow core/ACL Nextcloud**: nas-member-a đọc được file `-mat` bị
   Flow core chặn trong Nextcloud. Thư mục cần kiểm soát truy cập mức file phải chỉ cho truy
   cập qua Nextcloud (SMB chỉ cho tài khoản dịch vụ) hoặc dùng ACL trên NAS tương ứng.
4. **Flow core gắn tag theo ngữ cảnh "ai phát hiện" file NAS**: phát hiện trong request web
   (listing/truy cập) → đủ tag (`flow14-hoso` theo RequestURL và `flow14-mat` theo tên);
   phát hiện bằng `occ files:scan` (CLI) → chỉ tag theo tên, rule theo URL không áp → receiver
   đánh `tag_missing`. Rule Flow core cho NAS nên dựa trên tên/đường dẫn file, không dựa URL.
5. **Không có event cho thay đổi ngoài Nextcloud**; event cache không tương thích webhook.
   Đối soát receiver là đường duy nhất (đã làm); notify/scan vẫn cần để Nextcloud cập nhật
   cache. Lần chạy đầu của `acceptance-nas-flow`, hai lần giao webhook của file `-mat` lỗi
   `cURL error 56` qua relay (log Nextcloud 2026-10-25T09:49:42Z, không gửi lại); đối soát đã
   bù (journal `source=reconcile`, `tag_verified`). Lần chạy cuối 0 lỗi giao.
6. **Burst cùng giây không được thấy** nếu không có notify bắt được thay đổi (mục 4).
7. **NFD**: cần `encoding_compatibility=true` (tài liệu ghi "chậm"; chưa đo chi phí trên NAS
   thật). Hai file cùng tên dạng NFC và NFD cùng tồn tại trên NAS: **NOT_TESTED**.
8. **ETag không đổi khi ghi đè cùng kích thước trong cùng giây** (home: md5 mtime+size; SMB
   tương tự) → If-Match không phân biệt được hai lần ghi tuần tự trong cùng giây (LOCAL).
   Ghi đồng thời thực tế vẫn không mất bản nhờ khoá file (423) — xem mục 3.
9. **Thu hồi token bằng `occ`** trễ tới TTL 10 s (cache APCu theo node web; nhiều node web
   thì mỗi node tự hết hạn). Disable tài khoản trả 503 cho client (client hiểu là bảo trì,
   tiếp tục thử) — offboard phải **xoá token** (như chat13) và **khoá tài khoản NAS**.
10. **PROPFIND Depth: infinity đang được phép** (207): rủi ro tải với cây lớn; cân nhắc tắt
    khi lên thật (client không cần).
11. **Một danh tính SMB cho cả đội** (mount `password::password`): NAS không phân biệt ai
    trong đội ghi qua Nextcloud; audit theo người phải lấy từ Nextcloud. Kiểu xác thực
    theo người (`logincredentials`/Kerberos) không dùng được với OIDC + app password (DOC).
12. `enable_sharing=true` cho phép thành viên chia sẻ file NAS cho người ngoài đội qua
    Nextcloud — là quyết định chính sách (chưa khoá trong PoC).
13. Backup PoC loại trừ hai file 1 GiB thử; passdb Samba không nằm trong volume (tạo lại từ
    secret khi khởi động). Ghi trực tiếp vào NAS trong lúc maintenance mode vẫn có thể xảy ra
    → NAS thật cần snapshot riêng đồng bộ với backup Nextcloud.
14. Container Nextcloud work13 đang chạy image dẫn xuất; `docker compose up` của chat13 không
    kèm override sẽ quay về image không có smbclient (mount báo lỗi, dữ liệu không mất).

## 7. Bất biến đã giữ

| Bất biến | Cách giữ / bằng chứng |
|---|---|
| ID bất biến | uid 64-hex và group id federated cho mount/ACL; fileid giữ khi ghi đè và rename qua Nextcloud, giữ qua restore; rename ngoài Nextcloud đổi fileid (đã ghi là phát hiện) |
| Deny Team B/outsider qua WebDAV và SMB trực tiếp | `acceptance-nas-acl*.json`, `verify-restore.json` |
| Restart, backup/restore có kiểm lại ACL | `restart.json`, `verify-restore.json` |
| Không ghi DB/data directory Nextcloud trực tiếp | Chỉ `occ`, WebDAV/OCS; DB/volume chỉ đọc khi backup; mọi sửa "trực tiếp" là trên volume NAS |
| Không tin dữ liệu chưa xác thực | Webhook vẫn qua guard chat14; đối soát chỉ dùng fileid/ETag đọc lại bằng runner, href lạ bị bỏ |
| Quyết định quyền ở điểm cuối | Receiver đọc tag bằng quyền runner ngay trước khi kết luận; runner mất quyền → không đưa gì vào, audit |
| Không tải URL tuỳ ý | Chỉ origin cấu hình; test khẳng định href tuyệt đối/metadata trong phản hồi không bị gọi |
| Secret | Mật khẩu NAS/app password ở `poc/sync-nas/secrets/` (0600, Git bỏ qua); `scan-secrets.mjs` PASS 39 giá trị |

## 8. Cần thiết bị/NAS thật của chủ dự án để kiểm (NOT_TESTED trong chat15)

1. **Nextcloud Desktop** trên 2 máy (macOS + Windows): đăng nhập Login Flow v2 qua OIDC
   Authentik → app password; sửa offline rồi nối lại (conflict copy), selective sync, virtual
   files (Windows CfAPI / macOS File Provider), xử lý case clash `dup`/`DUP` và tên NFD,
   đổi tên chỉ khác hoa/thường trên thư mục NAS (sau khi đặt `case_sensitive=false`).
2. **Android + iOS**: đăng nhập OIDC, tải/xem offline, auto-upload ảnh, thu hồi thiết bị từ
   web (thời gian client nhận 401), mất thiết bị, MDM nếu có.
3. **NAS thật** (model/firmware do chủ dự án chọn — xem câu hỏi mở): SMB notify có hoạt
   động không, ứng dụng trên NAS (Synology Drive/QNAP Qsync, rsync, máy scan) ghi trực tiếp,
   ACL Windows/AD, snapshot, case sensitivity và chuẩn hoá Unicode của NAS, hiệu năng
   `encoding_compatibility` và scan trên cây thật, đứt mạng NAS giữa chừng.
4. Hành vi client khi server trả **503** do tài khoản bị disable và khi token bị xoá.

## 9. Lệnh đã chạy và kiểm repo

Trong `poc/sync-nas/` (đều PASS lần chạy cuối, trừ ghi chú): build 2 image, `create-secrets`,
`compose.sync15.yaml up`, tạo lại Nextcloud work13 bằng override, `setup-nas-mounts`,
`acceptance-nas-acl` (trước/sau restart), `probe-detection` (đo), `acceptance-nas-changes`,
`repro-case-unicode` (repro), `acceptance-nas-large` (1 GiB), `acceptance-sync-webdav`,
`acceptance-nas-flow`, `restart-sync15`, `backup-sync15`, `restore-sync15`,
`verify-restore-sync15`, `measure-scan`, `environment`, `scan-secrets`.

- E2E: `ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/flow-files-reconcile.e2e-spec.ts` → 8/8; `test/flow-receiver.e2e-spec.ts` → 13/13.
- `pnpm ai:check` (changed gate): **PASS** — guard, contract lint, typecheck BE, BE 322 passed /
  10 skipped (38 suite), độ phủ hợp đồng 148/148.
- `pnpm ai:check:full`: **PASS** (mục 10).

Trạng thái để lại: stack work13 + overlay flow14 + sync15 (`nas15`, `smb-client`,
`files-notify`) đang chạy; stack restore đã dừng (volume giữ); MongoDB thử 18141 đã tắt;
persona member-b và tài khoản NAS `nas-manager-b` đã bật lại; webhook Flow trỏ receiver với
bí mật trong `poc/flow/secrets/` của worktree chat15; dữ liệu thử còn trên NAS (thư mục
`Chat15-*`, `Flow14-HoSo`, hai file 1 GiB).

## 10. Gate đầy đủ

`pnpm ai:check:full` trên bản cuối (trước khi commit): **PASS** — guard 44/44, contract lint
hợp lệ (193 cảnh báo kiểu operationId như trước), typecheck BE/FE, BE 322 passed / 10 skipped,
độ phủ hợp đồng 148/148, FE 84 test (15 file), build web/api đạt. Không đổi `contract/` hay FE.

## 11. Đề xuất phạm vi chat16 (Groupware Calendar/Contacts)

1. Bật Calendar 6.x/Contacts 8.x trên stack local riêng hoặc stack work13 (pin version,
   preflight chữ ký như chat14); CalDAV/CardDAV với uid bất biến, app password.
2. Lịch cá nhân, lịch chia sẻ theo nhóm Team A/B (quyền đọc/ghi), lời mời họp nội bộ
   (iMIP qua Stalwart local, **không** gửi mail thật), phòng/tài nguyên (resource booking),
   múi giờ Asia/Ho_Chi_Minh + DST đối tác, lịch lặp + ngoại lệ, free/busy.
3. Danh bạ cá nhân, sổ địa chỉ chia sẻ theo nhóm, sổ hệ thống (ẩn outsider), import/export
   vCard, ETag/If-Match và sync-token (`REPORT sync-collection`) như client làm.
4. Deny Team B/outsider qua CalDAV/CardDAV và UI; offboard: chuyển lịch/danh bạ, thu hồi app
   password (lưu ý trễ cache 10 s và 503 khi disable ở chat15); restart, backup/restore có
   kiểm ACL.
5. Nối Flow: event lịch có phát webhook không (`CalendarObjectCreatedEvent`…), nếu không thì
   đối soát bằng sync-token. Thiết bị thật (Thunderbird/macOS Calendar/iOS/Android DAVx⁵)
   ghi NOT_TESTED nếu chưa có.
