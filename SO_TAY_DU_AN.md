# Sổ tay dự án VCdocs

Nơi các cuộc hội thoại (phiên Claude) trao đổi thông tin với nhau.
Mỗi phiên **đọc file này khi bắt đầu** và **ghi lại khi kết thúc** công việc.

## Quy ước ghi chép

- Ghi ngắn gọn, mới nhất ở trên cùng trong mỗi mục.
- Ngày theo định dạng `YYYY-MM-DD`; không dùng "hôm qua", "tuần sau".
- Mỗi mục nhật ký ghi: ngày · tên/chủ đề phiên · đã làm gì · còn dở gì.
- Thông tin đã lỗi thời thì sửa hoặc xoá, đừng để mâu thuẫn.
- Không ghi mật khẩu, token, khoá API hay dữ liệu cá nhân nhạy cảm.

---

## 1. Tổng quan dự án

- **Mục tiêu:** Phần mềm quản lý tài liệu – hồ sơ VCdocs cho VCPV. Giao diện Next.js, máy chủ NestJS, MongoDB, tích hợp Google Drive.
- **Tài liệu gốc (Claude Docs):**
  - BA và đặc tả người dùng: https://claude.ai/artifact/74kFt4rhgHd3ecPmgitRYc
  - Hợp đồng API v1: https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT (rev 16: đủ mục 1–8 + M16; thân ghi "ĐÃ CHỐT v1", tên vẫn [Đề xuất])
- **Chủ dự án:** Bùi Thọ Anh
- **Trạng thái hiện tại:** Nhánh `giai-doan-1` đã ghép FE + BE theo hợp đồng v1.3 (rev 21). Build qua, BE 110 test, FE 69 test; chạy thật (Google giả) trọn luồng hồ sơ, vòng đời tài liệu và huỷ bỏ. Đã push; PR #1 (FE) và PR #2 (`giai-doan-1`) đã merge vào `main` (2026-10-20). Google thật: đã có project `vcdocs`, service account `vcdocs-backend`, khoá JSON (chủ dự án giữ, ngoài repo) và domain-wide delegation 8 quyền.
- **Kho mã:** https://github.com/buithoanh/VCdocs (private), nhánh chính `main`.
- **Thư mục local:** `/Users/apple/projects/VCdocs`

## 2. Quyết định đã chốt

| Ngày | Quyết định | Lý do |
|------|-----------|-------|
| 2026-10-19 | Quy trình code: chốt hợp đồng → viết tay `contract/openapi.yaml` → lát mỏng đầu cuối (khung monorepo, đăng nhập Google, `/me`, CSRF, mẫu lỗi) → 2 phiên FE (`apps/web`, chạy trên mock) và BE (`apps/api`, có test kiểm hợp đồng) song song trên 2 worktree, không phiên nào sửa `contract/` → 1 phiên ghép, test đầu cuối | FE và BE làm song song mà không chờ nhau, lệch được phát hiện sớm |
| 2026-10-19 | `contract/openapi.yaml` viết tay là gốc, không sinh từ mã NestJS | Bên nào cũng phải code theo nó; sinh từ mã thì BE thành gốc |
| 2026-10-19 | Code theo giai đoạn, giai đoạn 1 trước, không làm cả 15 phân hệ một lần | Mỗi lần ghép nhỏ, ít rủi ro |
| 2026-10-19 | Code luôn theo phần hợp đồng đã viết, không chờ chốt cả bản. Thay quy trình cũ: bỏ bước lát mỏng riêng, mở ngay 2 phiên FE/BE từ nhánh `giai-doan-1`; mỗi phiên tự làm phần đăng nhập, `/me` trước | Chủ dự án yêu cầu "làm đến đâu code đến đấy", "có hợp đồng rồi thì code song song" |
| 2026-10-19 | Phiên FE/BE không sửa `contract/`; thấy cần sửa thì ghi `contract/DE_NGHI_SUA.md`. `contract/NGUON.md` ghi bản hợp đồng (rev) đã đưa vào OpenAPI | Giữ một gốc chung |
| 2026-10-19 | Tác vụ định kỳ `vcdocs-kiem-tra-hop-dong-api` (mỗi 30 phút, chế độ Auto) đọc toàn bộ nội dung hợp đồng; rev lớn hơn `contract/NGUON.md` và ảnh hưởng API thì sửa `contract/openapi.yaml` trên `giai-doan-1`, commit, báo điện thoại. Tên có `[Đã chốt]` thì chỉ báo | Code theo hợp đồng đến đâu, cập nhật đến đó |
| 2026-10-19 | Chưa dùng tài khoản Google thật: BE giả lập Google (đăng nhập OAuth, service account, shared drive) bằng lớp adapter có bản mock, cấu hình chọn mock hay thật. Không chặn việc mở phiên BE | Chủ dự án trả lời câu hỏi mở: "Cứ giả lập đi" |
| 2026-10-20 | Trưởng phòng trình huỷ bỏ HD/BM cấp phòng thì GĐ khối phụ trách duyệt (D21, hợp đồng v1.3) | Trưởng phòng vừa trình vừa duyệt → vướng BR-05, không huỷ được |
| 2026-10-19 | Đổi tên dự án từ VCknowledge sang VCdocs | Theo yêu cầu chủ dự án |
| 2026-10-19 | Dùng `SO_TAY_DU_AN.md` làm kênh trao đổi giữa các phiên | Giữ ngữ cảnh chung, tránh làm lại |

