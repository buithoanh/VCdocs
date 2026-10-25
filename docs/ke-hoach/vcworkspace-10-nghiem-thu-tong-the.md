# VCworkspace 10 — nghiệm thu tổng thể ba nhóm cốt lõi

- Ngày: 2026-10-24.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, Nextcloud/ONLYOFFICE/Stalwart
  thật; dữ liệu và danh tính `.test`; không production, Google thật, MX, mail
  Internet, deploy, commit hoặc push.
- Kết luận: **PASS nghiệm thu PoC local cho Drive–Office–Email và liên thông.**
  Không phải kết luận production-ready.

## 1. Runtime và định danh bằng chứng

| Thành phần | Runtime thật đã dùng | Trạng thái cuối |
|---|---|---|
| Drive | `nextcloud@sha256:f6653516...79b`, loopback `18080` | running |
| Office | `onlyoffice/documentserver:9.4.0.1`, image id `9f1f9ada...e5a3`, loopback `18082` | running |
| Email | `stalwartlabs/stalwart:v0.16`, image id `e105324c...047c`, internal network + fixed-port relay | healthy |
| Danh tính/CSDL | hai mailbox `.test`, Google fake, MongoDB memory/test riêng | cô lập |

Credential thử cuối được xoay lại đúng hai principal và recovery admin local;
file runtime `/private/tmp/vcworkspace-mail10-secrets.env` có mode `600`, không
đưa vào Git/log. Không đọc `.env` hoặc credential thật.

## 2. Ma trận nghiệm thu cuối

| Nhóm | Tiêu chí | Kết quả | Bằng chứng cuối |
|---|---|---|---|
| Drive | upload/download/hash, ACL manager/reader, rename/move giữ ID, version bất biến, trash/restore | PASS | E2E Drive trong ma trận 26/26; bàn giao 02–03 |
| Drive | backup/restore usable sang volume + DB thử mới | PASS (bằng chứng chat03 đã kiểm, không phá volume để chạy lại vô cớ) | `poc/drive-nextcloud/evidence/chat03-usable-restore-restore-mvks7o45.json`, fileId `6adb2c1d9cc53eaf644f87cd`, version `6adb2c1d9cc53eaf644f87d3`, SHA-256 `cfd028b0...f7471` |
| Văn bản | DOCX tạo/mở/edit-view/save version/reopen/export PDF, đúng body | PASS thật | ONLYOFFICE–Nextcloud integration 1/1; PDF 35.102 byte, marker present |
| Bảng tính | XLSX/công thức/filter/sort/save/reopen/export | PASS thật | integration 1/1; V2 XLSX `1ffcf25f...cec1b`, PDF `8a3c69e1...5e69`; lượt cuối tổng mẫu 7.400.000 |
| Slide | PPTX 3 trang/layout/save/reopen/PDF text/render | PASS thật | integration 1/1, PDF 64.393 byte/3 trang; V2 PPTX `aca135f2...8e7a`, PDF `0743fd35...69cb` |
| Email cơ bản | SMTP AUTH/ACK, IMAP persistence/search/folder copy, MIME attachment hash | PASS thật | marker `chat08-1792814673906`; SHA-256 `4086bb0e...c182f`; fetch 733 byte |
| Email quản lý | labels/search/Sieve/alias/shared Group ACL/offboard | PASS thật | real management 5/5; spoof/tenant/header-loop deny; filter, alias, shared ACL và offboard đạt |
| Thu hồi phiên | B đã select bị đóng, không FETCH/SEARCH; A còn sống; control token sai bị từ chối | PASS thật | `oldSessionClosed=true`, `oldSessionFetchLeaked=false`, `oldSessionSearchLeaked=false`, `unaffectedPrincipalSessionAlive=true` |
| Durability | pre/post-ACK, CAS concurrent retry, filter lease/fencing/rollback, MIME folded/QP | PASS fake/fault | `mail-durability.e2e-spec.ts`; nằm trong ma trận cuối 26/26 |
| Liên thông | attachment→Drive→đúng version/hash; snapshot/link recipient ACL; expiry/revoke/retry | PASS thật | fileId `6adc2e6d356eb533f6d0bd86`, SHA-256 `340bd40a...3be6`, delivery `1`, other-recipient/expiry/revoke đều deny |
| Idempotency regression | đổi mode/file/version/recipient/payload cùng key và race unique-key | PASS fake/fault + thật retry | `workspace-interop.e2e-spec.ts` 2/2; real integration 1/1 |
| Login-return/link tuyệt đối | token không vào `returnTo`/access log; intended recipient bắt buộc | PASS theo browser evidence chat09 + FE final | run `chat09-1792813754428`; FE 76/76 cuối |

