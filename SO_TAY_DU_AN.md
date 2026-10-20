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
  - Hợp đồng API v1: https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT (rev 22: đủ mục 1–9; thân ghi "ĐÃ CHỐT v1", tên vẫn [Đề xuất]; id connector `e2f31ce1-3cf6-4349-aebe-6445aa5e30b2`)
- **Chủ dự án:** Bùi Thọ Anh
- **Trạng thái hiện tại:** Nhánh `giai-doan-1` đã ghép FE + BE theo hợp đồng v1.4 (rev 22, D22 `loi=setup`) và lệnh khởi tạo công ty. Build qua, BE 116 test, FE 72 test; chạy thật (Google giả) trọn luồng hồ sơ, vòng đời tài liệu và huỷ bỏ. Đã push; PR #1 (FE) và PR #2 (`giai-doan-1`) đã merge vào `main` (2026-10-20). Google thật: đã có project `vcdocs`, service account `vcdocs-backend`, khoá JSON (chủ dự án giữ, ngoài repo) và domain-wide delegation 8 quyền.
- **Kho mã:** https://github.com/buithoanh/VCdocs (private), nhánh chính `main`; nhánh `dev` (tạo 2026-10-20 từ `main`) là nơi merge code mới. Bản lưu tài liệu BA, hợp đồng, kiến trúc ở `docs/` (xem `docs/README.md`).
- **Thư mục local:** `/Users/apple/projects/VCdocs`

## 2. Quyết định đã chốt

| Ngày | Quyết định | Lý do |
|------|-----------|-------|
| 2026-10-20 | Có nhánh `dev`: code mới (nhánh giai đoạn, nhánh phiên `claude/…`) merge vào `dev` trước; `main` chỉ nhận từ `dev` khi chủ dự án cho phép | Chủ dự án yêu cầu; giữ `main` ổn định |
| 2026-10-20 | Deploy phương án A: 1 máy ảo Compute Engine `e2-medium` ở `asia-southeast1` (project `vcdocs`), Docker Compose (caddy, web, api, mongo), tên miền `vcdocs.vcprosperous.com`; đĩa dữ liệu riêng có snapshot + `deploy/backup.sh` lên Cloud Storage. Cấu hình và hướng dẫn ở `deploy/` | Chạy được ngay không sửa logic; kho PDF nằm trên đĩa và lịch định kỳ chỉ chạy 1 bản nên hợp với 1 máy |
| 2026-10-19 | Quy trình code: chốt hợp đồng → viết tay `contract/openapi.yaml` → lát mỏng đầu cuối (khung monorepo, đăng nhập Google, `/me`, CSRF, mẫu lỗi) → 2 phiên FE (`apps/web`, chạy trên mock) và BE (`apps/api`, có test kiểm hợp đồng) song song trên 2 worktree, không phiên nào sửa `contract/` → 1 phiên ghép, test đầu cuối | FE và BE làm song song mà không chờ nhau, lệch được phát hiện sớm |
| 2026-10-19 | `contract/openapi.yaml` viết tay là gốc, không sinh từ mã NestJS | Bên nào cũng phải code theo nó; sinh từ mã thì BE thành gốc |
| 2026-10-19 | Code theo giai đoạn, giai đoạn 1 trước, không làm cả 15 phân hệ một lần | Mỗi lần ghép nhỏ, ít rủi ro |
| 2026-10-19 | Code luôn theo phần hợp đồng đã viết, không chờ chốt cả bản. Thay quy trình cũ: bỏ bước lát mỏng riêng, mở ngay 2 phiên FE/BE từ nhánh `giai-doan-1`; mỗi phiên tự làm phần đăng nhập, `/me` trước | Chủ dự án yêu cầu "làm đến đâu code đến đấy", "có hợp đồng rồi thì code song song" |
| 2026-10-19 | Phiên FE/BE không sửa `contract/`; thấy cần sửa thì ghi `contract/DE_NGHI_SUA.md`. `contract/NGUON.md` ghi bản hợp đồng (rev) đã đưa vào OpenAPI | Giữ một gốc chung |
| 2026-10-19 | Tác vụ định kỳ `vcdocs-kiem-tra-hop-dong-api` (mỗi 30 phút, chế độ Auto) đọc toàn bộ nội dung hợp đồng; rev lớn hơn `contract/NGUON.md` và ảnh hưởng API thì sửa `contract/openapi.yaml` trên `giai-doan-1`, commit, báo điện thoại. Tên có `[Đã chốt]` thì chỉ báo | Code theo hợp đồng đến đâu, cập nhật đến đó |
| 2026-10-19 | Chưa dùng tài khoản Google thật: BE giả lập Google (đăng nhập OAuth, service account, shared drive) bằng lớp adapter có bản mock, cấu hình chọn mock hay thật. Không chặn việc mở phiên BE | Chủ dự án trả lời câu hỏi mở: "Cứ giả lập đi" |
| 2026-10-20 | Đúng tên miền nhưng CSDL chưa có công ty → callback trả `/dang-nhap?loi=setup` (D22, hợp đồng v1.4, đề nghị N5) | `loi=domain` báo sai nguyên nhân, khó dò khi cài máy mới |
| 2026-10-20 | Trưởng phòng trình huỷ bỏ HD/BM cấp phòng thì GĐ khối phụ trách duyệt (D21, hợp đồng v1.3) | Trưởng phòng vừa trình vừa duyệt → vướng BR-05, không huỷ được |
| 2026-10-19 | Đổi tên dự án từ VCknowledge sang VCdocs | Theo yêu cầu chủ dự án |
| 2026-10-19 | Dùng `SO_TAY_DU_AN.md` làm kênh trao đổi giữa các phiên | Giữ ngữ cảnh chung, tránh làm lại |

