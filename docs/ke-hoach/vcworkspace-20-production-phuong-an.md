# Đưa VCworkspace (nhánh dev) lên production: hai phương án

Ngày: 2026-10-26. Không ai thao tác máy chủ, DNS, IAM hay dữ liệu thật khi viết trang này.

**Quyết định (chủ dự án, 2026-10-26):** đi phương án A trước, tức tắt các phân hệ và kiểm hồi quy
trên bản sao CSDL trước khi deploy. Sau đó bật dần theo phương án B: Drive/Office trước, Email sau
cùng.

## Hiện trạng đã kiểm trong mã

- Production đang chạy VCdocs cũ (`main` 39e02f7) theo `deploy/README.md`: 1 máy ảo, Docker
  Compose (caddy, web, api, mongo), Google thật.
- `dev` có thêm VCworkspace chat01–19: Drive/Office (Nextcloud + ONLYOFFICE), Email (Stalwart),
  SSO/lifecycle (Authentik), Flow. Tất cả mới là PoC local.
- **Trước bản sửa này, `dev` không khởi động được ở production với `api.env` hiện có.**
  `WORKSPACE_STORAGE_MODE`, `MAIL_ENGINE_MODE` mặc định `fake`, và production chặn `fake`.
  Không thể tránh bằng cách bật bản thật, vì adapter Nextcloud và Stalwart chỉ cho gọi loopback
  (`nextcloud-storage.ts`, guard `Mail engine chat07 chỉ được phép loopback` trong `config.ts`).
- Bản sửa này thêm chế độ `disabled` cho hai phân hệ, và production không khai báo thì mặc định
  `disabled`. Khi tắt, `/spaces`, `/drive/*`, `/mail/*` và liên thông trả 503
  `STORAGE_UNAVAILABLE`. Đăng nhập Google, `/me` và nghiệp vụ VCdocs không phụ thuộc hai phân hệ
  này. `fake` vẫn bị chặn. Bật editor khi Drive đang tắt cũng bị chặn. Web ẩn menu và trang
  Bộ nhớ/Email theo `NEXT_PUBLIC_WORKSPACE_MODULES` lúc build (production không khai báo thì ẩn).
- `AUTH_MODE=google`, `IDENTITY_LIFECYCLE_MODE=disabled`, `FLOW_ENABLED=false` và
  `DOCUMENT_EDITOR_ENABLED=false` (mặc định production) đã có sẵn, và là cấu hình đúng cho phương án A.

## Phương án A: lên production, các phân hệ VCworkspace tắt

**Việc cần làm**
1. Merge nhánh này vào `dev`. Chạy `pnpm ai:check:full`, rồi PR `dev` → `main` theo quyết định chủ dự án.
2. Trên máy chủ (phiên vận hành riêng): bổ sung `api.env` theo `deploy/api.env.example` mới
   (khối "Phân hệ VCworkspace", tất cả tắt). Bổ sung `deploy/.env` (`WORKSPACE_MODULES=` để trống,
   `AUTH_PROVIDER=google`). Trước khi build: sao lưu Mongo và kho PDF, snapshot đĩa.
3. Build lại. Kiểm log `API chạy ở … (Google: real)`, đăng nhập, tra cứu, phê duyệt, chia sẻ.
   Menu không có Bộ nhớ/Email.
4. Ghi lại lệnh rollback: checkout lại `39e02f7`, build lại, và khôi phục bản sao lưu bước 2 nếu
   bản mới đã ghi dữ liệu mà bản cũ không đọc được. Trước deploy phải kiểm điều này trên bản sao CSDL.

**Chi phí ước:** hạ tầng giữ nguyên, khoảng 35–45 USD/tháng như hiện nay. Công sức khoảng 0,5–1
ngày vận hành, cộng thời gian review PR và kiểm thử sau deploy.

**Rủi ro**
- Mã mới của `dev` (antd, M01–M09 sửa, chat18/19, bảo mật O1–O15 đang làm song song) lên
  production cùng lúc. Cần kiểm hồi quy nghiệp vụ VCdocs trên staging hoặc bản sao CSDL trước.
- Migration/index Mongo của các model mới tự tạo khi khởi động. Phải có bản sao lưu trước.
- Người dùng chưa thấy giá trị VCworkspace. Giữ Google Workspace thêm một thời gian, nên chi phí
  license Google vẫn còn.
- Hai cấu hình (API `*_MODE` và web `WORKSPACE_MODULES`) phải khớp nhau. Lệch thì menu hiện nhưng
  API trả 503 (không lộ dữ liệu, chỉ gây khó chịu).

