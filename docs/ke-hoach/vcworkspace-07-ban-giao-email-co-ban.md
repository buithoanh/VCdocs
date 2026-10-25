# VCworkspace 07 — bàn giao Email cơ bản

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, Stalwart thật; không deploy,
  không mail/MX/Internet thật, không commit hoặc push.
- Kết luận: **UI/API/MIME/mailbox nội bộ, draft, thread, reply, attachment và
  SMTP/IMAP thật đạt trong phạm vi local; chưa mở chat08.**

## Hợp đồng và kiến trúc

OpenAPI lên `2.0.0-gd1`; schema FE được sinh lại. Thêm mailbox list, thread,
draft create/get/update, send idempotent và tải raw MIME. `MailPort` trung tính có
fake cho gate và adapter Stalwart opt-in; adapter chỉ nhận host loopback. MongoDB
chỉ giữ mapping/trạng thái, raw MIME và attachment nằm ở mail server.

Stalwart `0.16.27` image `stalwartlabs/stalwart:v0.16`, digest
`sha256:c429b311c93db5606598abc1c68225a85a6953183848ae01bee9c6a98885836c`,
linux/arm64. Container `vcworkspace-mail-chat07` chỉ bind loopback, volume riêng;
Nextcloud/ONLYOFFICE không restart/purge. Domain `vcworkspace.test`, hai mailbox
giả. Nextcloud Mail là IMAP/SMTP client AGPL-3.0, không phải engine; không cài
vào Nextcloud Drive đang khỏe.

Rào outbound được bổ sung sau review: `poc/mail-stalwart/compose.yaml` đặt
Stalwart **chỉ** trong Docker network `internal`; sidecar relay hai network chỉ
proxy năm cổng cố định từ host loopback tới `mail:<cùng cổng>`, không nhận địa
chỉ đích từ client và không chạy SMTP router. `verify-no-egress.py` xác nhận
network internal không kết nối được `1.1.1.1:443`; `verify-relay.mjs` xác nhận
TLS/SMTP đi qua relay tới Stalwart và server từ chối phiên chưa xác thực.

## Bằng chứng đã chạy

- Protocol thật: SMTP TLS A→B ACK, IMAP TLS B fetch raw MIME; marker
  `chat07-1792759673471`, attachment SHA-256
  `190f41f56c73fc5e17dd939d64bd4627219c476dcee2dd9fa0b7bcc338678140`,
  fetch 1.663 byte.
- API e2e `mail-basic.e2e-spec.ts`: 2/2 đạt — draft reopen, A→B,
  reply giữ thread, raw MIME Unicode/attachment base64, HTML bỏ script/event,
  header injection và địa chỉ ngoài `.test` bị chặn, tenant không đọc mailbox
  người khác, retry cùng key không gửi trùng.
- Browser thật: manager lưu/mở lại draft, gửi A→B và UI chỉ báo thành công sau
  ACK; B thấy inbox. B gửi lại attachment `chat07-ui-attachment.txt`, manager
  thấy đúng thư trong inbox và có link tải MIME gốc. API test độc lập kiểm byte
  attachment sau tải raw MIME; browser downloadMedia timeout nên không nâng lượt
  browser này thành phép băm file tải độc lập.
- UI sau review có thao tác **Chuyển tiếp** thật: tải raw MIME thuộc mailbox qua
  API, đính kèm nguyên thư dưới dạng `message/rfc822`, điền `Fwd:` và phần thông
  tin thư gốc trước khi người dùng chọn người nhận và gửi.

## Giới hạn

Chat07 chưa có alias/shared mailbox/label/filter/search nâng cao (chat08), chưa
liên thông Drive/Office (chat09), chưa mobile client, tải nhiều người, HA/sizing,
TLS tin cậy hoặc production. Listener plaintext 143/587 chỉ host-map loopback qua
sidecar cho chẩn đoán; luồng nghiệm thu dùng SMTPS 465 và IMAPS 993 tự ký local.
API chặn địa chỉ ngoài `.test`, adapter từ chối host không loopback, và Stalwart
không có route Internet.

Sau khi chủ dự án cho phép, recovery admin và đúng hai mailbox `.test` được đặt
lại bằng credential local mới, không đọc secret cũ và không chạm tài khoản thật.
Protocol test trên topology sidecar mới đạt AUTH + SMTP ACK + IMAP fetch với
marker `chat07-1792761321413`, attachment SHA-256
`190f41f56c73fc5e17dd939d64bd4627219c476dcee2dd9fa0b7bcc338678140` và
732 byte fetch. Test FE riêng cho chuyển tiếp raw MIME đạt 1/1.