## 3. Việc đang làm / cần làm

- [ ] Chủ dự án đổi tên tài liệu hợp đồng API sang `[Đã chốt]` (thân tài liệu đã ghi "ĐÃ CHỐT v1" từ rev 16)
- [ ] Rà 15 chỗ `x-gia-dinh` trong `contract/openapi.yaml` (giả định do Claude chọn)
- [ ] Ghi quy tắc ghép tên thư mục (mã đã chứa tên ngắn thì không lặp) vào hợp đồng – FE #10
- [ ] Đánh dấu điểm cuối nào thuộc giai đoạn 1 trong hợp đồng
- [ ] Google thật, còn: OAuth client đăng nhập (`GOOGLE_CLIENT_ID/SECRET`), shared drive thử, nhóm Google theo mẫu C1, chạy BE với `GOOGLE_MODE=real`
- [ ] Máy chủ và hộp thư vcdocs@ (tên miền vcprosperous.com đã có; Q3 chưa chốt)
- [ ] Chỗ điền cho mẫu BM-VCPV-02/03/04
- [ ] Chủ dự án quyết định xoá repo cũ `buithoanh/VCknowledge` (vẫn còn trên GitHub, nội dung trùng)

## 4. Câu hỏi mở (chờ người dùng trả lời)

- _(trống)_

## 5. Lưu ý & bài học

- Máy local chưa cài `gh` CLI; thao tác GitHub (tạo, đổi tên, xoá repo) phải làm trên web.
- Git dùng thông tin đăng nhập trong macOS Keychain. Repo private nên gọi API GitHub không đăng nhập luôn trả 404.
- Google Cloud của vcprosperous.com: project `vcdocs`; service account `vcdocs-backend@vcdocs.iam.gserviceaccount.com`, Client ID `112100786889389485867`. Tổ chức chặn tạo khoá (`iam.disableServiceAccountKeyCreation`); đã tắt riêng cho project `vcdocs`. Đã bật API Drive, Admin SDK, Docs, Sheets, Gmail. Domain-wide delegation 8 quyền khớp `apps/api/src/google/real/real-google.ts`; thêm quyền mới ở BE thì phải thêm cả ở admin.google.com. Ảnh hướng dẫn: `docs/huong-dan/anh/`.
- `VCdocs` là repo tạo mới chứ không phải đổi tên từ `VCknowledge`, nên GitHub không tự chuyển hướng URL cũ.

## 6. Nhật ký các phiên

