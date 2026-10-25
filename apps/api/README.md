# @vcdocs/api – máy chủ nghiệp vụ VCworkspace

NestJS + TypeScript + MongoDB. Giai đoạn 1: M01–M09, M14 và `/jobs`, đúng theo
`contract/openapi.yaml` (1.3.0-gd1) (gốc chung FE/BE, không sinh từ mã). Google Drive giữ
file, MongoDB giữ sổ sách.

## Chạy local

Cần Node 22, pnpm 9, MongoDB (local đã có `/usr/local/bin/mongod`). Không cần
tài khoản Google: mặc định chạy với **Google giả**.

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
mongod --dbpath ~/vcdocs-db --port 27017
```

```bash
pnpm --filter @vcdocs/api build && pnpm --filter @vcdocs/api start
```

Máy chủ chạy ở `http://localhost:4000/api/v1`. CSDL trống thì tự nạp dữ liệu mẫu
(11 drive theo cây thư mục VCPV, nhóm Google, 12 người dùng mẫu, BM khung,
Bảng mã MKT). Đăng nhập: mở `http://localhost:4000/api/v1/auth/google` → trang
"Đăng nhập Google (giả lập)" → chọn người dùng mẫu. Cookie phiên đặt cho
localhost nên FE ở cổng 3000 gọi qua proxy `/api/v1` của Next.js là dùng được.

Khi phát triển: `pnpm --filter @vcdocs/api dev` (tsx watch).

Khởi động lại: trạng thái Google giả (người dùng, nhóm, drive, file) mặc định lưu ở
`apps/api/.vcdocs-dev/fake-google.json` (đã gitignore), nên chạy lại vẫn đăng nhập
được. Mất file này mà CSDL đã có dữ liệu thì BE tự dựng lại danh bạ, drive, thư mục
và file đã đăng ký từ CSDL (nội dung file chỉ còn bản trống). Muốn làm lại từ đầu:
xoá CSDL `vcdocs` và thư mục `.vcdocs-dev/`.

Người dùng mẫu (đều @vcprosperous.com, không phải người thật): `tgd` (R1),
`gdk.vhnb`, `gdk.kd` (R2), `hcns` (R3 + R4 drive 00, 22), `tp.mkt` (R4),
`leader.mkt` (R5), `nv.mkt` (R6), `xem.mkt` (R7), `tp.kd`, `nv.kd`, `ktt` (R4 + R8),
`it` (R4 + R9).

## Test

```bash
pnpm --filter @vcdocs/api test
```

- e2e bằng supertest trên app thật, MongoDB trong bộ nhớ (mongodb-memory-server,
  `MONGOMS_SYSTEM_BINARY` mặc định `/usr/local/bin/mongod`), Google giả.
- Mọi phản hồi trong test tự kiểm khớp schema trong `contract/openapi.yaml`
  (ajv) theo đúng mã trạng thái; thiếu `X-Request-Id`, `X-Audit-Id` cũng báo lỗi.
- Cuối lượt test kiểm **mọi điểm cuối trong hợp đồng đều đã có test** (hiện
  98/98). Đặt `ALLOW_PARTIAL_COVERAGE=1` để tạm bỏ qua khi đang làm dở.
- `TEST_UNDECLARED_REPORT=/tmp/x.txt` ghi các mã lỗi BE trả mà điểm cuối chưa khai
  trong hợp đồng (xem `DE_NGHI_SUA_HOP_DONG.md` mục B).

## Biến môi trường

