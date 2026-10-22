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
  - Hợp đồng API v1: https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT (rev 24: mục 1–10, mục 10 = giai đoạn 2 đợt 1 M10/M15 v1.5, đã vào `openapi.yaml` 1.5.0-gd2 trên nhánh `giai-doan-2`; `giai-doan-1` dừng ở rev 22 / 1.4.0-gd1; thân ghi "ĐÃ CHỐT v1", tên vẫn [Đề xuất]; id connector `e2f31ce1-3cf6-4349-aebe-6445aa5e30b2`)
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

- [ ] **Nghiên cứu VCworkspace**: đã có bản rút gọn `docs/nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md` (2026-10-22, nhánh `claude/nghien-cuu-vcworkspace`). Còn: kiểm chứng 42 luận điểm ○ của 8 mảng (tác vụ một lần `vcdocs-nghien-cuu-vcworkspace`, 2026-10-25 05:00 giờ VN, chỉ kiểm và sửa báo cáo); chủ dự án trả lời 20 câu hỏi mục 13 của báo cáo, chọn phương án mã A/B/C.
- [ ] Chủ dự án đổi tên tài liệu hợp đồng API sang `[Đã chốt]` (thân tài liệu đã ghi "ĐÃ CHỐT v1" từ rev 16)
- [ ] Rà 15 chỗ `x-gia-dinh` trong `contract/openapi.yaml` (giả định do Claude chọn)
- [ ] Ghi quy tắc ghép tên thư mục (mã đã chứa tên ngắn thì không lặp) vào hợp đồng – FE #10
- [ ] Đánh dấu điểm cuối nào thuộc giai đoạn 1 trong hợp đồng
- [ ] Google thật, còn: chủ dự án điền `apps/api/so-do-to-chuc.yaml` (từ mẫu `so-do-to-chuc.mau.yaml`, nhánh `claude/so-do-to-chuc-22aacc`) rồi chạy `nap-so-do`; IT (anh Hùng) tạo 64 nhóm C1 theo báo cáo `nhom-c1` (hiện có 0); sau đó R9 đồng bộ Google
- [ ] Nhận cây thư mục vào CSDL thật: sau `nap-so-do`, chạy `pnpm --filter api run nhan-cay-thu-muc -- --thu` rồi chạy thật (nhánh `claude/nhan-cay-thu-muc`, cắt từ `claude/so-do-to-chuc-22aacc`). Chạy thử 2026-10-20 trên bản sao: 291 thư mục, nhận 201, sai mẫu 73 + 17 con — gần hết là `Tháng NN` trong `11 MKT / 10 SEO / 0x SEO-… / 01 Kế hoạch / <năm>` (nên là `YYYY-MM`), `Bài viết` trong thư mục tháng, `00 Tài liệu / Bản nháp`, `20 Social / 04 TT-ĐK- …` (mã dở). Báo cáo đủ: ghi chú phiên `nhan-cay-thu-muc-thu-2026-10-20.md`
- [ ] Ghép nhánh `claude/nhan-cay-thu-muc` vào `dev` (sau hoặc cùng `claude/so-do-to-chuc-22aacc`)
- [ ] Ghép nhánh `claude/so-do-to-chuc-22aacc` (lệnh nạp sơ đồ + báo cáo C1) vào `giai-doan-1`/`dev`
- [ ] PR `dev` → `main` khi chủ dự án cho phép (`dev` đã có đủ `giai-doan-1` ở d6474b2)
- [ ] Dọn 7 nhánh `claude/…` đã gộp/rỗng và worktree của chúng; xoá 2 nhánh lỗi thời trên GitHub (chờ chủ dự án đồng ý)
- [ ] Dựng máy ảo production theo `deploy/README.md` (IP tĩnh, DNS `vcdocs`, OAuth client production, khoá SA, khởi tạo công ty, cron sao lưu, uptime check)
- [ ] Hộp thư vcdocs@ cho `MAIL_FROM` (Q3 chưa chốt)
- [ ] Chỗ điền cho mẫu BM-VCPV-02/03/04
- [ ] Chủ dự án quyết định xoá repo cũ `buithoanh/VCknowledge` (vẫn còn trên GitHub, nội dung trùng)