### 2026-10-20 · PR lên main và chuẩn bị Google thật (lái Chrome)
- Đã làm: mở PR #2 `giai-doan-1` → `main`; chủ dự án merge cả PR #1 và #2. Hướng dẫn chủ dự án (qua Claude in Chrome) tạo project `vcdocs`, bật API, tạo service account `vcdocs-backend` và khoá JSON (tắt chính sách chặn tạo khoá riêng cho project), thêm domain-wide delegation 8 quyền — đã kiểm tra đủ. Ảnh hướng dẫn lưu `docs/huong-dan/anh/`.
- Còn dở: OAuth client đăng nhập, shared drive, nhóm C1, chạy BE với Google thật.

### 2026-10-20 · Hợp đồng v1.3 (D21), ghép lần 3
- Đã làm: chủ dự án chốt D21 → hợp đồng mục 9.4 (rev 21), `contract/openapi.yaml` 1.3.0-gd1. BE sửa D21 và lỗi Google giả mất người dùng khi khởi động lại; ghép vào `giai-doan-1`. Build qua, BE 110/110, FE 69/69. Chạy thật: khởi động trên CSDL cũ vẫn đăng nhập được; HD-MKT-01 trưởng phòng trình huỷ bỏ → GĐ khối KD duyệt → việc nền xong → withdrawn; khởi động lại lần 2 vẫn đăng nhập được.
- Đã push `giai-doan-1` lên GitHub (chủ dự án cho phép git push).
- Còn dở: chủ dự án mở PR và đóng PR #1 trên web; Google thật.

### 2026-10-20 · Vẽ lại sơ đồ quy trình trong BA (mục 5)
- Đã làm: vẽ lại sơ đồ "vòng đời tài liệu và hồ sơ" trong tài liệu BA (Claude Docs, rev 20) theo hợp đồng v1.2. Tài liệu: người soạn hoặc trưởng phòng trình, lấy góp ý không bắt buộc, có vòng sửa lớn, huỷ bỏ phải duyệt. Hồ sơ: thêm bước trình duyệt, vòng yêu cầu sửa, nhánh Giữ lại; Bàn giao thành việc bên lề. Sửa câu đọc sơ đồ. Không đổi mã.
- Còn dở: không.

### 2026-10-20 · BE theo hợp đồng 1.3.0-gd1 (D21) và lỗi khởi động lại Google giả
- Đã làm: gộp `giai-doan-1` (f2c0560). D21: trưởng phòng trình huỷ bỏ HD/BM cấp phòng → GĐ khối phụ trách duyệt (cả /approvals/preview). Google giả: mặc định lưu trạng thái ở `apps/api/.vcdocs-dev/fake-google.json`; thiếu file mà CSDL đã có dữ liệu thì dựng lại danh bạ, nhóm, drive, thư mục, file từ CSDL. Đã chạy thử 3 lần khởi động liên tiếp. 110 test e2e qua, build qua. Không push.
- Còn dở: không.

### 2026-10-20 · Hợp đồng v1.2 (D15–D20), ghép lần 2
- Đã làm: chủ dự án đồng ý N1–N4, #14, #15 → hợp đồng mục 9.4 (rev 20), `contract/openapi.yaml` 1.2.0-gd1. BE, FE sửa theo; ghép lại vào `giai-doan-1`. Build qua, BE 107/107, FE 69/69. Chạy thật qua API + giao diện: HD-MKT-01 đăng ký → cấp mã → nháp → lấy góp ý (hành động `feedback`) → người soạn trình → trưởng phòng duyệt → ban hành; QT-MKT-01 ban hành → trình huỷ bỏ → GĐ khối KD duyệt → việc nền `document.withdraw` xong → withdrawn; trang "Việc đang chạy" hiện "Huỷ bỏ tài liệu".
- Phát hiện: (1) HD/BM cấp phòng không huỷ bỏ được — trưởng phòng vừa là người trình duy nhất vừa là người duyệt → 422 BR-05. (2) Google giả chỉ giữ người dùng trong bộ nhớ, khởi động lại BE với CSDL cũ thì trang đăng nhập giả trống.
- Còn dở: chờ chủ dự án quyết (1); giao BE sửa (2); push + PR.

