# Flow PoC (chat 14)

Chạy trên stack chat13 `vcworkspace-work13` (Nextcloud 33.0.10 + Authentik, chỉ bind
`127.0.0.1`), thêm overlay `compose.flow.yaml` (project `vcworkspace-flow14`, không
volume riêng, không tạo lại service work13). Dữ liệu giả, không Google thật, không
email thật. Bàn giao: `docs/ke-hoach/vcworkspace-14-ban-giao-flow.md`.

| Thành phần | Ở đâu | Ghi chú |
|---|---|---|
| `webhook-worker` | container, mạng `work13` (internal) | `occ background-job:worker --interval=1 WebhookCall`, thay cho chờ cron |
| `flow-receiver-relay` | container, `work13` + `host_edge` | đường duy nhất từ mạng nội bộ tới receiver `127.0.0.1:18140` |
| Receiver NestJS | spec Jest có cổng `apps/api/test/flow-nextcloud-server.spec.ts` | Google giả, MongoDB local riêng `127.0.0.1:18141`, không đọc `.env` |
| MongoDB thử | `/usr/local/bin/mongod --dbpath poc/flow/.runtime/db --bind_ip 127.0.0.1 --port 18141` | `.runtime/` Git bỏ qua |

Secret: `WORK13_SECRETS_DIR` trỏ thư mục `secrets/` (Git bỏ qua) của stack chat13;
bí mật webhook chat14 sinh vào `poc/flow/secrets/` (0600, Git bỏ qua). Không in giá trị.

## Trình tự

1. `node preflight-flow-apps.mjs` → `FLOW14_ALLOW_APP_DOWNLOADS=1 node install-flow-apps.mjs`
   (forms_deck 0.7.0, files_automatedtagging 4.0.1, files_accesscontrol 4.0.2; tạm nối
   egress, luôn ngắt trong `finally`; **không cài** `workflow_script`)
2. `docker compose -f compose.flow.yaml up -d`
3. `node setup-resources.mjs` (form, board 2 cột, bảng, thư mục chia sẻ, mapping forms_deck)
4. `node configure-flow-core.mjs` (2 tag restricted, 3 rule Flow core, nhóm `flow14-reviewers`)
5. `node capture-payloads.mjs` (payload thật → `evidence/webhook-payloads.json`, fixture test)
6. Chạy mongod thử (bảng trên), rồi:
   `node acceptance-flow-core.mjs`, `node acceptance-forms-deck.mjs`,
   `node acceptance-tables-notify.mjs`, `node acceptance-files-flow.mjs`,
   `node acceptance-receiver-invariants.mjs`, `node latency-cron-vs-worker.mjs`,
   `node deck-poll-probe.mjs`
7. `node scan-secrets.mjs` trước khi commit

Mỗi script acceptance tự khởi động/dừng receiver (`receiver-lib.mjs`) và đăng ký lại
webhook (`register-webhooks.mjs`). `smoke-receiver.mjs`, `probe-readback.mjs` chỉ để dò lỗi.

## Ghi chú

- Nextcloud gửi webhook **không có Content-Type** và **không gửi lại** khi receiver lỗi
  (job `WebhookCall` bắt exception rồi bỏ) → receiver đọc mọi kiểu thân là JSON và có
  đối soát (`FLOW_RECONCILE_MS`) bù phiếu/dòng bị lỡ từ mốc kích hoạt rule.
- `PHPMongoQuery` của `eventFilter` không có `$regex`: event file lọc theo
  `user.uid ∈ Team A`, receiver lọc thư mục bằng readback theo fileid.
- Xoay vòng bí mật: receiver nhận cả bản cũ và mới → cập nhật webhook Nextcloud sang
  bản mới → bỏ bản cũ (đều cần khởi động lại receiver vì cấu hình qua biến môi trường).
