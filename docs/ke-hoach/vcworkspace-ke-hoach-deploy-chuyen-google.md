# Chuẩn bị deploy và chuyển Google Workspace → VCworkspace

Ngày: 2026-10-24. Trạng thái: đề xuất, chưa triển khai/chuyển dữ liệu thật.

## Kết quả khảo sát ban đầu

- Chat01–10 PASS PoC local ba nhóm Drive/Office/Email và liên thông; chưa production-ready.
- deploy/README.md và compose hiện tại cho VCdocs cũ (web/api/Mongo/Caddy), chưa phải bộ triển khai đủ Nextcloud/SQL/Redis/cron, ONLYOFFICE, Stalwart và các kho/backup tương ứng. Không dùng dự toán cũ làm giá hệ thống mới.
- Connector Google đã xác nhận tài khoản buithoanh@vcprosperous.com và đọc được một trang metadata thư mục Drive, gồm shared-drive ID. Đây là mẫu nhỏ, không phải kiểm kê toàn công ty; chưa biết tổng người dùng, dung lượng, ACL hoặc quyền superadmin. Chưa đọc nội dung thư/file, chưa export/copy.

## Điều kiện triển khai

1. Chốt máy chủ/kiến trúc CPU/RAM/đĩa, vùng dữ liệu, ngân sách và số người dùng đồng thời sau kiểm kê. Kiểm license/giới hạn kết nối Office.
2. Đóng gói đầy đủ dịch vụ, pin artifact, cấu hình production riêng, TLS/domain/firewall; thay credential thử bằng secret riêng.
3. Identity/SSO không phụ thuộc duy nhất tài khoản Google dự định ngừng; lifecycle người dùng/nhóm và quyền xuyên engine.
4. Mail: public IP/port25/reverseDNS, MX/SPF/DKIM/DMARC, chốngspam và deliverability; phải kiểm nhận/gửi ngoài ở phiên vận hành được giao riêng, PoC local chưa chứng minh.
5. Backup tất cả engine/cấu hình/bytes/metadata, restore diễn tập trên đích mới, RPO/RTO/retention; monitoring/cảnh báo/on-call/rollback.
6. Staging kiểm tải, lỗi/restart, quyền và bộ file nghiệp vụ đại diện; pilot có giới hạn trước cutover.

## Quy trình chuyển đổi đề xuất

Kiểm kê read-only → bảng ánh xạ danh tính/nhóm/quyền → staging + backup → dry-run bản sao → pilot nhóm nhỏ → đồng bộ bổ sung → nghiệm thu/chốt cutover → chuyển DNS/MX ở phiên vận hành riêng → theo dõi + đối soát → chỉ đóng Google khi được duyệt.

- Email: số mailbox/dung lượng/ngày cần giữ/aliases/groups/delegation/filter; nhập MIME giữ ngày/thư mục, nhãn Gmail nhiều-nhãn phải map tránh nhân bản thư; đối soát Message-ID/hash attachment/count, retry idempotent.
- Drive: MyDrive/SharedDrives/owner/externalshares/shortcuts/trash/versions; manifest GoogleID→targetID và ACL mapping; tệp nhị phân kiểm checksum, tệp Google-native export DOCX/XLSX/PPTX rồi kiểm nội dung. Comments/revisions/links/AppsScript/Forms/phức tạp cần xử lý riêng, không hứa bảo toàn tự động.
- Calendar/Contacts: phụ thuộc chat11+, chuyển timezone/recurrence/invitations/resources/CalDAV/CardDAV và tránh gửi lại lời mời trong dry-run.
- Rollback mail phải giữ/đồng bộ cả thư mới phát sinh ở đích; đổi MX ngược không tự khôi phục các thư đó. Drive cutover phải có nơi ghi chuẩn, tránh sửa hai nơi không đối soát.

## Thông tin cần chủ dự án chốt

Phạm vi cả công ty hay nhóm pilot; đầu mối superadmin và DNS (chưa cấp quyền thao tác); hạ tầng sẵn có/ngân sách; dung lượng và thời gian giữ dữ liệu; thời gian gián đoạn cho phép; thời gian giữ Google chạy song song. Không yêu cầu gửi mật khẩu/OTP/secret trong chat; human tự đăng nhập/MFA khi cần.

## Nguồn chính thức

- https://knowledge.workspace.google.com/admin/migrate/export-all-your-organizations-data : export toàn tổ chức cần superadmin/2SV và subscription còn hoạt động; export không phải import/khôi phục tương thích tự động.
- https://github.com/nextcloud/integration_google : ứng dụng tích hợp/import Google là candidate, cần thử đúng version và giới hạn trước lựa chọn.