### 2026-10-20 · BE theo hợp đồng 1.2.0-gd1 (D15–D20, nhánh `claude/be-gd1-7af2e6`)
- Đã làm: gộp `giai-doan-1` (432bad4, nhanh tiến); D15 việc nền `document.withdraw` + Approval.jobId, việc nền tự thử lại khi Google lỗi; D16 Job.summary; D17 `people` chỉ ở cấp trang / cấp đối tượng; D18 hành động `feedback`; D19 `people` ở danh mục nền và bảng uỷ quyền; D20 gốc drive không nhận year/month/entity (422 BR-11). 107 test e2e qua, 98/98 điểm cuối, build qua. Không push.
- Còn dở: không có đề nghị mới.

### 2026-10-20 · Phiên FE: theo hợp đồng v1.2 (`claude/fe-gd1-72b5d9`)
- Đã làm: gộp `giai-doan-1` (432bad4, đã có cả apps/api); sửa `apps/web` theo D15–D20: phiếu huỷ bỏ tài liệu theo dõi việc `document.withdraw`; câu tóm tắt `Job.summary` (chỉ số liệu); nút "Xem góp ý" theo hành động `feedback`; tên người từ `people` của danh sách khối/phòng/division/uỷ quyền; gốc drive chỉ cho 7 loại thư mục. Chạy thử với BE thật (Google giả, MongoDB tạm): đăng nhập, danh mục phòng, tạo thư mục ở gốc drive, lập hồ sơ đều chạy. Sửa thêm: tên thư mục dự kiến khớp cách BE ghép; ô số phòng nhận "21b". 69 test + build qua. Chưa push.
- Còn dở: nên ghi quy tắc ghép tên thư mục (mã đã chứa tên ngắn thì không lặp) vào hợp đồng – xem `apps/web/DE_NGHI_SUA_HOP_DONG.md` #10.

### 2026-10-20 · Chốt đề nghị, hợp đồng v1.1, ghép FE + BE
- Đã làm: chủ dự án nhận toàn bộ đề nghị (D1–D14, C1–C17); ghi mục 9 vào hợp đồng Claude Docs (rev 19) và sửa 3 chỗ "OpenAPI sinh từ mã"; `contract/openapi.yaml` 1.1.0-gd1. Hai phiên BE/FE sửa theo v1.1. Ghép `claude/be-gd1-7af2e6` và `claude/fe-gd1-72b5d9` vào `giai-doan-1` (gộp sổ tay, sinh lại `pnpm-lock.yaml`). Build qua, BE 107/107, FE 60/60. Chạy thật Mongo + BE (Google giả) + FE: lỗi tên miền → /dang-nhap?loi=domain; nhân viên MKT lập hồ sơ → HS-2026-000001 đúng tên mẫu C3 → trình → trưởng phòng MKT duyệt → chốt (PDF, mã tra cứu, SHA-256, lưu đến 31/10/2031).
- Còn dở: 6 đề nghị mới chờ chốt; push + PR; Google thật.

### 2026-10-20 · BE theo hợp đồng 1.1.0-gd1 (nhánh `claude/be-gd1-7af2e6`)
- Đã làm: gộp `giai-doan-1` (bbebac3); sửa `apps/api` theo mục 7 rev 16 và mục 9 D1–D14: R4 lập hồ sơ, người soạn được trình, GET /users/lookup, hold.reasonType, uỷ quyền theo recordTypeId + isLegalSignature, chia sẻ phát hiện không cần hạn, thư mục gốc drive, allowedActions đúng enum, `people`, Job.type/result, /me blockId + limits, callback lỗi → 302 /dang-nhap?loi=, 413 PAYLOAD_TOO_LARGE, loại trường lạ. 107 test e2e qua, 98/98 điểm cuối, build qua. Không push (phiên chính ghép tại máy).
- Còn dở: đề nghị mới N1–N4 trong `apps/api/DE_NGHI_SUA_HOP_DONG.md` (Job.type thiếu document.withdraw, Job.summary, people lặp ở từng phần tử, allowedActions xem góp ý).