Xem `.env.example` (không chứa khoá thật). Chính:

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `PORT` | Cổng | 4000 |
| `MONGODB_URI` | Chuỗi kết nối MongoDB | `mongodb://127.0.0.1:27017/vcdocs` |
| `PUBLIC_API_ORIGIN` | Gốc công khai của API (ghép redirect OAuth) | `http://localhost:4000` |
| `WEB_ORIGIN` | Gốc giao diện (CORS, chuyển về sau đăng nhập, link QR) | `http://localhost:3000` |
| `ALLOWED_DOMAIN` | Tên miền được đăng nhập | `vcprosperous.com` |
| `COOKIE_SECURE` | Cookie Secure (bật ở production HTTPS) | true khi `NODE_ENV=production` |
| `SESSION_HOURS` | Thời hạn phiên | 8 |
| `GOOGLE_MODE` | `fake` hoặc `real` | `fake` |
| `FAKE_GOOGLE_STATE_FILE` | Lưu trạng thái Google giả ra file JSON; `none` = chỉ trong bộ nhớ | `.vcdocs-dev/fake-google.json` (khi fake, không phải test) |
| `SEED_DEMO` | Nạp dữ liệu mẫu khi CSDL trống (chỉ với fake) | true khi fake và không phải production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth đăng nhập (real) | |
| `GOOGLE_SA_WRITE_KEY`, `GOOGLE_SA_READ_KEY` | JSON tài khoản máy ghi / đọc: chuỗi JSON, base64 hoặc đường dẫn file ngoài repo (real) | |
| `GOOGLE_ADMIN_SUBJECT` | Email quản trị để uỷ quyền toàn tên miền (Admin SDK) | |
| `MAIL_FROM` | Hộp thư gửi thông báo | `vcdocs@vcprosperous.com` |
| `VAULT_DIR` | Kho riêng giữ PDF đã chốt | `.vault` |
| `UPLOAD_TMP_DIR` | Chỗ để tạm file tải lên | `.uploads` |
| `STAMP_FONT_PATH` | Font có dấu để in dấu ĐÃ CHỐT | tự tìm DejaVuSans / Arial Unicode |
| `JOBS_POLL_MS`, `SCHEDULER_ENABLED` | Hàng đợi việc nền, việc định kỳ | 1000, true |
| Quy tắc còn `[..]` | `APPROVAL_DUE_DAYS`, `SHARE_MAX_DAYS`, `BACKDATE_MAX_WORKING_DAYS`… | xem `.env.example` |

`GOOGLE_MODE=fake` bị chặn khi `NODE_ENV=production`.

## Cấu trúc

```
src/
  bootstrap.ts           dựng app (dùng chung main.ts và test)
  contract/openapi.ts    đọc contract/openapi.yaml, kiểm dữ liệu vào bằng ajv
  common/                lỗi (schema Error), X-Request-Id, phiên + CSRF, Idempotency-Key,
                         audit X-Audit-Id, phân trang/sort, vai trò R1–R9
  db/                    model mongoose; plugin chặn truy vấn thiếu companyId
  audit/                 audit_logs chỉ thêm, mã băm nối dòng trước (verifyChain)
  access/                quyền ba tầng: vai trò, phạm vi phòng, vai trò drive; drive Mật → 404
  jobs/                  hàng đợi việc chạy lâu trên MongoDB + GET /jobs
  google/                interface Drive/Docs/Sheets/Admin SDK/Gmail; bản giả + bản thật googleapis;
                         kho riêng (vault); đóng dấu PDF chốt + QR
  modules/m01…m14        mỗi phân hệ một module
  seed/                  dữ liệu mẫu cho local và test
```

Nguyên tắc đã làm theo hợp đồng mục 1, 7:

- Kiểm dữ liệu vào theo chính schema của hợp đồng (ajv), trường lạ bị loại.
- `companyId` lấy từ phiên; mọi truy vấn có `companyId`, thiếu thì mô hình ném lỗi.
- Drive Mật lọc ngay ở truy vấn CSDL; danh mục tài liệu Mật chỉ trả mã và tên.
- Mọi POST/PATCH/DELETE ghi `audit_logs` và trả `X-Audit-Id`; lần bị từ chối
  (403) cũng ghi. Nhật ký không ghi token, nội dung file.
- POST có `Idempotency-Key` (theo hợp đồng) gửi lại trong 24 giờ trả đúng kết quả
  cũ; lỗi thì không giữ key.
- Việc gọi Google nhiều bước trả 202 + `jobId`; sổ VCworkspace chỉ ghi sau khi Drive
  làm xong; bước lỗi thì việc dừng, `GET /jobs/{id}` báo bước nào.
- Giới hạn 600 yêu cầu/phút/người, tìm kiếm 60/phút (429 kèm Retry-After); thân
  JSON ≤ 1 MB, file ≤ 100 MB (vượt → 413 PAYLOAD_TOO_LARGE).
- Phản hồi chi tiết và danh sách có `people` (id → UserRef) ở cấp đối tượng / cấp trang.
- Việc nền gặp lỗi Google tạm thời tự thử lại tối đa 3 lần, giãn cách tăng dần.
- Đăng nhập lỗi không trả JSON mà chuyển về `WEB_ORIGIN/dang-nhap?loi=domain|locked|expired|state`;
  CSDL chưa có công ty của `ALLOWED_DOMAIN` thì `loi=setup` và ghi log lỗi (chưa có trong hợp đồng, xem
  `DE_NGHI_SUA_HOP_DONG.md` N5).

