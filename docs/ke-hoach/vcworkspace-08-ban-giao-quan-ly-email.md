# VCworkspace 08 — bàn giao Quản lý Email

> **Đủ điều kiện nghiệm thu chat08 trong phạm vi PoC local ngày 24/10/2026.**
> Real adapter, proof thu hồi phiên, fault-injection durability, browser smoke,
> full gate và review độc lập cuối đều đạt; review kết luận `NO BLOCKER`.
> Việc mở chat09 vẫn do phiên điều phối/chủ dự án quyết định, chat này không tự mở.

## Chốt cuối ngày 24/10/2026

- Điều tra `452` xác nhận rule inbound mặc định 25 thư/giờ là nguyên nhân. PoC
  chỉ loại cặp sender-domain/recipient-domain `vcworkspace.test` khỏi rule đó và
  thêm quota test hữu hạn 200/giờ theo `authenticated-as + recipient`; không tắt
  limiter toàn cục. Cấu hình đã readback và mail container healthy.
- Lookup và thao tác thư dùng IMAP UID; Stalwart runtime không trả kết quả cho
  `UID SEARCH HEADER Message-ID`, nên adapter lấy header theo UID, đối chiếu
  Message-ID phía client rồi tiếp tục `UID FETCH/STORE`. Sequence race cũ đã bỏ.
- Sieve được `GETSCRIPT` đọc lại và so nội dung, không chỉ kiểm tên active.
  Thay đổi filter được serialize theo owner; lỗi ghi Mongo sẽ cài lại script cũ.
  Cập nhật membership cũng rollback engine khi ghi Mongo lỗi.
- Danh sách/tìm kiếm đồng bộ toàn bộ UID hiện có trong folder engine trước khi
  truy vấn Mongo; lỗi engine trả `503`, không còn nuốt lỗi hoặc cắt 100 thư.
  Đây là đường reconcile idempotent theo `mailboxOwner + engineId`.
- Offboarding mới khóa secrets engine, vô hiệu alias, xóa Group membership,
  đóng phiên IMAP, xóa session web, gỡ quyền shared trong Mongo và đặt user
  `left/isSuspended`; chặn offboard manager cuối khi chưa có người kế nhiệm.
  Relay chỉ expose IMAPS, terminate TLS để đăng ký socket theo principal và yêu
  cầu control token. Proof đồng thời: token sai bị từ chối, cổng IMAP 143 không
  mở, phiên B bị đóng/không rò FETCH hoặc SEARCH, phiên A vẫn NOOP thành công.
- Send journal phân biệt lỗi chắc chắn trước ACK với outcome không rõ sau DATA.
  Retry hậu-ACK chỉ đối soát Message-ID và không gửi lại; retry pre-ACK dùng CAS
  single-winner. Fault tests phủ delayed visibility và hai retry đồng thời,
  chứng minh `deliveryCount` chỉ tăng một.
- Filter dùng Mongo lease/revision journal, pending row và fencing trước/sau side
  effect. Writer hết lease không thể publish ghost row; engine được phục hồi theo
  revision mới. Rollback kép thất bại được ghi rõ để reconcile.
- MIME ingestion dùng `mailparser` maintained; test phủ folded encoded header,
  quoted-printable Unicode và multipart. Real-adapter E2E cuối 5/5 đạt.
- Browser smoke thật trên `/email`: đăng nhập Google giả, tải danh sách từ
  Stalwart và tìm marker `BROWSER08 kiểm thử` còn đúng 1 thư.
- Full gate cây cuối: guard 44/44; OpenAPI hợp lệ (178 cảnh báo lint hiện có);
  BE 153/153, coverage hợp đồng 137/137; FE 74/74; typecheck và build API/web đạt.
  Target mail cuối 14/14 đạt. Review độc lập vòng cuối kết luận `NO BLOCKER`.

## Lịch sử trước review cuối — được phần Chốt cuối thay thế

