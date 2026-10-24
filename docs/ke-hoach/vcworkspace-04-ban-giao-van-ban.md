# VCworkspace 04 — bàn giao soạn thảo văn bản

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, StoragePort/Nextcloud thử;
  không deploy, dữ liệu thật, commit hoặc push.
- Kết luận: **hợp đồng, mã, test ứng dụng, editor browser thật và converter
  ONLYOFFICE + Nextcloud thật đều đạt trong môi trường local cô lập.** Docker đã
  phục hồi không purge/reset/xoá volume; chat04 đủ bằng chứng bàn giao kỹ thuật.
  Phiên này không tự mở chat05.

## 1. Hợp đồng và mô hình lưu

Hợp đồng lên `1.7.0-gd1`; nguồn quyết định ghi ở `contract/NGUON.md`, đề nghị
W1–W5 ghi ở `apps/api/DE_NGHI_SUA_HOP_DONG.md`, schema FE sinh lại bằng
`pnpm --filter @vcdocs/web gen:api`.

- `POST /drive/documents`: tạo DOCX OOXML từ mẫu và lưu như version 1.
- `GET /drive/files/{fileId}/editor-config`: manager nhận `edit`, reader nhận
  `view`; JWT, document key gồm fileId + version, vé content/callback hết hạn.
- Content/callback là luồng máy-máy, không dùng cookie. Callback bắt buộc vé HMAC
  và JWT, chỉ chấp nhận URL đúng protocol/host/port của editor đã cấu hình, không
  follow redirect và giới hạn 10 MiB.
- ONLYOFFICE không ghi đè blob hiện hành. Status 2/6 tải DOCX, kiểm magic byte và
  checksum, tạo `WorkspaceDriveVersion` bất biến, cập nhật current version rồi
  mới trả `error: 0`. Callback lặp idempotent không sinh thêm version.
- Export DOCX lấy đúng current version. Export PDF gọi converter có JWT, chỉ tải
  URL cùng origin editor và kiểm `%PDF` trước khi trả người dùng.

`document.key` đổi theo version để không lấy nhầm cache cũ; coediting cùng
version dùng chung key.

## 2. UI/API đã có

UI `/bo-nho` có tạo văn bản từ mẫu, mở trang
`/bo-nho/soan-thao/{fileId}`, tải DOCX và xuất PDF. Trang editor nạp `api.js` từ
Document Server đã cấu hình, hiển thị mode edit/view và lỗi editor. Reader không
nhận quyền edit ở cả config và callback.

Test `apps/api/test/drive-documents.e2e-spec.ts` chạy qua HTTP loopback và
MongoDB thử, đạt 2/2:

1. tạo DOCX → xuất DOCX → manager edit config → reader view config → editor tải
   content → callback lưu version 2 → mở config lại có key v2 → checksum đổi →
   hai version còn đủ;
2. callback lặp không tạo version 3; reader callback, JWT sai và URL metadata
   `169.254.169.254` đều trả `error: 1`; file vẫn ở version 1 trong ca lỗi.

Các test dùng storage giả có cùng StoragePort/version model để kiểm hành vi. Đây
không thay bằng chứng Document Server + Nextcloud + browser thật.

## 3. Engine được chọn và nguồn

- Image ghim: `onlyoffice/documentserver:9.4.0.1`, có tag arm64/amd64 trên registry
  chính thức; máy hiện tại là arm64. Compose ở `poc/onlyoffice/docker-compose.yml`
  chỉ publish `127.0.0.1:18082`, bật JWT, chặn metadata IP và dùng mạng chat04.
- [Tài liệu mở file](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/opening-file)
  yêu cầu config có key/url và Document Server phải tải được URL.
