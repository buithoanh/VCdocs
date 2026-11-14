# PR: Email — đồng bộ gia tăng, báo thư mới, thư thiếu Message-ID

Nhánh `claude/mail-dong-bo-thu-moi-6280c2` vào `dev`.

**Phụ thuộc:** nhánh nền `claude/bao-mat-o1-o15-3028d0` (review O1–O15) phải vào `dev` trước;
nhánh này cắt từ de09dcb của nhánh đó. Mở PR này sau khi PR O1–O15 đã gộp, hoặc đặt base tạm là nhánh nền.

## Tóm tắt

Bỏ ba giới hạn của luồng nhận thư Email. Chỉ dùng mail giả (`FakeMailPort`) và MongoDB test;
không đụng cấu hình production của Email (vẫn tắt), không đổi luật loopback/tên miền `@vcworkspace.test`.

1. **Đồng bộ gia tăng** (e19382d)
   - Collection mới `workspace_mail_sync_cursors`: công ty + hộp thư + thư mục logic → `uidValidity`, `lastUid`.
   - `MailPort.listFolder` nhận thêm trạng thái `{cursor, next}`: cùng `UIDVALIDITY` thì chỉ
     `UID SEARCH UID <lastUid+1>:*` và tải UID mới; `UIDVALIDITY` đổi thì đọc lại từ đầu, dòng đã có được
     nhận ra bằng `engineId` nên không sinh dòng trùng và không tải lại nội dung (riêng thư thiếu `Message-ID` phải tải lại để băm). Con trỏ chỉ ghi sau khi
     xử lý xong cả lượt.
   - Bản O7 (49ee3a6) được giữ và mở rộng: vẫn đọc header trước, nhưng chỉ trong khoảng UID mới.
   - `MailPort.findByMessageId` (chỉ đọc header) thay việc `reconcileSent` tải nguyên thư mục "Đã gửi"
     ba lượt ở mỗi lần gửi.
   - `FakeMailPort`: UID, `UIDVALIDITY`, `resetUidValidity()`, bộ đếm `bodyFetches`.
2. **Thư thiếu `Message-ID`** (bfe4d16)
   - Khoá ổn định `nomid-<sha256 nguyên văn>@vcworkspace.invalid` làm `engineId` (Stalwart) và
     `internetMessageId`/`threadId` ở chỉ mục. Chọn băm nội dung thay vì `UIDVALIDITY+UID` vì khoá theo
     UID đổi khi `UIDVALIDITY` đổi.
   - `StalwartMailPort.uid()` tìm thư theo khoá băm chỉ trong các thư không có `Message-ID`;
     `Message-ID` tự khai theo dạng khoá băm coi như thiếu (không mạo được khoá của thư khác).
   - Trả lời câu hỏi audit 12/12: thư từ ngoài API thiếu `Message-ID` nay hiện bình thường.
3. **Báo thư mới** (bf71b30 BE + hợp đồng, be4ea39 FE)
   - `MailSyncService` đăng ký việc `mail.syncInbox` vào `SchedulerService`; nhịp `MAIL_SYNC_INTERVAL_MS`
     (mặc định 60 000 ms; `0` hoặc `MAIL_ENGINE_MODE=disabled` thì không đăng ký).
   - Mỗi lượt: từng công ty → INBOX hộp cá nhân của user đang hoạt động và hộp nhóm; mọi truy vấn có
     `companyId` tường minh. Thông báo trong ứng dụng `mail.new` cho người có quyền đọc; nhận dòng bằng
     cập nhật nguyên tử `notifiedAt` nên không báo lặp; bỏ người gửi; không gửi Gmail kèm; thư có ngày gửi
     cũ hơn 24 giờ không báo.
   - Hợp đồng **2.7.0-gd2** (tương thích): `GET /mail/unread-count` → `{count}`; `MailMessage.unread`
     (chỉ ở danh sách); `GET /mail/messages/{id}/body` đánh dấu đã đọc. Nguồn ghi ở `contract/NGUON.md`.
   - FE: huy hiệu số thư mới trên mục Email của menu (hỏi lại mỗi phút); `/email` tự làm mới danh sách
     60 giây, thư chưa đọc in đậm + chấm, mở thư thì bỏ dấu; thư đang đọc được ghim để thư mới đến không
     làm khung đọc nhảy.