Các mục trạng thái chưa đạt/gate cũ bên dưới là lịch sử; không phải trạng thái nghiệm thu hiện hành.

### Kết quả kỹ thuật đã đạt trước review

- `MailPort` Stalwart đã nối thật: keyword IMAP, mailbox filter, ManageSieve,
  alias và Group membership qua JMAP `x:Account/*`; API chỉ ghi metadata sau khi
  engine trả thành công và readback đạt.
- Sửa reader ManageSieve thành bộ đệm có cursor xuyên suốt kết nối, xử lý
  capability tự động sau STARTTLS và xác thực response riêng. Hai lượt chẩn đoán
  liên tiếp đều `sieve-create:ok`, `sieve-update:ok`, `alias:ok`, `shared:ok`.
- Adapter tạo mailbox đích trước khi kích hoạt `fileinto`; thư filter mới xuất
  hiện trong `vip`. Stalwart 0.16.27 không tìm được Message-ID bằng `SEARCH
  HEADER/TEXT` ở runtime này, nên adapter lấy duy nhất header `Message-ID` bằng
  một lượt `FETCH` trong mailbox đã biết rồi đối chiếu phía client; không tải body.
- E2E real adapter `mail-management.e2e-spec.ts`: 4/4 đạt, gồm nhãn/filter,
  alias/chống spoof, shared roles và revoke.
- Restart `vcworkspace-mail-chat07`, health trở lại; readback đạt active script
  `vcworkspace`, keyword trong `vip`, A vẫn thấy shared tree và B đã revoke không
  thấy shared folder.
- Browser smoke trên bootstrap test Google giả/Mongo thử đạt: tạo label/filter,
  alias/shared, grant B, gửi qua alias, B nhận thư filter có nhãn `NhanB08`, A
  revoke B và UI báo thu hồi ngay. Browser phát hiện lỗi nút “Thư mới” không thoát
  màn quản lý; đã sửa và thêm test hồi quy FE.
- Full gate trên cây cuối exit 0: guard 44/44; OpenAPI hợp lệ (177 cảnh báo lint
  hiện có); BE 145/145 và coverage hợp đồng 136/136; FE 74/74; typecheck và build
  API/web đạt. `git diff --check` đạt.

Runtime vẫn local/internal: mail healthy với volume ngoài
`vcworkspace_mail_chat07_etc`, `vcworkspace_mail_chat07_data`; relay chỉ mở
loopback `18465/18587/18993/14190/18084/19090`; Nextcloud `18080`, ONLYOFFICE
`18082`. Credential thử nằm ngoài repo, quyền `600`, không in giá trị. Không đọc
`.env`, không gửi Internet, không deploy/commit/push và không tự mở chat09.

Giới hạn production còn lại: sync hiện quét toàn folder/raw nên cần UID checkpoint
hoặc JMAP Email cho mailbox lớn; shared `sent` là copy vật lý trong Group được API
trình bày là `sent`; control token PoC đang tái dùng credential test và phải tách
secret riêng trước vận hành. Chưa tuyên bố HA, tải lớn, DNS/MX hoặc production.

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, Stalwart 0.16.27 đang chạy
  trong Docker network `internal`; không deploy, đổi MX, gửi Internet, đọc `.env`,
  commit hoặc push.
- Kết luận: **hợp đồng/UI/API, protocol Stalwart local, durability/fencing,
  browser smoke, full gate và review độc lập đều đạt trong phạm vi chat08.**

## Hợp đồng và kiến trúc

OpenAPI `2.1.0-gd1` thêm nhãn, filter, alias và shared mailbox/membership; mở
rộng danh sách thư với `mailbox`, `folder`, `q`, `scope`, `label`. Schema FE được
sinh lại từ nguồn viết tay.