## 4. Câu hỏi mở (chờ người dùng trả lời)

- (VCworkspace, 2026-10-22) "AI Jev" trong yêu cầu là gì: tên một dự án, "AI Dev", hay trợ lý kiểu Jarvis/Jeeves?
- (VCworkspace) "Đập tính năng cũ" tới mức nào: bỏ hẳn quản lý hồ sơ – tài liệu (BA 15 phân hệ, giai đoạn 1–2 đã code ~22.000 dòng TS), hay giữ thành một ứng dụng chạy trên VCworkspace? Nhánh `giai-doan-2` (M10, M15, chưa gộp vào `dev`) gộp tiếp hay dừng?
- (VCworkspace) Mốc thời gian muốn thay Google Workspace và ngân sách hạ tầng/tháng chấp nhận được?
- Sơ đồ tổ chức (mẫu `apps/api/so-do-to-chuc.mau.yaml`): email GĐ 2 khối, trưởng 11 phòng, người giữ R1/R3/R8/R9; xác nhận khối của BDH, IT, VCE, MH, mã XDV, danh sách division. Nhóm "xem" của drive 00 có chứa cả công ty không, hay drive 00 cấp quyền cả tên miền.
- Cây thư mục MKT: đổi ~70 thư mục `Tháng 01…12` thành `2026-01…` (đúng BR-10) để VCdocs nhận, hay để VCdocs chấp nhận thêm kiểu `Tháng NN`? Thư mục `Bài viết` trong thư mục tháng: giữ (VCdocs không nhận) hay bỏ? Mảng `20 Social`, `30 Sàn TMĐT`, `40 Media` chưa có mã (BR-12; mẫu dùng SOCIAL, SAN, MEDIA). Drive 01 BDH và 21b LT trống, 7 drive chưa có `99 Lưu trữ`. Đề xuất: đổi tên trên Drive, không nới mẫu.
- Thời hạn giữ bản sao kho PDF trên bucket `vcdocs-sao-luu-kho-pdf` (đề xuất 10 năm) trước khi khoá chính sách retention (khoá rồi không gỡ được).

## 5. Lưu ý & bài học

- Máy local đã có `gh` và `gcloud` (kiểm 2026-10-22), chưa có Docker. Ghi chú cũ "chưa cài `gh`" đã lỗi thời.
- Git dùng thông tin đăng nhập trong macOS Keychain. Repo private nên gọi API GitHub không đăng nhập luôn trả 404.
- Drive API: bỏ thư mục vào thùng rác thì tệp con vẫn trả `trashed: false` khi đọc riêng; BE kiểm tệp đã xoá phải xét cả thư mục cha hoặc tự bỏ từng tệp.
- Google Cloud của vcprosperous.com: project `vcdocs`; service account `vcdocs-backend@vcdocs.iam.gserviceaccount.com`, Client ID `112100786889389485867`. Tổ chức chặn tạo khoá (`iam.disableServiceAccountKeyCreation`); đã tắt riêng cho project `vcdocs`. Đã bật API Drive, Admin SDK, Docs, Sheets, Gmail. Domain-wide delegation 8 quyền khớp `apps/api/src/google/real/real-google.ts`; thêm quyền mới ở BE thì phải thêm cả ở admin.google.com. Ảnh hướng dẫn: `docs/huong-dan/anh/`. OAuth client "VCdocs web (local)" (Internal), redirect `http://localhost:4000/api/v1/auth/google/callback`. `apps/api/.env` (git bỏ qua) chạy `GOOGLE_MODE=real`, CSDL `vcdocs_that`, `MAIL_FROM` tạm là mail chủ dự án; Drive dùng chính service account (không mượn quyền) nên chỉ thấy shared drive có thêm nó.
- Lịch hằng tháng (`folder.ensure_periods` tự động) tạo năm/tháng cho mọi thư mục `hasPeriods`; thư mục nhận từ Drive chỉ bật `hasPeriods` khi các thư mục năm bên trong đều đúng `YYYY-MM`, tránh sinh `2026-10` cạnh `Tháng 10`.
- `vcdocs_that` (2026-10-20) mới có bản ghi công ty và 1 người: chưa chạy `nap-so-do` nên chưa có phòng. Mongo local của phiên chính chạy ở cổng 27019.
- `VCdocs` là repo tạo mới chứ không phải đổi tên từ `VCknowledge`, nên GitHub không tự chuyển hướng URL cũ.

