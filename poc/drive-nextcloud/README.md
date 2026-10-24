# PoC Drive cơ bản trên Nextcloud cô lập

Harness này kiểm hợp đồng adapter, ACL hai người, idempotency, checksum, xung
đột tên và recovery ở mức kho. Nó không khởi động API VCworkspace, không đọc
file môi trường của repo và không phải tính năng Drive hoàn chỉnh.

## Bản ghim, giao thức và giấy phép

- Nextcloud Server 33.0.5 Apache, image chính thức linux/arm64:
  nextcloud@sha256:f6653516c000dd83a8ead6d7eda3ccdc6437fee78153bae71702c70f727dd79b.
  Digest tag đa kiến trúc là
  sha256:476228e615088e7d2de4bd9a87187961dfbff1577a96ff07955ec35dbe18f3c9.
- Metadata được đọc từ Docker Hub ngày 2026-10-23. Dùng bản stable đã ghim,
  không dùng latest; trước lần thử sau phải kiểm lại hỗ trợ và metadata.
- Nextcloud Server: AGPL-3.0-or-later. PoC không sửa hoặc phân phối lại mã;
  adapter gọi WebDAV và OCS Share API công khai.
- WebDAV dùng cho MKCOL, PROPFIND, PUT, GET, DELETE. OCS chia thư mục phòng từ
  A cho B với quyền chỉ đọc.

## Rào chắn và tài nguyên

- Cần Docker Compose, tối thiểu đề xuất 2 CPU, 2 GiB RAM và 3 GiB đĩa trống.
- Chỉ bind 127.0.0.1:18080. Volume mang tiền tố vcworkspace_drive_poc_, không
  dùng volume hoặc CSDL đang chạy của ứng dụng khác.
- Credential ngẫu nhiên phải nằm trong file .poc-secrets đã gitignore, chmod
  600 và không được in. Không dùng danh tính, cookie hoặc Google thật.
- Compose đặt trần 2 CPU, 2 GiB RAM. SQLite trong volume cô lập chỉ dành cho hai
  người và file tối đa 10 MiB, không phải cấu hình production.

## Chạy an toàn

Từ thư mục này, tạo `.poc-secrets` mode 600 với các biến:
`COMPOSE_PROJECT_NAME=vcworkspace-drive-poc`,
`POC_BASE_URL=http://127.0.0.1:18080`, `POC_ADMIN_USER`,
`POC_ADMIN_PASSWORD`, `POC_ADMIN_AUTH`, `POC_USER_A_VALUE`,
`POC_USER_B_VALUE`, `POC_USER_A_AUTH`, `POC_USER_B_AUTH`. Ba biến AUTH là giá
trị Basic tương ứng; các giá trị phải được sinh ngẫu nhiên trong phiên môi
trường, không sao chép từ hệ thống khác và không in ra terminal.

Chạy chính xác:

    chmod 600 .poc-secrets
    docker compose --env-file .poc-secrets -p vcworkspace-drive-poc up -d
    set -a
    . ./.poc-secrets
    set +a
    node run-nextcloud.mjs matrix

Runner từ chối endpoint ngoài loopback, port khác 18080, project/service sai,
published port không phải 127.0.0.1:18080 hoặc image không đúng digest ghim.
Runner tạo hai danh tính giả
`vcw-poc-a`, `vcw-poc-b`, hai root `department`/`personal`, share phòng A sang B
read-only và ghi evidence đã scrub vào file
`evidence/p01-p12-matrix-<runId>.json`.

Để kiểm persistence, sau khi `matrix` kết thúc, restart **chỉ** service
Nextcloud của đúng project bằng Compose, chờ service sẵn sàng rồi chạy:

    node run-nextcloud.mjs verify-restart

`verify-restart` đọc `evidence/restart-state.json`, so `docker inspect StartedAt`
với lượt matrix, rồi mới tải lại đúng fileId và so checksum. Nếu container chưa
thực sự restart thì P03 là blocked. Kết quả ghi file riêng
`evidence/p03-restart-<runId>.json`, không ghi đè matrix.

Contract harness không cần Docker:

    node --test test/fake-storage.test.mjs test/nextcloud-storage.test.mjs

Khi có Docker, evidence phân biệt `adapter`, `storage-acl`, `adapter-restart` và
`post-store-timeout-recovery`; không được gọi P01 là UI/API sản phẩm. P10 bọc
đúng adapter thật, để Nextcloud nhận byte thành công rồi phát một lỗi timeout có
kiểm soát; runner đối soát kho, retry cùng key và chứng minh chỉ một metadata/file
đúng checksum, không ngắt mạng máy hay container. Phải lưu thêm image digest, docker stats và
dung lượng volume. Cleanup chỉ sau khi liệt kê/đối chiếu target đúng project;
không dùng glob hoặc prune.