## Phương án B: dựng Nextcloud/ONLYOFFICE/Stalwart/Authentik production trước

**Việc cần làm (mã):** đây là phần chưa có, phải giao từng chat.
- Adapter Nextcloud: bỏ giới hạn loopback, dùng HTTPS, kiểm chứng chỉ. Thay
  `WORKSPACE_STORAGE_CREDENTIALS_JSON` (app password tĩnh theo từng người, nằm trong env) bằng cơ
  chế cấp/xoay credential theo người dùng, gắn với SSO.
- Adapter Stalwart: bỏ guard loopback, dùng TLS thật. Thay control port/credentials JSON bằng API
  quản trị có quyền tối thiểu.
- Identity lifecycle: chế độ production gọi Authentik/Nextcloud thật. Hiện `local` chỉ nhận
  `*.localtest.me`/loopback.
- ONLYOFFICE: secret JWT riêng, CSP, origin public/internal tách bạch. Kiểm giới hạn 20 kết nối
  của bản Community hoặc mua license.
- Bổ sung hợp đồng cho 503 khi tắt và (tuỳ chọn) cờ phân hệ trong `/me`. Xem
  `apps/api/DE_NGHI_SUA_HOP_DONG.md`.

**Việc cần làm (hạ tầng):** máy ảo lớn hơn hoặc tách máy, cùng PostgreSQL/MariaDB + Redis + cron
cho Nextcloud. Thêm tên miền phụ (cloud/office/mail/id) với TLS. Mail cần IP tĩnh,
PTR/reverse DNS, MX/SPF/DKIM/DMARC. **Google Cloud chặn gửi ra cổng 25**, nên phải dùng relay SMTP
có trả phí hoặc đặt mail ở nhà cung cấp khác. Sao lưu và diễn tập khôi phục cho từng engine,
giám sát, staging. Sau đó mới tới chuyển dữ liệu Google (xem
`vcworkspace-ke-hoach-deploy-chuyen-google.md`).

**Chi phí ước** (chưa có báo giá, chỉ để so cỡ):
- Hạ tầng khoảng 120–250 USD/tháng: 1–2 máy 4 vCPU/16 GB, đĩa và backup lớn hơn theo dung lượng
  Drive/mail, cộng relay SMTP. Thêm license ONLYOFFICE nếu vượt bản Community.
- Công sức nhiều tuần: 4–6 chat mã như trên, cộng vận hành/kiểm thử. Chưa tính chuyển dữ liệu.

**Rủi ro**
- Vận hành mail tự chủ: deliverability, spam, blacklist IP. Rollback mail khó, vì thư mới ở đích
  không tự quay về.
- Nhiều engine stateful hơn, nên nhiều điểm hỏng và nhiều thứ phải sao lưu. Chưa có người
  on-call được giao.
- Bảo mật credential theo người dùng và SSO là thiết kế mới, chưa có PoC production.
- Trì hoãn đưa các sửa đổi VCdocs trên `dev` lên production. `main` và `dev` càng lệch xa thì
  lần deploy sau càng rủi ro.

## So sánh nhanh

| | A: tắt phân hệ | B: dựng đủ trước |
|---|---|---|
| Thời gian tới production | ngày | nhiều tuần |
| Hạ tầng/tháng (ước) | 35–45 USD | 120–250 USD + license/relay |
| Mã cần thêm | đã có trong nhánh này | 4–6 chat |
| Giá trị cho người dùng | VCdocs mới, chưa có Drive/Email | đầy đủ |
| Rủi ro chính | hồi quy nghiệp vụ VCdocs | vận hành mail/engine, SSO |

## Khuyến nghị (chủ dự án quyết)

Tách hai việc. Có thể đi A trước để `main` bắt kịp `dev` với rủi ro thấp, sau khi kiểm hồi quy
trên bản sao CSDL. Song song, chuẩn bị B theo từng phân hệ (Drive/Office trước, Email sau cùng vì
rủi ro mail lớn nhất). Mỗi phân hệ chỉ bật khi có staging, backup đã diễn tập và người vận hành.
Nếu chủ dự án muốn ra mắt VCworkspace một lần đủ chức năng, thì B là bắt buộc. Khi đó cần chốt
ngân sách hạ tầng và nhà cung cấp mail trước khi giao chat mã.

## Câu hỏi cần chủ dự án chốt

1. Chọn A, B, hay A rồi B theo từng phân hệ?
2. Có staging/bản sao CSDL production để kiểm hồi quy trước khi deploy A không, và ai vận hành?
3. Với B: ngân sách hạ tầng, nơi đặt mail (GCP + relay hay nhà cung cấp khác), license ONLYOFFICE.
