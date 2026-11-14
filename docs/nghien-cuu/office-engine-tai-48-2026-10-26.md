# Đo tải 48 người sửa đồng thời: ONLYOFFICE 9.4 và Euro-Office 9.3.7

Ngày: 2026-10-26 · Phiên Claude · Yêu cầu chủ dự án: sửa container ONLYOFFICE PoC, dựng thêm
Euro-Office 9.3.7, đo tải 48 phiên sửa đồng thời trên cả hai để chọn engine.

## 1. Kết luận

- **Cả hai engine mở đủ 48/48 phiên ở chế độ sửa** (sự kiện `onInfo` trả `mode: edit`), không
  có cảnh báo giới hạn kết nối. Giới hạn 20 kết nối không còn ở cả hai bản đã thử.
- **ONLYOFFICE Docs CE 9.4.0.1 ổn định hơn và nhẹ hơn rõ rệt.** Hai lần chạy 48 phiên: không mất
  ký tự nào, 12/12 tài liệu lưu đủ, mọi trình duyệt cùng tài liệu thấy cùng nội dung. CPU trung
  bình khoảng 1,3 lõi, RAM tối đa khoảng 1,5 GB.
- **Euro-Office 9.3.7 (Nextcloud Office Document Server) dùng khoảng 3 lần CPU** (2,9 tới 3,9 lõi
  trung bình, đỉnh hơn 7 lõi) và RAM tới khoảng 3,5 GB. Nó còn hai vấn đề:
  - Mất 1 tới 6 ký tự đầu của lần gõ đầu tiên ở khoảng 5% phiên, do trình duyệt. ONLYOFFICE
    không gặp lần nào trong 158 phiên.
  - Một trong bốn lần chạy 48 phiên gặp lỗi phía máy chủ (`duplicate key` khi ghi thay đổi vào
    PostgreSQL, `unSaveLock failure`): mất 452 marker, 3/12 tài liệu không được lưu. Lần đó máy
    chạy client bị thiếu RAM nên trình duyệt chậm; ONLYOFFICE chưa bị thử trong đúng điều kiện ấy.
- **Đề xuất:** dùng **ONLYOFFICE Docs CE 9.4** cho thí điểm 48 người. Máy 4 vCPU/8 GB là điểm
  khởi đầu hợp lý vì bản này dùng chưa tới một nửa 4 CPU và khoảng 1,5 GB RAM ngay cả khi giả lập;
  đo lại trên máy thật và kiểm lại trên 10.0 trước khi nâng. Chưa dùng Euro-Office 9.3.7; xem lại khi Euro-Office lên nền 9.4
  (bản một tiến trình, bỏ RabbitMQ/DB). Yếu tố nguồn gốc hãng (ONLYOFFICE là công ty có đội phát
  triển chủ yếu ở Nga, theo README của Euro-Office) là quyết định chính sách của chủ dự án, không
  đo được bằng bài này.

## 2. Cách đo

Harness: `poc/office-load/` (`run-load.mjs`, `docker-compose.yml`, `README.md`).

| Mục | Giá trị |
|---|---|
| Engine | `onlyoffice/documentserver:9.4.0.1` và `ghcr.io/nextcloud-releases/office-documentserver:v9.3.7` |
| Nền | `linux/amd64` qua giả lập trên Mac M4 Pro (cả hai giống nhau); giới hạn 4 CPU, 4 GB; một lần Euro-Office 8 CPU |
| Kịch bản chính | 12 tài liệu × 4 người = 48 phiên Chromium headless, mở mỗi giây một phiên |
| Gõ | Mỗi người đặt con trỏ cuối đoạn riêng, cứ 5 giây gõ một marker `UnnKkkk` (25 ms mỗi phím), trong 180 giây, co-editing chế độ fast |
| Kiểm | Chế độ edit/view qua `onInfo`; nội dung mỗi trình duyệt thấy trước khi đóng; callback `status 2`; mọi marker phải có trong `word/document.xml` của tệp lưu cuối |
| Số liệu máy chủ | `docker stats` liên tục; số liệu RAM/CPU trình duyệt và RAM trống máy host mỗi 5 giây |
| Bảo mật thử | JWT HS256 bật ở cả hai, khoá thử sinh trong phiên, lưu ngoài repo; chỉ mở cổng loopback |

Phía client dùng chung một hồ sơ Chromium, tối đa 12 tiến trình renderer, tắt plugin và kiểm tra
chính tả (cả hai chạy trong trình duyệt). Lý do: máy host chỉ còn khoảng 4 GB RAM trống, swap đã
dùng khoảng 15 GB; mỗi phiên editor chiếm khoảng 220 MB. Các tuỳ chọn này không đổi lưu lượng hay
công việc của Document Server.