## 3. Việc đang làm / cần làm

- [ ] **Hạn chót 2027-01-18:** nâng cấp tài khoản thanh toán Google Cloud (đang dùng thử: ₫7.791.151 tín dụng, 90 ngày từ 2026-10-20) trước ngày này, nên làm đầu tháng 1/2027 — hết hạn mà chưa nâng cấp thì Google tắt máy ảo `vcdocs-prod`, quá hạn ân hạn có thể xoá cả đĩa dữ liệu. Nâng cấp vẫn giữ tín dụng còn lại. Kèm: đặt cảnh báo ngân sách (Billing → Budgets & alerts, đề xuất 1,5 triệu đồng/tháng)
- [ ] Chủ dự án đổi tên tài liệu hợp đồng API sang `[Đã chốt]` (thân tài liệu đã ghi "ĐÃ CHỐT v1" từ rev 16)
- [ ] Rà 15 chỗ `x-gia-dinh` trong `contract/openapi.yaml` (giả định do Claude chọn)
- [ ] Ghi quy tắc ghép tên thư mục (mã đã chứa tên ngắn thì không lặp) vào hợp đồng – FE #10
- [ ] Đánh dấu điểm cuối nào thuộc giai đoạn 1 trong hợp đồng
- [ ] Google thật, còn: nhóm Google theo mẫu C1, nạp sơ đồ tổ chức (khối, phòng, vai trò)
- [ ] PR `dev` → `main` khi chủ dự án cho phép (`dev` đã có đủ `giai-doan-1` ở d6474b2)
- [ ] Production: còn bản ghi DNS A `vcdocs` → 34.87.68.77 trên Cloudflare (DNS only), rồi bật `caddy` (`docker compose -f docker-compose.prod.yml up -d caddy`), thử đăng nhập, bước 8 (cron `backup.sh`) và 9 (uptime check). Máy ảo đã chạy mongo, api (healthy, Google thật), web; đã khởi tạo công ty "Công ty TNHH VC Phồn Vinh" (tên lấy từ ví dụ trong hướng dẫn – chủ dự án xác nhận)
- [ ] Hộp thư vcdocs@ cho `MAIL_FROM` (Q3 chưa chốt)
- [ ] Chỗ điền cho mẫu BM-VCPV-02/03/04
- [ ] Chủ dự án quyết định xoá repo cũ `buithoanh/VCknowledge` (vẫn còn trên GitHub, nội dung trùng)

## 4. Câu hỏi mở (chờ người dùng trả lời)

- Thời hạn giữ bản sao kho PDF trên bucket `vcdocs-sao-luu-kho-pdf` (đề xuất 10 năm) trước khi khoá chính sách retention (khoá rồi không gỡ được).

## 5. Lưu ý & bài học