## Kiểm tra

- Mỗi mục có test fail trên mã cũ (đã chạy lại test mới với `apps/api/src` / FE của commit trước) và đạt trên mã mới:
  - `apps/api/test/mail-sync-incremental.e2e-spec.ts` (4) + 4 ca transcript IMAP trong `stalwart-imap-literal.spec.ts`.
  - `apps/api/test/mail-no-message-id.e2e-spec.ts` (4) + 2 ca transcript IMAP.
  - `apps/api/test/mail-new-notify.e2e-spec.ts` (10).
  - `apps/web/src/app/(app)/email/new-mail.test.tsx` (3).
- Hai test cũ **đổi kỳ vọng theo đúng yêu cầu mới** (không phải nới): `mail-durability` "audit 12/12" và
  `stalwart-imap-literal` "thư không có Message-ID ở header…" trước đây khẳng định thư bị ẩn, nay khẳng định
  thư hiện bằng khoá băm; phần "không lấy Message-ID từ thân thư" và "không trả 500" giữ nguyên.
- `pnpm ai:check:full` (2026-11-14, trên be4ea39): **PASS** — guard 44/44, API 414 pass/10 skip (10 suite cần runtime thật),
  độ phủ hợp đồng 150/150, FE 106/106, typecheck + build đạt.

## Chưa chạy / giới hạn

- **Stalwart thật** (`poc/mail-stalwart/`): chưa chạy — Docker daemon không bật trên máy phiên này và cần
  secret của chủ dự án. Cần kiểm trên Stalwart thật: `UIDVALIDITY` của `Shared Folders/<hộp>/INBOX` có
  giống nhau giữa các thành viên không (khác thì vẫn đúng nhưng mỗi lần đổi người đọc sẽ quét lại header);
  `UID SEARCH UID n:*`; khoá băm với thư APPEND từ client ngoài.
- **Trình duyệt**: chưa xem trên trình duyệt (phiên code không khởi động `node dist/main.js`); FE chỉ kiểm bằng vitest.
- **Credential việc nền (PoC):** adapter Stalwart đăng nhập IMAP bằng credential từng hộp trong
  `MAIL_ENGINE_CREDENTIALS_JSON`. Việc nền dùng credential của chính hộp cá nhân; hộp nhóm dùng của một
  thành viên có quyền đọc. Hộp thiếu credential bị bỏ qua (log một lần). Production cần tài khoản dịch
  vụ/master user — thuộc việc đưa Email lên production.
- Thông báo là at-most-once: tiến trình chết giữa lúc nhận dòng và lúc tạo thông báo thì thư đó không được báo
  (vẫn hiện trong danh sách).
- Việc nền chạy trong tiến trình API (`SchedulerService`); nhiều bản API cùng chạy thì cùng đồng bộ, không
  báo lặp nhờ `notifiedAt`, nhưng tốn gấp đôi lượt IMAP.
- Hai thư giống nhau từng byte và cùng thiếu `Message-ID` gộp làm một dòng.
- Trả lời một thư thiếu `Message-ID` từ FE mở hội thoại mới (FE đọc `Message-ID` từ header MIME gốc).
- Có sẵn từ trước, không đổi: địa chỉ hộp thư `local@vcworkspace.test` không mang công ty, hai công ty
  trùng local-part dùng chung hộp ở engine.

## Lệnh cho chủ dự án

```bash
git push -u origin claude/mail-dong-bo-thu-moi-6280c2
```

```bash
gh pr create --base dev --head claude/mail-dong-bo-thu-moi-6280c2 --title "Email: đồng bộ gia tăng, báo thư mới, thư thiếu Message-ID" --body-file docs/ke-hoach/vcworkspace-pr-mail-dong-bo-thu-moi.md
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