## 3. Kết quả 48 phiên

| Lần chạy | Phiên sửa | Marker gõ | Marker thiếu | Tài liệu lưu | Hội tụ | Mở p95 (ms) | CPU TB / p95 (%) | RAM khi sửa / khi lưu (MiB) | RAM trống host thấp nhất (GiB) |
|---|---|---|---|---|---|---|---|---|---|
| ONLYOFFICE lần 1 | 48/48 | 1.714 | 0 | 12/12 | chưa đo | 1.071 | 126,5 / 261,8 | 873 / 1.275 | 3,96 |
| ONLYOFFICE lần 2 | 48/48 | 1.724 | 0 | 12/12 | 12/12 | 1.192 | 126,7 / 263,2 | 1.101 / 1.533 | 4,00 |
| Euro-Office lần 1 | 48/48 | 1.725 | 3 | 12/12 | chưa đo | 1.549 | 291,3 / 562,5 | 1.871 / 2.548 | 3,88 |
| Euro-Office lần 2 | 48/48 | 1.429 | **452** | **9/12** | **0/12** | 1.131 | 382,7 / 698,9 | 1.915 / 2.691 | **1,31** |
| Euro-Office lần 3 | 48/48 | 1.704 | 2 | 12/12 | 12/12 | 1.566 | 385,6 / 611,0 | 1.406 / 2.234 | 2,18 |
| Euro-Office 8 CPU | 48/48 | 1.725 | 2 | 12/12 | 12/12 | 1.580 | 375,8 / 708,7 | 1.997 / **3.459** | 3,81 |

- CPU 100% = một lõi. `docker stats` có mẫu vượt giới hạn danh nghĩa 400% ở đỉnh; so sánh dựa
  trên trung bình và p95 đo cùng cách cho cả hai.
- Lúc nhàn rỗi: ONLYOFFICE khoảng 0,8 tới 1,0 GiB; Euro-Office khoảng 1,2 tới 1,8 GiB vì kèm
  PostgreSQL 16, RabbitMQ, Redis và một worker docservice mỗi CPU.
- Lưu sau khi mọi người đóng: p50 khoảng 12 tới 15 giây ở cả hai engine.
- Euro-Office ở 4 CPU đã chạm trần trong pha sửa; cho 8 CPU thì trung bình vẫn khoảng 3,8 lõi,
  nghĩa là đó là nhu cầu thật của nó với tải này (trên giả lập).

## 4. Mất ký tự đầu ở Euro-Office

Mọi marker thiếu ở các lần chạy bình thường đều là marker đầu tiên (`K000`) của một phiên, mất 1
tới 6 ký tự, ví dụ `U11K000` thành `U11K00`, hoặc mất cụm ` U` ở đầu. Ngay trình duyệt của người
gõ cũng không có các ký tự đó, và mọi trình duyệt cùng tài liệu thấy cùng nội dung: ký tự chưa
từng vào tài liệu, máy chủ không làm rơi thay đổi đã nhận.

| Engine | Phiên đã thử | Phiên mất ký tự đầu |
|---|---|---|
| ONLYOFFICE 9.4 | 158 | 0 |
| Euro-Office 9.3.7 | 182 | 9 |

Đã xảy ra cả khi gõ 150 ms mỗi phím (tốc độ người) và ở tài liệu chỉ có 2 người. Chưa tìm được
nguyên nhân trong mã; cần một người thử tay trên trình duyệt thật trước khi kết luận người dùng
gặp đúng hiện tượng này.

## 5. Lần chạy lỗi của Euro-Office (lần 2)

- Từ giây thứ 100, CPU Euro-Office bão hoà khoảng 4 lõi. Từ giây thứ 180, RAM trống máy host tụt
  từ khoảng 4 GB xuống 1,3 GB (ứng dụng khác trên máy), trình duyệt bị chậm, có cụm gõ mất 66
  giây mới xong.
- Log docservice ghi hai lần `saveChanges error: duplicate key value violates unique constraint`
  khi `INSERT INTO doc_changes` và hai lần `unSaveLock failure` (08:36:22 UTC).
- Hậu quả: marker K024 tới K030 (khoảng phút thứ hai) mất ở nhiều phiên cùng lúc; 3 tài liệu báo
  0 người dùng nhưng không bao giờ gửi callback lưu trong 10 phút; các trình duyệt cùng tài liệu
  không còn thấy cùng nội dung.