## Khởi tạo CSDL trống (Google thật)

Chế độ `GOOGLE_MODE=real` không nạp dữ liệu mẫu, nên CSDL mới chưa có bản ghi công ty và
không ai đăng nhập được (`loi=setup`). Chạy một lần (chạy lại không tạo trùng, không ghi đè):

```bash
pnpm --filter api run khoi-tao -- --ten "Công ty TNHH VC Phồn Vinh" --mien vcprosperous.com
```

Thiếu `--mien` thì lấy `ALLOWED_DOMAIN`. Lệnh đọc `MONGODB_URI` từ `apps/api/.env`. Trên máy
chủ đã build: `node dist/khoi-tao.js --ten "…"`.

## Nạp sơ đồ tổ chức và kiểm nhóm Google C1 (Google thật)

Sau khi khởi tạo công ty, nạp khối, phòng (số drive, mã, drive, mức bảo mật, trưởng phòng),
division và người giữ R1/R3/R8/R9 từ một file YAML. Chép mẫu
`so-do-to-chuc.mau.yaml` thành `so-do-to-chuc.yaml` (git bỏ qua vì có email người thật), điền rồi:

```bash
pnpm --filter api run nap-so-do -- --file so-do-to-chuc.yaml --thu   # chỉ in việc sẽ làm
pnpm --filter api run nap-so-do -- --file so-do-to-chuc.yaml
```

- Chạy lại không tạo trùng: khối khớp theo mã, phòng theo mã (đổi mã thì khớp theo drive),
  division theo tiền tố; có rồi thì sửa theo file. Không xoá gì — có trong CSDL mà thiếu
  trong file thì chỉ cảnh báo. Mỗi thay đổi ghi `audit_logs` (`org.import`).
- Drive tìm theo tên đúng từng chữ hoặc id. Người chưa có trong CSDL thì lấy từ Google Directory;
  không có trong Workspace → báo lỗi, không ghi gì.
- Vai trò: GĐ khối → R2, trưởng phòng → R4 (kèm phòng nếu người đó chưa có phòng), mục `vai_tro`
  → R1/R3/R8/R9. Ghi vào `manualRoles` (như R9 gán tay), chỉ thêm, không gỡ; nên dùng được
  ngay cả khi IT chưa tạo nhóm. R5–R7 chỉ đến từ nhóm Google.

Báo cáo nhóm Google theo mẫu C1 (hợp đồng mục 9.3) — chỉ đọc Google, không tạo nhóm:

```bash
pnpm --filter api run nhom-c1 -- --file so-do-to-chuc.yaml --ra bao-cao-nhom-c1.md
pnpm --filter api run nhom-c1        # không --file: lấy sơ đồ đã nạp trong CSDL
```

Liệt kê nhóm cần có (`<số>-<mã>-quan-ly|quan-ly-noi-dung|dong-gop|nhan-xet|xem@`, `vcdocs-r1@`…`r9@`),
nhóm thiếu, nhóm chưa gắn vào drive hoặc gắn sai vai trò, người theo sơ đồ chưa ở trong nhóm,
nhóm đúng dạng C1 mà sơ đồ không có. Sau khi IT tạo nhóm, R9 chạy đồng bộ Google (`POST /sync/google`).

## Nhận cây thư mục có sẵn trên Drive (Google thật)

Sau `nap-so-do`, đưa thư mục đã có trên drive của các phòng vào sổ VCworkspace (`folders`) để
tài liệu, hồ sơ có chỗ lưu. **Chỉ đọc Drive** — không tạo, đổi tên, di chuyển gì.

```bash
pnpm --filter api run nhan-cay-thu-muc -- --thu                      # chỉ in việc sẽ làm
pnpm --filter api run nhan-cay-thu-muc -- --ra bao-cao-cay.md        # nhận, ghi báo cáo đủ ra file
pnpm --filter api run nhan-cay-thu-muc -- --drive 11                 # một drive (số, mã phòng hoặc id)
```

- Đọc tên theo mẫu `<số> <MÃ>-<tên ngắn> <tên đầy đủ>` (BR-11): số 2 chữ số; mã = các đoạn chữ in
  hoa đứng đầu (`SEO-PTDA`, `QĐ`, `DA-MAI`; `SAN-Sàn TMĐT` → mã `SAN`, tên ngắn `Sàn`). Loại theo
  khung: ở gốc 00 docs · 01 plan_report · 02–09 operations · 10–49 area · 50–89 project · 98 closed
  · 99 archive; bên trong: 99 → archive, 98 → closed, con của 00 Tài liệu → docs, mã `DA-…` → project,
  con của dự án → operations, còn lại theo loại thư mục cha. `YYYY` → năm, `YYYY-MM` trong năm → tháng;
  thư mục không số trong hồ sơ vận hành → đối tượng (entity).