- Máy local chưa cài `gh` CLI; thao tác GitHub (tạo, đổi tên, xoá repo) phải làm trên web.
- Git dùng thông tin đăng nhập trong macOS Keychain. Repo private nên gọi API GitHub không đăng nhập luôn trả 404.
- Drive API: bỏ thư mục vào thùng rác thì tệp con vẫn trả `trashed: false` khi đọc riêng; BE kiểm tệp đã xoá phải xét cả thư mục cha hoặc tự bỏ từng tệp.
- Production (2026-10-20): project `vcdocs` đã gắn thanh toán; máy ảo `vcdocs-prod` (e2-medium, asia-southeast1-b, Debian 12), IP tĩnh `vcdocs-ip` = 34.87.68.77, đĩa `vcdocs-data` 50 GB (snapshot `vcdocs-hang-ngay` 02:00 giờ VN, giữ 14 ngày), service account máy `vcdocs-vm` (chỉ ghi 2 bucket), bucket `gs://vcdocs-sao-luu-csdl` (xoá sau 90 ngày) và `gs://vcdocs-sao-luu-kho-pdf` (retention 10 năm, chưa khoá), firewall `vcdocs-allow-web`, `vcdocs-allow-iap-ssh`. DNS `vcprosperous.com` ở Cloudflare. gcloud cài trên máy Mac ở `/usr/local/bin/gcloud`. Chế độ auto của Claude chặn xoá firewall rule và `git push`.
- Google Cloud của vcprosperous.com: project `vcdocs`; service account `vcdocs-backend@vcdocs.iam.gserviceaccount.com`, Client ID `112100786889389485867`. Tổ chức chặn tạo khoá (`iam.disableServiceAccountKeyCreation`); đã tắt riêng cho project `vcdocs`. Đã bật API Drive, Admin SDK, Docs, Sheets, Gmail. Domain-wide delegation 8 quyền khớp `apps/api/src/google/real/real-google.ts`; thêm quyền mới ở BE thì phải thêm cả ở admin.google.com. Ảnh hướng dẫn: `docs/huong-dan/anh/`. OAuth client "VCdocs web (local)" (Internal), redirect `http://localhost:4000/api/v1/auth/google/callback`. `apps/api/.env` (git bỏ qua) chạy `GOOGLE_MODE=real`, CSDL `vcdocs_that`, `MAIL_FROM` tạm là mail chủ dự án; Drive dùng chính service account (không mượn quyền) nên chỉ thấy shared drive có thêm nó.
- `VCdocs` là repo tạo mới chứ không phải đổi tên từ `VCknowledge`, nên GitHub không tự chuyển hướng URL cũ.

## 6. Nhật ký các phiên

### 2026-10-20 · Production bước 5–7 (trừ HTTPS)
- Đã làm: cài máy ảo (đĩa `/mnt/vcdocs-data`, swap 2 GB, Docker 29.9); deploy key `vcdocs-prod` chỉ đọc (thêm bằng Chrome, chủ dự án xác nhận sudo), clone `/srv/vcdocs` (`main`); `deploy/.env` (mật khẩu Mongo sinh trên máy), `api.env` (admin subject + `MAIL_FROM` tạm = mail chủ dự án); khoá SA `vcdocs-backend` ở `deploy/secrets/` (400, uid 1000); OAuth client production `…8l6s8pa…` nạp vào `api.env` rồi xoá file JSON. Build 2 image trên máy (~440 MB mỗi image); chạy mongo/api/web, api healthy, `/auth/google` chuyển sang accounts.google.com; khởi tạo công ty.
- Còn dở: DNS Cloudflare chưa có `vcdocs` nên chưa bật caddy/HTTPS; bước 8–9.

### 2026-10-20 · Dựng hạ tầng production bước 1–4
- Đã làm: `main` lên ngang `dev` (d6474b2, chủ dự án push). Cài gcloud (Homebrew); chủ dự án đăng nhập và gắn thanh toán. Tạo IP tĩnh, service account `vcdocs-vm`, 2 bucket sao lưu, đĩa dữ liệu, máy ảo `vcdocs-prod`, firewall web + SSH qua IAP, lịch snapshot (chi tiết ở mục 5).
- Còn dở: bản ghi DNS trên Cloudflare; xoá `default-allow-ssh`, `default-allow-rdp` (bị chặn, chủ dự án tự xoá); bước 5–9.