- [Callback handler](https://api.onlyoffice.com/docs/docs-api/usage-api/callback-handler)
  mô tả status 2/6 và yêu cầu storage trả `error: 0`; VCworkspace chỉ trả 0 sau
  khi version đã persist.
- [Docker image chính thức](https://github.com/ONLYOFFICE/Docker-DocumentServer)
  mô tả JWT/private/meta-IP và yêu cầu đề xuất RAM 4 GB, CPU 2 lõi, swap 2 GB.
- [License chính thức](https://github.com/ONLYOFFICE/Docker-DocumentServer/blob/master/LICENSE)
  là AGPL-3.0 có điều khoản bổ sung theo mục 7. Local PoC không phải kết luận
  pháp lý hoặc quyết định production.
- Community Edition được upstream khuyến nghị cho tối đa khoảng 20 người; chưa
  có phép đo để kết luận đủ 48 người hoặc SLA nghiệp vụ.

## 4. Bằng chứng engine/browser thật và giới hạn

Lần pull đầu làm Docker VM dừng; log host ghi lúc `2026-10-23T11:17:17Z`:

`engine ... run error: write .../Data/log/vm/init.log: no space left on device`

Đã dừng đúng tiến trình backend treo rồi khởi động lại Docker Desktop; không
purge/reset/factory reset, không xoá Docker.raw hoặc volume chat03. Manifest
arm64 cùng tag trả `exec format error`, nên Compose ghi rõ `linux/amd64` dùng
image chính thức qua emulation. Container sau đó healthy ở loopback.

- Browser manager đăng nhập Google giả, tạo `Bien-ban-UI-chat04.docx`, mở editor
  ONLYOFFICE thật ở mode `edit`, nhập marker
  `NOI DUNG CHAT04 DA LUU 2026-10-23` và bấm Save. Editor báo “Đã lưu mọi thay
  đổi”; quay lại danh sách thấy tệp tăng từ 1.697 lên 25.428 byte và có bản 2
  lẫn bản 1. Đây là callback engine thật đã persist xuống Nextcloud/model version.
- Mở lại đúng fileId trên editor vẫn ở mode `edit`. Xuất currentVersion V2 qua
  hai link UI: DOCX SHA-256 `06df653a…d6971f`, PDF SHA-256
  `36110c53…20a55`; XML DOCX và text trích từ PDF đều chứa marker đã gõ, không
  phải tiêu đề/mẫu V1.
- Bài tích hợp lặp lại được `node poc/onlyoffice/run-integration.mjs` đạt: tạo
  DOCX trên Nextcloud, manager `edit`, reader `view`, DOCX bắt đầu `PK`, converter
  ONLYOFFICE thật trả PDF 35.102 byte bắt đầu `%PDF-`; giải DOCX và trích text PDF
  đều tìm thấy đúng marker `NOI DUNG CHAT04 DA LUU 2026-10-23`.
- Tại thời điểm đo sau converter: khoảng 99% CPU và 892 MiB RAM; đây chỉ là mẫu
  một lượt trên emulation, không phải sizing production.
- Bằng chứng máy đọc được lưu ở
  `poc/onlyoffice/evidence/chat04-2026-10-23.json`.

Hai phiên cùng version dùng chung document key; test callback bổ sung chứng minh
callback thứ hai mang key cũ sau khi version mới đã persist bị từ chối và không
tạo version 3. Chưa nâng thành kết luận production: chưa đo 48 người, SLA, legal
review, coediting nhiều người dưới tải hoặc fidelity bố cục phức tạp. Việc browser
transport mất kết nối ở hộp tải xuống không ảnh hưởng kết quả converter nhị phân
đã được bài tích hợp thật xác minh lại.

## 5. Gate cây cuối

- `pnpm ai:check:full`: **PASS**.
- Guard/gate: 44/44.
- OpenAPI: hợp lệ, 151 warning hiện có.
- BE: 135/135 chạy đạt, 3 integration opt-in skip; coverage hợp đồng 116/116.
- FE: 72/72; API/FE typecheck đạt; production build đạt, route editor dynamic.
- Target chat04: 2/2 đạt.
- `git diff --check`: đạt.

Không đọc `.env`, không khởi động entrypoint BE tự nạp `.env`, không dùng Google
thật, không deploy/commit/push.