## 6. Nhật ký các phiên

### 2026-10-22 · Báo cáo rút gọn VCworkspace (Opus 5.5)
- Đã làm: theo yêu cầu chủ dự án, bỏ phần kiểm chứng còn lại, viết báo cáo từ kết quả 72 agent: `docs/nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md` (14 mục + 2 phụ lục; ✅/◐/○ cho từng luận điểm). Kết luận chính: GCE chặn gửi cổng 25 → mail lai (hộp thư GCE + relay Amazon SES); nền đề xuất Nextcloud + Stalwart + ONLYOFFICE/Euro-Office + Authentik + LiveKit/Jitsi; không đập hết VCdocs (phương án C: tách khung hạ tầng, port nghiệp vụ hồ sơ sau); REA là công cụ phân tích, Creator OS là SaaS, "Jev" tìm được là mô hình quyết định đóng của TypeSafe AI (chờ xác nhận); VM cần ~2 máy 8 vCPU/32 GB + 4 vCPU/8 GB. Thêm dòng vào `docs/README.md`. Commit trên `claude/nghien-cuu-vcworkspace` (cắt từ `dev`), chưa merge.
- Còn dở: kiểm chứng 42 luận điểm ○ (phiên 2026-10-25); 20 câu hỏi cho chủ dự án ở mục 13 báo cáo.

### 2026-10-22 · Tác vụ định kỳ theo dõi hợp đồng API (rev 24, không sửa gì)
- Đã làm: đọc toàn bộ hợp đồng rev 24 (so với rev 22 trong `contract/NGUON.md` của `giai-doan-1`): rev 23 thêm mục 10 giai đoạn 2 đợt 1 (M10 Bàn giao, M15 Nhật ký, E1–E21, OpenAPI 1.5.0-gd2), rev 24 sửa dòng phạm vi quyền mục 6. Toàn bộ đã nằm trong `contract/openapi.yaml` 1.5.0-gd2 và `NGUON.md` (dòng rev 24) trên nhánh `giai-doan-2` (commit 0ade10b). Phần chạm giai đoạn 1 (Job.type, Notification.type, `/me.limits`, `/me.auditorAccess`) chỉ thêm, không bắt buộc, thuộc việc giai đoạn 2 → không chép sang `giai-doan-1`. Không commit (checkout `main` đang có sửa chưa commit của phiên khác).
- Lưu ý: hợp đồng chưa đổi tên `[Đã chốt]`; tác vụ 30 phút vẫn chạy (xem đề nghị tắt ở phiên 2026-10-22 VCworkspace).