## 3. Lệnh chạy trên cây cuối

- Ma trận Drive/Office/Email/interop fake + fault/race: **8 suite, 26/26 PASS**.
- ONLYOFFICE + Nextcloud thật: **3/3 PASS** (DOCX, XLSX, PPTX/PDF).
- Stalwart protocol thật: SMTP ACK, IMAP fetch/search/folder persistence PASS.
- Stalwart management thật: **5/5 PASS**.
- Principal revoke proof thật: PASS toàn bộ điều kiện deny/alive.
- Stalwart + Nextcloud interop thật: **1/1 PASS**, đúng một delivery.
- `pnpm ai:check:full`: **PASS** — guard 44/44; OpenAPI hợp lệ (181 warning
  lint hiện có); BE 157/157, coverage hợp đồng 140/140; FE 76/76; typecheck và
  build API/web đạt. Sáu suite runtime opt-in được skip đúng trong gate và đã
  chạy riêng như trên.

Lượt gọi Jest runtime đầu tiên thiếu `POC_BASE_URL` nên FAIL trước khi chạy ca;
đã thay bằng runner chính thức đọc credential thử mode 600 và đạt. Đây là lỗi
cách gọi harness, không được che khỏi hồ sơ. Protocol runner cũng phát hiện
mailbox `VC08` còn từ lượt trước; đã sửa để CREATE idempotent chỉ được tiếp tục
sau LIST/readback đúng mailbox, rồi rerun PASS.

## 4. Review bảo mật/quyền

- Tenant và membership được kiểm ở service/API; reader không nhận callback ghi,
  người ngoài nhận 403/404 phù hợp chống lộ.
- MIME nguyên bản ở mail engine; Mongo chỉ giữ metadata/mapping/journal. Send
  journal bind fingerprint đầy đủ và CAS chống gửi trùng sau ACK/đua tiến trình.
- Callback Office bắt buộc JWT/vé HMAC, same-origin, không redirect và chặn
  metadata IP; stale document key bị từ chối.
- Shared link chỉ là token định danh: vẫn cần cookie, intended recipient, ACL
  hiện tại, version/hash cố định; expiry/revoke bị từ chối.
- Stalwart ở internal network; relay chỉ fixed ports loopback, plaintext IMAP
  không expose và control token sai bị từ chối.

Không phát hiện blocker P0/P1 mới trong review cuối. Sửa duy nhất của chat10 là
harness IMAP idempotent/readback; không đổi OpenAPI nên không kích hoạt phiên
hợp đồng hoặc sinh lại schema.

## 5. NOT_TESTED và điều kiện thí điểm cần human

NOT_TESTED/không được suy rộng: coediting nhiều người và tải 48 user; mailbox/file
lớn; HA/SLA; backup theo lịch và diễn tập production; Unicode/case-folding rộng;
macro/Apps Script/external link/pivot phức tạp; fidelity Office phức tạp; mobile
client; TLS/DNS/MX/autoconfig; retention; sizing; license/legal; secret manager,
monitoring và vận hành production; Google/dữ liệu thật.

Trước thí điểm có người dùng thật, chủ dự án/human còn phải chốt và thực hiện ở
phiên vận hành riêng: phạm vi người dùng/dữ liệu, DNS/MX và TLS, danh tính/SSO,
secret riêng (không tái dùng credential test/control token), backup–restore/RPO–RTO,
retention và revoke UI, monitoring/on-call, sizing/load test, legal/license và
kế hoạch rollback. Hồ sơ này không tự cho phép deploy hoặc chuyển dữ liệu.