MIME/raw vẫn thuộc mail server. MongoDB giữ mapping `engineOwner/engineId`, ACL,
nhãn, folder logic, bộ lọc hữu hạn và chỉ mục tìm kiếm nghiệp vụ. Đây là metadata
mapping để UI/API áp quyền tenant và tìm corpus đã nhận; không phải bản sao MIME
hoặc mail engine. `MailPort` fake chỉ dùng gate. Adapter Stalwart dùng mailbox
thật đã AUTH (`authOwner`) khi gửi alias/shared; trường `From` vẫn là identity đã
được ACL cho phép. Raw luôn đọc lại từ engine owner, không lấy body trong Mongo.

Alias chỉ là identity gửi của một cá nhân. Shared mailbox là đối tượng riêng với
ba quyền `read`, `send`, `manage`; do Stalwart Group dùng membership chung cho
đọc và danh tính gửi, `send` bắt buộc kèm `read`, còn `manage` có thể độc lập.
Không có assignment/workflow xử lý thư trong chat08. Mỗi API kiểm membership hiện tại nên roles rỗng thu hồi quyền ở
lần gọi tiếp theo, kể cả session web cũ. MIME shared không bị xóa khi thu hồi.

Bộ lọc chỉ cho điều kiện `from/to/subject/body`, phép `equals/contains`, gán nhãn,
chuyển folder logic và `stop`; không có redirect/vacation, nên không tạo vòng gửi.
Chỉ báo gửi thành công sau ACK của mail port. Fingerprint idempotency bao gồm
identity, HTML, references và hash attachment.

## UI và kiểm thử đã chạy

UI `/email` có tìm kiếm server-side, nhiều nhãn, tạo filter thư đến, alias gửi,
shared mailbox, chọn identity gửi và cấp/thu hồi quyền thành viên. Test FE có luồng
chuyển tiếp MIME và tạo nhãn/phân biệt alias–shared mailbox.

`pnpm ai:check:full` trên cây cuối, chạy ngoài sandbox chỉ để MongoDB thử mở cổng
loopback, kết quả exit 0:

- guard: 44/44;
- OpenAPI hợp lệ (177 cảnh báo lint hiện có);
- BE: 145 test đạt, 4 integration opt-in bỏ qua; coverage hợp đồng 136/136;
- FE: 74 test đạt;
- typecheck và build API/web đạt.

Target `mail-basic.e2e-spec.ts` + `mail-management.e2e-spec.ts`: 2 suite, 6 test
đạt. Các test chat08 chứng minh:

- một thư có hai nhãn, bỏ còn một nhãn và đọc lại; folder `vip` khác nhãn;
- tìm đúng sender/subject/body với thư gây nhiễu và scope folder;
- filter A→B tự áp folder/nhãn sau delivery;
- alias From đúng, spoof alias người khác bị 403, retry khác payload bị 409;
- shared mailbox tách read/send/manage; B bị thu hồi thì session cũ đọc/gửi 403
  ngay, manager vẫn đọc MIME mapping và thư không mất;
- chặn địa chỉ ngoài `.test`, CRLF/header injection, tenant/nhãn mailbox khác và
  không expose hành động forward trong filter.

Container read-only check: `vcworkspace-mail-chat07` healthy, relay up;
Nextcloud và ONLYOFFICE vẫn up. Không restart/purge các dịch vụ này.

## Bằng chứng engine/protocol và giới hạn

Bằng chứng chat07 còn hợp lệ cho topology hiện tại: SMTP AUTH + ACK, IMAP fetch
raw MIME/attachment hash qua sidecar loopback, engine nằm network `internal` và
không egress. Script `poc/mail-stalwart/run-integration.mjs` đã được nâng cho
chat08 để kiểm IMAP CAPABILITY, SEARCH TEXT, custom folder COPY/readback và đánh
dấu tương thích giao thức mobile.

