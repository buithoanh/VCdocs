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
  - Hợp đồng API v1: https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT (rev 7: xong mục 1–6, mục 7–8 còn trống)
- **Chủ dự án:** Bùi Thọ Anh
- **Trạng thái hiện tại:** Nhánh `giai-doan-1` có `contract/openapi.yaml` (giai đoạn 1) và khung workspace pnpm; 2 phiên FE/BE đang code song song.
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
| 2026-10-19 | Hợp đồng coi là chốt khi tên tài liệu có `[Đã chốt]` (thay `[Đề xuất]`) và không còn mục trống. Tác vụ định kỳ `vcdocs-kiem-tra-hop-dong-api` (mỗi 30 phút) tự kiểm tra; khi chốt thì làm lát mỏng trên nhánh `giai-doan-1/khung` và đưa ra 2 thẻ phiên FE/BE để chủ dự án bấm | Chủ dự án chỉ cần đổi tên tài liệu, không phải báo lại |
| 2026-10-19 | Chưa dùng tài khoản Google thật: BE giả lập Google (đăng nhập OAuth, service account, shared drive) bằng lớp adapter có bản mock, cấu hình chọn mock hay thật. Không chặn việc mở phiên BE | Chủ dự án trả lời câu hỏi mở: "Cứ giả lập đi" |
| 2026-10-19 | Đổi tên dự án từ VCknowledge sang VCdocs | Theo yêu cầu chủ dự án |
| 2026-10-19 | Dùng `SO_TAY_DU_AN.md` làm kênh trao đổi giữa các phiên | Giữ ngữ cảnh chung, tránh làm lại |

## 3. Việc đang làm / cần làm

- [ ] Hoàn thành hợp đồng API v1, mục 7–8; khi xong cập nhật `contract/openapi.yaml` và `contract/NGUON.md`
- [ ] Rà các chỗ `x-gia-dinh` trong `contract/openapi.yaml` (giả định do Claude chọn)
- [ ] Phiên BE giai đoạn 1 (`apps/api`) và phiên FE giai đoạn 1 (`apps/web`) — xem nhật ký
- [ ] Ghép FE + BE khi hai phiên xong
- [ ] Sửa đoạn mở đầu của hợp đồng API: hiện ghi "OpenAPI sinh tự động từ mã NestJS", phải đổi thành "`contract/openapi.yaml` viết tay là gốc"
- [ ] Đánh dấu điểm cuối nào thuộc giai đoạn 1 trong hợp đồng
- [ ] Khi duyệt xong hợp đồng, chủ dự án đổi `[Đề xuất]` thành `[Đã chốt]` trong tên tài liệu → tác vụ định kỳ tự làm tiếp
- [ ] Sau này: chủ dự án cung cấp service account và shared drive test để thay mock Google bằng bản thật
- [ ] Chủ dự án quyết định xoá repo cũ `buithoanh/VCknowledge` (vẫn còn trên GitHub, nội dung trùng)

## 4. Câu hỏi mở (chờ người dùng trả lời)

- _(trống)_

## 5. Lưu ý & bài học

- Máy local chưa cài `gh` CLI; thao tác GitHub (tạo, đổi tên, xoá repo) phải làm trên web.
- Git dùng thông tin đăng nhập trong macOS Keychain. Repo private nên gọi API GitHub không đăng nhập luôn trả 404.
- `VCdocs` là repo tạo mới chứ không phải đổi tên từ `VCknowledge`, nên GitHub không tự chuyển hướng URL cũ.

## 6. Nhật ký các phiên

### 2026-10-19 · Phiên FE giai đoạn 1 (`apps/web`, nhánh `claude/fe-gd1-72b5d9`)
- Đã làm: giao diện Next.js + TypeScript cho M01–M09, M14, /jobs theo `contract/openapi.yaml` (kiểu sinh bằng openapi-typescript, gọi bằng openapi-fetch). Lớp gọi API: X-Request-Id, X-CSRF-Token từ /me, Idempotency-Key giữ tới khi thành công, 401 → đăng nhập, lỗi hiện message + mã BR. Nút theo `allowedActions`; việc 202 theo dõi /jobs/{id}. Bảng màu HD-VCPV-02; dùng được trên điện thoại (lập hồ sơ 1 màn hình 3 phần, duyệt 2 chạm). 52 test (Vitest + MSW) và build qua; 25 màn hình mở được trên Prism. 11 commit, chưa push.
- Cách chạy: `apps/web/README.md`. Mock: `pnpm contract:mock` + `pnpm --filter @vcdocs/web dev:mock` (Prism không có tiền tố /api/v1 nên dùng `API_PATH_PREFIX=`).
- Còn dở: 13 đề nghị sửa hợp đồng trong `apps/web/DE_NGHI_SUA_HOP_DONG.md` (quan trọng nhất: tên hành động trong `allowedActions`, thiếu `allowedActions` ở User/Folder/danh mục nền, thiếu API chọn người cho mọi người, id người không kèm tên). Chưa chạy với BE thật — để phiên ghép.

### 2026-10-19 · Trả lời câu hỏi tài khoản Google thử nghiệm
- Đã làm: ghi quyết định giả lập Google cho BE, chuyển câu hỏi khỏi mục Câu hỏi mở.
- Còn dở: chưa có tài khoản Google thật.

### 2026-10-19 · Viết OpenAPI giai đoạn 1, mở 2 phiên FE/BE
- Đã làm: đọc toàn bộ hợp đồng (rev 7) và BA; viết `contract/openapi.yaml` (M01–M09, M14, /jobs, đối tượng dữ liệu, mã lỗi), lint đạt; khung workspace pnpm (`package.json`, `pnpm-workspace.yaml`, máy chủ giả Prism `pnpm contract:mock`); nhánh `giai-doan-1`.
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