### 2026-10-20 · Cấu hình deploy phương án A (`deploy/`)
- Đã làm: `deploy/api.Dockerfile` (pnpm deploy --prod, font DejaVu, user node, healthcheck qua /me), `deploy/web.Dockerfile` (Next standalone; `next.config.ts` bật `output: 'standalone'` khi `NEXT_OUTPUT=standalone`), `docker-compose.prod.yml` (caddy/web/api/mongo có mật khẩu, không mở cổng Mongo, dữ liệu ở `DATA_DIR`), `Caddyfile` (`/api/*` thẳng sang api – khớp `trust proxy 1`), mẫu `.env.example` + `api.env.example`, `backup.sh`, `.dockerignore`, hướng dẫn dựng VM `deploy/README.md`. Máy local không có Docker nên chưa build image; đã chạy lại đúng các bước build ngoài Docker: API production (Google thật, khoá giả) khởi động, /me 401, khởi tạo công ty chạy bằng `node dist/khoi-tao.js`, redirect OAuth đúng `https://vcdocs.vcprosperous.com/api/v1/auth/google/callback`, cookie Secure; web standalone phục vụ trang + static + chuyển tiếp /api.
- Chủ dự án tự push `giai-doan-1` (chế độ auto của Claude chặn `git push`).
- Còn dở: chưa build image Docker thật (làm ở bước 7 trên VM); đưa `deploy/` lên `main` (qua `dev`) để máy ảo clone; chủ dự án dựng VM theo hướng dẫn.

### 2026-10-20 · Đưa BA, hợp đồng API, kiến trúc vào `docs/`, tạo nhánh `dev`, sơ đồ git
- Đã làm: xuất BA (rev 20) và hợp đồng API (rev 22, v1.4) từ Claude Docs ra Markdown, chép trang kiến trúc HTML vào `docs/ba/`, `docs/hop-dong-api/`, `docs/kien-truc/`; `docs/README.md` ghi link artifact gốc (bản gốc đúng khi lệch). Hình vòng đời trong BA mục 5 không xuất được, thay bằng câu dẫn link. Commit 24488b5 trên `claude/docs-tai-lieu` (cắt từ `main`). Chủ dự án chọn tạo `dev` từ `main`: merge vào `dev` (e30943e), đã push `origin/dev`.
- Merge `giai-doan-1` (7bdab96: khởi tạo công ty, v1.4, deploy) vào `dev` → d6474b2; build qua, BE 116/116, FE 72/72; đã push `origin/dev`. Sơ đồ nhánh git (Artifact riêng tư): https://claude.ai/artifact/LAs5cVJWkugw7huhWj1AKx — 10 nhánh máy, 5 trên GitHub, 63 commit; mọi nhánh `claude/…` đã gộp vào `dev`; `origin/claude/be-gd1-7af2e6`, `origin/claude/fe-gd1-72b5d9` lỗi thời (máy hơn 28/18 commit).
- Dọn nhánh (chủ dự án đồng ý): xoá 5 worktree (be-gd1, fe-gd1, eager-curie, practical-shaw, docs-tai-lieu) và 7 nhánh máy `claude/be-gd1-7af2e6`, `claude/fe-gd1-72b5d9`, `claude/khoi-tao-cong-ty`, `claude/ghep-khoi-tao-cong-ty`, `claude/docs-tai-lieu`, `claude/eager-curie-623995`, `claude/practical-shaw-a66803` (đã kiểm từng nhánh nằm trọn trong `origin/dev`); xoá `claude/be-gd1-7af2e6`, `claude/fe-gd1-72b5d9` trên GitHub. GitHub còn `main`, `dev`, `giai-doan-1`. Không đụng worktree của phiên khác (nhan-cay-thu-muc, giai-doan-2, so-do-to-chuc).
- Còn dở: PR `dev` → `main` khi chủ dự án cho phép; sửa BA/hợp đồng thì xuất lại vào `docs/`.

### 2026-10-20 · Đề xuất phương án deploy
- Đã làm: đọc cấu hình chạy (`apps/api/.env.example`, `next.config.ts`, `main.ts`, hàng đợi việc). Ràng buộc: PDF đã chốt lưu đĩa (`VAULT_DIR`, giữ đến 2031) → cần đĩa bền + sao lưu; lịch định kỳ chạy trong tiến trình API, không khoá → chỉ chạy 1 bản API; hàng đợi việc đã khoá `lockedUntil`; không dùng transaction → Mongo đơn lẻ được; `API_ORIGIN` của web đọc lúc build; repo chưa có Dockerfile. Đề xuất A (khuyên dùng) / B / C trong chat, chưa đổi mã.
- Còn dở: chủ dự án đã chốt A (xem phiên dưới).