**Chưa chạy script chat08 mới:** `MAIL_TEST_A_PASSWORD` và
`MAIL_TEST_B_PASSWORD` không có trong môi trường phiên. Không đọc `.env`, secret
file hay recovery credential cũ. Vì vậy chưa có bằng chứng runtime mới cho
labels/keywords/Sieve/IMAP ACL hoặc thu hồi một IMAP connection đang mở. Nhãn,
filter và shared ACL trong bản này là metadata nghiệp vụ + enforcement API; chưa
được đồng bộ bằng JMAP keywords/JMAP Sieve/Stalwart Group ACL. Không tuyên bố
mobile UI, DNS/autoconfig/TLS trust, HA, tải, tenant Stalwart Community hay
production đã đạt. Computer Use cũng đóng transport trước khi tải UI, nên không
có ảnh browser cuối; test DOM và build không thay ảnh browser thật.

## Nguồn chính thức đã đối chiếu

- [Stalwart 0.16 releases](https://github.com/stalwartlabs/stalwart/releases) và
  [changelog](https://github.com/stalwartlabs/stalwart/blob/main/CHANGELOG.md).
- [Stalwart Groups](https://stalw.art/docs/auth/principals/group),
  [permissions và ACL](https://stalw.art/docs/auth/authorization/permissions/),
  [Sieve](https://stalw.art/docs/sieve/) và
  [JMAP for Sieve](https://stalw.art/docs/sieve/jmap/).
- [Nextcloud Mail](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/mail.html)
  cho folder, filter và shared mailbox; ACL mailbox vẫn phải cấu hình ở IMAP server.
- [RFC 8621 JMAP Mail](https://www.rfc-editor.org/rfc/rfc8621.html),
  [RFC 5228 Sieve](https://www.rfc-editor.org/rfc/rfc5228.html) và
  [RFC 4314 IMAP ACL](https://www.rfc-editor.org/rfc/rfc4314.html).
- [Stalwart Community/Enterprise comparison](https://www.stalw.art/compare/):
  core IMAP/JMAP/Sieve/aliases/ACL có ở Community; multi-tenancy là Enterprise.

## Blocker review độc lập trước khi mở chat09

Các sửa code sau review đã thực hiện và qua fake-adapter E2E 4/4 + full gate:
recipient alias được canonical hóa về mailbox chủ alias; shared raw/setLabels dùng
credential thành viên hiện tại trên Group folder; Shared Sent được copy vào Group;
engine Group membership chỉ bật khi role có `read`, nên `send` đơn lẻ không cấp
quyền đọc IMAP. Test mới phủ inbound alias raw, inbound shared raw/label và
send-only bị chặn đọc ở API.

Chưa được coi là nghiệm thu vì real-adapter rerun sau sửa bị Stalwart trả `452
Rate limit exceeded` do chuỗi chẩn đoán liên tiếp, kể cả sau restart container;
chưa có lượt pass sạch cho các ca mới. Ngoài ra vẫn còn:

1. Bổ sung offboarding protocol toàn user và test session IMAP đã select vẫn
   không FETCH/SEARCH được sau revoke.
2. Kiểm GETSCRIPT/hash, concurrent filter update, reconcile
   engine–Mongo, ingestion/search thư ngoài API và UID/JMAP lookup thay sequence.
3. Chạy lại real-adapter sau khi cửa sổ rate limiter hết và review độc lập lần cuối.

Chat này **không tự mở chat09** cho tới khi review lại không còn lỗi chặn.

Review độc lập lần hai xác nhận bốn sửa trên đúng về cấu trúc và fake E2E,
nhưng giữ kết luận **chưa nghiệm thu** vì chưa có real-adapter pass sạch trên cây
mới. Shared `sent` hiện là bản copy phát vào Group/INBOX vật lý và được API trình
bày ở folder `sent`; chưa được tuyên bố là thư nằm trong IMAP `Sent Items` chuẩn.
Các tuyên bố search cũng chỉ giới hạn ở corpus metadata do API tạo, chưa bao gồm
thư vào từ client SMTP/IMAP khác.