### 2026-10-22 · Nghiên cứu VCworkspace thay Google Workspace (tạm dừng vì hết hạn mức)
- Yêu cầu chủ dự án (8 điểm): (1) code trực tiếp trên máy ảo Anthropic (Claude Code cloud) → merge GitHub → deploy GCP; (2) đập tính năng VCdocs, xây email server **VCworkspace** thay Google Workspace; (3) cần nhận/gửi thư, gắn nhãn, họp, lịch, lưu trữ, soạn văn bản/bảng tính/trình chiếu; để sẵn cửa tích hợp mã nguồn mở thay Adobe/CapCut/Office, "REA – Reverse Engineer Anything", "Creator OS" (chạy quảng cáo), nhân viên tự phát triển thêm; (4) tự động hoá tối đa quá trình phát triển; sản phẩm có AI agent, trợ lý cá nhân 24/7 always-on, "AI Jev"; (5) bảo mật cao (kho trung tâm công ty); (6) tận dụng mã nguồn mở, dễ mở rộng; (7) plugin `anthropics/knowledge-work-plugins`, hướng công ty 1 thành viên; (8) không hiểu thì hỏi lại.
- Đã làm: Workflow 13 mảng khảo sát web song song (Claude Code cloud/GitHub Action/Agent SDK; CI/CD GitHub→GCP; mail server trên GCP; so sánh mail server OSS; bộ workspace OSS; office/họp/lịch; công cụ sáng tạo; REA/Creator OS/AI Jev; AI agent & plugins; bảo mật & pháp lý VN; di cư; chi phí; mã VCdocs hiện có), mỗi luận điểm quyết định kiểm bằng 2 agent độc lập (nguồn gốc, cập nhật). 13/13 khảo sát xong; kiểm chứng xong claude-cloud, cicd-gcp, gcp-mail, creative-tools, mail-stacks (5/6); dở workspace-suites; chưa kiểm 7 mảng còn lại, chưa rà thiếu, chưa viết báo cáo. Dừng theo yêu cầu. Kết quả 72 agent: `~/.claude/projects/-Users-apple-projects-VCdocs/0153f5e4-10fe-4d4d-98d6-3915a62ea6bf/subagents/workflows/wf_d8f20636-759/` (`ket-qua-da-xong.json`, `journal.jsonl`); script: `~/.claude/projects/-Users-apple-projects-VCdocs/0153f5e4-10fe-4d4d-98d6-3915a62ea6bf/workflows/scripts/nghien-cuu-vcworkspace-wf_d8f20636-759.js`.
- Đặt tác vụ một lần `vcdocs-nghien-cuu-vcworkspace` (2026-10-25 05:00 giờ VN; chỉ chạy khi app Claude đang mở) làm tiếp: kiểm chứng còn lại → rà thiếu → viết `docs/nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md` → sổ tay → commit nhánh `claude/nghien-cuu-vcworkspace` cắt từ `dev` → báo chủ dự án.
- Bên lề: máy local đã có `gh`, `gcloud` (sửa mục 5). Tác vụ `vcdocs-kiem-tra-hop-dong-api` vẫn chạy mỗi 30 phút dù hợp đồng đã chốt — tốn hạn mức, đề nghị chủ dự án tắt. Sổ tay sửa trên checkout `main`, chưa commit (để phiên 25/10 commit cùng báo cáo trên nhánh riêng).
- Còn dở: toàn bộ báo cáo; 3 câu hỏi mới ở mục 4.

### 2026-10-20 · BE: lệnh nhận cây thư mục có sẵn trên Drive (nhánh `claude/nhan-cay-thu-muc`)
- Đã làm: `pnpm --filter api run nhan-cay-thu-muc -- [--drive 11] [--thu] [--ra file]` (`src/nhan-cay-thu-muc.ts`, `src/seed/nhan-cay-thu-muc.ts`). Chỉ đọc Drive; đọc tên theo mẫu `<số> <MÃ>-<tên ngắn> <tên đầy đủ>` và khung 00–99, gán kind; sai mẫu thì không nhận cả nhánh, chỉ báo; chạy lại khớp googleId không trùng; ghi `folder_numbers`, audit `folder.import`; cảnh báo khung thiếu, mã chưa có trong Bảng mã, số trùng, thư mục đã đổi/xoá trên Drive. 6 test e2e (gồm nhận lại nguyên cây mẫu sau khi xoá sổ). Build qua, BE 129/129, 98/98 điểm cuối. Không sửa `contract/`, không cần đổi hợp đồng.
- Chạy thật Google (chỉ đọc) trên CSDL tạm `vcdocs_thu_nhan_cay` (khởi tạo + `nap-so-do` file mẫu) rồi xoá; `vcdocs_that` không đổi. Kết quả ở mục 3.
- Còn dở: chạy trên `vcdocs_that` sau khi có sơ đồ phòng; chủ dự án quyết câu hỏi cây MKT (mục 4); chưa push.

