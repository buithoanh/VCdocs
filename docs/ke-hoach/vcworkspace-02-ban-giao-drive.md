# VCworkspace 02 — bàn giao Drive cơ bản và PoC Nextcloud

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi đã duyệt: local cô lập, dữ liệu giả, ACL từng người, A/B, không gian
  phòng/cá nhân, trùng tên 409, tối đa 10 MiB/tệp.
- Kết luận: sáu API/hợp đồng/schema, lớp sản phẩm tối thiểu và PoC Nextcloud
  thật đã hoàn thành trong phạm vi local. Adapter Nextcloud đã nối opt-in vào
  runtime; integration API A/B và smoke UI bằng trình duyệt đều đạt.

## 1. Đề nghị hợp đồng

Đã bổ sung vào `apps/api/DE_NGHI_SUA_HOP_DONG.md`, giữ nội dung cũ: GET /spaces,
GET /drive/items, POST /drive/folders, POST /drive/files multipart,
GET /drive/files/{fileId}, GET /drive/files/{fileId}/content.

Đề nghị đã được chủ dự án duyệt. `contract/openapi.yaml` lên `1.5.0-gd1`, nguồn
ghi D23, schema FE đã sinh lại. DTO trung tính, 403/404 chống lộ, 409 trùng tên,
upload 10 MiB, MIME PoC, fingerprint có SHA-256 byte, replay/conflict
idempotency, download header, taxonomy lỗi storage và audit scrub đã vào hợp đồng.

## 2. PoC đã chuẩn bị

`poc/drive-nextcloud/` gồm core PoC và MemoryStorage, adapter WebDAV, helper OCS
share read-only, runner opt-in `run-nextcloud.mjs`, Compose local chỉ bind
loopback, trần 2 CPU/2 GiB RAM và 21 unit/harness tests. Image Nextcloud 33.0.5
Apache chính thức ARM64 đã ghim digest; giấy phép
AGPL-3.0-or-later; không dùng latest.

Nguồn: wiki image và metadata Docker Hub chính thức, Nextcloud Developer Manual
cho OCS Share API. Digest ARM64 đọc ngày 2026-10-23.

## Kết quả cuối sau khi được duyệt triển khai

- Docker Desktop 4.96.3 ARM64: client `darwin/arm64`, engine `linux/arm64`.
  Bản Intel sai kiến trúc được giữ tạm tại
  `/private/tmp/VCworkspace-Docker-Intel-backup.app`, chưa xoá.
- Nextcloud 33.0.5 chạy đúng digest, project `vcworkspace-drive-poc`, chỉ publish
  `127.0.0.1:18080`. Evidence cuối `p01-p12-matrix-mvkn94h0.json`: 11 pass,
  P03 tách quy trình; `p03-restart-mvkn94h0.json`: P03 pass sau khi `StartedAt`
  đổi và checksum giữ nguyên. Tổng P01–P12 không còn fail/blocked.
- P10 để kho thật nhận byte rồi mới phát timeout có kiểm soát; runner đối soát,
  retry cùng key và chứng minh đúng một metadata/file cùng checksum.
- Số đo lúc bàn giao: khoảng 71.64 MiB/2 GiB RAM, 0.01% CPU; volume cô lập
  `vcworkspace_drive_poc_nextcloud` khoảng 954.6 MiB.
- Lớp sản phẩm có bốn collection `workspace_spaces`,
  `workspace_space_members`, `workspace_drive_items`, `upload_attempts`; sáu API,
  manager/reader, checksum, 10 MiB, MIME PoC, idempotency theo byte, 409 không
  ghi đè, audit metadata và trang `/bo-nho` tạo/list/upload/download.
- `WorkspaceStoragePort` giữ fake mặc định và chọn Nextcloud bằng cấu hình opt-in;
  credential tách theo email. Integration API chứng minh A ghi, B chỉ đọc và
  metadata/byte/checksum còn sau restart. Evidence scrub:
  `api-nextcloud-mvknc24c.json`.
- Browser smoke run `mvkqwtie`: A-manager tạo thư mục, upload/list/download;
  B-reader thấy phòng ở vai trò chỉ đọc, không có điều khiển ghi, vẫn list và
  download; personal B trống. Tệp nguồn và hai bản tải về cùng SHA-256
  `01751a26...f70913`. Evidence scrub:
  `browser-smoke-mvkqwtie.json`; hash hai ảnh Cua được ghi trong evidence.
- Full gate cuối: guard 43/43; OpenAPI hợp lệ (138 cảnh báo hiện có); BE 132/132,
  104/104 điểm cuối; FE 72/72; typecheck/build đạt. Harness 21/21 đạt.
  Integration Nextcloud opt-in bị skip trong full gate không credential và đã
  chạy riêng đạt 1/1 bằng credential giả local.

Các dòng “Chưa chạy” và blocker thiếu Docker ở phần lịch sử bên dưới phản ánh
trạng thái trước khi chủ dự án duyệt runtime, nay đã được kết quả cuối này thay thế.

## 3. Kết quả P01–P12 hiện hành

