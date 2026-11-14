# Đề xuất lưu giữ thư (journaling tự bù) cho Stalwart Community

Trạng thái: đề xuất để chủ dự án quyết. Chưa có dòng mã nào. Mọi con số công sức và dung lượng dưới đây là ước lượng/giả định, không phải đo đạc.

## 1. Mục tiêu và phạm vi

- Mục tiêu: giữ một bản thư để tra soát, tuân thủ khi người dùng xoá thư của họ.
- Phạm vi: thư của hộp thư công ty trên Stalwart Community (không mua Enterprise, nên không có journaling của engine).
- Ngoài phạm vi: chọn nhà cung cấp lưu trữ, chính sách pháp lý cụ thể, giao diện tra soát.
- Giả định: mục A (thùng rác, tự xoá hẳn sau N ngày, mặc định 30) sẽ có. Chưa kiểm trong mã vì đang được code song song.

## 2. Ba cách

Mã hiện có liên quan: `MailPort.installFilters` và `MailPort.deliver` (`mail.port.ts`); Sieve dựng trong `StalwartMailPort.sieveScript` (`stalwart-mail.port.ts`, hiện chỉ `require fileinto, imap4flags, body`); gửi qua `MailBasicService.send` (`mail-basic.service.ts`), SMTP envelope = To ∪ Cc ∪ Bcc.

### (a) Sieve `redirect :copy` thư đến vào hộp lưu trữ

- Phủ: thư đến mọi hộp có script. Thư nội bộ phủ ở phía người nhận. Thư gửi đi: không phủ. Thư gửi từ client ngoài API: không phủ.
- Sửa mã: `sieveScript` thêm `redirect :copy "archive@..."` ở đầu script và khai `require "copy"`; `installFilters` gắn khối này vào mọi lần cài; cần bước cài lại cho mọi hộp hiện có. Chưa kiểm: Stalwart Community có cho `redirect` và giới hạn số lần chuyển tiếp ra sao.
- Ưu: không phụ thuộc nơi người dùng đọc thư; chạy ở engine ngay khi nhận.
- Nhược/rủi ro:
  - Người dùng sửa được script nếu có quyền ManageSieve trực tiếp (client ngoài). Qua API thì khối này do server thêm, người dùng không thấy.
  - Cài script lỗi thì thư không được sao; hiện chỉ có mã lỗi `FILTER_APPLY_FAILED`, chưa có cảnh báo riêng.
  - Khối lưu giữ phải chạy trước mọi bộ lọc khác, kể cả bộ lọc `stop`.
- Công sức ước lượng: 2–3 ngày công (gồm cài lại hộp cũ và test với Stalwart thật).

### (b) Bcc tự động vào hộp lưu trữ khi gửi qua API

- Phủ: thư đi gửi qua API (kể cả thư nội bộ, phía gửi). Thư đến từ ngoài: không phủ. Gửi từ client ngoài API: không phủ.
- Sửa mã: `MailBasicService.send` thêm địa chỉ lưu trữ vào `envelopeRecipients` (không đưa vào header); `deliver` nhận RCPT TO riêng nên về nguyên tắc làm được. Phải xử lý `engineIds` và `fingerprint` của journal gửi để không coi hộp lưu trữ là người nhận thật. Chưa kiểm các chỗ này.
- Ưu: đơn giản, nằm trong đường gửi đã có idempotency và đối soát.
- Nhược/rủi ro:
  - Lộ Bcc nếu địa chỉ lọt vào header; cần test khẳng định MIME không chứa nó.
  - Bị bỏ qua hoàn toàn khi gửi bằng client ngoài qua SMTP.
  - Hộp lưu trữ lỗi/đầy có thể làm hỏng việc gửi. Phải quyết: lỗi lưu giữ có chặn gửi không.
- Công sức ước lượng: 1–2 ngày công.

### (c) Giữ lại thư quá hạn thùng rác thay vì xoá hẳn

