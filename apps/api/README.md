# @vcdocs/api – máy chủ nghiệp vụ VCdocs

NestJS + TypeScript + MongoDB. Giai đoạn 1: M01–M09, M14 và `/jobs`, đúng theo
`contract/openapi.yaml` (1.2.0-gd1) (gốc chung FE/BE, không sinh từ mã). Google Drive giữ
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
| `FAKE_GOOGLE_STATE_FILE` | Lưu trạng thái Google giả ra file JSON | (trống = chỉ trong bộ nhớ) |
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
- Việc gọi Google nhiều bước trả 202 + `jobId`; sổ VCdocs chỉ ghi sau khi Drive
  làm xong; bước lỗi thì việc dừng, `GET /jobs/{id}` báo bước nào.
- Giới hạn 600 yêu cầu/phút/người, tìm kiếm 60/phút (429 kèm Retry-After); thân
  JSON ≤ 1 MB, file ≤ 100 MB (vượt → 413 PAYLOAD_TOO_LARGE).
- Phản hồi chi tiết và danh sách có `people` (id → UserRef) ở cấp đối tượng / cấp trang.
- Việc nền gặp lỗi Google tạm thời tự thử lại tối đa 3 lần, giãn cách tăng dần.
- Đăng nhập lỗi không trả JSON mà chuyển về `WEB_ORIGIN/dang-nhap?loi=domain|locked|expired|state`.

## Những gì còn dùng bản giả hoặc chưa làm

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