| Ca | Fake/harness | Nextcloud local | Nhận xét |
|---|---|---|---|
| P01 | Đạt | Đạt | tạo folder thật; API sản phẩm cũng tạo qua Nextcloud |
| P02 | Đạt | Đạt | upload/list/download thật, SHA-256 byte khớp |
| P03 | Đạt | Đạt | restart container, metadata API và byte/checksum còn nguyên |
| P04 | Đạt | Đạt | B-reader đọc/tải qua API bằng credential riêng |
| P05 | Đạt | Đạt | B-reader tạo qua API bị 403; kho cũng từ chối ghi |
| P06 | Đạt | Đạt | B không truy cập personal A bằng credential riêng |
| P07 | Đạt | Đạt | cùng key/cùng byte trả đúng một file |
| P08 | Đạt | Đạt | cùng key/khác byte xung đột, bản cũ nguyên |
| P09 | Đạt | Đạt | tên trùng 409, không overwrite/auto-rename |
| P10 | Đạt | Đạt | kho nhận byte rồi timeout; đối soát + retry còn một metadata/file đúng SHA-256 |
| P11 | Đạt | Đạt | quá 10 MiB/MIME cấm không có blob ready |
| P12 | Đạt | Đạt | audit không có byte/credential/header bí mật |

Đã chạy kiểm cú pháp module/runner, 21 test Node và `git diff --check`: đều đạt.
`pnpm ai:check` lần đầu bị sandbox chặn MongoDB thử mở cổng local; chạy lại với
quyền loopback đạt: guard/gate 40/40, OpenAPI hợp lệ với 131 cảnh báo hiện có,
BE 129/129 và 98/98 điểm cuối, FE 72/72, typecheck/build đạt. Gate dùng Google
giả và không phải bằng chứng Nextcloud.

Sau review điều phối, đã bổ sung parser DAV chỉ nhận `propstat` 200, hỗ trợ
namespace/collection tự đóng, XML entity, timeout và chuẩn hoá lỗi mạng; 4 unit
test adapter và 5 test runner-support, tổng 21/21 test đạt. Runner thật có preflight endpoint
loopback/port/project/service/image, tự provision A/B và hai root thử, dùng
credential từng người, đối soát OCS share read-only và ghi evidence
pass/fail/blocked đã scrub. Matrix/restart dùng file riêng theo runId. P01 được
gắn lớp `adapter`, không tự nhận là UI; P03 chỉ pass khi `docker inspect StartedAt`
đã đổi sau lượt matrix. Evidence hiện hành run `mvkn94h0`: matrix 11 pass và
P03 tách quy trình; restart P03 pass. P10 thuộc lớp
`post-store-timeout-recovery`: adapter thật ghi byte rồi wrapper phát timeout;
retry cùng key trả cùng fileId/checksum và không tạo bản thứ hai.

## 4. Phần chưa làm và blocker hiện hành

- Không còn blocker hook/browser cho Chat02. Hook phân loại shell và patch theo
  `tool_name`; patch qua trường adapter `cmd` không còn bị quét như lệnh shell.
  Hook tiến trình thật và fixtures chứng minh patch chứa ví dụ âm được phép,
  còn CLI vận hành, Google thật, production, secret, schema sinh tự động và
  thao tác nguy hiểm vẫn bị chặn. Guard/gate đạt 43/43.
- Smoke `/bo-nho` chạy bằng harness Jest/ts-jest, Mongo tạm, Google fake và
  Nextcloud loopback; không gọi `loadDotEnv`. FE dùng `NEXT_DIST_DIR` riêng để
  không tranh chấp cache với build/gate song song. Ảnh manager/reader đã chụp
  bằng Cua; tool cung cấp ảnh inline nên evidence lưu SHA-256 ảnh thay vì bản
  JPEG trong repo.
- Chưa thử rộng Unicode/case sensitivity và chưa thiết kế secret vận hành.
  Credential A/B chỉ là dữ liệu giả local; fake vẫn là mặc định.
- Không đọc `.env`, không truy cập Google/CSDL thật, không deploy/commit/push.

## 5. Chạy và cleanup an toàn sau khi có Docker

Kiểm Docker/Compose, CPU/RAM và còn ít nhất 3 GiB trước khi chạy. Credential
ngẫu nhiên nằm trong `.poc-secrets` mode 600, không in/commit. Chỉ dùng project
`vcworkspace-drive-poc`, port loopback và target mang đúng tiền tố PoC.

Tạo A/B bằng occ, tạo root phòng/cá nhân, share phòng A sang B read-only; chạy
P01-P12 và restart test, lưu evidence đã scrub. Trước cleanup phải liệt kê và
đối chiếu chính xác container/network/volume thuộc project; tuyệt đối không dùng
glob, prune hoặc tác động volume khác. Lệnh cleanup chỉ được chạy trong phiên
môi trường được giao quyền sau bước xác nhận target.

## 6. Bước tiếp theo sau khi duyệt hợp đồng

1. Phiên hợp đồng duyệt/chỉnh sáu API rồi mới sửa OpenAPI và sinh schema FE.
2. Cấp Docker trong phiên môi trường riêng; chạy ma trận kho thật trước code sản
   phẩm lớn, ghi số đo và digest thực tế.
3. Nếu kho đạt, triển khai StoragePort, metadata/UploadAttempt Mongo, policy,
   audit và UI tối thiểu; giữ M03 Google tương thích.
4. Chạy test mới, `pnpm ai:check`, rồi `pnpm ai:check:full` trên final tree.

Không mở chat 03 từ phiên này. Chat điều phối quyết định khi hợp đồng và bằng
chứng Nextcloud thật đã đủ.