- Phủ: chỉ thư người dùng đã xoá và đi qua thùng rác. Thư xoá ngoài đường thùng rác (client ngoài, IMAP expunge) và thư chưa xoá: không phủ.
- Sửa mã: tác vụ tự xoá của mục A đổi từ "xoá" sang "chuyển sang hộp lưu trữ rồi xoá" (tên hàm chưa kiểm).
- Ưu: không đụng engine, không đụng đường gửi/nhận.
- Nhược/rủi ro: thư bị xoá trước khi được sao thì mất; không đảm bảo mọi thư đã nhận/đã gửi đều có bản.
- Công sức ước lượng: 1 ngày công, sau khi mục A xong.

## 3. So sánh

| | (a) Sieve copy | (b) Bcc khi gửi | (c) Giữ thư quá hạn |
|---|---|---|---|
| Thư đến | có | không | chỉ nếu bị xoá |
| Thư đi qua API | không | có | chỉ nếu bị xoá |
| Gửi từ client ngoài | không | không | chỉ nếu bị xoá |
| Người dùng né được | khó (qua API) | có (client ngoài) | có (xoá ngoài thùng rác) |
| Công sức (ước lượng) | 2–3 ngày | 1–2 ngày | 1 ngày |

Khuyến nghị: làm (a) và (b) cùng nhau, (c) là lớp phụ. (a)+(b) sao thư ngay lúc giao, không phụ thuộc người dùng có xoá hay không. Nếu chỉ chọn một thì chọn (a) vì thư đến không thể tái tạo. Khoảng hở còn lại là SMTP từ client ngoài; chỉ đóng được bằng cấu hình engine hoặc chặn gửi ngoài API (cần quyết).

## 4. Chi phí lưu trữ

Công thức: dung lượng (GB) = số hộp × thư/ngày/hộp × kích thước TB (MB) × 365 × số năm ÷ 1024.
Thư nội bộ có thể bị đếm hai lần (bản đến và bản đi); thêm hệ số trùng nếu loại bỏ. Chi phí/tháng = dung lượng × đơn giá/GB/tháng (đơn giá là tham số, chưa lấy giá nhà cung cấp nào).

Ba kịch bản, tất cả là giả định:

| Kịch bản | Hộp | Thư/ngày | TB (MB) | Năm | Dung lượng |
|---|---|---|---|---|---|
| Nhỏ | 20 | 60 | 0,15 | 5 | ≈ 320 GB |
| Vừa | 50 | 100 | 0,3 | 5 | ≈ 2.700 GB |
| Lớn | 100 | 150 | 0,5 | 10 | ≈ 26.700 GB |

Chưa tính: chỉ mục tìm kiếm, bản sao lưu của hộp lưu trữ, nén.

## 5. Giới hạn so với journaling của Enterprise

- Không chống sửa/xoá ở mức engine: quản trị hộp lưu trữ xoá được thư.
- Phụ thuộc cấu hình đúng; Sieve lỗi hay bị đổi sẽ làm hở mà không ai biết nếu không có giám sát.
- Không phủ thư gửi bằng client ngoài (b), không phủ thư đi (a).
- Chưa có bằng chứng toàn vẹn (băm, chữ ký). Có thể bổ sung băm từng thư và nhật ký; chưa ước lượng công sức.
- Không thay thế tư vấn pháp lý về yêu cầu lưu giữ thực tế.

## 6. Câu hỏi mở cho chủ dự án

- Giữ bao nhiêu năm, và có xoá tự động khi hết hạn không?
- Loại thư nào: tất cả, chỉ thư đến, chỉ thư đi; thư nội bộ có tính không?
- Ai được đọc hộp lưu trữ, và mỗi lần đọc có ghi nhật ký không?
- Lưu ở đâu: hộp Stalwart riêng, kho đối tượng, hay dịch vụ ngoài?
- Lỗi lưu giữ có chặn việc gửi thư hay chỉ cảnh báo?
- Có chặn SMTP gửi từ client ngoài API không?
- Có cần bằng chứng toàn vẹn (băm, chữ ký) không?