### 2026-10-19 · BE giai đoạn 1 (`apps/api`, nhánh `claude/be-gd1-7af2e6`)
- Đã làm: NestJS + MongoDB theo `contract/openapi.yaml`, đủ M01–M09, M14, /jobs (97/97 điểm cuối). Kiểm dữ liệu vào bằng chính schema OpenAPI (ajv); lỗi theo schema Error; phiên `vcdocs_sid` 8 giờ, CSRF, Idempotency-Key 24 giờ, audit_logs mã băm nối dòng + X-Audit-Id, chặn truy vấn thiếu companyId, drive Mật → 404, hàng đợi việc trên Mongo, việc định kỳ. Lớp Google có bản giả (dùng test + local, có trang đăng nhập giả `/api/v1/dev/fake-google`) và bản thật googleapis (chưa chạy với tài khoản thật). 100 test e2e, mọi phản hồi tự kiểm khớp OpenAPI; chạy thử máy chủ thật với Google giả qua đăng nhập → lập hồ sơ.
- Còn dở: chạy bản Google thật khi có service account + shared drive test; M10 bàn giao (giai đoạn 2); chủ dự án rà `apps/api/DE_NGHI_SUA_HOP_DONG.md` (A1 `parentId` thư mục gốc drive, A3 R4 lập hồ sơ, A4 ai trình tài liệu, tên nhóm Google, định dạng tên hồ sơ, BR-21…). Chưa push, chưa merge.