### 2026-10-20 · Sơ đồ tổ chức và nhóm Google C1 (nhánh `claude/so-do-to-chuc-22aacc`, tách từ `giai-doan-1`)
- Đã làm: khối/phòng/division nằm trong `blocks`, `departments` (số drive, mã, driveId, mức bảo mật, headId, groupEmails), `divisions`; vai trò = nhóm Google (C1) ∪ `manualRoles`. CSDL `vcdocs_that` mới có công ty + 1 người, 0 khối/phòng. File mẫu `apps/api/so-do-to-chuc.mau.yaml` (khối, 11 phòng khớp đúng tên 11 shared drive thật, division; email để trống). Lệnh `pnpm --filter api run nap-so-do -- --file … [--thu]`: chạy lại không trùng, sửa theo file, không xoá, ghi audit `org.import`; người lấy từ Directory; GĐ khối → R2, trưởng phòng → R4 (+ phòng), `vai_tro` → R1/R3/R8/R9 vào `manualRoles` (dùng được trước khi có nhóm). Lệnh `nhom-c1` (chỉ đọc Google): nhóm thiếu/thừa, chưa gắn drive hoặc sai vai trò drive, thiếu người. Chạy thật với file mẫu: 11/11 drive khớp; cần 64 nhóm, có 0 (Directory chỉ có `giao_vien_lop_hoc@`). `nap-so-do --thu` trên `vcdocs_that` chạy đúng (chưa ghi thật). 7 test mới, BE 123/123, 98/98 điểm cuối, build qua. Không sửa `contract/`, không cần đề nghị mới. Chưa push.
- Còn dở: chủ dự án điền file → chạy `nap-so-do` thật; hỏi IT tạo nhóm C1; ghép nhánh.

### 2026-10-20 · Cấu hình deploy phương án A (`deploy/`)
- Đã làm: `deploy/api.Dockerfile` (pnpm deploy --prod, font DejaVu, user node, healthcheck qua /me), `deploy/web.Dockerfile` (Next standalone; `next.config.ts` bật `output: 'standalone'` khi `NEXT_OUTPUT=standalone`), `docker-compose.prod.yml` (caddy/web/api/mongo có mật khẩu, không mở cổng Mongo, dữ liệu ở `DATA_DIR`), `Caddyfile` (`/api/*` thẳng sang api – khớp `trust proxy 1`), mẫu `.env.example` + `api.env.example`, `backup.sh`, `.dockerignore`, hướng dẫn dựng VM `deploy/README.md`. Máy local không có Docker nên chưa build image; đã chạy lại đúng các bước build ngoài Docker: API production (Google thật, khoá giả) khởi động, /me 401, khởi tạo công ty chạy bằng `node dist/khoi-tao.js`, redirect OAuth đúng `https://vcdocs.vcprosperous.com/api/v1/auth/google/callback`, cookie Secure; web standalone phục vụ trang + static + chuyển tiếp /api.
- Chủ dự án tự push `giai-doan-1` (chế độ auto của Claude chặn `git push`).
- Còn dở: chưa build image Docker thật (làm ở bước 7 trên VM); đưa `deploy/` lên `main` (qua `dev`) để máy ảo clone; chủ dự án dựng VM theo hướng dẫn.

### 2026-10-20 · Đưa BA, hợp đồng API, kiến trúc vào `docs/`, tạo nhánh `dev`, sơ đồ git
- Đã làm: xuất BA (rev 20) và hợp đồng API (rev 22, v1.4) từ Claude Docs ra Markdown, chép trang kiến trúc HTML vào `docs/ba/`, `docs/hop-dong-api/`, `docs/kien-truc/`; `docs/README.md` ghi link artifact gốc (bản gốc đúng khi lệch). Hình vòng đời trong BA mục 5 không xuất được, thay bằng câu dẫn link. Commit 24488b5 trên `claude/docs-tai-lieu` (cắt từ `main`). Chủ dự án chọn tạo `dev` từ `main`: merge vào `dev` (e30943e), đã push `origin/dev`.
- Merge `giai-doan-1` (7bdab96: khởi tạo công ty, v1.4, deploy) vào `dev` → d6474b2; build qua, BE 116/116, FE 72/72; đã push `origin/dev`. Sơ đồ nhánh git (Artifact riêng tư): https://claude.ai/artifact/LAs5cVJWkugw7huhWj1AKx — 10 nhánh máy, 5 trên GitHub, 63 commit; mọi nhánh `claude/…` đã gộp vào `dev`; `origin/claude/be-gd1-7af2e6`, `origin/claude/fe-gd1-72b5d9` lỗi thời (máy hơn 28/18 commit).
- Còn dở: PR `dev` → `main` khi chủ dự án cho phép; dọn nhánh/worktree `claude/…` đã gộp (chờ chủ dự án đồng ý); sửa BA/hợp đồng thì xuất lại vào `docs/`.

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