### 2026-10-20 · Ghép khởi tạo công ty, hợp đồng v1.4 (D22)
- Đã làm: chủ dự án chốt N5 → D22 trong hợp đồng mục 9.4 + lịch sử phiên bản v1.4 (Claude Docs rev 22); `contract/openapi.yaml` 1.4.0-gd1 (mô tả callback thêm `setup`), `contract/NGUON.md`. FE: câu báo `loi=setup` ở /dang-nhap + 3 test. Ghép `claude/khoi-tao-cong-ty` (fca348e) vào `giai-doan-1` (gỡ xung đột sổ tay). Build qua, BE 116/116 (98/98 điểm cuối), FE 72/72. Chưa push.
- Chạy thật (chủ dự án tự làm): Google thật + CSDL mới → /dang-nhap?loi=setup đúng câu báo; chạy `khoi-tao` → đăng nhập được. 89b0162 đã có trên `origin/giai-doan-1`.
- Còn dở: mở PR lên `main` trên web.

### 2026-10-20 · Vẽ lại kiến trúc code
- Đã làm: đọc code `apps/web`, `apps/api`, `contract/`; vẽ sơ đồ kiến trúc (Artifact riêng tư): https://claude.ai/artifact/Bh992AU1qAhyneRJxkbRhF — tầng FE, hợp đồng, chuỗi guard/interceptor BE, 14 module, CoreModule, lớp cổng Google (giả/thật), MongoDB, kho PDF, Google Workspace; kèm luồng yêu cầu ghi, việc nền, bảng phụ thuộc giữa các Service. Không đổi mã.
- Còn dở: không. Code đổi kiến trúc thì cập nhật lại trang này (đăng lại cùng URL).

### 2026-10-20 · BE: lệnh khởi tạo công ty (nhánh `claude/khoi-tao-cong-ty`, tách từ `giai-doan-1`)
- Đã làm: lệnh `pnpm --filter api run khoi-tao -- --ten "…" --mien vcprosperous.com` (thiếu `--mien` lấy `ALLOWED_DOMAIN`; chạy lại không tạo trùng, không ghi đè; bản build `node dist/khoi-tao.js`). Callback thiếu công ty → `loi=setup` + log lỗi kèm lệnh khởi tạo, không còn `loi=domain`. `setup` chưa có trong hợp đồng → đề nghị N5. 6 test mới, BE 116/116, build qua. Commit, chưa push.
- Còn dở: chủ dự án duyệt N5; FE chưa có câu báo cho `loi=setup` (trang hiện không báo gì).

### 2026-10-20 · PR lên main và chuẩn bị Google thật (lái Chrome)
- Đã làm: mở PR #2 `giai-doan-1` → `main`; chủ dự án merge cả PR #1 và #2. Hướng dẫn chủ dự án (qua Claude in Chrome) tạo project `vcdocs`, bật API, tạo service account `vcdocs-backend` và khoá JSON (tắt chính sách chặn tạo khoá riêng cho project), thêm domain-wide delegation 8 quyền — đã kiểm tra đủ. Ảnh hướng dẫn lưu `docs/huong-dan/anh/`.
- Tạo OAuth client, `.env` chế độ thật. Chạy thật: đăng nhập Google thật thành công (sau khi thêm tay bản ghi công ty vào CSDL `vcdocs_that`); Directory đọc được 48 người, 1 nhóm; Drive chưa có shared drive nào cho service account.
- Drive thật (chỉ đọc) trên `00 VCPV Chung`: đọc được 10 thành viên, 18 thư mục, 61 tệp (52 Docs, 9 Sheets). Thử ghi (chủ dự án đồng ý): tạo thư mục `_VCdocs thử` + 1 Docs trống, đọc lại đúng drive/cha, rồi bỏ cả hai vào thùng rác (còn trong thùng rác của drive).
- Phiên phụ làm BE khởi tạo công ty: commit fca348e trên `claude/khoi-tao-cong-ty`, chưa push, chưa ghép; FE chưa có câu báo `loi=setup`; đề nghị N5.
- `vcdocs-backend` đã vào đủ 11 shared drive, vai trò Quản lý.
- Còn dở: nhóm C1, sơ đồ tổ chức, ghép nhánh khởi tạo công ty.

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
