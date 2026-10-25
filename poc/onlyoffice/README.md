# ONLYOFFICE chat04 local

- Image ghim: `onlyoffice/documentserver:9.4.0.1`, `platform: linux/amd64`;
  không dùng `latest`. Manifest arm64 của đúng tag đã thử trên host Apple Silicon
  nhưng rootfs trả `exec format error`; manifest amd64 chính thức chạy qua
  emulation và được ghi rõ để lần sau không hiểu nhầm là native.
- Chỉ publish `127.0.0.1:18082`; container gọi API thử qua
  `host.docker.internal`, không expose Internet.
- JWT bắt buộc. Đặt cùng một giá trị sinh thử cho container và
  `DOCUMENT_EDITOR_JWT_SECRET` của API; không ghi giá trị vào repo/log.
- API thử dùng `DOCUMENT_EDITOR_PUBLIC_ORIGIN=http://127.0.0.1:18082`,
  `DOCUMENT_EDITOR_INTERNAL_ORIGIN=http://vcworkspace-onlyoffice-chat04` nếu API
  cùng network, hoặc origin loopback phù hợp khi chạy trên host, và
  `DOCUMENT_EDITOR_API_ORIGIN=http://host.docker.internal:4000`.

Kiểm tích hợp lặp lại được (cần Nextcloud fixture local đang chạy):

```sh
node poc/onlyoffice/run-integration.mjs
```

Runner chỉ đọc tài khoản giả trong `.poc-secrets`, khởi tạo MongoDB tạm, tạo
DOCX trên Nextcloud, kiểm mode edit/view và gọi converter ONLYOFFICE thật để
kiểm magic byte/kích thước PDF. Không in credential và không nạp `.env` API.

Community Edition dùng giấy phép AGPL-3.0 kèm điều khoản bổ sung/nhãn hiệu của
ONLYOFFICE. Chat04 chỉ đo local; chưa kết luận phù hợp production hoặc hỗ trợ 48
người. Nguồn API callback, document key và license được ghi trong bàn giao.
