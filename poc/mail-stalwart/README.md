# Stalwart PoC (chat07/08) — sao lưu và diễn tập khôi phục

Stack live: container `vcworkspace-mail-chat07`, volume `vcworkspace_mail_chat07_etc` và
`vcworkspace_mail_chat07_data` (xem `compose.yaml`). Phần dưới là bộ script `*-mail07.mjs`,
theo mẫu `poc/calendar-contacts/{backup,restore,verify-restore}-cal16.mjs`.

## Chưa chạy

Các script mới **chưa được chạy thật** (đã `node --check` và test logic thuần). Lý do, kiểm bằng lệnh
chỉ đọc (`docker ps -a`, `docker volume ls`, `docker network ls`, `docker image ls`, `ls /private/tmp`):

- Không còn container Stalwart chat07; chỉ còn mạng `vcworkspace-mail-chat07_default/_internal`.
- Không còn volume `vcworkspace_mail_chat07_etc` / `_data` (chỉ có `vcworkspace_mail_pilot_data`, của stack khác, không đụng).
- Không có file credential thử trong `/private/tmp` cho `run-with-secrets.mjs`; không có image `stalwart`/`alpine` cục bộ.

Việc chủ dự án cần làm để diễn tập thật:

1. Dựng lại stack chat07 bằng `compose.yaml` với credential thử như mọi PoC khác (relay IMAPS ở 18993),
   nạp vài thư vào `tp.mkt@` / `nv.mkt@vcworkspace.test` (ví dụ `run-integration.mjs`; hộp rỗng thì verify cố ý FAIL).
2. Tạo file credential thử trong `/private/tmp` (`MAIL_TEST_A_PASSWORD`, `MAIL_TEST_B_PASSWORD`, `STALWART_RECOVERY_ADMIN=user:pass`).
3. Chạy lần lượt (từ gốc repo, `S=` là đường dẫn file credential):
   - `node poc/mail-stalwart/run-with-secrets.mjs $S poc/mail-stalwart/backup-mail07.mjs`
   - `node poc/mail-stalwart/run-with-secrets.mjs $S poc/mail-stalwart/restore-mail07.mjs`
   - `node poc/mail-stalwart/run-with-secrets.mjs $S poc/mail-stalwart/verify-restore-mail07.mjs`
4. Dọn: `docker compose -p vcworkspace-mail07-restore -f poc/mail-stalwart/compose.restore.yaml down` rồi xoá hai volume `vcworkspace_mail07_restore_*`.

## Cách hoạt động

- `backup-mail07.mjs`: chụp mốc IMAP (SHA-256 MIME từng thư, mọi thư mục, EXAMINE + BODY.PEEK nên không đổi cờ)
  → **dừng container chat07** (RocksDB không an toàn khi chép lúc đang chạy; hộp thư ngừng phục vụ trong lúc tar, thường vài giây)
  → tar hai volume chỉ đọc, `--network none` → luôn `docker start` lại trong `finally`
  → `backup/mail07-{etc,data}.tgz` (0600) + `mail07-backup.json` (SHA-256, image) + `mail07-reference.json`.
  `backup/` nằm trong `.gitignore` của thư mục này.
- `restore-mail07.mjs`: kiểm SHA-256 tệp, tạo volume **mới** `vcworkspace_mail07_restore_{etc,data}`, giải nén,
  dựng `compose.restore.yaml` (project `vcworkspace-mail07-restore`). Volume đã có thì cần `MAIL07_RECREATE_RESTORE=1`
  (chỉ xoá đúng hai volume mail07; hàm `assertOwnResource` từ chối tên có `pilot|ses|vcparts` hoặc volume gốc).
- `verify-restore-mail07.mjs`: đọc lại qua IMAPS `127.0.0.1:18994`, so hash MIME theo tài khoản|thư mục|UID, in bảng,
  kiểm `restore_internal` có `Internal=true`, Stalwart khôi phục không publish cổng và chỉ nối mạng internal, dùng volume
  khôi phục; thoát mã 1 nếu lệch/thiếu/thừa hoặc mốc rỗng.
- Logic thuần: `node --test poc/mail-stalwart/mail07-lib.test.mjs`.

## Giới hạn

- Nhất quán đạt được nhờ dừng container, không phải snapshot nóng. Thư tới giữa lúc chụp mốc và lúc dừng sẽ nằm trong
  bản sao nhưng không có trong mốc, verify báo "thừa" (chạy PoC không có lưu lượng thì không xảy ra).
- Chỉ kiểm hai hộp thư thử (A, B), không kiểm hộp nhóm, quota, cấu hình ngoài volume, hay gửi thư mới qua bản khôi phục.
- Bản khôi phục mặc định dùng đúng image của container gốc (ID lưu trong manifest); đặt `MAIL07_STALWART_IMAGE` để ghi đè.
- Giả định Stalwart lắng nghe IMAPS 993 trong mạng internal (như `relay.py`); relay `nc` dùng image redis ghim digest như mẫu cal16.
- Mốc/bản sao chứa dữ liệu thư: để mode 0600, không commit.
