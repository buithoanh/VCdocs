# VCworkspace 03 — bàn giao Drive an toàn dữ liệu

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, Nextcloud PoC loopback; không deploy, dữ liệu thật, commit, push hoặc xoá vĩnh viễn.
- Kết luận: lát cắt UI–API–StoragePort đã có đổi tên/di chuyển giữ ID, phiên bản bất biến và khôi phục theo checksum, thùng rác/khôi phục theo cây, cùng bằng chứng sao lưu/phục hồi volume và metadata sang đích thử mới.

## 1. Hợp đồng và hành vi sản phẩm

Đề nghị S1–S7 đã ghi vào `apps/api/DE_NGHI_SUA_HOP_DONG.md` trước khi sửa hợp đồng. `contract/openapi.yaml` lên `1.6.0-gd1`, nguồn quyết định được ghi tại `contract/NGUON.md`, schema FE được sinh lại bằng `gen:api`.

- `PATCH /drive/items/{itemId}` đổi tên/cha, giữ nguyên `itemId`; tên trùng 409, không cho di chuyển folder vào chính nó hoặc con của nó.
- Blob tệp dùng khóa phiên bản bất biến, tách khỏi tên/cha logic. MOVE thư mục đi qua StoragePort/Nextcloud; lỗi kho xảy ra trước khi đổi metadata.
- Upload mới tạo version 1. Upload bản mới tạo version bất biến tiếp theo; restore đọc lại byte và đối chiếu SHA-256 trước khi chuyển current version.
- Trash không xoá blob. Trash folder đánh dấu toàn bộ cây bằng cùng root; direct file/version bị 404. Restore chỉ từ root thùng rác, trả cả cây về cha cũ.
- Manager được ghi; reader chỉ đọc/list version; người ngoài tenant/space nhận 404. Audit không ghi byte hoặc credential.

UI `/bo-nho` có đổi tên/di chuyển bằng biểu mẫu nội tuyến, tạo bản mới, xem/khôi phục phiên bản, mở thùng rác và khôi phục. Ảnh controls ban đầu: `docs/huong-dan/anh/9-drive-an-toan-chat03.jpg`, SHA-256 `78d122148e8493266acd4d29265e82edea310a6be9b56ec7a082e01e678f34d7`. Ảnh sau khi manager khôi phục version 1 rồi đổi tên và di chuyển tệp khỏi thư mục gốc: `docs/huong-dan/anh/10-drive-chat03-doi-ten-di-chuyen.jpg`, SHA-256 `d46b1c0a5a908df6b47ed8ba6ca9d934091aba35b4df189f9e1b252701a72353`.

Sau xác nhận trực tiếp của chủ dự án, browser run mới nạp lại đúng fixture `ui03-renamed-chat03ui2.txt`: manager đưa đúng file ID `6adb3ff6cf4129e9aa012d04` vào trash, thấy file 28 byte trong trash, khôi phục, thấy lại cùng ID/size và tải xuống. Reader thấy cùng tệp và link download nhưng không có rename/move, upload version hoặc trash. Ảnh:

- Trash: `docs/huong-dan/anh/11-drive-chat03-thung-rac.jpg`, SHA-256 `ceb6d4433b3002cc097f585f9417d32bccce26ae5ade06f21ea005862bbc127d`.
- Sau restore: `docs/huong-dan/anh/12-drive-chat03-khoi-phuc.jpg`, SHA-256 `d50c6dec20d2643b41ec739b10854936b1f1f27f19960ad56b71967038e39184`.
- Reader chỉ đọc: `docs/huong-dan/anh/13-drive-chat03-reader.jpg`, SHA-256 `3add407bfcbfe82d7fb15bb27fe7e264b9b259a9975a518e2e8ffb6b1d9aefa2`.

## 2. Bằng chứng fake, Nextcloud và phục hồi

`apps/api/test/drive-basic.e2e-spec.ts` kiểm ID ổn định, 409, version 1/2 và restore đúng byte/hash, trash/restore file và cả cây folder, reader 403, người ngoài 404. Bốn collection Drive được nạp sang database thử mới, đối chiếu số bản ghi và current checksum/version, rồi chỉ cleanup đúng database thử đó.