### 2026-10-20 · Phiên FE: theo hợp đồng v1.1 (`claude/fe-gd1-72b5d9`)
- Đã làm: gộp `giai-doan-1` (openapi 1.1.0-gd1), sửa `apps/web` theo D1–D14: `allowedActions` theo enum từng đối tượng (bỏ đoán theo vai trò), tên người từ `people`, chọn người bằng `/users/lookup`, lý do giữ lại `reasonType`, uỷ quyền theo loại hồ sơ + `isLegalSignature`, chia sẻ phát hiện, thư mục gốc drive, `Job.type`/`result`, `/me.limits` và `blockId`, `loi=state`, 429 Retry-After, 413. 60 test + build qua; 25 màn hình mở trên Prism. Chưa push.
- Còn dở: 2 đề nghị mới (#14 `people` cho /blocks, /departments; #15 số kế tiếp ở gốc drive) trong `apps/web/DE_NGHI_SUA_HOP_DONG.md`. PR #1 không gộp vào main – phiên ghép làm trên `giai-doan-1`.

### 2026-10-19 · Phiên FE giai đoạn 1 (`apps/web`, nhánh `claude/fe-gd1-72b5d9`)
- Đã làm: giao diện Next.js + TypeScript cho M01–M09, M14, /jobs theo `contract/openapi.yaml` (kiểu sinh bằng openapi-typescript, gọi bằng openapi-fetch). Lớp gọi API: X-Request-Id, X-CSRF-Token từ /me, Idempotency-Key giữ tới khi thành công, 401 → đăng nhập, lỗi hiện message + mã BR. Nút theo `allowedActions`; việc 202 theo dõi /jobs/{id}. Bảng màu HD-VCPV-02; dùng được trên điện thoại (lập hồ sơ 1 màn hình 3 phần, duyệt 2 chạm). 52 test (Vitest + MSW) và build qua; 25 màn hình mở được trên Prism. 11 commit, chưa push.
- Cách chạy: `apps/web/README.md`. Mock: `pnpm contract:mock` + `pnpm --filter @vcdocs/web dev:mock` (Prism không có tiền tố /api/v1 nên dùng `API_PATH_PREFIX=`).
- Còn dở: 13 đề nghị sửa hợp đồng trong `apps/web/DE_NGHI_SUA_HOP_DONG.md` (quan trọng nhất: tên hành động trong `allowedActions`, thiếu `allowedActions` ở User/Folder/danh mục nền, thiếu API chọn người cho mọi người, id người không kèm tên). Chưa chạy với BE thật — để phiên ghép.

### 2026-10-19 · Tác vụ định kỳ theo dõi hợp đồng API (rev 16)
- Đã làm: đọc toàn bộ hợp đồng rev 16 (mục 7–8 đã viết, thêm M16 giai đoạn 2). Sửa `contract/openapi.yaml`: 429 + Retry-After, 413 cho tải file (giả định), bỏ `additionalProperties: false` ở đầu vào (trường lạ bị loại không báo lỗi), phiên tự gia hạn. Lint đạt. Ghi `contract/NGUON.md`. Commit trên `giai-doan-1`.
- Lưu ý: hợp đồng mục 1 và mục 7 vẫn ghi "OpenAPI sinh từ mã" – trái quyết định đã chốt. FE/BE cần gộp `giai-doan-1`; BE kiểm lại ValidationPipe (`whitelist: true`, không `forbidNonWhitelisted`).

### 2026-10-19 · Trả lời câu hỏi tài khoản Google thử nghiệm
- Đã làm: ghi quyết định giả lập Google cho BE, chuyển câu hỏi khỏi mục Câu hỏi mở.
- Còn dở: chưa có tài khoản Google thật.

### 2026-10-19 · Viết OpenAPI giai đoạn 1, mở 2 phiên FE/BE
- Đã làm: đọc toàn bộ hợp đồng (rev 7) và BA; viết `contract/openapi.yaml` (M01–M09, M14, /jobs, đối tượng dữ liệu, mã lỗi), lint đạt; khung workspace pnpm (`package.json`, `pnpm-workspace.yaml`, máy chủ giả Prism `pnpm contract:mock`); nhánh `giai-doan-1`.
- Mở phiên BE `vcdocs-be-gd1` (nhánh be-gd1) và FE `vcdocs-fe-gd1` (nhánh fe-gd1), cả hai cắt từ `giai-doan-1`. Đề nghị sửa hợp đồng của từng phiên ghi ở `apps/api|web/DE_NGHI_SUA_HOP_DONG.md`.
- Đổi tác vụ định kỳ sang theo dõi thay đổi hợp đồng và cập nhật OpenAPI.
- Còn dở: 2 phiên FE/BE đang chạy; hợp đồng còn mục 7–8.

### 2026-10-19 · Hỏi quy trình code FE/BE sau khi chốt hợp đồng API
- Đã làm: đọc tài liệu BA và hợp đồng API, ghi mục tiêu dự án và đề xuất quy trình vào mục 4.
- Chủ dự án đã duyệt quy trình, ghi ở mục 2.
- Cài tác vụ định kỳ `vcdocs-kiem-tra-hop-dong-api` (file /Users/apple/.claude/scheduled-tasks/vcdocs-kiem-tra-hop-dong-api/SKILL.md), chế độ Auto, lịch mỗi 30 phút. Chạy thử 2026-10-19 thành công: đọc được tài liệu qua connector, kết luận "chưa chốt".
- Còn dở: hợp đồng còn thiếu mục 3–8; chờ chủ dự án báo hợp đồng đã chốt.

### 2026-10-19 · Khởi tạo repo và đổi tên sang VCdocs
- Đã làm: clone repo trống `VCknowledge`, tạo README và commit đầu tiên. Đổi tên thư mục local, README và remote sang `VCdocs`. Push `main` lên repo trống `buithoanh/VCdocs`.
- Còn dở: repo cũ `VCknowledge` chưa xoá, chờ chủ dự án quyết định.

### 2026-10-19 · Tạo sổ tay dự án
- Đã làm: tạo `SO_TAY_DU_AN.md` và `CLAUDE.md` (nhắc mọi phiên đọc/ghi sổ tay).
- Còn dở: chưa có nội dung dự án.
