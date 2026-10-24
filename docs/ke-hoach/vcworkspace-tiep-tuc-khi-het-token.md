# VCworkspace — tiếp tục sau hết token hoặc tạm dừng

Ngày lập: 2026-10-23. Chủ dự án yêu cầu chuẩn bị phương án hết token, chạy tiếp sáng mai. Mốc điều phối chọn: **08:45 thứ Bảy 2026-10-24, Asia/Ho_Chi_Minh**.

## Trạng thái và nguồn sự thật

- Workspace `/Users/apple/projects/VCdocs`; project app `6fd2fcb2-3da4-4962-9367-821d8930b46c`. Không suy nhánh từ ghi chú: xác nhận Git hiện tại trước làm. Checkout có WIP lớn nhiều phiên; giữ nguyên, không reset/clean/gom commit.
- Chat điều phối: `01a166d3-c301-7151-8dde-323ff0fa54ba`. Chat08 hiện tại: `01a168eb-bc87-7050-9bfd-5e863647acec`, host local. Tiếp tục cùng chat, không tạo lại08.
- Chat01–07 đã nghiệm thu **local**, chưa production. Đọc `SO_TAY_DU_AN.md`, biên bản thứ tự, bàn giao08 và checkpoint mới nhất của chat08. Tài liệu này là hướng dẫn khởi động lại, không thay evidence mới.
- Chat08 code/gate trước wiring engine: OpenAPI2.1.0, guard44, BE145/coverage136, FE74/build đã đạt. Test cũ không chứng minh cây cuối.
- Snapshot gần nhất: protocol shared mailbox revoke đã đạt cả session cũ và login mới; agent đang nối IMAP keywords/Sieve/alias/shared mailbox server-side vào ứng dụng. **Chưa nghiệm thu08/chưa mở09.** Đọc checkpoint cuối vì snapshot này có thể được cập nhật.

## Việc làm khi khởi động lại

1. Đọc AGENTS và sổ tay; kiểm cwd/nhánh/WIP, không đọc `.env` hoặc credential thật.
2. `wait_threads` snapshot08 rồi đọc bàn giao mới nhất. Nếu08 idle, nhắn tiếp tục đúng task dở; nếu active không mở trùng hoặc gửi nhiều lệnh chồng.
3. Kiểm runtime/ports/health thực tế; Stalwart internal network + sidecar loopback giữ cấm Internet egress. Nextcloud18080, ONLYOFFICE18082 và restore thử18081 là các mốc cũ, xác minh trước dùng. Không reset/purge/xoá volume.
4. Credential CHỈ thử: sinh/cấp lại trong đúng user/container thử khi cần, lưu file600 ngoài Git, không log giá trị. Không tái sử dụng giá trị từ chat/log; không truy cập secret thật.
5. Hoàn thiện ứng dụng08: labels→IMAP keywords, filters→Sieve có readback, alias/groupACL server xác nhận, restart persistence, thu hồi quyền/session cũ, search corpus có distractors và browser thật. Fake/metadata API-only không thay engine proof.
6. Chạy meaningful tests và final gates theo skills; review toàn bộ mã/contract/evidence độc lập. Chỉ khi08 đạt mới mở09 liên thông Email–Drive–Office, sau đó10 nghiệm thu tổng thể. Mỗi bước cập nhật sổ tay và chỉ báo human khi hoàn tất bước hoặc quyết định mới thật sự cần chốt.

## Quyền đã có và giới hạn

Human đã giao tự chạy đến hết phạm vi phát triển/nghiệm thu, mở chat tuần tự, sửa lỗi, local runtime/contract/hook trong phạm vi. Không hỏi lại quyền routine đã duyệt. Giao rõ contract từng task, áp dụng skills contract/change, sinh schema. Không secret/dữ liệu thật, deploy production, mua dịch vụ, mail thật/MX/push merge ngoài quyền. CUA có xác nhận action-time riêng cho thao tác delete/send nếu instruction công cụ bắt buộc: không lách, báo đúng nguồn và operation.

## Khi token/quota hết giữa việc

- Nếu còn gọi tool được, chốt checkpoint ngắn vào sổ tay và bàn giao task: file đang sửa, hành vi đã/chưa làm, test cuối + thời điểm, lỗi còn lại, process/session/runtime đang chạy, một lệnh hoặc task tiếp theo không secret.
- Không tự báo task đạt, không mở bước phụ thuộc khi test/bằng chứng thiếu. Không dọn/xoá WIP để có cây sạch.
- Phiên sau đọc checkpoint và xác minh lại trạng thái, không làm lại từ đầu hoặc dùng test cũ chứng minh mã mới. Nếu không còn quota thì scheduler không bảo đảm chạy được; chờ hạn mức khả dụng và tiếp tục cùng hồ sơ này.

## Lịch và điều phối

Automation `i-u-ph-i-ph-t-tri-n-vcworkspace-tu-n-t` đổi từ15phút sang thứBảy08:45 để không tự làm tiếp cuối tuần. Ở lượt sáng24/10, sau đọc checkpoint, đổi lại lịch15phút rồi resume08 và tiếp tục tuần tự. Không để lịch thứBảy lặp mãi sau khi đã resume. Khi toàn bộ phạm vi thử hoàn tất, xoá automation.