- ONLYOFFICE 9.4 lưu thay đổi không qua cơ sở dữ liệu (bản 9.4 bỏ DB/RabbitMQ) và log của nó
  không có lỗi tương tự, nhưng hai lần chạy ONLYOFFICE đều có host đủ RAM. Vì vậy chỉ kết luận
  được: Euro-Office 9.3.7 có đường lỗi làm mất dữ liệu khi client chậm và máy chủ bão hoà;
  chưa chứng minh ONLYOFFICE miễn nhiễm.

## 6. Bài mất mạng (12 phiên, cả hai engine)

Sau 30 giây gõ, cắt mạng 2/4 người mỗi tài liệu trong 45 giây, họ vẫn tiếp tục gõ. Kết quả **giống
nhau ở hai engine**: người mất mạng không đưa thêm được ký tự nào vào tài liệu từ lúc mất mạng tới
cuối bài (khoảng 36 marker mỗi tài liệu), kể cả 45 giây sau khi có mạng lại; tài liệu vẫn lưu đủ
phần đã gửi trước đó. Editor khoá sửa khi mất kết nối thay vì âm thầm làm mất dữ liệu đã vào tài
liệu. Bài này không phân biệt hai engine. Chưa kiểm editor có tự sửa tiếp được sau khi nạp lại.

## 7. Sửa container ONLYOFFICE PoC (`vcworkspace-onlyoffice-chat04`)

- Hiện tượng: `ds:docservice`, `ds:converter` FATAL, nginx 502 từ 2026-10-25 07:04 UTC.
- Nguyên nhân: ba tệp cấu hình rỗng 0 byte từ 2026-10-24 23:09 UTC:
  `/etc/onlyoffice/documentserver/local.json`, `.../log4js/production.json`,
  `/etc/onlyoffice/documentserver-example/local.json`. Entrypoint sửa các tệp này tại chỗ
  (`json -I`) ở mỗi lần khởi động nên không tự hồi phục. Khả năng cao là một lần khởi động bị cắt
  ngang khi đang ghi; chưa xác minh.
- Cách sửa: chép bản gốc ba tệp từ image `onlyoffice/documentserver:9.4.0.1` vào container rồi
  `docker restart`; entrypoint ghi lại JWT từ biến môi trường, không ai đọc hay in khoá. Healthy
  từ 2026-10-26 07:55 UTC, vẫn chạy sau 1,5 giờ. Chưa chạy lại `run-integration.mjs` vì cần khoá
  JWT trong shell cô lập của chủ dự án.
- Rủi ro còn lại: lỗi có thể lặp lại nếu container bị dừng giữa lúc khởi động. Nên thêm
  healthcheck và cảnh báo cho container Document Server khi triển khai.

## 8. Giới hạn của phép đo

- Giả lập amd64 trên Apple Silicon: CPU tuyệt đối cao hơn máy chủ x86 thật. Tỷ lệ giữa hai engine
  đáng tin hơn con số tuyệt đối. Không dùng bảng trên làm sizing production.
- Mỗi người gõ một cụm mỗi 5 giây liên tục 3 phút, dày hơn người dùng thật (đọc, nghĩ, chuyển tab).
- Client chạy cùng máy với Docker. Client có lúc là nút cổ chai (cụm gõ p95 tới 4 giây ở ONLYOFFICE
  lần 1, 10,6 giây ở Euro-Office lần 2); số liệu này được ghi để tách khỏi lỗi engine.
- Chưa đo độ trễ lan truyền thay đổi giữa hai người cùng sửa; chưa thử XLSX/PPTX; chưa thử tài
  liệu lớn; chưa thử ONLYOFFICE 10.0 hay image arm64.
- So sánh bản 9.4 với 9.3.7 là so hai bản đang phát hành, không phải hai engine cùng phiên bản lõi.

## 9. Bằng chứng và chạy lại

- Tóm tắt từng lần chạy (không chứa khoá): `poc/office-load/evidence/2026-10-26/*.summary.json`
  (18 tệp: 6 lần chạy 48 phiên, hiệu chỉnh, bài ký tự đầu, bài mất mạng, chạy thử).
- Chi tiết đầy đủ (mẫu `docker stats`, nội dung trình duyệt, tệp DOCX cuối) nằm trong scratch của
  phiên, không đưa vào repo.
- Cách chạy lại: `poc/office-load/README.md`.

## 10. Nguồn

- Image và entrypoint đọc trực tiếp từ `onlyoffice/documentserver:9.4.0.1` và
  `ghcr.io/nextcloud-releases/office-documentserver:v9.3.7` (tạo 2026-10-24).
- https://github.com/nextcloud-releases/Office-DocumentServer (bản v9.3.7, 2026-10-24).
- https://github.com/Euro-Office (README tổ chức, lý do fork).
- API editor: sự kiện `onInfo`, `onDocumentReady`, callback `status` theo tài liệu ONLYOFFICE Docs API.
