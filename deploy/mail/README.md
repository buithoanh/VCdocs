# Thư công ty chạy thẳng trên Stalwart (không qua phân hệ Email của VCworkspace)

Bộ này dựng một máy chủ thư Stalwart độc lập cho một tên miền, ví dụ `vcparts.vn`. Người dùng nối
thẳng bằng Outlook, Thunderbird hoặc điện thoại. API và giao diện Email của VCworkspace (`mail-basic`,
trang `/email`) không nằm trên đường đi của thư và không cần bật.

```
Outlook / điện thoại ──993 đọc, 465 gửi──►  Stalwart (máy chủ AWS, IP tĩnh)
Máy chủ thư bên ngoài ──25──────────────►  Stalwart
Stalwart ──25 (hoặc qua Amazon SES 587)─►  Máy chủ thư bên ngoài
DNS của tên miền (iNET): chỉ là danh bạ để các bên tìm nhau, thư không đi qua đó
```

| File | Việc |
|------|------|
| `docker-compose.yml` | Một dịch vụ `stalwart`, hai volume (cấu hình, dữ liệu) |
| `.env.example` → `.env` | Tên máy chủ thư, bản Stalwart, sao lưu, mật khẩu trạm chuyển tiếp |
| `kiem-tra-dns.mjs` | Kiểm bản ghi DNS đã nhập (chỉ tra cứu) |
| `kiem-tra-gui-nhan.mjs` | Gửi một thư thử A → B qua SMTP 465 rồi đọc lại qua IMAP 993 |
| `backup.sh`, `khoi-phuc.sh` | Sao lưu hằng đêm và khôi phục vào volume trống |
| `kiem-tra.test.mjs` | Test phần logic của hai script kiểm tra |

`.env` bị git bỏ qua — **không commit**.

## Đã thử và chưa thử

Đã chạy thật ngày 2026-11-14 trên một máy thử cục bộ, Stalwart 0.16.27, tên miền giả `vcparts.test`,
cổng chỉ mở trên loopback:

- Khởi động từ `docker-compose.yml`, cài đặt ban đầu, khởi động lại, các cổng 25/465/993/443 mở.
- Tạo hai hộp thư, gửi A → B và B → A bằng `kiem-tra-gui-nhan.mjs` (sai mật khẩu và chứng chỉ tự ký
  đều bị từ chối đúng).
- Stalwart sinh bộ bản ghi DNS cho tên miền (mục 5 chép từ kết quả đó).
- Tạo và xoá route chuyển tiếp kiểu SES, đổi và trả lại quy tắc định tuyến (mục 8).
- `backup.sh` rồi `khoi-phuc.sh` sang bộ volume mới: thư cũ còn đủ, gửi thư mới được. Sao lưu lỗi giữa
  chừng vẫn chạy lại máy chủ. Khôi phục vào volume đang có dữ liệu bị từ chối.

Chưa thử, phải kiểm khi triển khai thật:

- Máy chủ AWS, IP tĩnh, mở cổng 25, PTR.
- Nhập bản ghi ở iNET. Phần tra cứu mạng của `kiem-tra-dns.mjs` (mạng của máy thử chỉ trả bản ghi A).
- Chứng chỉ TLS thật (Let's Encrypt), trang quản trị trên trình duyệt.
- Gửi/nhận với Gmail, Outlook thật; thư có vào spam không.
- Gửi qua Amazon SES thật; tải `BACKUP_S3` lên S3.
- Giới hạn `ulimits` trong compose (máy thử không cho đặt).

## 1. Việc cần quyết trước

- **Tên miền đang nhận thư ở đâu?** Tra bản ghi MX hiện có trước khi làm. Nếu tên miền đang dùng dịch
  vụ thư khác, đổi MX là thao tác cắt chuyển: thư mới về Stalwart, thư cũ nằm lại nơi cũ. Khi đó tạo
  đủ hộp thư trước, chọn giờ thấp điểm, hạ TTL của MX xuống 300 từ hôm trước. Tên miền chưa có MX thì
  không có gì để cắt chuyển.
- **Gửi ra bằng đường nào?** Gửi thẳng cổng 25 từ IP của mình (phải xin AWS mở và tự giữ uy tín IP),
  hoặc qua Amazon SES (mục 8). Tên miền đã được xác minh sẵn trong SES thì nên đi SES: không phải
  xin mở cổng 25 và không phụ thuộc uy tín của một IP mới.
- **Ai vận hành?** Cần một người theo dõi hàng đợi, dung lượng đĩa, sao lưu và cập nhật.

## 2. Máy chủ AWS

Việc này làm trong tài khoản AWS của công ty, không làm từ phiên viết mã.

- EC2 Linux, gợi ý 2 vCPU / 4 GB RAM. Tài liệu Stalwart nêu giới hạn bộ nhớ mặc định khoảng 2,4 GiB,
  nên máy 2 GB là sát nút.
- Đĩa: khoảng 1 GB đĩa cho mỗi 1 GB thư, cộng chỗ cho bản sao lưu tại chỗ.
- **Elastic IP** gắn vào máy. IP phải cố định.
- Security Group mở vào: 25, 465, 993, 443 từ mọi nơi; 22 chỉ từ IP quản trị. **Không** mở 8080.
- Máy phải ra được Internet bằng HTTPS: lúc khởi động Stalwart tải giao diện quản trị từ GitHub và
  xin chứng chỉ từ Let's Encrypt.
- **Cổng 25 gửi ra:** EC2 mặc định hạn chế. Gửi yêu cầu "Request to remove email sending
  limitations" kèm Elastic IP, hoặc dùng SES (mục 8).
- **PTR (reverse DNS):** đặt cho Elastic IP về đúng `MAIL_HOSTNAME`, ở phía AWS. Bản ghi này không
  nằm ở iNET.
- Cài Docker Engine và plugin compose.

Chi phí ước tính ở vùng Singapore, giá niêm yết trả theo giờ (bảng giá AWS đọc ngày 2026-11-14, 730
giờ/tháng; chưa gồm thuế, chưa trừ ưu đãi tài khoản mới hay gói cam kết):

| Khoản | Đơn giá | Mỗi tháng |
|---|---|---|
| EC2 `t4g.medium` (2 vCPU, 4 GiB, ARM) | 0,0424 USD/giờ | khoảng 31 USD |
| EC2 `t3.medium` (2 vCPU, 4 GiB, x86) | 0,0528 USD/giờ | khoảng 38,5 USD |
| EC2 `t4g.small` (2 vCPU, 2 GiB, ARM) | 0,0212 USD/giờ | khoảng 15,5 USD |
| Địa chỉ IPv4 công cộng (Elastic IP) | 0,005 USD/giờ | khoảng 3,65 USD |
| Amazon SES, thư gửi ra | 0,10 USD / 1.000 thư | theo lượng gửi |
| Đĩa EBS, sao lưu S3, lưu lượng ra | chưa tra giá | tính thêm theo dung lượng |

Cấu hình gợi ý (`t4g.medium` + một IP) vào khoảng 35 USD/tháng trước tiền đĩa. Image Stalwart ghim
trong `.env.example` có cả bản ARM và x86.

## 3. DNS bước 1 (ở iNET): bản ghi A

Thêm bản ghi **A**: tên `mail`, giá trị là Elastic IP, TTL 300. Làm trước mục 4, vì Stalwart cần tên
này trỏ đúng mới xin được chứng chỉ TLS.

Chưa đụng tới MX ở bước này.

## 4. Chạy Stalwart và cài đặt ban đầu

```bash
cd deploy/mail
cp .env.example .env      # sửa MAIL_HOSTNAME
docker compose up -d
docker compose logs stalwart 2>&1 | grep -A8 'bootstrap mode'
```

Lệnh cuối in tài khoản tạm `admin` và mật khẩu ngẫu nhiên, **chỉ hiện một lần**.

Trang cài đặt chỉ mở trên loopback của máy chủ. Từ máy mình, mở đường hầm rồi vào
`http://127.0.0.1:8080/admin`:

```bash
ssh -L 8080:127.0.0.1:8080 <người dùng>@<IP máy chủ>
```

Các màn hình cài đặt (theo tài liệu Stalwart):

1. **Server identity:** hostname đã điền sẵn theo `MAIL_HOSTNAME`; default domain là tên miền thư
   (`vcparts.vn`). Giữ bật xin chứng chỉ TLS tự động và sinh khoá DKIM.
2. **Storage:** giữ mặc định (RocksDB ở `/var/lib/stalwart/`).
3. **Directory:** giữ thư mục nội bộ.
4. **Logging:** chọn **Console**. Chạy trong container không có `/var/log/stalwart/`.
5. **DNS:** chọn quản lý thủ công (iNET không nằm trong danh sách tự động).

Kết thúc, trang hiện tài khoản quản trị lâu dài `admin@<tên miền>` và mật khẩu. **Ghi lại ngay**, nó
không hiện lần hai và không ghi vào log.

```bash
docker compose restart stalwart
```

Sau khi khởi động lại, trang quản trị ở `https://<MAIL_HOSTNAME>/admin`. Nếu trình duyệt cảnh báo
chứng chỉ thì chờ vài phút cho Let's Encrypt cấp xong; đừng bấm bỏ qua cảnh báo.

Mất mật khẩu quản trị: thêm tạm `STALWART_RECOVERY_ADMIN: admin:<mật khẩu>` vào `environment` của
dịch vụ, `docker compose up -d`, đăng nhập, đặt lại, rồi **gỡ biến đó và chạy lại**. Biến này là
quyền toàn bộ, không được để lại.

## 5. DNS bước 2 (ở iNET): bản ghi thư

Lấy bộ bản ghi chính xác của máy mình ở trang quản trị: **Management › Domains › Domains**, mở menu
của tên miền, chọn **View Zone File**. Chép từng dòng sang trang quản lý DNS của iNET.

Mẫu dưới đây chép từ máy thử (tên miền giả, khoá đã lược) để biết trước cần nhập những gì:

```
vcparts.test.                              MX    10 mail.vcparts.test.
vcparts.test.                              TXT   "v=spf1 mx -all"
mail.vcparts.test.                         TXT   "v=spf1 a -all"
v1-ed25519-20261114._domainkey.vcparts.test.  TXT  "v=DKIM1; k=ed25519; h=sha256; p=<khoá>"
v1-rsa-20261114._domainkey.vcparts.test.      TXT  "v=DKIM1; k=rsa; h=sha256; p=<khoá>"
_dmarc.vcparts.test.                       TXT   "v=DMARC1; p=reject; rua=mailto:postmaster@vcparts.test"
mta-sts.vcparts.test.                      CNAME mail.vcparts.test.
_mta-sts.vcparts.test.                     TXT   "v=STSv1; id=<số>"
_smtp._tls.vcparts.test.                   TXT   "v=TLSRPTv1; rua=mailto:postmaster@vcparts.test"
autoconfig.vcparts.test.                   CNAME mail.vcparts.test.
autodiscover.vcparts.test.                 CNAME mail.vcparts.test.
ua-auto-config.vcparts.test.               CNAME mail.vcparts.test.
_ua-auto-config.vcparts.test.              TXT   "v=UAAC1; a=sha256; d=<mã>"
_imaps._tcp.vcparts.test.                  SRV   0 1 993 mail.vcparts.test.
_submissions._tcp.vcparts.test.            SRV   0 1 465 mail.vcparts.test.
_jmap._tcp / _caldavs._tcp / _carddavs._tcp   SRV   0 1 443 mail.vcparts.test.
```

Lưu ý khi nhập:

- **DMARC:** Stalwart gợi ý `p=reject`. Nếu tên miền còn nơi khác gửi thư thay mình (website, phần
  mềm bán hàng, dịch vụ thư cũ), bắt đầu bằng `p=none`, đọc báo cáo vài tuần rồi mới nâng dần.
- **SPF:** mỗi tên chỉ được một bản ghi `v=spf1`. Đã có sẵn thì gộp vào, không thêm bản thứ hai.
- **DKIM:** khoá RSA dài, có nơi bắt chia thành nhiều đoạn. Tên selector có ngày tạo nên máy thật sẽ
  khác mẫu trên. Stalwart tự xoay khoá định kỳ (mặc định 90 ngày); mỗi lần xoay phải nhập bản ghi mới.
- **MX nhập sau cùng**, khi các bước kiểm tra ở mục 10 đã đạt với những bản ghi còn lại.
- `_pop3s._tcp` chỉ cần nếu mở cổng 995.

## 6. Tạo hộp thư

Trang quản trị: **Management › Directory › Accounts** → tạo tài khoản → thêm mật khẩu (tối thiểu 8
ký tự). Tài khoản quản trị không dùng làm hộp thư hằng ngày.

## 7. Cấu hình máy người dùng

| | Máy chủ | Cổng | Bảo mật | Tên đăng nhập |
|---|---|---|---|---|
| Nhận thư (IMAP) | `MAIL_HOSTNAME` | 993 | SSL/TLS | địa chỉ thư đầy đủ |
| Gửi thư (SMTP) | `MAIL_HOSTNAME` | 465 | SSL/TLS | địa chỉ thư đầy đủ |

Có các bản ghi `autoconfig`/`autodiscover` thì nhiều client tự dò được cấu hình này.

## 8. Gửi ra qua Amazon SES (tuỳ chọn)

Dùng khi AWS chưa mở cổng 25 hoặc không muốn tự giữ uy tín IP. Thư đến vẫn vào thẳng Stalwart.

Phía AWS (theo tài liệu AWS, chưa thử):

- Xác minh tên miền trong SES và nhập đúng các bản ghi SES liệt kê vào iNET (DKIM dạng CNAME; thêm MX
  và SPF cho tên miền con nếu bật "custom MAIL FROM").
- Xin ra khỏi chế độ sandbox của SES; còn trong sandbox thì chỉ gửi được tới địa chỉ đã xác minh.
- Tạo SMTP credentials. Đây là cặp tên/mật khẩu riêng cho SMTP, không phải access key thường.

Phía Stalwart (tên trường đã kiểm trên 0.16.27):

1. Điền `SMARTHOST_PASSWORD` trong `.env`, rồi `docker compose up -d`.
2. **Settings › MTA › Outbound › Routes** → tạo route loại **Relay**:

   | Trường | Giá trị |
   |---|---|
   | `name` | `smarthost` |
   | `address` | `email-smtp.<vùng>.amazonaws.com` |
   | `port` | `587` |
   | `implicitTls` | tắt |
   | `authUsername` | tên SMTP của SES |
   | `authSecret` | loại Environment variable, tên biến `SMARTHOST_PASSWORD` |

   Tài liệu Stalwart bản 1.x gọi trường địa chỉ là `host`; bản 0.16.27 chỉ nhận `address`.
3. **Settings › MTA › Outbound › Strategy** → sửa biểu thức `route`. Mặc định là: điều kiện
   `is_local_domain(rcpt_domain)` trả `'local'`, còn lại trả `'mx'`. Đổi giá trị "còn lại" thành
   `'smarthost'`. Dạng lưu trong Stalwart sau khi đổi:

   ```json
   {"match": {"0": {"if": "is_local_domain(rcpt_domain)", "then": "'local'"}}, "else": "'smarthost'"}
   ```

Quay lại gửi thẳng: đổi `'smarthost'` về `'mx'`.

## 9. Sao lưu và khôi phục

```bash
sudo crontab -e
# 02:30 hằng đêm
30 2 * * * /đường/dẫn/deploy/mail/backup.sh >> /var/log/vcmail-backup.log 2>&1
```

- `backup.sh` dừng Stalwart, nén hai volume vào `BACKUP_DIR` kèm tệp SHA-256, chạy lại, rồi đẩy lên
  S3 nếu có `BACKUP_S3`. Trong lúc nén hộp thư ngừng phục vụ; thư tới lúc đó được máy gửi tự thử lại.
- Bản sao lưu chứa toàn bộ thư, khoá DKIM và mật khẩu đã băm. Giữ quyền 600; bucket S3 không công khai.
- `./khoi-phuc.sh <mốc>` chỉ giải nén vào volume trống và dừng nếu volume đã có dữ liệu.
- **Diễn tập trước khi cần:** trên một máy khác, hoặc cùng máy với
  `COMPOSE_PROJECT_NAME=vcmail-dien-tap` và cổng khác, chạy `khoi-phuc.sh`, `docker compose up -d`,
  rồi kiểm thư bằng `kiem-tra-gui-nhan.mjs`.

## 10. Kiểm tra trước khi đổi MX và sau khi đổi

```bash
# Bản ghi DNS (truyền selector DKIM lấy ở View Zone File)
node kiem-tra-dns.mjs --domain vcparts.vn --host mail.vcparts.vn --ip <Elastic IP> \
  --dkim <selector-ed25519>,<selector-rsa> --resolver 1.1.1.1
# thêm --gui-qua-tram nếu gửi ra qua SES

# Một vòng gửi → nhận giữa hai hộp thử của chính mình (gửi một thư thật)
MAIL_HOST=mail.vcparts.vn \
MAIL_FROM=thu1@vcparts.vn MAIL_FROM_PASSWORD='…' \
MAIL_TO=thu2@vcparts.vn   MAIL_TO_PASSWORD='…' \
node kiem-tra-gui-nhan.mjs
```

Rồi thử tay với bên ngoài:

- Gửi từ hộp thử sang một địa chỉ Gmail. Ở Gmail mở "Hiện bản gốc", cần thấy SPF, DKIM, DMARC đều PASS.
- Sau khi đổi MX: gửi từ Gmail vào hộp thử, thư phải tới.

## 11. Khoá chặt sau khi chạy ổn

- Không còn biến `STALWART_RECOVERY_ADMIN` trong compose hay `.env`.
- Cổng 8080 chỉ ở loopback (compose đã đặt sẵn); Security Group không mở 8080.
- Chưa dùng POP3 và ManageSieve thì để nguyên trạng thái không mở cổng 995 và 4190.
- Tạo tài khoản quản trị riêng cho từng người vận hành.
- Xem lại chính sách mật khẩu, tự động chặn IP dò mật khẩu (auto-ban) và giới hạn tần suất trong
  phần Settings của trang quản trị.

## 12. Quan hệ với VCworkspace

- Production VCworkspace giữ `MAIL_ENGINE_MODE=disabled` và không có `mail` trong `WORKSPACE_MODULES`.
  Bộ này không sửa gì trong `apps/`.
- Nếu về sau muốn mở thêm cửa vào từ VCworkspace cho cùng máy chủ thư này, cần sửa mã trước: API
  đang chỉ nhận địa chỉ `@vcworkspace.test`, và mục "Đã gửi" của nó không đọc thư mục Sent mà Outlook
  dùng.

## 13. Bản Stalwart

Bộ này ghim Stalwart 0.16.27 theo digest (chủ dự án chốt 2026-11-15) vì mọi PoC của dự án và các bước
ở trên đã chạy với đúng bản này. Tài liệu Stalwart hiện khuyên nhánh 1.x (`stalwartlabs/stalwart:v1`)
cho máy mới. Lên 1.x là một việc riêng: chạy lại toàn bộ mục "Đã thử" trên máy thử trước, vì tên
trường có chỗ khác (ví dụ mục 8), rồi mới đổi `STALWART_IMAGE`.

Nguồn: tài liệu Stalwart (stalw.art/docs) các trang install/platform/docker, install/dns,
install/security, install/requirements, mta/outbound/routing, mta/outbound/strategy; đọc ngày 2026-11-14.
