# VCworkspace 09 — bàn giao liên thông Email–Drive–Office

- Ngày: 2026-10-24.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, CSDL thử; không deploy, mail/MX/Internet
  thật, dữ liệu thật, commit hoặc push.
- Trạng thái: **hoàn tất trong phạm vi local: mã, hợp đồng, fake E2E, browser
  A→B trên ba engine thật, real-integration và full gate cây cuối đều đạt.**

## Hợp đồng và hành vi

OpenAPI `2.2.0-gd2` thêm ba API:

1. `POST /mail/messages/{messageId}/attachments/{part}/save-to-drive`: authorize
   mailbox nguồn và quyền manager của không gian Drive đích; parse raw bằng
   `mailparser`, chọn đúng part, chuẩn hoá basename Unicode NFC, bỏ control/bidi,
   giới hạn 10 MiB, allowlist MIME và kiểm cấu trúc OOXML/PDF. Version 1 giữ
   provenance message/mailbox/part/SHA-256 ngay trong lần ghi; retry cùng key
   trả lại cùng file.
2. `POST /mail/send-drive-file`: chế độ `attachment` lấy đúng `versionId` và
   SHA-256 tại lúc compose, tạo snapshot MIME; chế độ `link` yêu cầu mọi người
   nhận đã có ACL Drive trước, không tự cấp quyền. Cả hai dùng send journal/CAS
   chat08 với key ổn định để bind toàn payload, tránh gửi trùng và reconcile hậu
   ACK. Cùng key đổi file/version/hash/recipient/nội dung trả 409, kể cả outer
   journal mất receipt hoặc hai request chạy đồng thời.
3. `GET /drive/shared-links/{token}`: cookie đăng nhập + intended-recipient +
   ACL Drive hiện tại; link cố định version/hash, hết hạn 7 ngày và từ chối khi
   revoked. Token chỉ là định danh, không thay xác thực.

Email ghi URL tuyệt đối `${WEB_ORIGIN}/bo-nho/lien-ket#token`. Fragment không đi
vào request/access log; khi cần đăng nhập, web lưu tạm token trong
`sessionStorage`, chỉ đưa route sạch vào `returnTo`, rồi xoá token sau khi dựng
nút tải.

UI Email có thao tác lưu attachment vào không gian được phép ghi. UI Drive có
chọn người nhận và phân biệt rõ “snapshot attachment” với “link cần đăng nhập”.

## Bằng chứng đã chạy

- Target `workspace-interop.e2e-spec.ts`: 2/2 đạt trên MongoDB thử.
  - DOCX từ mail A→B được parse/lưu với hash/provenance, basename traversal bị
    loại, retry không nhân file; B gửi snapshot đúng version lại A.
  - Hash sai bị 409; XLSX/PPTX representative đi qua cùng đường và raw MIME có
    đúng routing content type.
  - Link department A→B tải đúng hash; A dù có ACL Drive không dùng được link
    dành cho B; link revoked trả 404; personal file không tự cấp quyền cho B;
    retry cùng key trả cùng mail, không tạo delivery mới.
- `pnpm ai:check:full`: PASS trên cây cuối sau browser/real-integration/review:
  guard 44/44; OpenAPI hợp lệ (181 warning hiện có); BE 157/157 (6 suite tích
  hợp opt-in được skip trong gate), coverage hợp đồng 140/140; FE 76/76; typecheck
  và build API/web đạt.
- Browser A→B thật, run `chat09-1792812692823`:
  - A gửi DOCX V1 qua Stalwart; B lưu đúng attachment vào Nextcloud với SHA-256
    `239486a3f840d48029894811428b5a5547f8ebab918e6f8699d758df0417fcbf`.
  - B mở bằng ONLYOFFICE, sửa marker thành
    `CHAT09 BODY V2 chat09-1792812692823`, Save và mở lại cùng file
    `6adc26e2c176b8a244a9a188`; UI hiện bản 1 và bản 2.
  - DOCX V2 tải lại có SHA-256
    `19988b15dde130c292ae1ba25f707d3b6f383ff094ba5808a0b8cb4d9f863160`
    và XML chứa đúng marker V2.
  - B gửi snapshot V2 cho A và gửi link đăng nhập cho B. A tải raw MIME;
    attachment 25.302 byte có đúng SHA-256 V2.
- Real integration riêng trên Stalwart + Nextcloud: 1/1 đạt. Retry cùng
  idempotency key chỉ có một delivery/một link; B tải đúng snapshot/hash; A dù
  có ACL không phải intended-recipient nên 403; expiry và revoke đều 404.
  Evidence máy đọc được ở `poc/onlyoffice/evidence/chat09-real.json`.
- Review-fix E2E: race tạo link thua unique-key đọc lại row và revalidate
  fingerprint; snapshot cùng key đổi payload sau khi xoá outer receipt trả 409;
  hai request concurrent khác payload cho đúng một 201/một 409; save attachment
  cùng bytes nhưng khác source message trả 409.
- Browser login-return run `chat09-1792813754428`: MIME chứa URL web tuyệt đối;
  logout rồi mở link chuyển tới `/dang-nhap?returnTo=%2Fbo-nho%2Flien-ket`
  không có token; đăng nhập B quay lại route sạch, tải DOCX SHA-256
  `e31c808c…a6c680f` đúng expected. Access log lượt cuối không chứa token.

## Giới hạn còn lại

- Chưa fault-inject crash đúng khoảng giữa từng engine trong một transaction
  phân tán; retry/journal đã được kiểm bằng fake E2E và real Stalwart–Nextcloud,
  nhưng chưa phải HA/load/production.
- Link expiry hiện cố định 7 ngày trong PoC; chưa có API revoke dành cho UI hoặc
  chính sách retention production. Sync mailbox lớn vẫn giữ giới hạn chat08.

Không đọc `.env`, không khởi động entrypoint BE tự nạp `.env`, không dùng Google
thật và không deploy/commit/push. Chat09 đủ điều kiện bàn giao để điều phối review
và quyết định bước kế tiếp; phiên này không tự mở chat10.
