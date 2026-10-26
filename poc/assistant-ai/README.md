# Assistant AI PoC (chat 19, chỉ đọc)

Chạy trên stack work13 đang chạy (Nextcloud 33.0.10 + Authentik chat13, Calendar/Contacts
chat16, Talk chat17). Assistant **3.5.1** + integration_openai **4.5.2** gọi **Ollama 0.40.11
trên máy host** (`127.0.0.1:11434`, không đổi cấu hình lắng nghe) qua một proxy chỉ cho phép
`GET /v1/models` và `POST /v1/chat/completions`. Mô hình duy nhất đã tải:
`qwen3:4b-instruct-2507-q4_K_M` (Apache-2.0, 2,50 GB); Nextcloud dùng bản alias CPU
`vcws-qwen3-4b-cpu` (`num_gpu 0`, `num_ctx 8192`, tạo bằng `ollama create`, không tải thêm).
Không đọc `.env`, không đọc secret của chat trước: app password `ai19-api` do chat19 tự mint
bằng `occ` vào `secrets/` (0600, Git bỏ qua). Không gọi API AI ngoài.
Bàn giao: `docs/ke-hoach/vcworkspace-19-ban-giao-assistant-ai.md`.

| Thành phần | Nơi chạy | Ghi chú |
|---|---|---|
| Nextcloud work13 | `localhost:18130` | chỉ mạng internal `vcworkspace-work13_work13` |
| Proxy Ollama | `vcworkspace-ai19-ollama-proxy-1` (không publish cổng) | `compose.ai19.yaml`, `ollama-proxy/httpd.conf`; alias `ollama19.internal` (Ollama chỉ nhận Host `*.internal`/localhost) |
| Ollama | host `127.0.0.1:11434` | do chủ dự án chạy sẵn |
| TaskProcessing worker | `taskprocessing-worker.mjs` (vòng `occ taskprocessing:worker -t 300`) | không có worker thì task chỉ chạy theo cron 5 phút |

## Trình tự

1. `node preflight-app-metadata.mjs` (App Store 33.0.10 → pin assistant, integration_openai;
   ghi metadata context_chat) và `node model-card.mjs` (ghi thẻ mô hình **trước** khi tải)
2. `ollama pull qwen3:4b-instruct-2507-q4_K_M`, `node model-card.mjs --verify`,
   `ollama create vcws-qwen3-4b-cpu -f Modelfile.cpu`
3. `docker compose -f compose.ai19.yaml up -d`
4. `AI19_ALLOW_APP_DOWNLOADS=1 node install-assistant.mjs` (chỉ lần bootstrap: tạm nối
   `host_edge` + tạm `has_internet_connection=true`, luôn trả lại trong `finally`)
5. `node configure-assistant.mjs` (provider → proxy, allow-list task type chỉ đọc, tắt picker
   ảnh/giọng nói/sticker), `node mint-app-passwords.mjs`
6. Chạy nền `node taskprocessing-worker.mjs`
7. `node setup-corpus.mjs` (Files/Notes/Deck/Collectives/Talk giả cho Team A/B)
8. `node state.mjs snapshot before-final` → `node acceptance-rag.mjs` →
   `node acceptance-native.mjs` → `node probe-chat-idor.mjs` → `node state.mjs snapshot after-final`
   → `node state.mjs compare before-final after-final`
9. `node probe-file-action-write.mjs` (FINDING ghi file; **không** chạy giữa hai snapshot),
   `node probe-admin-audit.mjs` (tạm `loglevel=1`, trả lại trong `finally`), `node audit-logs.mjs`
10. `node bench-cpu.mjs`, `node quality-vi.mjs`
11. `node verify-isolation.mjs`, `node probe-csp.mjs`, `node environment.mjs`, `node scan-secrets.mjs`

`probe-task.mjs`, `probe-list.mjs` chỉ để debug (không in credential).

## Ghi chú vận hành PoC

- `rag-lib.mjs` là harness "retrieve-as-asker": Context Chat cần backend ExApp (AppAPI + image
  lớn + embedding) nên không dựng; harness lấy nguồn **bằng chính credential người hỏi**
  (WebDAV/Deck/Talk), xếp hạng từ khoá, gọi mô hình qua TaskProcessing dưới uid người hỏi,
  rồi đọc lại từng citation bằng quyền người hỏi. Đây là hợp đồng ACL mà mọi RAG thật phải giữ.
- Mọi định danh là uid 64-hex bất biến (user_oidc) và group id federated. Không ghi DB/data
  directory: chỉ `occ`, OCS, WebDAV, Deck/Talk API. DB chỉ đọc (`SET default_transaction_read_only`)
  khi kiểm audit/finding.
- Dữ liệu thử để lại: thư mục `ai19-team-a` (đọc), `ai19-team-a-rw` (ghi, cho probe), `ai19-team-b`,
  `ai19-own` + `ghi-chu-ca-nhan.md - summarized.md` của member-a, note "Ghi chú họp …", board
  `ai19 Team A/B`, collective `ai19 Wiki Team A`, 4 tin "ai19" trong phòng Talk chat17, task và
  phiên chat Assistant (một số phiên của member-a đã bị xoá tin bởi probe IDOR).
- Dừng: tắt `taskprocessing-worker.mjs`; `docker compose -f compose.ai19.yaml stop` để cắt hẳn
  đường tới Ollama (Assistant khi đó báo lỗi task, không ảnh hưởng app khác).
