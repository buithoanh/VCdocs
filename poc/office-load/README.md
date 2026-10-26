# Đo tải engine soạn thảo (ONLYOFFICE / Euro-Office)

Harness so sánh **ONLYOFFICE Docs CE 9.4.0.1** và **Nextcloud Office Document Server
(Euro-Office) 9.3.7** với cùng kịch bản: nhiều người mở và gõ đồng thời vào DOCX thật,
rồi kiểm tệp lưu cuối có đủ nội dung. Kết quả và kết luận:
`docs/nghien-cuu/office-engine-tai-48-2026-10-26.md`.

## Thành phần

- `docker-compose.yml`: hai container đo tải, mỗi lần bật một profile. Cùng nền
  `linux/amd64` (giả lập trên Apple Silicon), cùng giới hạn 4 CPU / 4 GB, chỉ mở
  `127.0.0.1` (18083 ONLYOFFICE, 18084 Euro-Office). Không đụng container PoC chat04.
- `run-load.mjs`: một tiến trình Node vừa là máy chủ tài liệu (DOCX nguồn, trang nhúng
  editor ký JWT HS256, nhận callback và tải tệp cuối), vừa điều khiển Chromium headless
  qua `playwright-core`, vừa lấy mẫu `docker stats` và RAM/CPU máy chạy client.

## Kịch bản

1. Sinh DOCX nguồn: mỗi người một đoạn nhãn ở đầu tệp, sau đó 60 đoạn nội dung.
2. Mở `docs × users` phiên, mỗi giây một phiên; ghi thời gian tới `onDocumentReady` và
   chế độ trả về qua `onInfo` (`edit` hay `view`). Đây là phép kiểm trực tiếp giới hạn
   kết nối: nếu engine còn cap, phiên vượt cap sẽ mở ở chế độ xem.
3. Khi mọi phiên sẵn sàng, mỗi người đặt con trỏ cuối đoạn của mình rồi gõ một marker
   `UnnKkkk` mỗi `interval-ms` trong `type-seconds` (co-editing chế độ fast).
4. Đóng mọi phiên, chờ callback `status 2`, tải tệp cuối, kiểm **mọi marker đã gõ có
   trong `word/document.xml`**.

## Chạy

Khoá JWT thử, `playwright-core` và trình duyệt nằm **ngoài repo**:

```sh
export OFFICE_LOAD_SECRETS_DIR=/đường/dẫn/khoá-thử   # onlyoffice.env, eurooffice.env: JWT_SECRET=...
export PLAYWRIGHT_CORE_PATH=/đường/dẫn/node_modules/playwright-core/index.mjs
export CHROMIUM_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell
docker compose -f poc/office-load/docker-compose.yml --profile onlyoffice up -d
node poc/office-load/run-load.mjs --engine onlyoffice --docs 12 --users 4 \
  --type-seconds 180 --interval-ms 5000 --shared-context --process-limit 12 --lean-client \
  --out /tmp/office-load-onlyoffice
docker compose -f poc/office-load/docker-compose.yml --profile onlyoffice down
```

Chờ CPU container nhàn rỗi (sau khi sinh theme/font lúc khởi động) rồi mới đo.

Tuỳ chọn phía client, chỉ để tiết kiệm RAM máy chạy đo, không đổi tải máy chủ:

- `--shared-context`, `--process-limit N`: các trang dùng chung hồ sơ và tối đa N tiến
  trình renderer.
- `--lean-client`: tắt plugin và kiểm tra chính tả (đều chạy trong trình duyệt).
- `--min-free-gib X`: tự dừng nếu RAM trống của máy chạy dưới X GiB trong 15 giây.

Tuỳ chọn kịch bản:

- `--key-delay MS`: thời gian giữa hai phím khi gõ marker (mặc định 25).
- `--offline-at S --offline-for S --offline-slots 1,2`: cắt mạng các người ở vị trí 1, 2 của mỗi
  tài liệu sau S giây gõ, trong S giây; cần bỏ `--shared-context`.
- `OFFICE_LOAD_CPUS`, `OFFICE_LOAD_MEM`: đổi giới hạn CPU/RAM của container (mặc định 4 và 4g).

Bằng chứng tóm tắt các lần chạy 2026-10-26: `evidence/2026-10-26/`.

## Giới hạn

- Giả lập amd64 trên Apple Silicon làm CPU tuyệt đối cao hơn máy chủ x86 thật; chỉ dùng
  để so tương đối giữa hai engine cùng điều kiện.
- Mỗi người gõ một cụm ký tự mỗi 5 giây, dày hơn thói quen thật; không đo độ trễ lan
  truyền thay đổi giữa hai người cùng sửa.
- Client chạy trên cùng máy với Docker; số liệu RAM/CPU client được ghi để biết client
  có thành nút cổ chai hay không.