- **Sai mẫu thì không nhận, kèm cả nhánh con**, chỉ báo cáo: thiếu số, số ngoài khung (90–97 ở gốc),
  mã dở (`TT-ĐK-`), `Tháng 10` thay vì `2026-10`, thư mục con trong thư mục tháng, năm ở gốc drive.
  Sửa tên trên Drive rồi chạy lại.
- Chia năm/tháng (`hasPeriods`, để lịch hằng tháng tự tạo thư mục tháng) chỉ bật cho thư mục đã có
  thư mục năm **và** mọi thư mục trong năm đúng `YYYY-MM` — tránh tạo `2026-10` cạnh `Tháng 10`.
  Chạy lại sau khi sửa tên thì tự bật.
- Chạy lại không trùng: khớp theo googleId; thư mục đã có trong sổ giữ nguyên (đổi tên/chuyển chỗ/
  vào thùng rác trên Drive chỉ cảnh báo — dùng "Làm mới"). Số đã dùng ghi `folder_numbers` nên VCworkspace
  không cấp lại. Mỗi thư mục nhận ghi `audit_logs` (`folder.import`).
- Cảnh báo thêm: khung thiếu (00 Tài liệu, 02 QT/03 HD/04 BM, 99), mảng/dự án chưa có mã, số trùng,
  mã chưa có trong Bảng mã (vẫn nhận), thư mục có cha đã vào thùng rác.

## Những gì còn dùng bản giả hoặc chưa làm

- **Drive cơ bản VCworkspace**: `WORKSPACE_STORAGE_MODE=fake` là mặc định.
  Chế độ `nextcloud` chỉ chấp nhận HTTP loopback, chọn credential riêng theo
  email từ `WORKSPACE_STORAGE_CREDENTIALS_JSON`; không dùng danh tính Google.
  Integration test local dùng Nextcloud cô lập ở `poc/drive-nextcloud/` và không
  đọc `.env` thật. Secret vận hành/production chưa được thiết kế.

- **Google**: test và chạy local dùng `FakeGoogle` (trong bộ nhớ). Bản thật
  (`src/google/real/real-google.ts`, googleapis + 2 tài khoản máy) đã viết nhưng
  **chưa chạy với tài khoản thật** vì chưa có tài khoản thử nghiệm. Khi có service
  account + shared drive test: đặt `GOOGLE_MODE=real` và các biến `GOOGLE_*`, chạy
  `POST /sync/google` để đồng bộ nhân sự, nhóm, quyền drive.
- **Kho riêng PDF chốt**: thư mục trên máy chủ (`VAULT_DIR`); MinIO/S3 làm sau.
- **Bàn giao (M10)** thuộc giai đoạn 2: ghi ngày nghỉ việc mới chỉ đổi trạng thái
  `leaving` và nhắc HCNS.
- Hàng đợi việc, việc định kỳ, giới hạn tần suất, file tải lên tạm chạy trong
  một tiến trình; chạy nhiều máy cần chuyển sang Redis/BullMQ và kho chung.
- Chưa dùng giao dịch MongoDB (cần replica set); thứ tự ghi đã sắp để không nửa
  vời (Drive xong mới ghi sổ).
- Tìm kiếm dùng biểu thức trên trường chữ không dấu; khi tới 100.000 hồ sơ nên
  thêm chỉ mục văn bản hoặc Atlas Search để giữ ≤ 2 giây.
- Neo nhật ký hằng tuần, `GET /audit-logs` thuộc M15 (giai đoạn 3); hiện có
  `AuditService.verifyChain` để kiểm chuỗi.
- `/dev/fake-google` chỉ có khi `GOOGLE_MODE=fake`, không thuộc hợp đồng.

Chỗ hợp đồng thiếu/sai và giả định BE đã chọn: `DE_NGHI_SUA_HOP_DONG.md`.

> Tên dự án hiện tại là VCworkspace (từ 2026-10-23). Các định danh `vcdocs`,
> package `@vcdocs/*` và cấu hình hạ tầng trong ví dụ vẫn đang dùng tên kỹ thuật cũ.
> Phiên code AI: xem [quy tắc chung](../../AGENTS.md) trước khi khởi động dịch vụ thật.