`apps/api/test/drive-basic-nextcloud.spec.ts` chạy opt-in sau khi xoay credential PoC: manager rename/move, version/restore, trash/restore; reader đọc nhưng bị từ chối ghi; restart giữ metadata/byte/checksum. Evidence mới nhất `poc/drive-nextcloud/evidence/api-nextcloud-mvkrd8g3.json`, SHA-256 `500aae1464f49e9533e18c6756ce841e96350100d2c8960a88973574992100b2`.

Container nguồn được dừng ngắn để archive nhất quán; volume nguồn không bị xoá/ghi đè và được khởi động lại. Test opt-in `drive-backup-restore-nextcloud.spec.ts` tạo tệp qua API nguồn, sao chép bốn collection Drive sang MongoDB thử đích, archive volume nguồn, bung sang volume mới rồi boot một Nextcloud độc lập trên cổng khác. API phục hồi dùng đúng ID tệp cũ để tải byte, đối chiếu `currentVersionId`, SHA-256, quyền tải của reader và 403 khi reader ghi.

Run đạt `restore-mvks7o45`: container `vcworkspace-drive-chat03-restore-mvks7o45`, volume `vcworkspace_drive_chat03_usable_restore_mvks7o45`, endpoint `http://127.0.0.1:18081`, database thử `chat03_restore_mvks7o45`, file ID `6adb2c1d9cc53eaf644f87cd`, current version `6adb2c1d9cc53eaf644f87d3`, SHA-256 nội dung `cfd028b0304a5f06cb7c8d4347ee8dd5ec0fd7058b2c5a178ae237cb80df7471`. Manager download, reader download và reader-write-denied đều đạt. Evidence `poc/drive-nextcloud/evidence/chat03-usable-restore-restore-mvks7o45.json`, SHA-256 `834d6244081549e9cdf522ddc005923f7a953428a357b7eba975cd5b7bd023f3`. Container/volume phục hồi còn giữ để điều phối kiểm.

## 3. Kiểm tra đã chạy

- `pnpm ai:guard:test`: 44/44 đạt sau khi sửa rule chỉ cho FE Next dev test; entrypoint API/BE, secret, production và thao tác nguy hiểm vẫn bị chặn.
- `pnpm ai:check:full`: đạt lại trên cây cuối sau browser smoke và usable restore; OpenAPI hợp lệ với 145 cảnh báo hiện có, BE 133/133 và coverage endpoint 111/111, FE 72/72, typecheck/build đạt. Ba integration opt-in skip đúng trong full gate.
- Nextcloud opt-in sau rotate: 1/1 đạt. Target Drive riêng: 2/2 đạt. `git diff --check`: đạt.
- Usable restore opt-in: 1/1 đạt trên Nextcloud cổng 18081 + MongoDB thử đích, không dùng manifest đơn thuần làm tiêu chí đạt.

## 4. Sự cố và giới hạn

- Cách nạp secret PoC ban đầu bằng `source` đã làm hai giá trị xác thực giả xuất hiện trong log shell. Hai password user PoC đã được xoay ngay bằng `rotate-user-secrets.mjs`, file giữ mode 600 và integration đã chạy lại bằng giá trị mới mà không in chúng. Không có credential thật liên quan.
- Browser smoke manager đã mở version 1/2, khôi phục version 1, tải xuống, đổi tên/move, rồi ở run fixture mới trash → thấy trong trash → restore → tải lại cùng ID. Ảnh chứng minh trạng thái UI/ID/size; byte/hash/version được đối chiếu độc lập trong integration và usable-restore JSON.
- Reader browser thấy cùng ID/size, tải được và không có control ghi. Reader 403 khi gọi API ghi đã được kiểm trực tiếp ở cả E2E, Nextcloud integration và usable restore.
- Chưa thử Unicode/case-folding rộng, secret vận hành, dữ liệu thật, tải lớn hơn 10 MiB, lịch backup tự động hoặc restore production. Volume restore thử còn giữ để điều phối kiểm; chưa cleanup.

Không mở chat04 từ phiên này.
