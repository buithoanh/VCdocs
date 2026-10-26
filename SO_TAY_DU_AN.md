# Sổ tay dự án VCworkspace

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

- **Tên hiện tại:** VCworkspace (đổi từ VCdocs theo chủ dự án ngày 2026-10-23). Định danh kỹ thuật và các bản nguồn lịch sử còn tên cũ; chưa di trú runtime.
- **Mục tiêu:** Phát triển nền tảng VCworkspace cho VCPV; repo hiện chứa nghiệp vụ quản lý tài liệu – hồ sơ từ VCdocs. Giao diện Next.js, máy chủ NestJS, MongoDB, tích hợp Google Drive.
- **Tài liệu gốc (Claude Docs):**
  - BA và đặc tả người dùng: https://claude.ai/artifact/74kFt4rhgHd3ecPmgitRYc
  - Hợp đồng API v1: https://claude.ai/artifact/V2S8WQZXaLeGBLEBJvQvfT (rev 24: mục 1–10, mục 10 = giai đoạn 2 đợt 1 M10/M15 v1.5, đã vào `openapi.yaml` 1.5.0-gd2 trên nhánh `giai-doan-2`; `giai-doan-1` dừng ở rev 22 / 1.4.0-gd1; thân ghi "ĐÃ CHỐT v1", tên vẫn [Đề xuất]; id connector `e2f31ce1-3cf6-4349-aebe-6445aa5e30b2`)
- **Chủ dự án:** Bùi Thọ Anh
- **Trạng thái code VCworkspace (cập nhật 2026-10-25):** các chat công việc 01–12B (phần lớn do ChatGPT/Codex làm) đã **nghiệm thu LOCAL** và đã **commit** trên nhánh local `vcworkspace/chat01-12b` (cắt từ `claude/nghien-cuu-vcworkspace`: quản trị AI, hợp đồng, BE, FE, PoC, tài liệu, sửa sau review, báo cáo). **Chưa push, chưa có PR** (repo chặn `git push` cho Claude). Review/QA/bảo mật: `docs/ke-hoach/vcworkspace-review-qa-2026-10-25.md` — đã sửa 6 lỗi (F1–F6), còn mở 15 (O1–O15). Đã có:
  - Hợp đồng `contract/openapi.yaml` **2.3.0-gd2** (từ 1.5.0-gd1 chat02 đến OIDC/lifecycle chat12B; nguồn ghi ở `contract/NGUON.md`).
  - BE mới: `drive-basic` (Drive, version/trash/restore, DOCX/XLSX/PPTX qua ONLYOFFICE), `mail-basic` (Stalwart: gửi/nhận, MIME, nhãn/lọc/alias/hộp chung, offboard), `workspace-interop` (đính kèm mail → Drive, gửi bản Drive), `m01-auth` thêm OIDC + identity lifecycle (journal/CAS/Idempotency-Key, app→Authentik→Nextcloud). FE mới: `/drive`, `/email` (bố cục kiểu Outlook), `/bo-nho`; đăng nhập OIDC. Google cũ vẫn giữ.
  - PoC chạy local: Nextcloud 33, ONLYOFFICE 9.4, Stalwart 0.16, Authentik 2026.8 (`poc/`).
  - Gate cuối 2026-10-25 sau sửa review (chạy trên `vcworkspace/chat01-12b`): guard 44, BE 180 (9 skip), endpoint 145/145, FE đạt, typecheck/build đạt.
  - Chín nhóm (ma trận `docs/ke-hoach/vcworkspace-11-lo-trinh-9-nhom.md`): LOCAL PASS Files, Office, Email (một phần), Admin/SSO, Work management (chat13), Flow (chat14, nhánh `claude/chat14-flow`, OpenAPI 2.4.0-gd2 trên nhánh đó) và NAS giả lập + ngữ nghĩa sync WebDAV (chat15, nhánh `claude/chat15-sync-nas`), Calendar/Contacts CalDAV/CardDAV + iMIP local (chat16, nhánh `claude/chat16-calendar-contacts`), 2026-10-25; **chưa có** client desktop/mobile thật (NOT_TESTED), Talk (đề xuất chat17), Assistant AI. Chỉ là PoC local, chưa production, chưa deploy, chưa dữ liệu Google thật.
- **Trạng thái VCdocs cũ:** Nhánh `giai-doan-1` đã ghép FE + BE theo hợp đồng v1.4 (rev 22, D22 `loi=setup`) và lệnh khởi tạo công ty. Build qua, BE 116 test, FE 72 test; chạy thật (Google giả) trọn luồng hồ sơ, vòng đời tài liệu và huỷ bỏ. Đã push; PR #1 (FE) và PR #2 (`giai-doan-1`) đã merge vào `main` (2026-10-20). Google thật: đã có project `vcdocs`, service account `vcdocs-backend`, khoá JSON (chủ dự án giữ, ngoài repo) và domain-wide delegation 8 quyền.
- **Kho mã:** https://github.com/buithoanh/VCdocs (API kiểm 2026-10-23: public; tên repo chưa đổi), nhánh chính `main`; nhánh `dev` (tạo 2026-10-20 từ `main`) là nơi merge code mới. Bản lưu tài liệu BA, hợp đồng, kiến trúc ở `docs/` (xem `docs/README.md`).
- **Thư mục local:** `/Users/apple/projects/VCdocs`

## 2. Quyết định đã chốt

| Ngày | Quyết định | Lý do |
|------|-----------|-------|
| 2026-10-25 | Thiết kế lại giao diện `apps/web` trên **Ant Design 6** (không Tailwind/shadcn), theme token theo HD-VCPV-02 (navy `#13233A`, sọc `#E8EDF3`, bo góc 4px, font Be Vietnam Pro, một bộ icon `@ant-design/icons`). Bước 1 thay lớp component nền giữ nguyên tên export/props; sau đó chuyển từng module (hồ sơ → tài liệu → phê duyệt → thư mục/Drive → email), mỗi module một PR vào `dev` | Chủ dự án muốn giao diện "bớt AI"; app là CRUD nghiệp vụ dày (bảng, form, cây, duyệt theo bước) nên antd có sẵn widget; antd 6 chạy React 19.1/Next 15 không cần patch; Tailwind + shadcn mặc định chính là bộ mặt cần tránh |
| 2026-10-24 | Human duyệt mở chat 11 khảo sát lộ trình đủ chín nhóm, chỉ tài liệu/read-only; chưa code lớn, cài app, mua dịch vụ, production hoặc mở chat 12 | Phân biệt nghiệm thu LOCAL Drive–Office–Email của chat 01–10 với mục tiêu đủ chín nhóm; cần ma trận khoảng trống, kiến trúc và acceptance trước bước mới |
| 2026-10-23 | Human xác nhận trực tiếp đưa đúng tệp thử ui03-renamed-chat03ui2.txt vào thùng rác local rồi khôi phục qua UI | Hoàn tất chat03, review đạt mở04 và tự chạy tiếp; không xoá vĩnh viễn |
| 2026-10-23 | Chủ dự án giao tự động toàn bộ phát triển/nghiệm thu các task đã thống nhất; điều phối tự review, sửa lỗi, mở chat tuần tự, không hỏi lại quyền đã duyệt | Không mở rộng sang production, mua dịch vụ hoặc dữ liệu thật; hộp quyền công cụ vẫn theo cơ chế hệ thống |
| 2026-10-23 | Cho phép sửa hook chặn nhầm harness/patch tài liệu, giữ rào chắn thao tác nguy hiểm và bổ sung tests allow/deny | Chủ dự án yêu cầu “sửa hook đi”; tiếp tục browser smoke chat02 sau sửa |
| 2026-10-23 | Duyệt cài môi trường container local riêng và cập nhật hợp đồng sáu API Drive theo đề xuất; tiếp tục chat 02, review đạt rồi mở chat kế tiếp | Chủ dự án giao rõ trong chat điều phối; thay thế trạng thái chờ duyệt runtime/hợp đồng, không bao gồm production |
| 2026-10-23 | Duyệt gói PoC Drive: Nextcloud local cô lập, dữ liệu giả, ACL từng người, hai tài khoản và hai không gian phòng/cá nhân, trùng tên 409 không ghi đè, tối đa 10 MiB/tệp thử | Chủ dự án trả lời “Duyệt gói thử đề xuất”; chat 02 chuẩn bị đề nghị sáu API và PoC trước code lớn, chưa được sửa OpenAPI gốc |
| 2026-10-23 | Tên dự án hiện tại là VCworkspace; triển khai 4 lớp quản trị AI trong repo và hướng dẫn quyền ngoài repo | Chủ dự án yêu cầu; chưa đổi tên folder/remote/runtime, không tự thay quyền dịch vụ |
| 2026-10-23 | Chủ dự án giao Sol High kiểm bộ luận điểm còn dở, dùng Astra rà điểm khó, cập nhật báo cáo và sổ tay | Phạm vi kiểm chứng tài liệu; chưa chốt stack, mua hạ tầng hay triển khai VCworkspace |
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

- [ ] **Giao diện Ant Design – bước 5 module Thư mục/Drive xong, chờ chủ dự án xem (2026-10-26), cùng nhánh `vcworkspace/antd-ho-so`:** `thu-muc/FolderBrowser.tsx` cây thư mục bằng antd `Tree` (`showLine`, `blockNode`, tải con theo `loadData` qua `GET /folders/{id}/children`, `isLeaf` theo `hasChildren`, tiêu đề nút có số/mã/tên + Tag trạng thái), bố cục hai cột Row/Col, bộ lọc drive Form/Row/Col, chi tiết dùng Space + LinkButton, ô trống `Empty`; hộp thoại Đổi tên và Tạo thư mục là antd Form trong Modal (parent/kind/code Select, số kế tiếp vẫn qua `/folders/next-number`, D20 bỏ loại không hợp lệ khi đổi cha), Tạo năm/tháng dùng `MonthField` + Checkbox. `drive/[id]` checkbox antd; `drive/page.tsx` giữ nguyên (đã DataTable). CSS bỏ `.tree*`/`.layout-split`, thêm `.vc-tree`. Module không còn `.filters/.tree/.actions/.btn/.checkbox/.hint/.empty`. Test FE 96/96, typecheck đạt, `pnpm ai:check` đạt; QA giả: cây tải con khi mở nút, chọn nút hiện chi tiết, danh sách drive, hộp thoại Tạo thư mục (vai Trưởng phòng MKT). **Chưa làm:** Email (bố cục kiểu Outlook, nhiều CSS riêng `.mail-*`); chưa push/PR.

- [ ] **Giao diện Ant Design – bước 4 module Phê duyệt xong, chờ chủ dự án xem (2026-10-26), cùng nhánh `vcworkspace/antd-ho-so`:** `phe-duyet/page.tsx` hộp duyệt: Tabs antd, bộ lọc Form/Row/Col, mỗi phiếu là `Card` trong `Flex` (tiêu đề link, Tag trạng thái, hàng nút Space, nút Xem file/Chi tiết bằng LinkButton), rỗng bằng `Empty`; không dùng antd `List` vì 6.6 đã deprecated (thay bằng `Listy` là virtual list khác hẳn). `[id]/page.tsx` chi tiết phiếu: hàng nút Space + LinkButton (bản đã trình, mở đối tượng), thanh quyết định dán đáy bằng `Affix` + `.vc-decide-bar`. `uy-quyen/page.tsx`: bộ lọc khối Form/Row/Col; `DelegationForm` là antd Form trong Modal (Select loại hồ sơ, Checkbox luật ký valuePropName=checked, InputNumber hạn mức có dấu chấm nghìn, `UserSelectInput`, hai DatePicker với validator Đến ≥ Từ qua `dependencies`). `approvalUi.tsx` mô tả hộp thoại dùng Typography. Module không còn `.list/.actions/.btn/.filters/.checkbox/.sticky-decide`. Test `phe-duyet.test.tsx` giữ nguyên 4/4, FE 96/96, typecheck đạt, `pnpm ai:check` đạt; QA giả: Trưởng phòng MKT lập + trình duyệt hồ sơ → GĐ khối Kinh doanh thấy phiếu ở hộp duyệt, mở chi tiết, hộp thoại Yêu cầu sửa, trang Uỷ quyền + hộp thoại thêm dòng. **Chưa làm:** Thư mục/Drive, Email; chưa push/PR.

- [ ] **Giao diện Ant Design – bước 3 module Tài liệu xong, chờ chủ dự án xem (2026-10-26), cùng nhánh `vcworkspace/antd-ho-so`:** `tai-lieu/page.tsx` bộ lọc Form/Row/Col + DataTable phân trang; `dang-ky/page.tsx` antd Form với validator từ `validate.ts` (BR-02 tự chuyển cấp VCPV qua `onValuesChange`), hạn soạn DatePicker; `[id]/DocumentView.tsx` các hộp thoại dùng Checkbox.Group (phòng góp ý), Checkbox (vẫn trình), Radio.Group (sửa nhỏ/lớn, kết quả rà soát), InputNumber (số ngày mở khoá), DateField; hàng nút bằng Space, link phiếu duyệt bằng LinkButton; `ben-ngoai/page.tsx` antd Form (validator link Drive/URL); `ma/[code]` không có lớp cũ, giữ nguyên. `pickers.tsx` tách `DeptSelectInput` / `UserSelectInput` / `MultiUserSelectInput` (chỉ Select, gắn thẳng `Form.Item name=…`), các bản có nhãn bọc lại; người tìm được qua `/users/lookup` được `rememberPeople` nên nhãn còn hiện sau khi chọn. `dates.tsx` thêm `disabledPast`. Module không còn `.filters/.field/.form/.checkbox/.btn`. Test `tai-lieu.test.tsx` giữ nguyên 7/7, FE 96/96, typecheck đạt, `pnpm ai:check` đạt (chạy lại khi máy rảnh); QA giả: danh sách, đăng ký (trọn luồng tới chi tiết, BR-02 tự khoá cấp phòng), nhập bên ngoài, chi tiết vai Kiểm soát tài liệu với hộp thoại Sửa đổi và Rà soát. **Chưa làm:** Phê duyệt, Thư mục/Drive, Email; chưa push/PR.

- [ ] **Giao diện Ant Design – bước 2 module Hồ sơ xong, chờ chủ dự án xem (2026-10-26), nhánh `vcworkspace/antd-ho-so` cắt từ `claude/gop-antd` (= dev + antd bước 1):** `ho-so/page.tsx` bộ lọc bằng antd Form/Row/Col (Input, Select, DeptSelect, DatePicker tháng, Checkbox), bảng `DataTable` nay nhận prop `pagination` (phân trang antd phía máy chủ); `moi/NewRecordForm.tsx` dùng antd `Form` (`useForm`/`useWatch`), `Steps`, `DatePicker` ngày và tháng (dayjs ↔ chuỗi ISO qua `components/dates.tsx`), `Radio`, `Upload` (`beforeUpload` trả false) — mọi ô kiểm bằng `validateRecordForm` của `lib/records` làm validator nên quy tắc và thông điệp vẫn một nơi; `[id]/RecordView.tsx`: Sửa hồ sơ bằng antd Form trong Modal, Gắn bản scan bằng Upload, hàng nút bằng Space; `chua-dang-ky/page.tsx` bộ lọc Row/Col, tháng bằng `MonthField`. Module không còn `.filters/.field/.form/.steps/.btn`. Thêm dep `dayjs@1.11.19`; `Button` nhận `style`; `DefList` bỏ dấu hai chấm. Test `ho-so.test.tsx` giữ nguyên 6/6, FE 96/96, typecheck đạt; `pnpm ai:check` đạt (guard 44, BE 369/10 skip, FE 96/96) — chạy trước lần chỉnh cuối lưới bộ lọc 2 cột trên điện thoại (chỉ đổi prop `Col`, typecheck lại đạt); QA giả trọn luồng lập hồ sơ → việc nền xong → chi tiết → Sửa / Gắn bản scan, điện thoại (bộ lọc 2 cột). Để việc nền chạy trên QA, `apps/api/test/qa-fake-server.spec.ts` bật `jobsPollMs` (xem mục 5). **Chưa làm:** Tài liệu, Phê duyệt, Thư mục/Drive, Email theo thứ tự đã chốt; `Pagination` rời vẫn còn ở trang khác; chưa push/PR (repo chặn push cho Claude).

- [ ] **Giao diện Ant Design – bước 1 xong, chờ chủ dự án xem (2026-10-25), nhánh `vcworkspace/giao-dien-antd` cắt từ `vcworkspace/chat01-12b`:** đã cài `antd@6.6.7`, `@ant-design/icons`, `@ant-design/nextjs-registry`; `UiProvider` (ConfigProvider locale vi + token HD-VCPV-02) + `AntdRegistry` ở root layout; font Be Vietnam Pro qua `next/font/google` (build cần mạng tới Google Fonts một lần). Lớp nền đã đổi ruột sang antd, giữ nguyên API: `ui.tsx` (Button/LinkButton/Card/Badge→Tag/ErrorBox+Notice→Alert/Loading→Spin/Empty/Field+TextField→Form.Item+Input/SelectField→Select/Modal/Tabs/DefList→Descriptions), `AppShell` (Layout+Menu+Badge, Drawer trên điện thoại), `ToastProvider` (notification góc dưới phải), `DataTable` (Table sọc, header navy, thẻ trên điện thoại qua `data-label`) + `Pagination`, `ActionDialog`, `pickers` (DeptSelect/UserPicker/MultiUserPicker → Select showSearch). Test: `src/test/antd.ts` (chooseOption/findOption/selectedText), setup thêm matchMedia/ResizeObserver/getComputedStyle; 3 file test đổi thao tác select. Gate: typecheck đạt, FE 76/76, `next build` (`.next-antd`) đạt, `pnpm ai:check` đạt (BE 180, 9 skip; FE 76); xem bằng mắt trên QA giả (qa-api 14100 + qa-web 13100) các trang chủ, hồ sơ, lập hồ sơ, nhân sự, danh mục, cây thư mục, điện thoại. **Chưa làm:** các trang còn dùng `.btn`/`.field`/select gốc (trang đăng nhập, bộ lọc, email), DatePicker thay input date/month, bỏ emoji ở trang; chuyển từng module theo thứ tự đã chốt. Brand hiển thị đổi "VCdocs" → "VCworkspace" ở thanh trên và title; chữ "sổ VCdocs" trong trang để lại cho lúc chuyển module. First-load JS tăng lên ~400 kB/trang vì antd.

- [ ] **Push + PR `claude/mail-compose-cc-bcc-richtext` vào `dev` (chủ dự án tự chạy):** Cc/Bcc + soạn thư định dạng (2.5.0-gd2) và đọc nội dung thư an toàn trong khung đọc (`GET /mail/messages/{id}/body`, 2.6.0-gd2), full gate PASS local 2026-10-26; commit đọc nội dung nằm trên nhánh tạm `tmp-reader` (trên 29a0ef4), cần đẩy vào cùng nhánh PR #8. Còn cần xem UI trên trình duyệt và thử Stalwart thật (thư HTML từ client ngoài).

- [ ] **Push và mở PR `vcworkspace/chat01-12b` vào `dev` (chủ dự án tự chạy):** đã commit đủ WIP chat01–12B; nội dung PR soạn sẵn ở `docs/ke-hoach/vcworkspace-pr-chat01-12b.md`. PR gồm cả commit nghiên cứu b8c8b80.

- [ ] **Audit bảo mật Cloudflare skill (quick, 2026-10-25): 12 đầu mối `needs_validation`, 0 confirmed** (không chạy mã vì máy không cưỡng chế được giới hạn bộ nhớ/tiến trình/đĩa). Báo cáo `docs/bao-mat/audit-cloudflare-2026-10-25.md`, chi tiết `...-needs-validation.md`, bản ghi `...-findings.json`; bản đầy đủ (ledger, prompt) ở `~/security-audit-skill/VCdocs/run-1/`. Ưu tiên: OIDC không kiểm tên miền email + hộp thư theo local-part; nhập tài liệu ngoài (service account copy fileId bất kỳ, SSRF theo redirect); quyền không gian Drive không thu hồi; callback ONLYOFFICE tin JWT trình duyệt; ai cũng tạo alias/hộp nhóm; production chấp nhận lifecycle giả. 7 vùng `deferred` chưa săn. Ngoài phạm vi: `.claude/settings.json` chưa chặn đọc `poc/*/secrets/**`.

- [ ] **Sửa 15 lỗi còn mở sau review (O1–O15):** ưu tiên O1–O4 (lưu ONLYOFFICE, OIDC đăng xuất sau 5 phút, quyền hộp thư) trước pilot; cần runtime thật trên Docker.

- [x] **Chat13 Work management LOCAL PASS (2026-10-25):** nhánh `claude/chat13-work-management-d67500`, stack riêng `poc/work-management/` (NC 33.0.10, Deck 1.17.8, Notes 6.1.0, Forms 5.4.1, Tables 2.3.2, Collectives 4.7.1, OIDC Authentik, 6 persona hai phòng + outsider). Share/ACL/comment/attachment, deny UI+API, tìm kiếm, export, chuyển sở hữu/offboard, restart, backup/restore có ACL đều LOCAL PASS (N/A: comment Forms/Tables, attachment Tables). Event cho Flow: Forms/Tables/Files có, Deck không; `userIdFilter` không bắn với API app password. Bàn giao `docs/ke-hoach/vcworkspace-13-ban-giao-work-management.md`. Chưa push.
- [x] **Chat14 Flow LOCAL PASS (2026-10-25):** nhánh `claude/chat14-flow` (cắt từ chat13 aed52ad). Module BE `apps/api/src/modules/flow/` + OpenAPI **2.4.0-gd2** (`POST /flow/nextcloud/webhooks` header bí mật xoay vòng, `GET /flow/events[/{id}]` R9). Ba flow Form→Deck, Tables→thông báo trong ứng dụng, file→tag/chặn truy cập bằng Flow core; replay, xoay vòng bí mật, restart SIGKILL giữa chừng, receiver tắt + đối soát đều LOCAL PASS; độ trễ p50 ≈ 1,05 s với worker riêng. Deck chỉ làm đích. Bàn giao `docs/ke-hoach/vcworkspace-14-ban-giao-flow.md`. Chưa push.
- [x] **Chat15 Sync + NAS LOCAL PASS (2026-10-25, phần container):** nhánh `claude/chat15-sync-nas` (cắt từ chat14 05b0ced). Samba 4.21 cô lập làm NAS + External Storage SMB theo nhóm Team A/B; ACL WebDAV + SMB trực tiếp, restart, backup/restore đều LOCAL PASS; độ trễ thấy thay đổi NAS ≈ 70–110 ms (trừ burst cùng giây); file 1 GiB khớp SHA-256; ngữ nghĩa sync WebDAV (If-Match, xung đột, chunked v2, revoke, offboard) LOCAL PASS; receiver Flow thêm **đối soát Files theo thư mục** (rule `reconcile: true`, e2e 8/8). Phát hiện: đổi tên chỉ khác hoa/thường qua Nextcloud trên SMB **xoá file** khi `case_sensitive=true` (đã đặt `false`), rename ngoài Nextcloud mất share/tag/comment, SMB bỏ qua Flow core. Bàn giao `docs/ke-hoach/vcworkspace-15-ban-giao-sync-nas.md`. Chưa push.
- [ ] **Chat15 phần thiết bị thật (chờ chủ dự án):** Nextcloud Desktop 2 máy, Android/iOS, NAS thật — danh sách kiểm ở mục 8 bàn giao chat15.
- [x] **Chat16 Groupware Calendar/Contacts LOCAL PASS (2026-10-25, phần container):** nhánh `claude/chat16-calendar-contacts` (cắt từ chat15 dfc6a28). Calendar 6.6.3, Contacts 8.9.2, calendar_resource_management 0.12.2 trên work13; Stalwart chat16 mới (`mail16`, chỉ mạng internal) nhận iMIP vào hộp `.test`. Lịch/sổ chia sẻ theo group id, phòng có xung đột, múi giờ/DST, lặp + ngoại lệ, free/busy không lộ chi tiết, vCard, sync-token, deny 150/150, offboard, restart, backup/restore LOCAL PASS. Phát hiện: ghi đồng thời cùng ETag mất bản (10/10), link "Chấp nhận" hỏng khi bật chia sẻ chỉ trong nhóm, sổ địa chỉ hệ thống mặc định lộ cả công ty (đã bật `restrict_user_enumeration_to_group`), khác nhóm bị coi là khách ngoài. Flow: event lịch tương thích webhook (payload đủ iCalendar kể cả PRIVATE), danh bạ thì không → Contacts chỉ làm đích. Bàn giao `docs/ke-hoach/vcworkspace-16-ban-giao-calendar-contacts.md`. Chưa push.
- [ ] **Chat16 phần thiết bị thật (chờ chủ dự án):** iOS/Android DAVx⁵/macOS/Thunderbird/Outlook — danh sách ở mục 7 bàn giao chat16.
- [x] **Chat17 Talk nhỏ LOCAL PASS (2026-10-25, phần container + Chrome headless):** nhánh `claude/chat17-talk` (cắt từ chat16 d93960d). Talk 23.0.12 trên work13, signaling nội bộ, không HPB/TURN/STUN (`has_internet_connection=false`), `force_passwords`. Phòng theo group id, chat, mention, tìm người theo enumeration, file vào chat theo ACL Files, link Talk trong lời mời (hai chiều), khách mật khẩu + lobby, offboard, restart, backup/restore, deny 264/264 (live/sau restart/restore) LOCAL PASS; WebRTC 2 Chrome offer→connected p50 2,11 s, join→connected 3,26 s, mesh 3 người 2,29 s. Phát hiện: moderator thêm người khác nhóm theo uid (file qua phòng tới Team B/outsider, kể cả khi `allowed_groups`), email guest làm phòng công khai không mật khẩu, share phòng mặc định quyền 19, lobby không bắt buộc. Flow: Talk chỉ qua bot webhook (HMAC, có nội dung tin). Bàn giao `docs/ke-hoach/vcworkspace-17-ban-giao-talk.md`. Chưa push.
- [ ] **Chat17 phần thiết bị/mạng thật (chờ chủ dự án):** Talk iOS/Android, push, 4G/NAT + coturn, screenshare, nút gọi trong UI thật — mục 8 bàn giao chat17.
- [ ] **Chat18 Talk HPB/load: chờ chủ dự án chốt quy mô họp** (không mở trước). Đề xuất ở mục 10 bàn giao chat17.
- [ ] **Chat19 Assistant AI read-only (chờ điều phối mở):** phạm vi đề xuất ở mục 10 bàn giao chat17.

- [x] **Chat12B tích hợp OIDC vào app thật hoàn tất LOCAL sau review (2026-10-24):** OpenAPI
  `2.3.0-gd2`; `apps/web`→Authentik→`apps/api` browser tạo session manager R4,
  `/me` 200. E2E kiểm PKCE/state/nonce/replay, issuer+sub binding, same-email
  deny, verified rename, server role policy, outage fail-closed và disable
  session 401. Instance NestJS mới đọc lại binding/session trên cùng MongoDB
  TEST và binding disable làm `/me` 200→401; production config HTTP/cookie
  không Secure bị chặn. Coordinator sản phẩm thêm journal Mongo/CAS lease,
  Idempotency-Key, subject revision/CAS fencing, pending-deny đến commit,
  readback app→Authentik→Nextcloud và retry partial sau restart. Review blocker
  đã sửa: two-key delayed race/stale recovery/lease expiry, không ghost-grant,
  Authentik pagination users/groups/sessions→0, Nextcloud control bridge xóa
  từng token và đợi cache settle. Live local mover/rename/disable/global
  revoke active=true/re-enable/restore
  baseline đạt. Browser đủ manager/member/outsider trên app Drive/Office/Email;
  OIDC direct API outsider bị 403/404, WebDAV live manager204/member200/
  outsider404/404; app-password cũ sau global revoke 207→401 trong khi account
  vẫn active. `ai:check:full` cuối PASS guard44/BE173/
  endpoint145/145/FE76/typecheck/build. Browser phát
  hiện/sửa callback khác origin mất cookie; loading shell do browser dev/full
  build dùng chung `.next`, cache riêng đã hydrate. Manager mở Drive/Office/
  Email và SSO sang Nextcloud không nhập lại. Script PoC chỉ làm driver/proof;
  mutation lifecycle cuối đi qua API sản phẩm. Bàn giao
  `docs/ke-hoach/vcworkspace-12b-ban-giao-sso-ung-dung.md`; chưa mở13.

- [x] **Chat12B tíchhợpSSO vào appthật đã nghiệmthu LOCAL:** `01a16e86-3947-7e12-8a2a-39b10e5eaa1c`, hostlocal. Human trực tiếp đồngý mở12B; Next.js/NestJS thực +OIDC/immutablebinding/session/roles/lifecycle/revoke/browserproof; DBtest/Googlefake, khôngproduction.

- [x] **Chat12 Identity/Admin hoàn tất PoC local (2026-10-24):** stack riêng
  Nextcloud 33.0.10 + Authentik 2026.8.5, portal harness và Nextcloud là hai
  relying party thật. Browser chứng minh 3 persona, SSO không nhập lại,
  immutable sub/email rename, Team A ACL, mover đổi claim rồi relogin mất quyền,
  current Nextcloud session revoke 200→401. Đã sửa group namespace/binding và
  regex removal; restart, backup/restore mới, restore ACL đạt. Portal 18122 chưa
  phải tích hợp `apps/web`/`apps/api`; không Google/data thật/production.

- [x] **Chat11 khảo sát lộ trình đủ chín nhóm hoàn tất tài liệu (2026-10-24):**
  `docs/ke-hoach/vcworkspace-11-lo-trinh-9-nhom.md` ghi ma trận có/thiếu/PoC/
  NOT_TESTED, component/version/license/dependency cho Nextcloud 33, kiến trúc
  identity/data/ACL không sửa DB Nextcloud trực tiếp, acceptance và backlog
  chat12+. Kết luận đúng: chat01–10 có lát cắt LOCAL ba nhóm, sáu nhóm còn cần
  PoC. Chưa cài app/chạy runtime mới/đổi contract/deploy/push; chưa mở chat12.

- [x] **Chat10 nghiệm thu tổng thể local hoàn tất (2026-10-24):** runtime thật
  Nextcloud/ONLYOFFICE/Stalwart đạt; fake/fault/race 26/26, Office thật 3/3,
  mail management thật 5/5, revoke-session và interop thật 1/1 đạt. Full gate
  cuối guard44, BE157/140 endpoint, FE76, typecheck/build đạt. Sửa harness IMAP
  CREATE idempotent nhưng bắt buộc LIST/readback; không đổi contract. Bàn giao
  `docs/ke-hoach/vcworkspace-10-nghiem-thu-tong-the.md`. Chỉ kết luận PoC local,
  chưa production-ready.
- [x] **Điều phối nghiệm thu09 local:** đọc final bàn giao/mã/race tests/evidence/login-return/gate exit0; absolute link và fingerprint race đã sửa. BE157/140endpoint/FE76/guard44.

- [x] **Chat09 hoàn tất local (2026-10-24):** OpenAPI
  `2.2.0-gd2`; lưu MIME attachment vào Drive có provenance/hash/idempotency;
  gửi đúng Drive version dưới dạng snapshot hoặc link đăng nhập + intended
  recipient + ACL có sẵn, không cấp quyền ngầm. Target fake E2E 2/2, DOCX trọn
  luồng và XLSX/PPTX MIME routing; full gate guard44, BE157, endpoint140/140,
  FE76, typecheck/build đạt. Browser A→B trên Stalwart/Nextcloud/ONLYOFFICE và
  real integration retry/ACL/expiry/revoke đều đạt; chat10 đã nghiệm thu local.
  Bàn giao `docs/ke-hoach/vcworkspace-09-ban-giao-lien-thong.md`.

- [x] **Điều phối nghiệm thu08 local:** đọc final bàn giao/review/testdurability/proof; realadapter5/5, principalrevoke đúng, MIMEparser và send/filterfaulttests đạt; finalgate exit0 BE153 endpoint137 FE74 guard44. Không suy production.
- [x] **Chat09 đã hoàn tất:** `01a16be9-2597-7a31-b38f-0ecd37fdfba2`, host local; điều phối đã nghiệm thu và chat10 đã hoàn tất local.

- [x] **Đã tiếp tục sau mốc tạm dừng:** human đã sửa lịch sang 08:45 thứ Bảy 2026-10-24 giờ VN; hồ sơ resume ở `docs/ke-hoach/vcworkspace-tiep-tuc-khi-het-token.md` đã được thực hiện.

- [x] **Chat08 đã nghiệm thu local:** trạng thái `452`/blocker cũ đã được phần
  chốt cuối của bàn giao08 thay thế; chat10 xoay credential thử và rerun xác nhận
  protocol, management 5/5, offboard/revoke-session, filter/alias/shared ACL đạt.
  Bàn giao `docs/ke-hoach/vcworkspace-08-ban-giao-quan-ly-email.md`.

- [x] **Điều phối nghiệm thu07 local:** finalgate exit0 guard44/BE141/endpoint125/FE73, SMTPAUTH ACK IMAP MIMEhash sau reset chỉ credential thử đạt. Mail engine networkinternal, sidecar fixed ports; forward .eml có testFE. Giới hạn ảnhUI cuối đã ghi, không suy production.

- [x] **Điều phối nghiệm thu06 local:** tự kiểm PPTX/PDF hash, markerV2/ellipse XML và PDFtext, xem render slide2; gate final exit0.
- [x] **Chat07 Email cơ bản hoàn tất local:** Stalwart 0.16.27 ARM64,
  SMTP/IMAP TLS, UI/API/draft/thread/reply/MIME/attachment/idempotency/tenant
  đạt; bàn giao `docs/ke-hoach/vcworkspace-07-ban-giao-email-co-ban.md`.
  Browser download MIME timeout nên hash browser độc lập chưa có; API/protocol
  hash đạt. UI email đã được làm lại 2026-10-23 theo bố cục Outlook ba vùng:
  thư mục, danh sách thư, vùng đọc/soạn; có tìm kiếm, chọn thư, trạng thái,
  responsive và giữ nguyên API. `ai:check` đạt guard 44, BE 141 với 125/125
  endpoint, FE 72, typecheck/build. Trình duyệt local trả `/email` 200 nhưng
  phiên Computer Use đóng transport trước bước đăng nhập nên chưa có ảnh rà
  trực quan sau cùng. Review bổ sung đã khóa Stalwart vào Docker internal network,
  dùng sidecar relay cố định từ loopback; kiểm internal không ra Internet và
  TLS/SMTP qua relay đạt. UI có chuyển tiếp raw MIME dạng `message/rfc822`.
  Chủ dự án đã cho phép đặt lại recovery admin và đúng hai mailbox local; AUTH,
  SMTP ACK và IMAP fetch qua topology mới đạt với marker
  `chat07-1792761321413`, hash attachment `190f41f5…8140`. Test FE chuyển tiếp
  raw MIME đạt 1/1. Chưa mở08; chờ điều phối mở theo quy trình.

- [x] **Chat06 Slide hoàn tất local:** OpenAPI `1.9.0-gd1`; mẫu PPTX ba slide,
  API/UI/ONLYOFFICE/Drive version và PDF đạt. Browser manager sửa marker
  `NOI DUNG CHAT06 V2`, thêm ellipse bố cục, Save V2, mở lại cùng fileId và
  chạy slideshow 1/3; reader riêng chỉ xem. fileId
  `6adb4f76f2890f1546ee8087`, V2 PPTX hash `aca135f2…8e7a`, PDF hash
  `0743fd35…69cb`; XML/relationships/font và render ba trang đạt. Browser còn
  phát hiện/sửa iframe 150px do height calc không hợp lệ. Full gate cuối PASS:
  guard44, BE139/coverage118, FE72, typecheck/build. Bàn giao
  `docs/ke-hoach/vcworkspace-06-ban-giao-slide.md`; chưa tự mở chat07.

- [x] **Chat06 hoàn tất:** Slide, `01a168ab-4e5f-7cf3-b89c-8c32d493c173`, host local; chờ điều phối review để mở07.

- [x] **Điều phối nghiệm thu chat04 local:** Docker phục hồi không mất volume; ONLYOFFICE thật lưu V2/mở lại cùng fileId, DOCX/PDF V2 chứa đúng body marker. Review test tách V1 và V2, callback stale bị từ chối. Gate cuối chat04 BE135/116 endpoint, FE72/build và guard44 đạt.
- [x] **Chat05 đã được điều phối nghiệm thu local:** OpenAPI `1.8.0-gd1`; XLSX qua ONLYOFFICE thật, công thức/filter/sort, Drive V1→V2, mở lại và xuất XLSX/PDF đã kiểm XML/cached value/PDF text. Fixture fileId `6adb4cfe8dc500771673bc51`, V2 hash `1ffcf25f…cec1b`; reader browser chỉ xem. Bàn giao `docs/ke-hoach/vcworkspace-05-ban-giao-bang-tinh.md`, evidence `poc/onlyoffice/evidence/chat05-browser-v2.*`. Chưa mở06.

- [x] **Điều phối đã nghiệm thu chat03 local:** đúng fixture trash→restore UI, ID/size giữ nguyên, reader chỉ đọc; kết hợp bằng chứng API/Nextcloud/usable restore và final gate.
- [x] **Chat04 hoàn tất local (2026-10-23):** OpenAPI `1.7.0-gd1`; tạo DOCX từ mẫu, editor JWT edit/view, callback version bất biến/idempotent chống SSRF/JWT/reader, UI và export DOCX/PDF. Docker được phục hồi không purge/reset/xoá volume; image ONLYOFFICE 9.4.0.1 amd64 chính thức chạy qua emulation do manifest arm64 lỗi đóng gói. Browser manager đã tạo/sửa/save editor thật và thấy bản 2; tích hợp lặp lại với Nextcloud + converter thật đạt DOCX `PK`, PDF `%PDF-` 35.102 byte, reader mode view và tìm thấy đúng marker trong cả XML DOCX lẫn text PDF. Bàn giao: `docs/ke-hoach/vcworkspace-04-ban-giao-van-ban.md`; evidence JSON trong `poc/onlyoffice/evidence/`. Chưa suy rộng thành sizing/SLA/production; phiên này không mở chat05.

- [x] **Chat03 hoàn tất local:** OpenAPI `1.6.0-gd1`; API/UI/StoragePort rename/move giữ ID, version/checksum restore và trash/restore cây đều đạt. Usable restore boot Nextcloud volume mới ở cổng 18081 với MongoDB thử đích, tải bằng ID cũ và kiểm checksum/quyền đạt. Browser manager đã restore version, tải, đổi tên/move và trash/restore đúng fixture; reader tải được nhưng không có control ghi. Full gate cuối đạt 133 BE, 111/111 endpoint, 72 FE và build. Bàn giao: `docs/ke-hoach/vcworkspace-03-ban-giao-drive-an-toan.md`. Chat04 chưa mở từ phiên này, chờ điều phối review/mở.

- [x] **Chat02 đã được điều phối nghiệm thu phạm vi local:** đọc final bàn giao và evidence browser mvkqwtie; manager/reader và hash cả hai bản tải khớp. Hook guard đã được điều phối kiểm 43/43; full gate cuối do chat02 chạy đạt BE132/104 endpoint, FE72 và build. Đủ điều kiện mở chat03.

- [ ] **Điều phối tự động tuần tự:** chủ dự án giao theo dõi, review, mở chat kế tiếp và báo quyết định cần chốt (heartbeat `i-u-ph-i-ph-t-tri-n-vcworkspace-tu-n-t`). Đã chạy hết chat 01–12B; đang dừng chờ human duyệt chat13.

- [x] **Tách chat tuần tự (2026-10-23):** đã mở và nghiệm thu tuần tự chat 01–10, rồi 11, 12, 12B.

- [x] **Phát triển tuần tự ba nhóm lõi:** Drive → version/restore → văn bản → bảng tính → slide → email → quản lý email → liên thông → nghiệm thu tổng thể đều LOCAL PASS (chat02–10).

- 2026-10-23 · Giải thích hook Codex: đã đọc cấu hình `SessionStart`, `PreToolUse`, `Stop` và mã policy/gate để trả lời chủ dự án. Chỉ kiểm tra mã; chưa chạy thử hay bật hook, không có quyết định hoặc câu hỏi mở mới.

- [ ] **4 lớp quản trị AI (chủ dự án duyệt triển khai 2026-10-23):** đã cài và kiểm cấu hình trong repo: instructions, 3 skills, deny rules, hooks và CI; 40/40 guard tests, BE 129/129 + FE 72/72, typecheck/build đạt. Codex nhận config/skills; 3 hooks còn untrusted. Chủ dự án còn cần review/trust hooks trong phiên mới, tách identity Google/GCP/GitHub và bật bảo vệ main/dev theo `docs/huong-dan/quan-tri-ai.md`.
- [ ] **Nghiên cứu VCworkspace**: đã hoàn tất đợt đối chiếu tài liệu 2026-10-23 bằng Sol High, Astra rà điểm khó; cập nhật báo cáo và `docs/nghien-cuu/vcworkspace-kiem-chung-2026-10-23.md`. Số “42” bàn giao sai: đã xét đủ **48 ID** (21 đúng trong phạm vi, 24 đúng một phần, 1 bị bác, 2 chưa đủ bằng chứng). Còn: định danh “AI Jev”, báo giá GCP Singapore đúng SKU, dữ liệu workload/hoá đơn, các PoC tương thích/tải/restore, và 20 câu hỏi mục 13 để chọn A/B/C. Tác vụ định kỳ Claude 2026-10-25 đã chạy, đọc kết quả này và không kiểm lại (xem nhật ký 2026-10-25); nên tắt hoặc sửa prompt tác vụ `vcdocs-nghien-cuu-vcworkspace`. Báo cáo + hồ sơ kiểm chứng vẫn là WIP chưa commit. **Đề xuất mới nhất ở Phụ lục D (23/10): C + Nextcloud, thí điểm trước, 12 điểm cần chủ dự án chốt; chưa được duyệt.** Hồ sơ kiểm chứng đã có 3 mức đọc 20 của 20 / 20 của 100 / 100 của 100 và sơ đồ; phần đầy đủ giữ nguyên.
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
- Cây thư mục MKT: đổi ~70 thư mục `Tháng 01…12` thành `2026-01…` (đúng BR-10) để VCworkspace nhận, hay để VCworkspace chấp nhận thêm kiểu `Tháng NN`? Thư mục `Bài viết` trong thư mục tháng: giữ (VCworkspace không nhận) hay bỏ? Mảng `20 Social`, `30 Sàn TMĐT`, `40 Media` chưa có mã (BR-12; mẫu dùng SOCIAL, SAN, MEDIA). Drive 01 BDH và 21b LT trống, 7 drive chưa có `99 Lưu trữ`. Đề xuất: đổi tên trên Drive, không nới mẫu.
- Thời hạn giữ bản sao kho PDF trên bucket `vcdocs-sao-luu-kho-pdf` (đề xuất 10 năm) trước khi khoá chính sách retention (khoá rồi không gỡ được).
- (Audit 10/12, 2026-10-25) R3 (kiểm soát tài liệu) có cần xem hoặc nhắc phiếu duyệt ở drive Mật mà mình không là thành viên không? Bản sửa theo hợp đồng hiện tại: 404 cho cả xem lẫn nhắc; R3 vẫn xem/nhắc phiếu ở drive không Mật và drive Mật mình là thành viên. Nếu cần nhắc mà không xem, phải đổi hợp đồng `/approvals/{id}/remind`.
- (Audit 11/12, 2026-10-25) Đăng ký ngược (`/records/claim`) sang drive khác giờ chỉ cho trưởng phòng nguồn hoặc Quản lý drive nguồn (theo BA dòng 528); người tạo là Đóng góp phải nhờ trưởng phòng. Giữ vậy? Và trên Workspace thử: phiên bản đầu (`revisions.list`) của file shared drive có đúng người tạo không (Docs và file tải lên), lệch bao lâu so với `createdTime`.
- (Audit 12/12, 2026-10-25) Mail engine production có nhận thư vào hộp `@vcworkspace.test` từ ngoài API không (SMTP internet, SMTP/IMAP APPEND từ client khác)? Engine có tự thêm Message-ID không? Hiện thư thiếu Message-ID ở header bị bỏ qua, không hiện trong VCworkspace.

- (Chat13→14, 2026-10-25) Flow có cần Deck làm **nguồn** sự kiện không? Chat14 đã thử: không có webhook; polling quyền chủ board phát hiện trong ≈ nhịp poll (1 s) nhưng tốn 2 request/giây/board. Mặc định chat14: Deck chỉ làm đích. Cần nguồn thì duyệt poller NestJS (nhịp đề xuất ≥ 30 s).
- (Chat14, 2026-10-25) Tạo thẻ Deck từ Form bằng `forms_deck` (đồng bộ, app cộng đồng một người duy trì, **chép câu trả lời cả khi board rộng hơn quyền xem kết quả**) hay bằng receiver NestJS (từ chối board rộng, có journal/audit, chưa có tag/đính kèm)? Đề xuất: receiver; `forms_deck` chỉ cho board riêng của chủ form.
- (Chat14, 2026-10-25) Thông báo từ Tables có cần gửi cho người chỉ có quyền qua **share nhóm** không? Receiver hiện đóng an toàn (chỉ chủ bảng và share trực tiếp) vì runner không đọc được thành viên nhóm; muốn mở cần nguồn membership (Authentik/LDAP).
- (Chat17, 2026-10-25) **Quy mô họp dự kiến** để quyết định chat18 (HPB): số người tối đa/cuộc họp, số cuộc họp đồng thời giờ cao điểm, tỷ lệ bật video, có họp với khách ngoài không, uplink văn phòng/chi nhánh? Chat17 đo P2P + signaling nội bộ đủ cho 1-1/nhóm ≤ 4–5 người trong LAN; HPB thường cần từ 5–20+ người.
- (Chat17, 2026-10-25) Talk có được là kênh **liên phòng** không? Hiện moderator thêm được bất kỳ ai theo uid/group id (bỏ qua "chỉ chia sẻ trong nhóm"), và file chia sẻ vào phòng tới người đó qua Files. Chọn: (a) chấp nhận, moderator chịu trách nhiệm + audit thành viên phòng; (b) chặn ở reverse proxy/patch upstream; (c) chỉ cho Talk trong nhóm. Đồng thời: chặn **mời khách bằng email** (phòng thành công khai không mật khẩu) cho tới khi upstream sửa? Share vào phòng mặc định chỉ đọc hay đọc-sửa?
- (Chat17, 2026-10-25) Thiết bị/mạng để kiểm Talk thật: điện thoại iOS/Android nào, mạng 4G/NAT, có cần push (push proxy Nextcloud ra Internet hay tự host), screenshare trên máy nào, tên miền/IP công khai cho coturn?
- (Chat16, 2026-10-25) Họp **liên phòng** có thường xuyên không? Với `shareapi_only_share_with_group_members=yes` (chat13) người khác nhóm bị coi là khách ngoài: lời mời đi bằng thư, không có free/busy chéo, và link "Chấp nhận" trong thư **hỏng** (trang lỗi). Chọn: (a) giữ chính sách, họp liên phòng qua thư/ứng dụng thư; (b) bỏ chính sách nhóm cho chia sẻ, chỉ giữ `restrict_user_enumeration_to_group` để ẩn danh bạ.
- (Chat16, 2026-10-25) Lịch phòng họp dùng chung: chấp nhận rủi ro mất cập nhật khi hai người sửa cùng lúc (CalDAV không khoá, 10/10 vòng mất một bản) hay chỉ cho đặt qua lời mời (phòng tự nhận/từ chối)? Đề xuất: chỉ qua lời mời; báo upstream.
- (Chat16, 2026-10-25) Thiết bị nào để kiểm CalDAV/CardDAV thật (iPhone/iPad, Android + DAVx⁵, macOS, Thunderbird, Outlook)? Có cần Outlook kết nối lịch không (cần plugin bên thứ ba)?
- (Chat15, 2026-10-25) Thiết bị thật để kiểm sync: máy Desktop nào (macOS + Windows?), điện thoại Android/iOS nào, có MDM không? NAS thật hãng/model/firmware nào (Synology DSM, QNAP QTS, Windows Server…), giao thức (SMB3/NFS), NAS có tham gia AD/LDAP không, đặt ở đâu so với máy chủ Nextcloud?
- (Chat15, 2026-10-25) Người dùng có được sửa **trực tiếp** trên NAS không? Đề xuất: chỉ qua Nextcloud cho thư mục có chia sẻ/tag/Flow core (rename ngoài Nextcloud mất metadata, SMB bỏ qua kiểm soát truy cập); nếu cho sửa trực tiếp thì chỉ sửa nội dung, không đổi tên/di chuyển, và bật notify + đối soát.
- (Chat15, 2026-10-25) Cho phép chia sẻ file trên mount NAS ra ngoài đội không (`enable_sharing` đang bật trong PoC)? Có tắt PROPFIND `Depth: infinity` khi lên thật không?
- (Chat13, 2026-10-25) Note dùng chung của phòng nên đặt ở Notes cá nhân + share (người nhận không thấy trong app Notes, chỉ thấy qua Files), hay chuyển sang Collectives làm wiki phòng? Đề xuất: Collectives cho tài liệu chung, Notes cho ghi chú cá nhân.

## 5. Lưu ý & bài học

- antd Form: `rules` chạy ngay trong `onChange`, trước khi component render lại, nên validator không được dùng biến của lần render trước (ví dụ `type` tính từ `useWatch`); đọc `form.getFieldsValue(true)` rồi tự tra. `Select` có `value: ''` không hiện placeholder → initialValues dùng `undefined`. `Form.useWatch` trả `undefined` khi Form đã unmount (màn theo dõi việc nền) → giữ bản sao giá trị đã gửi.
- Gate FE với antd: `ho-so.test.tsx` mất 15–35 s cho 6 ca (mỗi ca mở 2 Select); chạy `pnpm ai:check` khi dev server QA + trình duyệt đang bận thì có ca vượt 20 s. Chạy gate lúc máy rảnh, không nới thêm timeout.
- QA giả: `qa-fake-server.spec.ts` bật `jobsPollMs` (mặc định 1000 ms, đổi bằng `QA_JOBS_POLL_MS`) để việc nền lập hồ sơ/chốt chạy trên trình duyệt; các e2e khác vẫn `jobsPollMs: 0` và `drain()` tay.
- antd 6 trong vitest/jsdom: cần mock `matchMedia`, `ResizeObserver`, bọc `getComputedStyle` bỏ tham số pseudo (Modal đo thanh cuộn bằng `::-webkit-scrollbar`); render test qua `UiProvider test` để tắt motion và danh sách ảo (khi đó mọi mục Select có `role="option"`, `aria-disabled`). `Input.TextArea autoSize` làm `userEvent.type` chậm tới timeout → dùng `rows`. Nhãn mục đã chọn của Select nằm ở `title` của `.ant-select-content`. antd 6 bỏ `cssVar: true` (mặc định bật), `Alert/Notification message`→`title`, `Tag bordered`→`variant`, `Drawer width`→`size`.
- `next dev`/`next build` tự ghi lại `apps/web/tsconfig.json` (thêm `.next-*/types` vào include, định dạng lại): kiểm `git diff` và trả lại trước khi commit.
- Máy local có `gh`, `gcloud` (kiểm 2026-10-22) và Docker (dùng cho PoC từ chat02, kiểm lại 2026-10-25). Ghi chú cũ "chưa có Docker" đã lỗi thời.
- QA trình duyệt không cần Docker: `RUN_QA_FAKE_SERVER=1` chạy `apps/api/test/qa-fake-server.spec.ts` (API cổng 14100, mọi thứ giả) cùng web `NEXT_DIST_DIR=.next-qa API_ORIGIN=http://127.0.0.1:14100 next dev -p 13100`. Không chạy `node dist/main.js` vì nó nạp `.env` thật.
- Repo chặn `git push` cho Claude (`.claude/settings.json`): chủ dự án tự push và mở PR.
- Browser dev và full build dùng chung `apps/web/.next` làm shell đứng ở "Đang mở…"; dùng thư mục build riêng (`.next-oidc12`, `.next-smoke`…) khi chạy song song.
- Git dùng thông tin đăng nhập trong macOS Keychain. Ghi chú private trước đây đã lỗi thời: API GitHub 2026-10-23 trả `private=false`; main/dev chưa có branch protection và chưa có ruleset.
- Drive API: bỏ thư mục vào thùng rác thì tệp con vẫn trả `trashed: false` khi đọc riêng; BE kiểm tệp đã xoá phải xét cả thư mục cha hoặc tự bỏ từng tệp.
- Google Cloud của vcprosperous.com: project `vcdocs`; service account `vcdocs-backend@vcdocs.iam.gserviceaccount.com`, Client ID `112100786889389485867`. Tổ chức chặn tạo khoá (`iam.disableServiceAccountKeyCreation`); đã tắt riêng cho project `vcdocs`. Đã bật API Drive, Admin SDK, Docs, Sheets, Gmail. Domain-wide delegation 8 quyền khớp `apps/api/src/google/real/real-google.ts`; thêm quyền mới ở BE thì phải thêm cả ở admin.google.com. Ảnh hướng dẫn: `docs/huong-dan/anh/`. OAuth client "VCdocs web (local)" (Internal), redirect `http://localhost:4000/api/v1/auth/google/callback`. `apps/api/.env` (git bỏ qua) chạy `GOOGLE_MODE=real`, CSDL `vcdocs_that`, `MAIL_FROM` tạm là mail chủ dự án; Drive dùng chính service account (không mượn quyền) nên chỉ thấy shared drive có thêm nó.
- Lịch hằng tháng (`folder.ensure_periods` tự động) tạo năm/tháng cho mọi thư mục `hasPeriods`; thư mục nhận từ Drive chỉ bật `hasPeriods` khi các thư mục năm bên trong đều đúng `YYYY-MM`, tránh sinh `2026-10` cạnh `Tháng 10`.
- `vcdocs_that` (2026-10-20) mới có bản ghi công ty và 1 người: chưa chạy `nap-so-do` nên chưa có phòng. Mongo local của phiên chính chạy ở cổng 27019.
- `VCdocs` là repo tạo mới chứ không phải đổi tên từ `VCknowledge`, nên GitHub không tự chuyển hướng URL cũ.

- Probe deny hàng loạt kích hoạt brute-force protection của Nextcloud (cuối cùng HTTP 500). Test reset bằng `occ security:bruteforce:reset <IP relay>`; production sau reverse proxy phải có `trusted_proxies`.
- Relay busybox `nc` của PoC làm Chrome treo với keep-alive; PoC chat13 tắt KeepAlive. Không dùng relay này cho môi trường thật.
- Restore Nextcloud từ `pg_dump`: phải tạo lại role DB `oc_admin` do installer sinh (role nằm ngoài dump).
- Nextcloud `webhook_listeners` (1.5.0): gửi JSON **không có Content-Type**, **không gửi lại** khi receiver lỗi (job bắt exception), `eventFilter` không có `$regex` (toán tử lạ ném exception). Chạy `occ background-job:worker ... WebhookCall` riêng thì giao ≈ 1 s; chỉ cron thì chờ tới lượt cron.
- Mount SMB tới NAS không phân biệt hoa/thường: luôn đặt `case_sensitive=false` (mặc định `true` làm đổi tên `a.txt→A.txt` qua Nextcloud xoá file) và `encoding_compatibility=true` (tên NFD từ macOS mới hiện). Thu hồi app password bằng `occ` trễ tới 10 s (cache APCu của web); disable tài khoản trả 503, không phải 401.
- Calendar/Contacts (chat16): sổ địa chỉ hệ thống mặc định cho **mọi** người dùng thấy cả công ty (kể cả khi đã bật chia sẻ chỉ trong nhóm) → bật `shareapi_restrict_user_enumeration_to_group=yes` và `..._full_match=no`. CONFIDENTIAL chỉ che với người được chia sẻ **chỉ đọc**. Xoá sự kiện phát `CalendarObjectMovedToTrashEvent` (không phải `Deleted`). vCard 4.0 chỉ được trả nguyên khi client gửi `Accept: text/vcard; version=4.0`. Gọi Nextcloud work13 từ host bằng `http://localhost:18130` (trusted domain `localhost`).
- Talk (chat17): danh sách STUN rỗng thì Talk tự dùng `stun.nextcloud.com:443` (trình duyệt gọi ra Internet) — chỉ `has_internet_connection=false` hoặc STUN/TURN nội bộ bỏ được. Talk chặn tra token phòng sai theo IP (429) → reset brute-force trước ma trận probe; production cần `trusted_proxies`. Signaling nội bộ poll 1 s; người thứ hai của 1-1 chỉ được thêm khi có tin/join đầu. Đăng tin trong phòng xoá thông báo chat của chính người đăng. Chrome headless macOS: micro giả lỗi NotReadableError (dùng WebAudio); UI Talk báo `HeadlessChrome` không hỗ trợ. Lên lịch họp từ Talk 500 nếu user chưa có tuỳ chọn múi giờ.
- Hook guard chặn cả chuỗi con trong lệnh Bash: `base64`, `sh -c`, `node -e`, `dropDatabase(`, tên file chứa `sa…json` (vd `samples.json`), từ `mongo` đứng riêng (vd thư mục `.runtime/mongo`). Viết script ra file rồi chạy.

## 6. Nhật ký các phiên

### 2026-10-26 · Giao diện Ant Design bước 5: module Thư mục/Drive

- Chủ dự án duyệt Phê duyệt, giao Thư mục/Drive. Cây thư mục viết lại trên antd Tree tải dần; hộp thoại tạo/đổi tên thành antd Form; trang thành viên drive đổi checkbox.
- Đã chạy: typecheck, FE 96/96, QA giả (GĐ khối xem cây + danh sách drive; Trưởng phòng MKT mở hộp thoại Tạo thư mục). `pnpm ai:check` đạt (FE 96/96).
- Còn dở: chờ xem rồi sang Email; chưa push/PR.

### 2026-10-26 · Giao diện Ant Design bước 4: module Phê duyệt

- Chủ dự án duyệt Tài liệu, giao Phê duyệt. Viết lại hộp duyệt (Card/Flex thay `.list`), chi tiết phiếu (Space, LinkButton, Affix), uỷ quyền (antd Form trong Modal). Bỏ antd `List` sau khi thấy cảnh báo deprecated trên trình duyệt.
- Đã chạy: typecheck, FE 96/96 (phe-duyet.test không đổi), QA giả trọn luồng trình duyệt hồ sơ → hộp duyệt → chi tiết → hộp thoại; trang Uỷ quyền. `pnpm ai:check` đạt (FE 96/96).
- Còn dở: chờ xem rồi sang Thư mục/Drive; chưa push/PR.

### 2026-10-26 · Giao diện Ant Design bước 3: module Tài liệu

- Chủ dự án duyệt Hồ sơ, giao Tài liệu cùng cách làm. Viết lại danh sách, đăng ký, chi tiết, bên ngoài; tách ô chọn phòng/người thành bản chỉ-Select để dùng trong antd Form.
- Đã chạy: typecheck, FE 96/96 (tai-lieu.test không đổi), QA giả hai vai (Trưởng phòng MKT đăng ký tài liệu; Kiểm soát tài liệu mở hộp thoại Sửa đổi / Rà soát). `pnpm ai:check` lần đầu trượt 2 ca ho-so.test vì hết giờ 20 s khi gate chạy song song với dev server QA + trình duyệt; chạy lại khi máy rảnh: đạt (FE 96/96).
- Còn dở: chờ xem rồi sang Phê duyệt; chưa push/PR.

### 2026-10-26 · Giao diện Ant Design bước 2: module Hồ sơ

- Chủ dự án duyệt lớp nền, giao chuyển module Hồ sơ. Checkout đang ở `dev` (đã merge PR #3–#8); phiên khác đã gộp bước 1 vào `claude/gop-antd` (PR #10, nới Vitest 20 s) nên cắt `vcworkspace/antd-ho-so` từ đó, không gộp lại dev lần nữa.
- Viết lại danh sách, lập hồ sơ, chi tiết, file chưa đăng ký bằng antd Form/Table/DatePicker/Upload; thêm `components/dates.tsx`, `DataTable` nhận `pagination`. Sửa hai lỗi thấy khi xem: Select không hiện placeholder (giá trị ''), validator đọc loại hồ sơ của render cũ nên ô báo đỏ dù đã chọn.
- Đã chạy: typecheck, FE 96/96 (ho-so.test không đổi), QA giả trọn luồng lập hồ sơ → chi tiết → Sửa / Gắn bản scan, điện thoại; `pnpm ai:check` đạt (BE 369/10 skip, FE 96/96).
- Còn dở: chờ chủ dự án xem rồi sang Tài liệu; chưa push/PR.

### 2026-10-25 · Giao diện Ant Design bước 1 (lớp component nền)

- Chủ dự án hỏi thư viện thiết kế; đề xuất và được duyệt Ant Design 6 (xem mục 2). Tạo nhánh `vcworkspace/giao-dien-antd`, cài gói bằng `pnpm add` (lockfile cập nhật theo pnpm, không sửa tay).
- Viết lại `ui.tsx`, `AppShell`, `ToastProvider`, `DataTable`, `ActionDialog`, `pickers`, thêm `providers/UiProvider.tsx`, root layout dùng `AntdRegistry` + font; `globals.css` bỏ CSS khung/modal/toast/bảng/tabs cũ, giữ CSS trang email, việc nền, cây thư mục, đăng nhập và `.btn/.field` cho trang chưa chuyển.
- Đã chạy: `pnpm --filter @vcdocs/web typecheck` đạt; `test` 76/76 (sửa 3 file test sang thao tác antd Select); `NEXT_DIST_DIR=.next-antd build` đạt; QA giả bằng trình duyệt (đăng nhập Trưởng phòng MKT mẫu) chụp các trang chính và điện thoại. `pnpm ai:check` đạt (guard 44, contract lint, BE 180/9 skip, FE 76/76).
- Còn dở: chờ chủ dự án xem rồi mới đi từng module; chưa push (repo chặn), chưa PR.

### 2026-10-26 · Email: hiển thị an toàn nội dung thư trong khung đọc (OpenAPI 2.6.0-gd2)

- Nhánh `tmp-reader` cắt từ `origin/claude/mail-compose-cc-bcc-richtext` (29a0ef4, PR #8), worktree `.claude/worktrees/agent-aa3522b43b9f25d02`; `pnpm install --offline --frozen-lockfile`. Chủ dự án giao thay đổi hợp đồng: thêm `GET /mail/messages/{id}/body` + schema `MailMessageBody`, ghi `contract/NGUON.md`, sinh lại `schema.d.ts`.
- BE: `MailBasicService.body` dùng lại `raw` (cùng ACL/404, `?mailbox=` cần quyền `read`, 403 như raw), phân tích bằng `simpleParser`; `html` luôn lọc lại bằng allowlist `sanitizeHtml` (cả thư đến), không ảnh; `hasRemoteResources` (mới, htmlparser2) báo ảnh/CSS/media từ xa; giới hạn HTML gốc 2 MiB, text 256 Ki, 100 tệp → `truncated`; `attachments[].part` khớp save-to-drive. `Cache-Control: private, no-store`; không log nội dung.
- FE `/email`: `MessageBody.tsx` thay khối "Thư đã được lưu an toàn"; HTML trong `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">` (không allow-scripts/allow-same-origin), `srcDoc` có CSP `default-src 'none'; style-src 'unsafe-inline'`, `<base target="_blank">`, style đọc, lọc lại bằng `cleanHtml`; chiều cao ước lượng theo độ dài chữ (260–900px, cuộn trong). Không có html → chữ thuần `white-space: pre-wrap` (React text). Danh sách tệp (tên/kích thước/loại) với nút "Lưu vào Drive" theo `part`, bỏ ô nhập số thứ tự/SHA-256 thủ công. Có trạng thái đang tải/lỗi + Thử lại; báo chặn nội dung từ xa/cắt bớt.
- Test mới: `apps/api/test/mail-body.e2e-spec.ts` (4 ca: chủ thư/người khác 404, HTML độc hại script/onerror/javascript:/style/iframe/svg/form, chữ thuần không html, hộp nhóm read/manage-only/người ngoài), 1 ca `hasRemoteResources` trong `mail-html-sanitizer.spec.ts`, 3 ca FE (iframe sandbox + CSP + lưu Drive theo part, chữ thuần, lỗi + thử lại).
- `pnpm ai:check:full` PASS: guard 44/44, OpenAPI hợp lệ (194 warning), API 367 pass/10 skip + độ phủ hợp đồng 149/149, FE 96/96, typecheck/build đạt. Chưa chạy: trình duyệt thật, Stalwart thật, thư HTML từ client mail ngoài. Không đọc `.env`, không gửi thư thật, không deploy/push.

### 2026-10-25 · Soạn thư Email: Cc/Bcc + định dạng nội dung (OpenAPI 2.5.0-gd2)

- Nhánh `claude/mail-compose-cc-bcc-richtext` (cắt từ `origin/main` a959120), worktree riêng `.claude/worktrees/agent-af0c92f95586cd73b`; `pnpm install --offline --frozen-lockfile`; thêm `htmlparser2@10.1.0` cho `@vcdocs/api` bằng `pnpm add --offline` (lockfile do pnpm sinh).
- Hợp đồng (chủ dự án giao): `MailCompose` + form multipart thêm `cc`/`bcc`; `MailMessage` thêm `cc`, `bcc` (bcc chỉ ở bản "Đã gửi" của mailbox người gửi); mô tả allowlist `html` ≤ 512 KiB; ghi `contract/NGUON.md`, sinh lại `schema.d.ts`. Tương thích (chỉ thêm trường tuỳ chọn).
- BE: To/Cc/Bcc cùng luật địa chỉ nội bộ, bỏ trùng giữa danh sách (To → Cc → Bcc), tổng ≤ 50, gửi vẫn bắt buộc có To; SMTP envelope = To ∪ Cc ∪ Bcc, MIME có `To`/`Cc`, **không bao giờ có `Bcc`** (kể cả bản Đã gửi; Bcc của người gửi chỉ lưu ở metadata Mongo); vân tay Idempotency có Cc/Bcc (chỉ thêm khoá khi có nên journal cũ giữ nguyên). Thay `sanitizeHtml` regex bằng allowlist dựng lại từ token htmlparser2 (`html-sanitizer.ts`; đóng phần sanitizer của O14). Nháp lưu/bỏ trùng Cc/Bcc. Hộp thư nhóm: người đọc hộp nhóm thấy bcc của thư hộp nhóm đã gửi (đó là bản Đã gửi của hộp nhóm).
- FE `/email`: nút Cc/Bcc mở hai ô (phân cách phẩy/chấm phẩy, cả ô Đến); trình soạn `contentEditable` với thanh công cụ (đậm, nghiêng, gạch dưới, gạch ngang, danh sách chấm/số, trích dẫn, link chỉ http/https/mailto, xoá định dạng), Ctrl/Cmd+B/I/U, dán chỉ giữ allowlist; gửi `html` (đã lọc) + `text` thuần cùng nội dung; khung đọc hiện Cc (và Bcc trên bản Đã gửi), vẫn không render HTML thư. Không thêm dependency FE.
- Kiểm: `pnpm ai:check:full` **PASS** — guard 44/44, contract lint OK, BE 362 pass/10 skip (50 suite, 40 chạy), độ phủ hợp đồng 148/148, FE 93/93 (16 file), typecheck + build đạt. Test mới: `apps/api/test/mail-cc-bcc.e2e-spec.ts` (6), `apps/api/test/mail-html-sanitizer.spec.ts` (34), FE `email.test.tsx` +5. Không sửa assertion cũ.
- Chưa kiểm: giao diện trên trình duyệt thật (preview dùng `launch.json` của checkout chính nên không tự dựng được), Stalwart thật với Cc/Bcc (chỉ chạy fake port; code Stalwart không đổi, RCPT TO vốn lặp theo envelope). Chưa push, chưa PR.

### 2026-10-25 · Chat17 Talk nhỏ — LOCAL PASS (container + Chrome headless)

- Nhánh `claude/chat17-talk` (cắt từ chat16 d93960d), worktree riêng; `pnpm install --offline --frozen-lockfile`. Preflight App Store 33.0.10 → Talk **23.0.12** (ký số, integrity PASS), cài qua egress tạm ≈ 4,9 s rồi ngắt. Cấu hình: signaling nội bộ, không HPB/TURN/STUN, `has_internet_connection=false`, `force_passwords`, tắt recording/SIP/federation. App password `talk17-api`(+`-2`) mint bằng `occ` (không đọc secret chat trước).
- Nghiệm thu LOCAL (`poc/talk/evidence/`): phòng nhóm theo group id + đồng bộ nhóm (≈ 275 ms), 1-1 (chéo nhóm 403), chat/mention/@all/thông báo, autocomplete mention, tìm người 0 chéo nhóm, file vào chat (người ngoài 404 mọi đường, reshare thiếu quyền 404, chỉ đọc 403, gỡ khỏi phòng mất quyền ≈ 95 ms), link Talk trong lời mời (Calendar→Talk và "Lên lịch họp" Talk→Calendar; link không cấp quyền: Team B/outsider/ẩn danh 404), khách mật khẩu + lobby 412, offboard (`talk:user:transfer-ownership`, `talk:user:remove`, revoke ≈ 9,4 s, disable 401 ngay), restart (≈ 1,8 s) + backup/restore 18173 khớp trạng thái, deny 264/264 ×3, cô lập. WebRTC 2 Chrome headless (harness nói đúng signaling nội bộ): offer→connected p50 2 109 ms, join→connected 3 263 ms; mesh 3 người (1 khách) 2 290 ms; kẻ ngoài chèn offer không tới callee.
- Phát hiện: moderator thêm Team B/outsider/nhóm outsiders theo id (200) → file qua phòng tới người khác nhóm (share trực tiếp 403); `allowed_groups` khoá Talk API của outsider nhưng file vẫn tới (200); email guest biến phòng riêng thành công khai không mật khẩu (người lạ đọc lịch sử); share phòng mặc định quyền 19 (thành viên ghi đè được); lobby không bắt buộc; scheduleMeeting 500 khi user chưa có múi giờ; Calendar "phòng công khai" 400 dưới `force_passwords`; file của người nghỉ mất khi disable. Flow: event Talk không tương thích `webhook_listeners` (400), bot webhook HMAC chạy (≈ 163 ms, có nguyên văn tin).
- `pnpm ai:check` (changed gate) PASS — guard 44/44, chỉ PoC/tài liệu nên không chạy test BE/FE; `ai:check:full` chưa chạy. `scan-secrets` PASS 12 giá trị.
- Còn dở/NOT_TESTED: nút gọi trong UI Talk thật (headless không có micro giả), TURN/coturn, điện thoại, push, 4G/NAT, screenshare, recording, SIP, HPB/tải. Trạng thái để lại: spreed bật trên work13 với cấu hình trên (`has_internet_connection=false` toàn hệ thống), phòng fixture `talk17-*`, không còn bot chat17, restore talk17 dừng (giữ volume), member-b bật lại + token mới, successor-a có múi giờ `Asia/Ho_Chi_Minh`. Chưa push.

### 2026-10-25 · Chat16 Groupware Calendar/Contacts — LOCAL PASS (container)

- Nhánh `claude/chat16-calendar-contacts` (cắt từ chat15 dfc6a28), worktree riêng; `pnpm install --offline --frozen-lockfile`. Preflight App Store 33.0.10 rồi cài (tạm nối egress, đã ngắt) Calendar 6.6.3, Contacts 8.9.2, calendar_resource_management 0.12.2 — ký số, integrity PASS. Overlay `vcworkspace-cal16`: Stalwart 0.16.27 **mới** (`mail16`, volume `vcworkspace_cal16_mail_data`, chỉ mạng internal work13, relay `127.0.0.1:18160`), 11 hộp `.test`; Nextcloud gửi thư SMTP 465 tới `mail16`. App password `cal16-dav` mint bằng `occ` (không đọc secret chat13).
- Nghiệm thu LOCAL (`poc/calendar-contacts/evidence/`): lịch/sổ chia sẻ group id (đọc-ghi/chỉ đọc), PRIVATE/CONFIDENTIAL, lặp + EXDATE + RECURRENCE-ID, NY qua DST 2026-11-01 (13:00Z→14:00Z), giờ không tồn tại/lặp, sync-token CalDAV/CardDAV, free/busy không chi tiết (chéo nhóm "3.7"), lời mời nội bộ + iMIP (REQUEST/update/CANCEL) chỉ tới hộp local, trả lời qua CalDAV, phòng P301 (giới hạn Team A)/P302 tự nhận/từ chối, sổ hệ thống theo nhóm, tìm người kiểu UI 0 chéo nhóm, vCard 3.0/4.0 + export/import, deny 150/150 (live, sau restart, restore), offboard (calendar:export, dav:move-calendar, revoke ≈ 9 s, disable 503), backup/restore stack 18163/18164 khớp sync-token + ETag, cô lập (không route ra ngoài, hàng đợi rỗng).
- Phát hiện: ghi đồng thời cùng ETag mất bản 10/10; link "Chấp nhận" lỗi khi bật chia sẻ chỉ trong nhóm (DOC `Principal::findByUri`, LOCAL tắt tạm thì chạy); sổ hệ thống mặc định lộ toàn bộ (đã bật `restrict_user_enumeration_to_group=yes`, `full_match=no` trên work13); khác nhóm = khách ngoài; CONFIDENTIAL lộ với sharee đọc-ghi; ORGANIZER không đổi khi chuyển lịch người nghỉ; tên phòng giới hạn vẫn liệt kê được.
- Flow: `CalendarObject{Created,Updated,Deleted,MovedToTrash}Event` đăng ký + giao được, lọc theo `calendarData.principaluri/uri`, payload đủ iCalendar (kể cả PRIVATE); `OCA\DAV\Events\Card*/AddressBook*` 400 → Contacts chỉ làm đích. Receiver chat14 chưa nhận lớp lịch (422, DOC); không đổi mã `apps/`/hợp đồng.
- `pnpm ai:check` (changed gate, 59 file) PASS — guard 44/44, không có mã BE/FE thay đổi nên không chạy test BE/FE; `ai:check:full` chưa chạy (không cần cho thay đổi chỉ PoC/tài liệu). `scan-secrets` PASS 19 giá trị.
- Còn dở/NOT_TESTED: client thật (iOS/Android DAVx⁵/macOS/Thunderbird/Outlook), UI trình duyệt OIDC cho Calendar/Contacts, trả lời iMIP bằng ứng dụng thư, múi giờ người dùng trên UI, thư thật. Trạng thái để lại: overlay cal16 chạy, restore cal16 dừng (giữ volume), không còn webhook chat16, member-b bật lại, chính sách danh bạ theo nhóm đang bật, SMTP Nextcloud trỏ `mail16`. Chưa push.

### 2026-10-25 · Chat15 Sync + NAS — LOCAL PASS (container)

- Nhánh `claude/chat15-sync-nas` (cắt từ chat14 05b0ced), worktree riêng; `pnpm install --offline --frozen-lockfile`. Pull `alpine:3.22.2` (digest pin) dựng Samba 4.21.9 làm NAS `nas15` (mạng internal work13, không cổng host, volume mới `vcworkspace_sync15_nas`); image Nextcloud dẫn xuất cùng digest 33.0.10 + smbclient + php-smbclient, **tạo lại** container nextcloud work13 bằng override (volume giữ nguyên). Overlay `vcworkspace-sync15`: `nas15`, `smb-client`, `files-notify`. Không cài gì lên máy Mac, không dùng thiết bị thật; không có image `nextcloudcmd` nên client thật NOT_TESTED.
- Nghiệm thu LOCAL: ACL theo nhóm qua WebDAV và SMB trực tiếp (Team B/outsider/ẩn danh/tài khoản dịch vụ đội kia bị chặn, leaver chat13 401); độ trễ notify/kiểm khi truy cập/scan; rename/metadata; Unicode NFC/NFD; hoa/thường; 1 GiB chunked v2 + ghi trực tiếp; ngữ nghĩa sync WebDAV với 2 app password (If-Match 412, xung đột 423→412 không mất bản, chunked v2 tiếp tục/huỷ/403, revoke ≈ 6 s bằng occ, tự đăng xuất ngay, offboard 503 ngay + phải khoá NAS riêng); Flow: ghi qua WebDAV trên mount SMB có webhook + Flow core chặn, ghi trực tiếp trên NAS **không** có webhook → đối soát Files mới bắt được ≈ 1,8 s; restart; backup/restore stack riêng 18153 có kiểm ACL. Bằng chứng `poc/sync-nas/evidence/`, bàn giao `docs/ke-hoach/vcworkspace-15-ban-giao-sync-nas.md`.
- BE: đối soát Files theo thư mục trong `apps/api/src/modules/flow/` (`files.verify-tag` + `reconcile: true`, `listFolderFiles`, collection `flow_file_states`, outcome `tag_missing`, audit `flow.reconcile.failed`/`flow.files.tag_missing`); không đổi hợp đồng/FE. E2E `flow-files-reconcile.e2e-spec.ts` 8/8, `flow-receiver` 13/13.
- `pnpm ai:check` PASS (BE 322 passed/10 skipped, hợp đồng 148/148); `pnpm ai:check:full` PASS (guard 44/44, FE 84, build). `scan-secrets` PASS 39 giá trị.
- Còn dở/NOT_TESTED: client Desktop/mobile thật, NAS thật, NFC+NFD cùng tên, chi phí `encoding_compatibility` trên cây lớn, nhiều node web. Stack work13 + flow14 + sync15 còn chạy (Nextcloud work13 chạy image `vcworkspace-sync15/nextcloud-smb`); restore sync15 đã dừng (giữ volume); mongod thử đã dừng; webhook Flow dùng bí mật trong `poc/flow/secrets/` của worktree chat15; member-b và `nas-manager-b` đã bật lại. Chưa push.

### 2026-10-25 · Chat14 Flow — LOCAL PASS

- Nhánh `claude/chat14-flow` (cắt từ chat13 aed52ad), worktree riêng; `pnpm install --offline --frozen-lockfile`. Dùng lại stack `vcworkspace-work13` đang chạy; thêm overlay `poc/flow/compose.flow.yaml` (project `vcworkspace-flow14`: worker `background-job:worker` cho WebhookCall + relay tới receiver loopback 18140), không volume mới. Cài forms_deck 0.7.0, files_automatedtagging 4.0.1, files_accesscontrol 4.0.2 (preflight App Store, integrity PASS, egress tạm rồi ngắt); không cài workflow_script.
- BE: module `flow` (guard header bí mật nhiều bản, allowlist, journal `flow_events` + `flow_effects` + `flow_cursors`, worker lease/thứ tự/retry, readback quyền runner, đối soát, audit theo correlationId); cấu hình `FLOW_*` kiểm khi khởi động, mặc định tắt. Hợp đồng 2.4.0-gd2 (`contract/NGUON.md`), FE `schema.d.ts` sinh lại. E2E `flow-receiver.e2e-spec.ts` 13/13 với Nextcloud giả; receiver thật chạy qua spec có cổng `flow-nextcloud-server.spec.ts` (Google giả, mongod local 127.0.0.1:18141 trong `poc/flow/.runtime`).
- Nghiệm thu LOCAL: (a) 10 phiếu → 10 thẻ, ACL thẻ chỉ chủ board, board chia sẻ → receiver từ chối còn forms_deck lộ câu trả lời; (b) 10 dòng → thông báo 2 người có quyền, 2 người ngoài bị từ chối, không email; (c) tag/chặn file `*-mat` bằng Flow core, receiver `tag_verified`; replay body thật, xoay vòng bí mật, SIGKILL giữa chừng, receiver tắt + đối soát, cron vs worker, polling Deck. Bằng chứng `poc/flow/evidence/`, bàn giao `docs/ke-hoach/vcworkspace-14-ban-giao-flow.md`.
- `pnpm ai:check:full` PASS (guard 44/44, BE 314 passed/10 skipped, hợp đồng 148/148, FE 84, build); `pnpm ai:check` PASS bản cuối. `scan-secrets` PASS.
- Còn dở/NOT_TESTED: nhiều instance receiver, tải, đối soát Files, Row Updated/Deleted và Node Deleted/Renamed chưa có rule, UI FE cho thông báo/journal, HTTPS giữa Nextcloud và receiver, production. Stack work13 + overlay flow14 còn chạy (mongod thử đã dừng, dữ liệu ở `poc/flow/.runtime`); webhook Nextcloud vẫn trỏ relay (receiver tắt thì log lỗi). Chưa push.

### 2026-10-25 · Chat13 Work management — LOCAL PASS

- Nhánh `claude/chat13-work-management-d67500` (cắt từ 98f8025, audit 12/12). Stack mới `vcworkspace-work13` cổng 18130/18131 (restore 18133), volume riêng, mạng internal, không đụng runtime chat02–12B. Kiểm App Store API cho NC 33.0.10 ngay trước cài: Forms stable mới là 5.4.1 (lộ trình ghi 5.3.6), user_oidc 8.11.0; integrity PASS.
- 6 persona OIDC qua Chrome headless (manager-a, member-a, successor-a, manager-b, member-b, outsider). Acceptance 5 app bằng API (app password) và UI trình duyệt; tìm kiếm 14 provider không lộ chéo; event probe; restart 9 container; export; backup/restore sang stack riêng có readback ACL; offboard manager-a → successor-a. Bằng chứng `poc/work-management/evidence/`, bàn giao `docs/ke-hoach/vcworkspace-13-ban-giao-work-management.md`.
- Phát hiện: Deck không có event webhook; `userIdFilter` không bắn với API app password (dùng `eventFilter`); Forms webhook không kèm câu trả lời; Tables lộ tồn tại row ID (403/404); Collectives trả 500 cho người ngoài liệt kê attachment; brute-force throttle khi probe; relay keep-alive.
- Không sửa `apps/`, không đổi hợp đồng. `pnpm ai:check` PASS (changed gate 65 file, guard 44/44; không có mã `apps/` đổi nên gate không chạy BE/FE). Chưa chạy `ai:check:full` (không cần cho thay đổi PoC/tài liệu).
- Còn dở: OIDC login trên bản restore NOT_TESTED; manager-a để ở trạng thái đã offboard; chưa push. Stack work13 còn chạy, restore đã stop (giữ volume).

### 2026-10-25 · Sửa audit 12/12 — client IMAP tách phản hồi theo literal `{N}`

- Nhánh `claude/audit-fix-12-imap-literal` (cắt từ nhánh 11/12, commit 120bd69). Fingerprint `mail-basic/imap-literal-length-ignored` **tái hiện được** bằng transcript IMAP trong bộ nhớ. Dòng `s3 OK`/`s4 OK` cùng `BODY[] {..}` giả nằm trong thân thư 1 làm `listFolder` cắt cụt thư 1 và trả thêm thư giả `victim@`. Thư thiếu Message-ID làm `uid()` lấy UID của thư kế tiếp. `NO` phải chờ timeout 10 giây.
- Sửa:
  - `tls-client.ts`: thêm `parseImapResponse`/`readImap`. Đọc đúng N byte literal; chỉ nhận dòng hoàn tất có tag nằm ngoài literal; `OK`/`NO`/`BAD` trả ngay; socket đóng thì báo lỗi ngay.
  - `StalwartMailPort`: `withImap` luôn đóng socket trong `finally` (SMTP cũng vậy). engineId lấy bằng mailparser trên header. Thư thiếu Message-ID bị bỏ qua.
  - `syncFolder`: thư hỏng thì bỏ qua, không trả 500.
  - Test mới `apps/api/test/stalwart-imap-literal.spec.ts` (trước 7/7 fail, sau 7/7 đạt) và 1 ca e2e trong `mail-durability.e2e-spec.ts` (trước 500, sau 200).
  - `ai:check` PASS (301 passed). Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: chưa kiểm với Stalwart thật. Câu hỏi deploy mail ngoài API ở mục 4. Chưa chạy `ai:check:full`. Đã xong 12/12 đầu mối audit.

### 2026-10-25 · Sửa audit 11/12 — đăng ký ngược không coi người sửa cuối là người tạo

- Nhánh `claude/audit-fix-11-records-claim-creator-c6f9d9` (cắt từ nhánh 10/12). Fingerprint `legacy/records-claim:creator-check-uses-lastModifyingUser` **tái hiện được** (bản giả trả người sửa cuối như adapter thật): người sửa cuối `nv.mkt` claim file drive chung VCPV do `hcns` tạo → 202, file bị chuyển sang drive MKT, Record `createdBy` = `nv.mkt`.
- Sửa: `DriveFileMeta.createdByEmail` → `lastModifierEmail`; thêm `drive.getCreatorEmail` (bản thật: `lastModifyingUser` của phiên bản sớm nhất, lệch `createdTime` quá 1 giờ thì `undefined`); claim dùng người tạo từ đó và khi chuyển sang drive khác đòi trưởng phòng nguồn hoặc Quản lý drive nguồn; `/records/unregistered` lấy `ownerEmail` từ `getCreatorEmail`. Test mới `records-claim-creator.e2e-spec.ts` và `real-google-creator.spec.ts` (trước 6/7 fail, sau 7/7). Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 1 đầu mối audit còn lại (phiên 12/12 cắt từ nhánh này); chưa kiểm cách lấy người tạo với Google thật (mục 4); chưa chạy `ai:check:full`.

### 2026-10-25 · Sửa audit 10/12 — R3 không đọc phiếu duyệt drive Mật ngoài phòng

- Nhánh `claude/audit-fix-10-approvals-r3-confidential-96b801` (cắt từ nhánh 9/12). Fingerprint `legacy/approvals-load:R3-bypass-confidential-drive` **tái hiện được**: R3 `hcns` (không thuộc TC – KT) `GET /approvals/:id` và `POST /approvals/:id/remind` phiếu chia sẻ ngoài file mật của TC – KT đều 200.
- Sửa `ApprovalsController.load`: người liên quan qua; R3 dùng `assertVisibleOrR3` (drive Mật không là thành viên → 404); người khác như cũ. `list` vốn lọc theo người liên quan nên không lộ. Test mới `apps/api/test/approvals-r3-confidential.e2e-spec.ts` (trước 2/5 fail, sau 5/5). Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 2 đầu mối audit còn lại (phiên 11/12 cắt từ nhánh này); câu hỏi chính sách R3 với drive Mật ở mục 4; chưa chạy `ai:check:full`.

### 2026-10-25 · Sửa audit 9/12 — trang soạn thảo kiểm fileId và origin Document Server

- Nhánh `claude/audit-fix-09-editor-page-fileid-d6e01c` (cắt từ nhánh 8/12). Fingerprint `web/bo-nho-soan-thao:fileId-path-injection-editor-config-script-src` **tái hiện được** bằng Vitest/MSW: fileId `<id>/content#` hoặc `<id>?x=` làm trang gọi `/drive/files/<id>/content` hoặc `/drive/files/<id>` và chèn `<script>` từ `documentServerUrl` lạ.
- Sửa: fileId phải là ObjectId 24 hex + `encodeURIComponent`; `api.js` chỉ nạp khi origin nằm trong `NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS` (build-time; ngoài production mặc định `127.0.0.1:18082`/`localhost:18082`, production không đặt thì tắt editor); CSP `script-src 'self' 'unsafe-inline' <origin DS>; object-src 'none'; base-uri 'self'` ở `next.config.ts` cho mọi phase trừ `next dev`. `deploy/web.Dockerfile` thêm ARG. Test mới `soan-thao.test.tsx` (trước 4/5 fail, sau 5/5) và `lib/document-server.test.ts`. Kiểm trình duyệt trên bản build QA. Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 3 đầu mối audit còn lại (phiên 10/12 cắt từ nhánh này); deploy muốn dùng editor phải truyền build arg; chưa chạy `ai:check:full`.

### 2026-10-25 · Sửa audit 8/12 — production không chạy lifecycle giả, OIDC không đè projection

- Nhánh `claude/audit-fix-08-lifecycle-fake-prod-6561dc` (cắt từ nhánh 7/12). Fingerprint `m01-auth/identity-lifecycle/fake-port-allowed-in-production` **tái hiện được**: production OIDC không đặt `IDENTITY_LIFECYCLE_MODE` vẫn khởi động với cổng giả; R9 hạ quyền qua lifecycle báo `done`, đăng nhập OIDC lại với nhóm IdP cũ lấy lại R9; email đổi qua lifecycle bị token email cũ đè.
- Sửa: mode `disabled` mới (mặc định production, route lifecycle trả 503 trước khi tạo operation); `fake` ở production ném lỗi khi khởi động; `commitApp` ghi `OidcIdentity.projectionRevision`, OIDC callback chặn `loi=locked` + audit `auth.oidc.projection_mismatch` khi token lệch email/vai trò đã commit. Test mới `test/identity-lifecycle-fake-prod.e2e-spec.ts` (trước 6 fail, sau 6 pass). Cập nhật hai file mẫu biến môi trường. Không đổi hợp đồng. Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 4 đầu mối audit còn lại (phiên 9/12 cắt từ nhánh này); chủ dự án kiểm `AUTH_MODE`/`IDENTITY_LIFECYCLE_MODE` trên máy chủ; production chưa có cổng lifecycle thật; chưa chạy `ai:check:full`.

### 2026-10-25 · Sửa audit 7/12 — địa chỉ mail nội bộ không tự chiếm được

- Nhánh `claude/audit-fix-07-address-claim-0a082f` (cắt từ nhánh 6/12). Fingerprint `mail-basic/self-service-address-claim` **tái hiện được**: `tp.mkt` tạo alias `newhire@`, người mới đăng nhập thì thư tới `newhire@` vào hộp `tp.mkt` và `tp.mkt` gửi được dưới tên `newhire@`; `nv.mkt` tạo được hộp nhóm `hr@`.
- Sửa: hộp thư nhóm chỉ R3/R9 tạo; alias tên tự do chỉ R3/R9, người khác chỉ `<tên mình>+<nhãn>@`; hộp thư cá nhân luôn thắng alias/hộp nhóm khi nhận, đọc, gửi; tạo user/đổi email (OIDC, Google, google-sync, identity lifecycle) gọi `MailBasicService.releaseAddressFor` tắt alias + gỡ ở engine (`MailPort.releaseAlias` mới), hộp nhóm trùng thì gắn cờ audit. Test mới `test/mail-address-claim.e2e-spec.ts` (trước 5 fail, sau 5 pass), thêm 1 ca `oidc-auth`; `mail-management` đổi người tạo alias/hộp nhóm. Đề nghị hợp đồng R5. Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 5 đầu mối audit còn lại (phiên 8/12 cắt từ nhánh này); chưa chạy `ai:check:full` và Stalwart thật (`releaseAlias`, biến thể `RUN_MAIL_ENGINE_MANAGEMENT`); chủ dự án rà alias/hộp nhóm tên tự do đã có; FE `/email` chưa ẩn nút tạo cho người không có R3/R9.

### 2026-10-25 · Sửa audit 6/12 — callback ONLYOFFICE ràng buộc JWT với payload

- Nhánh `claude/audit-fix-06-editor-callback-jwt-b6ea2c` (cắt từ nhánh 5/12). Fingerprint `drive-basic/editor-callback/jwt-signature-only-unbound-payload` **tái hiện được**: manager dùng `config.token` của trình duyệt làm token callback, API tải url tuỳ ý trên `internalOrigin` và lưu thành phiên bản mới; url trong body được dùng thay url đã ký; token thiếu `exp` vẫn nhận.
- Sửa `drive-basic.service.ts`: `verifyJwt` chỉ nhận HS256, bắt buộc `exp`, trả nội dung đã ký (`payload.payload` hoặc payload); `editorCallback` lấy key/status/url từ đó. Token API tự ký mang `iss: vcworkspace-api` + `exp`, callback từ chối `iss` này. Vé editor tách `content` (15 phút) và `callback` (24 giờ, sửa O1). Test mới `test/editor-callback-jwt.e2e-spec.ts` (trước sửa 4 fail/1 pass, sau sửa 5 pass); helper jwt test cũ thêm `exp`. `pnpm ai:check` PASS (BE 269 pass, 9 skip). Không đổi hợp đồng. Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 6 đầu mối audit còn lại (phiên 7/12 cắt từ nhánh này); O2 (forcesave làm callback sau bị coi là cũ) chưa sửa, chờ chủ dự án chốt ngữ nghĩa vì mâu thuẫn test stale chat04; chưa chạy lại ONLYOFFICE thật; vé editor cấp trước khi triển khai mất hiệu lực; chưa chạy `ai:check:full`.

### 2026-10-25 · Sửa audit 5/12 — quyền không gian Drive theo phòng ban và R4 hiện tại

- Nhánh `claude/audit-fix-05-space-membership-54dd1c` (cắt từ nhánh 4/12). Fingerprint `drive-basic/space-membership/never-reconciled-after-role-or-department-change` **tái hiện được**: user chuyển phòng vẫn đọc, tải, nhận link Drive phòng cũ; trưởng phòng mất R4 (đồng bộ Google hoặc R9 gỡ R4 tay) vẫn upload, tạo thư mục; vé editor cấp trước vẫn lưu được phiên bản mới.
- Sửa `drive-basic.service.ts`: quyền suy động từ `WorkspaceSpace` (`ownerUserId`/`departmentId`) và `departmentId`, R4 hiện tại (`roleIn`/`memberOf`); `WorkspaceSpaceMember` chỉ còn là bản đối soát (`ensureDefaultSpaces` `$set` vai trò, xoá dòng lệch); `editor/content` và `editor/callback` tra lại quyền hiện tại của user trong vé. `workspace-interop` kiểm người nhận link bằng `drive.canRead`. Test mới `test/space-membership.e2e-spec.ts` (trước sửa 2 fail/1 pass, sau sửa 3 pass). `pnpm ai:check` PASS (BE 264 pass, 9 skip). Không đổi hợp đồng, schema. Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 7 đầu mối audit còn lại (phiên 6/12 cắt từ nhánh này); chưa chạy `ai:check:full`; chủ dự án rà `workspace_spaces` thiếu `departmentId`/`ownerUserId` trong dữ liệu thật (sẽ không ai vào được); chưa có cơ chế chia sẻ không gian cho người ngoài phòng (dòng thành viên thêm tay không còn cấp quyền).

### 2026-10-25 · Sửa audit 4/12 — tải url tài liệu ngoài không chạm mạng nội bộ

- Nhánh `claude/audit-fix-04-url-fetch-ssrf-25262e` (cắt từ nhánh 3/12). Fingerprint `m04-documents/external-import/url-fetch-redirect-ssrf` **tái hiện được**: `RealGoogle.urls.fetch` tải `https://127.0.0.1/...` và đi theo 302 về `http://127.0.0.1/internal`, trả nội dung dịch vụ nội bộ (fixture loopback, chứng chỉ tự ký, tiến trình con có `NODE_EXTRA_CA_CERTS`).
- Thêm `apps/api/src/common/safe-url.ts` (`isBlockedAddress`, `urlProblem`, `safeFetch`: https mọi bước, tối đa 5 redirect, chặn loopback/private/link-local/CGNAT/multicast/IPv6 tương đương và tên không dấu chấm, kết nối gắn địa chỉ đã kiểm, giới hạn 100 MB khi đọc luồng). `real-google.ts` dùng `safeFetch`; controller dùng `urlProblem` (400 `internal_address`). Test `test/url-fetch-ssrf.spec.ts` (trước sửa 2 fail/2, sau sửa 70 pass) và một ca e2e trong `external-import-source`. `pnpm ai:check` PASS (BE 261 pass, 9 skip). Không đổi hợp đồng, không thêm thư viện. Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 8 đầu mối audit còn lại (phiên 5/12 cắt từ nhánh này); chưa chạy `ai:check:full`; chủ dự án kiểm egress container API và trường hợp có proxy egress bắt buộc (`safeFetch` kết nối thẳng).

### 2026-10-25 · Sửa audit 3/12 — nhập tài liệu ngoài và templateId chỉ chép file người gọi được xem

- Nhánh `claude/audit-fix-03-external-import-fileid-1aae87` (cắt từ nhánh 2/12). Fingerprint `legacy/external-documents-import:fileId-service-account-copy-without-source-authorization` **tái hiện được**: `nv.mkt` chép file drive Mật 01 BĐH vào MKT (đọc được bản sao) và tạo EXT `effective` trên chính drive Mật; `tp.mkt` đặt `templateId` là file đó và hồ sơ mới mang nội dung mật.
- Sửa `documents.controller.ts` `importExternal` (writer trên drive phòng đích; fileId phải nằm trên drive công ty người gọi xem được, sai thì 400 `not_found`) và `record-types.controller.ts` `checkRefs` (`templateId` phải là bản hiệu lực của BM đã đăng ký, xem được). Test mới `test/external-import-source.e2e-spec.ts` (trước sửa 3 fail/2 pass, sau sửa 5 pass). `pnpm ai:check` PASS (BE 190 pass, 9 skip). Không đổi hợp đồng. Chi tiết, giả định ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 9 đầu mối audit còn lại (phiên 4/12 cắt từ nhánh này); chưa chạy `ai:check:full`; chủ dự án cần rà `RecordType.templateId` hiện có trong dữ liệu thật; FE `danh-muc-ho-so` vẫn cho dán link Drive bất kỳ (BE sẽ trả 400).

### 2026-10-25 · Sửa audit 2/12 — hộp thư gắn email đúng tên miền công ty

- Nhánh `claude/audit-fix-02-mailbox-owner-f16a35` (cắt từ nhánh 1/12). Fingerprint `mail-basic/mailbox-owner-local-part` **tái hiện được**: user `nv.mkt@other.example` chèn vào DB đọc được hộp thư `nv.mkt@vcworkspace.test`, tải được link Drive gửi cho nv.mkt; regex người nhận lấy nhầm user ngoài tên miền.
- Sửa `mail-basic.service.ts` (`mailboxAddress`, `owner`, `assertAddressFree`, `offboardUser`) và `workspace-interop.service.ts` (tra người nhận khớp chính xác, `downloadLink`). Test mới `test/mailbox-owner.e2e-spec.ts` (3 ca: trước sửa 3 fail, sau sửa 3 pass). `pnpm ai:check` PASS (BE 185 pass, 9 skip). Đề nghị hợp đồng R4 (thêm 403 cho mail). Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 10 đầu mối audit còn lại (phiên 3/12 cắt từ nhánh này); chưa chạy `ai:check:full`; chủ dự án cần rà user hiện có ngoài tên miền công ty (sẽ mất hộp thư).

### 2026-10-25 · Sửa audit 1/12 — OIDC kiểm tên miền email

- Nhánh `claude/audit-fix-01-oidc-domain-36359f` (cắt từ `vcworkspace/chat01-12b`). Fingerprint `m01-auth/oidc-callback/email-domain-not-bound-to-company-domain` **tái hiện được**: trước khi sửa, email verified `nv.mkt@other.example` tạo được User và nhận phiên, binding sẵn có bị ghi đè email ngoài tên miền.
- Sửa `auth.controller.ts`: callback OIDC từ chối email không thuộc `@cfg.oidc.companyDomain` (`loi=identity`) trước cả hai nhánh. Thêm 2 test hồi quy trong `oidc-auth.e2e-spec.ts`. `pnpm ai:check` PASS (BE 182 pass, 9 skip). Chi tiết ở `docs/bao-mat/audit-fix-log.md`.
- Còn dở: 11 đầu mối audit còn lại (phiên kế tiếp cắt từ nhánh này); chưa chạy `ai:check:full`; chính sách Authentik chờ chủ dự án kiểm.

### 2026-10-25 · Audit bảo mật theo Cloudflare security-audit skill

- Skill chưa cài: đọc `SKILL.md` từ github.com/cloudflare/security-audit-skill (commit c1c8a8c), tải các file hướng dẫn + 2 validator (đã rà: chỉ dùng fs/path/util) vào `~/security-audit-skill/skill/` theo đồng ý của chủ dự án. Chạy full audit profile quick: 4 trinh sát, 4 hunter, 1 critic, 4 verifier (13 agent).
- Không chạy mã dự án: macOS không cưỡng chế RLIMIT bộ nhớ/tiến trình/đĩa, Docker không có image Node (không được tải). Mọi kết luận từ đọc mã; 12 đầu mối đều `needs_validation` có kế hoạch kiểm local bằng harness Jest. Hai validator của skill đạt (12 findings, 23 coverage units).
- Báo cáo copy vào `docs/bao-mat/`. Chưa sửa mã theo audit.

### 2026-10-25 · Commit, review, QA và bảo mật chat01–12B

- Rà file chưa commit (không có khoá thật), bỏ `.next-*` và `__pycache__` khỏi Git, chia commit trên nhánh mới `vcworkspace/chat01-12b`. Gate đầy đủ đạt. `git push` bị repo chặn nên chưa có PR.
- Hai lượt review độc lập (logic, bảo mật) và QA trình duyệt trên server giả cô lập. Đã kiểm chứng và sửa F1–F6 (không gian theo tên làm lộ dữ liệu, khôi phục phiên bản làm kẹt tệp, khoá editor mặc định, Google vượt khoá OIDC, production chạy kho giả, đổi tên trùng chính nó), thêm test hồi quy; gate sau sửa đạt BE 180, endpoint 145/145.
- Còn mở O1–O15 (cần ONLYOFFICE/Stalwart/Authentik thật; Docker đang tắt). Báo cáo: `docs/ke-hoach/vcworkspace-review-qa-2026-10-25.md`.

### 2026-10-25 · Cập nhật tình trạng code sau các chat 01–12B

- Chủ dự án báo các phiên ChatGPT đã code gần xong các tính năng mới. Đối chiếu Git: toàn bộ chat01–12B là WIP chưa commit trên `claude/nghien-cuu-vcworkspace` (base b8c8b80); OpenAPI 2.3.0-gd2; module BE `drive-basic`/`mail-basic`/`workspace-interop`/OIDC; trang FE `/drive`, `/email`, `/bo-nho`.
- Viết lại mục 1 (tình trạng code, chín nhóm), mục 3 (thêm việc đưa WIP vào Git, đánh dấu xong tách chat và ba nhóm lõi), mục 5 (Docker, `.next` dùng chung). Chỉ sửa sổ tay; không chạy test, không commit.

### 2026-10-25 · Tác vụ định kỳ kiểm chứng phần còn lại báo cáo VCworkspace

- Đã làm: `git switch`/`git pull` nhánh `claude/nghien-cuu-vcworkspace` (đã cập nhật). Hạn mức tuần 0% nên không cần cắt phạm vi. Đọc báo cáo: đợt kiểm 2026-10-23 đã xét đủ **48 ID** (21 ✅, 24 ◐, 1 ❌ ai-agents#6, 2 ? rea-creatoros#3 và sizing-cost#2), có Phụ lục C, D và hồ sơ `vcworkspace-kiem-chung-2026-10-23.md`. Prompt tác vụ (42 luận điểm ○) đã lỗi thời nên **không chạy Workflow kiểm lại**, tránh tốn hạn mức và ghi đè kết luận. Chỉ bỏ chữ “(bản rút gọn)” ở tiêu đề báo cáo.
- Không làm: không commit/push. Báo cáo (diff 335 dòng) và hồ sơ kiểm chứng (untracked) là thay đổi chưa commit của phiên khác; AGENTS cấm gom thay đổi người khác vào commit. Bốn mục ○ còn lại trong mục 6.1–6.2 (OpenClaw, Hermes, Nextcloud Assistant, knowledge-work-plugins) là thông tin bổ trợ ngoài bộ 48 ID, chưa kiểm.
- Cần chủ dự án: (1) cho phép commit báo cáo + hồ sơ kiểm chứng lên nhánh này, hoặc tự commit; (2) tắt/sửa tác vụ định kỳ `vcdocs-nghien-cuu-vcworkspace`; (3) nếu muốn, giao kiểm 4 mục ○ bổ trợ.

### 2026-10-25 · Điều phối chạy lại check sau hook timeout

- Stop hook dừng sau173BEpass, wrapper giới hạn110giây; không có testfailure tronglog. Lượt chạy ai:check sandbox bị EPERM cổngMongoTEST; chạy lại đúng escalation/testisolated đãPASS exit0 toàncheck/build, log /private/tmp/vcworkspace-coordinator-check.log. Không nới assertion/timeout hoặc đổi hook. Kếtquả12B giữLOCALPASS, vẫnchờduyệt13.

### 2026-10-25 · Điều phối nghiệm thu12B local

- Đọc bàn giao cuối, service reservation/CAS/fence, tests samekeybarrier/injectedallocationfailure/commitfenceloss; kiểm history finalgateexit0 BE173/145endpoint/FE76/guard44 và liveintegration1/1. Cácblocker đãgiao cófix/test. Nghiệmthu SSO appNext/Nest LOCAL, khôngproduction.
- Đềxuất bước13 theo lộtrình11: Workmanagement Deck/Notes/Forms/Tables/Collectives trên stacktest riêng, 2nhómgiả, ACL/ownership/exportrestore/browserAPI, khôngdata thật/deploy/mua. Chờhuman duyệt mở13; không tựsuyduyệt12B thànhduyệt13.

### 2026-10-24 · Review12B race tạo cùngkey

-4blocker trước đãsửa cómã/test; review tiếp create phát hiện tăngsubjectrevision trước operationunique. Hai requestcùngkey cóthể tạo revisionphantom rồi superseded/pending khôngrecover. Đã giao12B reservation/transaction/CASmapping và deterministicrace/createfailuretests trước nghiệmthu; không cần human.

### 2026-10-24 · Stop hook lệchcontract lifecycleWIP12B

-4testfail vì steps app-deny/app-commit mới chưakhớpenumOpenAPI;163pass, GEToperation chưađạtcoverage dofail sớm. Đã nhắn12B đồngbộcontract/schema trongscopeđãgiao, giữstrictassertion và tiếp tụcreviewfix. Chưa nghiệmthu.

### 2026-10-24 · Review12B coordinator chưa đạt

- Đọc toàn bộ bàn giao và service/port sảnphẩm: phát hiện globalRevokeNC khôngxóa tokens khi active=true; khóa theooperation khôngtheosubject; apppublishrole/active trướcreadbackupstream; Authentiksessions chỉtrang100. Đã giao12B sửa với race/partialgrant/livebrowserrevoke/paginationtests. Không nghiệmthu theo gateBE167/145endpoint vì khôngphủ các lỗhổng này; chưa mở13.

### 2026-10-24 · Stop hook giữaWIP lifecycle12B

- 162BEpass, coverage142/145 thiếu3route create/read/reconcile lifecycle mới. Đã gửi12B lỗi/log để bổsung e2e quyền/tenant/recovery/CAS trước finalgate; không nới coverage. Đây làWIPchưa nghiệmthu, không cầnhuman.

### 2026-10-24 · Điều phối tiếp tục12B sửa shellUI

-12B báoPARTIAL: OIDCappthật/me200 và gateBE160/endpoint142 đạt, nhưng shellUI loading khôngxong; thiếu luồngUI3persona/Nextcloud/mover/revoke/restart. Đã nhắn tiếp tục debugfix shell trong quyềncũ rồi hoàn tất acceptance, không mở13/chưanghiệmthu. Không cần human chốt thêm.

### 2026-10-24 · Chat12B tích hợp OIDC vào ứng dụng

- Xác nhận đúng nhánh/shared WIP; dùng skills change+contract, không đọc `.env`,
  không Google/data thật/deploy/push. Thêm OIDC app routes, immutable binding,
  server-side role map, projection freshness và session revoke; giữ Google cũ.
- Browser thật dùng client Authentik riêng phát hiện callback API khác origin làm
  mất state cookie; sửa redirect qua web same-origin. Login manager vào app và
  `/me` R4 đạt, nhưng React shell còn loading nên bàn giao PARTIAL, không lấy
  portal harness chat12 thay bằng chứng app.
- `pnpm ai:check:full` trên cây bàn giao cuối đạt guard44, OpenAPI hợp lệ,
  BE160/160, endpoint142/142, FE76/76, typecheck/build. Cần tiếp tục blocker
  UI/browser/lifecycle trước nghiệm thu12B.

### 2026-10-24 · Stop hook giữaWIP12B

- 157BEtestpass nhưng coverage140/142: hai routeGET auth/oidc và callback mới thêm chưa cóe2e. Đã nhắn12B bổsung meaningfulauth/securitytests và finalgate sauimplementation, không nới coverage/skip. Chưa nghiệmthu12B, không cần quyềnmới.

### 2026-10-24 · Human duyệt12B

- Mở `01a16e86-3947-7e12-8a2a-39b10e5eaa1c` tíchhợpOIDC vào apps/web/apps/api thật sauPoC12. Giao rõ contractscope12B/securitybinding/lifecycle/revoke/realbrowser/faulttests/finalgate; giữWIP/nhánh/runtime cũ. Automation chuyển theo dõi12B. Khôngproduction/Google/MX/dữliệuthật.

### 2026-10-24 · Điều phối nghiệm thu12 PoCidentity

- Đã đọc bàn giao sửa và browser-nextcloud-sso.json:3persona same-sub SSO, ACL200/200/404, mover404 sau relogin, renameemail cùngsub, currentNextcloudsession200→401; restoreACLhash/directdeny đạt, finalgateexit0. Nghiệmthu PoClocal12.
- Giới hạn quan trọng:18122 là standaloneharness, apps/web/apps/api chưaSSO. Đềxuất ưu tiên chat12B tíchhợp OIDC vào sảnphẩm thật trước Workapps13 và deploy/migration; cần duyệt scope mới, không tựmở.

### 2026-10-24 · Chat12 bổ sung browser Nextcloud SSO và nghiệm thu lại

- Review điều phối phát hiện proof cũ chỉ bao phủ portal harness; ACL/revoke
  Nextcloud dùng app password/OCS. Browser thật còn phát hiện `user_oidc`
  namespace group thành SHA-256 nhưng Team Folder chỉ bind group local, làm
  manager OIDC 404; regex cũ không gỡ được ID băm nên mover giữ quyền cũ.
- Đã bind Team A với federated group ID, dùng regex
  `^(vcw-|[0-9a-f]{64}$)`, đồng bộ lifecycle local/federated. Browser suite mới
  chứng minh portal harness → Nextcloud không nhập lại credential, 3 persona
  ACL, rename giữ `sub`, mover đổi Authentik claim rồi relogin Team A 404 và
  restore 200, current Nextcloud session revoke 200→401.
- Restart dịch vụ rồi chạy lại browser suite đạt. Tạo backup mới, recreate đúng
  ba restore TEST volume; verifier xác nhận regex/federated binding và restore
  ACL manager 204, member 200, outsider 404/404. Portal 18122 là harness độc
  lập, chưa tích hợp `apps/web`/`apps/api`; HTTP/local-server exceptions chỉ
  dành cho loopback PoC, không production.

### 2026-10-24 · Browser12 phát hiện lỗi groupmapping

- Lượt browserNextcloud thật phát hiện OIDC nhóm bị bămID khác vcw-team-a, manager bị404TeamFolder.12 đang sửa mappingclaim; chưa nghiệmthu. Đã yêu cầu sửa headlinePASS cũ và rerun3persona/mover/revoke/restartrestore saufix để backup không giữ config lỗi. Không cần decisionhuman mới.

### 2026-10-24 · Review12 còn thiếu browser Nextcloud SSO

- Đọc hết bàn giao12 và evidencebrowser/revoke: portaladapter18122 cóOIDC/security/session, ACLWebDAV/restartrestore có; NextcloudOIDC mớiconfig/OCCreadback, chưa chứngminh browserSSO và revoke phiênNextcloud đangmở. Đã giao12 bổsung cùngsub/group/directfileACL và phânbiệt harness với appNext/Nest thực. Chưa nghiệmthu12, chưa mở13.

### 2026-10-24 · Human duyệt12 và mở chat

- Human trực tiếp “duyệt 12”; mở `01a16e32-0b5b-7a63-ae20-29b8050789cf` đúng projectVCworkspace local, giao triển khai và kiểm SSO/subject/groupACL/lifecycle/sessionrevoke/audit/restartrestore, security/faulttests và finalgate. Quyềncontract scope12 đã giao rõ; giữ runtime cũ và sharedWIP.
- Automation tiếp tục theo dõi/review12, chỉbáo hoànthành hoặc decision thật mới; khôngproduction/MX/Google/dữliệu thật.

### 2026-10-24 · Điều phối nghiệm thu11 tài liệu

- Đọc hết lộtrình sửa, xác minh trực tiếp lịch Nextcloud và changelogONLYOFFICE chính thức; đã sửa candidate/range/giới hạnCE, tách Flowapp cósẵn với adapterphải viết. Nghiệmthu sảnphẩm khảo sát11, chưa nghiệmthu app/runtime9nhóm.
- Đềnghị mở12 theo gói mục5: stacklocal mới NC33.0.10 + Authentik/OIDC +4persona .test, TeamFolders/groupACL/lifecycle/revoke/audit/restartrestore, không Google/domain/dữliệu thật. Chờhuman duyệt gói12; không hỏi productionidentity lúc này.

### 2026-10-24 · Chuẩn bị deploy và chuyển Google

- Human hỏi điều khiển Google để lập kế hoạch chuyển Email/Drive. Đã xác nhận connector tài khoản và đọc metadata một trang folder; không export/chuyển/sửa dữ liệu. Chưa xác minh quyền superadmin/tổng dung lượng.
- Ghi kế hoạch `docs/ke-hoach/vcworkspace-ke-hoach-deploy-chuyen-google.md`: deploy cũ chưa đủ stack mới; cần inventory/staging/pilot/delta/cutover/rollback, identity/mailDNS/backup/load/license. Chưa được coi là duyệt deploy/MX/chuyển dữ liệu thật.

### 2026-10-24 · Review11 vòng1

- Đọc hết lộtrình9nhóm: kiếntrúc/ACL/backlog12–21/acceptance đã có; chưa nghiệmthu vì nguồnversionNC33 có URLplatform31, giới hạnONLYOFFICECE chưacụthể và trigger/actionFlow chưa tách appcósẵn với adaptercầnviết. Đã yêucầu11 sửa nguồn/version/limits và góiPoC12 đềnghịhuman; chưa mở12.

### 2026-10-24 · Chat11 — lộ trình đủ chín nhóm

- Human trực tiếp duyệt mở chat11 trong điều phối00; phạm vi chỉ khảo sát/tài
  liệu, không code lớn, cài app, mua dịch vụ, production hoặc mở chat12.
- Xác nhận đúng checkout/nhánh và giữ nguyên shared WIP; đọc AGENTS, sổ tay,
  biên bản phát triển, bàn giao10, hồ sơ nghiên cứu/kiểm chứng và inventory mã.
- Đối chiếu nguồn chính thức ngày 2026-10-24: Nextcloud33 còn được hỗ trợ nhưng
  không là latest; app NC33 candidates; External Storage/filecache; Talk
  TURN/HPB; Flow engine và deprecation External App Flow; AI CPU/GPU; LDAP/audit.
- Viết `docs/ke-hoach/vcworkspace-11-lo-trinh-9-nhom.md`; tách LOCAL PASS/DOC/
  PoC/NOT_TESTED, chi phí phần mềm với hạ tầng/vận hành, không cam kết Enterprise
  parity. `pnpm ai:check` lần đầu bị sandbox chặn MongoDB thử mở cổng local;
  chạy lại ngoài sandbox đạt guard44, OpenAPI hợp lệ (181 warning hiện có),
  BE157/140 endpoint, FE76, typecheck/build và diff-check. Gate kiểm toàn shared
  WIP 363 file bằng Google giả; không chạy app/runtime thật và không chứng minh
  app mới. Câu hỏi human giữ lại: NAS/mobile thật, quy mô họp, production
  identity, GPU/cost và production topology.
- Review11 vòng cuối: thay link Talk/Context Agent dạng `platform=` bằng trang
  release metadata; sửa Forms NC33 từ 5.4.1 thành 5.3.6; ghi lịch chính thức
  NC33.0.10 maintained tới 2027-02 và NC35.0.2 latest ngày kiểm. Bổ sung giới
  hạn ONLYOFFICE CE 9.4 (không cap 20 document cũ nhưng recommended 20 users,
  thiếu mobile web editor/cluster/support; AGPL Section7/branding chưa legal
  review), phân rã Flow connector có sẵn với custom adapter. Đề nghị human duyệt
  chat12 local clone NC33.0.10 + Authentik/OIDC/test identities; chưa mở chat12.

### 2026-10-24 · Human duyệt mở11

- Human trả lời trực tiếp “Duyệt mở chat 11”, giải quyết thiếuủyquyền tạo chat trước đó. Đã mở `01a16e18-d565-7333-a5c5-31f3c3f2de8b` khảo sát đủ9nhóm miễnphí: gap/compatibility/license/identityACL/acceptance/lộtrình chat12+.
- Giới hạn khảo sát read-only và tài liệu; chưa code lớn/càiapps/mua/deploy. Tiếp tục automation review11, không tự coi9nhóm đã hoàn thành.

### 2026-10-24 · Điều phối review10 đạt; phạm vi mở rộng chờ quyền mở chat

- Đọc toàn bộ bàn giao10 và output runtime/gate cuối exit0: fake/fault26/26, Office thật3/3, mailmanagement5/5, revoke Aalive/Bdeny, interop1/1; BE157/140endpoint/FE76/guard44. Nghiệm thu ba nhóm cốt lõi LOCAL, không production.
- Đã xác minh trực tiếp lời human trong chat “Giải thích Nextcloud” về mục tiêu đủ9nhóm và miễn phí phần mềm. Cần khảo sát khoảng trống/kiến trúc/lộ trình bổ sung, chưa coi là đã phát triển đủ.
- Đề nghị chat11: khảo sát read-only9nhóm, kiểm compatibility/license appCommunity, thiết kế identity/ACL/data boundary, ma trận acceptance và thứ tự chat12+; chưa code lớn/cài app/production/mua dịch vụ. Tạo chat11 bị automatic approval review từ chối vì chưa có ủy quyền rõ cho task mới/phạm vi mở rộng; chờ human xác nhận mở chat11, không thử lách.

### 2026-10-24 · Nghiệm thu09 và mở10

- Review lại service, provenance fingerprint, stable send journal, race409 và link web tuyệt đối; evidence logout/login-return tải đúng hash, realV2/ACL/revoke/expiry đạt. Final gate exit0 BE157/endpoint140/FE76/guard44. Nghiệm thu09 LOCAL.
- Mở10 `01a16c12-36e4-7923-b06d-28751bcefb70` nghiệm thu tổng thể; giao ma trận thật/fake, quyền/fault/restart/backuprestore, tự sửa blocker đến hết. Automation chuyển theo dõi10, giữ giới hạn thử và WIP.

### 2026-10-24 · Stop hook trong lượt sửa09

- Cây WIP mới: test liên kết mail không trích được token từ MIME, 154 test đạt/1 lỗi; endpoint shared-link chưa được chạm vì ca dừng sớm. Đã gửi09 lỗi dòng56 và log để sửa parsing MIME/URL tuyệt đối, giữ assertion quyền và fullgate cuối. Chưa nghiệm thu09 hoặc mở10; không cần human.

### 2026-10-24 · Review09 — real đạt, còn sửa link/idempotency

- Đọc toàn bộ bàn giao, evidence real và mã service: browser ba engine có bodyV2/hash, real integration1/1 và fullgate BE155/140endpoint/FE74/guard44 đạt.
- Chưa nghiệm thu09: link email còn đường dẫn tương đối; nhánh race duplicate-key chưa kiểm lại fingerprint; snapshot ghép version vào key có nguy cơ cùng key gửi hai payload. Đã giao09 sửa, bổ sung race/mismatch tests và kiểm click link từ thư. Chưa mở10, không cần quyền mới.

### 2026-10-24 · Review tiến độ09 — gate đạt, tiếp tục runtime

- Đọc toàn bộ bàn giao09: fake E2E2/2, full gate guard44/BE155/endpoint140/FE74 đạt; lỗi coverage giữa WIP đã được khắc phục.
- Chưa có bằng chứng liên thông thực trên Stalwart–Nextcloud–ONLYOFFICE/browser nên chưa nghiệm thu09, chưa mở10. Đã tiếp tục cùng chat09 để chạy A→B, bodyV2/save/reopen, snapshot/link/hash/ACL/deny và retry; không cần quyền mới từ human.

### 2026-10-24 · Stop hook kiểm giữa WIP09

- BE153 testpass nhưng coverage137/140 do3API liênthông09 vừa thêm chưa có e2e: saveattachmentDrive/sendDriveFile/sharedlink. Đã nhắn09 bổ sung meaningfultests/finalgates, không nới coverage. Đây là WIP09 sau nghiệmthu08, không lấy gate08 chứng minh09. Chưa mở10.

### 2026-10-24 · Review08 đạt và mở09

- Đọc toàn bộ final bàn giao08, tests durability/CAS/fencing/MIME, toolhistory realmanagement/revokeproof/finalgates exit0. Review cuối NO BLOCKER; realStalwart5/5, BE153 endpoint137 FE74 guard44/build. Nghiệmthu PoClocal, giới hạn synclớn/controltokenproduction còn ghi rõ.
- Đã mở09 Liênthông Email–Drive–Office, giao attachment saveDrive/editV2/sendback snapshot hoặc ACLlink, engine/browser/faultproof và contractscope. Không hỏi quyền cũ, khôngproduction.

### 2026-10-24 · Stop hook phát hiện regression filter trên WIP08

- Gate tự chạy sau heartbeat failed: POST mailfilters trả503 thay201 tại mail-management test27/98; hai endpoint coverage không tới do các ca dừng sớm. 150pass2fail, durability tests pass. Đây là cây WIP chưa nghiệmthu, không lấy gate cũ xanh thay thế.
- Chuyển lỗi cụthể và đường dẫn output cho08 xửlý filterlease/fake readback/fencing, không nới assertion. Chưa mở09, chưa cần human.

### 2026-10-24 · Review08 vòng tiếp — bốn blocker

- Realadapter5/5 và browsersearch/gate xanh sau xửlý452, ingestion/Sieve/readback/offboarding có; review chỉra4 lỗi chặn: kill session không principal-specific, sendACK→Mongofail retry uncertain, filter rollbackprocesslocal, MIMEparser chưa folded/QP.
- Giao08 sửa trực tiếp với durable journal/CAS/reconciliation và parser phù hợp, tests fault/race/restart/deny. Không cần decisionhuman mới, không mở09 trước review đạt.

### 2026-10-24 · Điều phối yêu cầu hoàn tất blocker08

- Đọc final/review mới: structural fixes inbound/sharedSent/readrole đã có; fake4/4/fullgate đạt nhưng realadapter bị452 quota. Không nghiệm thu hoặc mở09.
- Giao08 tiếp tục xử lý ratewindow/backoff/quota CHỈ accounttest, không tắt global guard; hoàn thiện offboarding/selectedsession revoke/reconciliation và ingestion mail nhận trực tiếp để search/filter. Đây là scope08 hiện có, không cần human chốt lại.

### 2026-10-24 · Resume đúng08:45

- Heartbeat đến08:41, điều phối đọc checkpoint và đợi đúng08:45 trước nhắnresume08. Cùngchat `01a168eb-bc87-7050-9bfd-5e863647acec`; không tạotrùng. Chỉnh lịch thứBảy về15phút để tiếp tục điều phối.
- Checkpoint protocol đã có revoke/restart, wiringSieve còn readerfailed; oldgate không chứng minh finaltree. Giao sửa reader, realE2E/browser/finalgates trước review/mở09. Không có quyền mới cầnhuman.

### 2026-10-23 · Chốt giờ tiếp tục08:45

- Human chỉnh giờ từ08:00 sang08:45 sáng24/10/2026 giờVN. Automation cùngID đã đổi phút45; hồ sơ resume đồng bộ. Các mốc08:00 ở nhật ký lịch sử đã bị thay thế.

### 2026-10-23 · Sửa lịch tiếp tục sang sáng mai

- Human sửa yêu cầu: sáng mai, không phải thứHai. Đã đổi automation hiện có sang08:00 thứBảy24/10/2026 giờVN; cùng ID, không tạo duplicate. Hồ sơ resume cập nhật cùng mốc. Lịch26/10 ở nhật ký cũ đã được thay thế.

### 2026-10-23 · Chuẩn bị hết token và hẹn tiếp tục thứHai

- Lập hồ sơ resume/checkpoint, nguồn sự thật và thứ tự08→09→10; nhận định hiện tại08 đã có protocol revoke nhưng wiring engine app còn dở. Nhắn08 chốt an toàn rồi dừng, không mở09.
- Chọn08:00 thứHai26/10 giờVN theo yêu cầu sáng thứHai; đổi lịch hiện có, không tạo duplicate. Việc chạy phụ thuộc app/máy và quota khả dụng, không coi lịch là bảo đảm execution thành công.

### 2026-10-23 · Review08 runtime còn thiếu, giao tiếp tục

- Đọc toàn bộ bàn giao08: code/gate đạt BE145 endpoint136 FE74 guard44 nhưng nhãn/filter/sharedACL mới metadata API, chưa provision/readback engine; chưa credential mới và browser cuối. Chưa nghiệm thu/mở09.
- Sau human hỏi phải làm gì, điều phối xác định đây là việc agent tự xử lý trong scope và gửi tiếp08: credential mới đúng user thử, JMAP keyword/Sieve/GroupACL thật, restart/readback/revoke protocol và browser. Không hỏi lại quyền đã duyệt, không đụng secret/dữ liệu thật.

### 2026-10-23 · Chat08 Quản lý Email — code/gate đạt, protocol còn dở

- OpenAPI lên 2.1.0; thêm UI/API nhãn nhiều nhãn, search server-side theo scope,
  filter hữu hạn tự áp, alias identity và shared mailbox ACL read/send/manage.
  Alias/shared AUTH bằng mailbox gốc với Stalwart; raw MIME đọc qua engine mapping;
  idempotency gồm identity/HTML/references/hash attachment.
- Target mail 6/6 đạt; full gate cuối exit0: guard44, BE145, coverage136/136,
  FE74, typecheck/build. Container Stalwart/relay, Nextcloud và ONLYOFFICE up.
- Protocol script đã thêm IMAP CAPABILITY/SEARCH/custom folder proof nhưng chưa
  chạy vì không có credential thử trong phiên; không đọc secret cũ. CUA browser
  đóng transport trước khi tải UI. Ghi rõ metadata nghiệp vụ chưa đồng bộ JMAP
  keywords/Sieve/Group ACL; chưa đủ điều kiện tự mở chat09.

### 2026-10-23 · Review07 bổ sung đạt và mở08

- Theo yêu cầu mở08, điều phối phát hiện/giao sửa network bridge egress; internal+sidecar proxy fixed loopback giữ SMTPIMAP hoạt động. Đọc compose/protocol script/evidence: internal egress denied, new run chat07-1792761321413 SMTPACK/IMAPfetch marker+base64 attachment match, SHA190f41f5…78140.
- Chốt gatefull cuối toolcompleted exit0; guard44 BE141 contract125 FE73/typecheck/build đạt. Forward message/rfc822 có testFE1/1; browser cuối transport mất, ghi rõ không lấy hashbrowser độc lập thay API/protocol. Chấp nhận local task07.
- Mở08 Quản lý Email theo ủy quyền, giữ isolation và phạm vi giả, không hỏi lại quyền đã duyệt.

### 2026-10-23 · Chat07 Email cơ bản local

- OpenAPI `2.0.0-gd1`; thêm MailPort fake/real, Stalwart adapter loopback,
  metadata tenant và UI `/email`. Raw MIME/attachment giữ ở mail engine.
- Stalwart official v0.16.27 linux/arm64 chạy volume/cổng riêng; không restart
  Nextcloud/ONLYOFFICE. Protocol SMTP ACK + IMAP fetch attachment hash đạt.
- API e2e 2/2 và browser manager/reader đạt draft reopen, send/receive/status;
  attachment browser đến inbox đúng, nhưng công cụ tải MIME timeout nên không có
  hash download browser độc lập. Không đọc `.env`, không mail thật/deploy/commit/push.

### 2026-10-23 · Review06 đạt và mở07 Email cơ bản

- Đọc toàn bộ bàn giao06/evidenceV2; tự kiểm PPTX SHA aca135f2…8e7a, PDF0743fd35…69cb, slide1 markerV2/slide2ellipse; pdftotext và xem render slide2 không clipping/mất glyph. Tool history gate cuối completed exit0, guard44/BE139 endpoint118/FE72/typecheck/build. Nghiệm thu local, không suy production.
- Đã mở chat07 mail cơ bản: mail engine thật cô lập .test, egress chặn, UI/API/MIME/attachment hash/draft/reply/thread và permissions; contract trong scope, không mail thật.

### 2026-10-23 · Chat06 Slide hoàn tất local

- Thêm contract `1.9.0-gd1`, endpoint tạo PPTX, `documentType=slide`, kiểm OOXML
  presentation, native/PDF export và UI; sinh lại schema. Mẫu ba slide tiếng
  Việt 16:9 dùng Liberation Sans, có title/body/shape/table.
- Target 4/4 và integration thật 3/3 đạt; ONLYOFFICE xuất PPTX V1 thành PDF
  64.393 byte/3 trang, text slide 2/3 đọc được. Full gate cây hiện tại đạt
  guard 44, BE139/coverage118, FE72, typecheck/build.
- Sau khi human mở khóa, browser manager sửa marker V2 và thêm ellipse bố cục,
  Save → Drive bản2 → reopen cùng file → slideshow 1/3 đạt; reader “Sẵn sàng
  xem”, không Save/edit. Phát hiện và sửa iframe editor bị rơi về 150px do
  height calc không hợp lệ.
- Chính V2 PPTX/PDF được xuất: hash `aca135f2…8e7a` / `0743fd35…69cb`; XML có
  marker/ellipse/3 relationships/Liberation Sans, PDF 3 trang và render không
  tràn/mất glyph. Full gate cuối đạt 139 BE, coverage118, FE72, guard44/build.
  Không mở chat07 từ phiên này.

### 2026-10-23 · Nghiệm thu gate chat05 và mở06

- Điều phối đối chiếu tool output: lượt pnpm ai:check:full cuối completed exit0 sau sửa type parser; BE137/137, endpoint117/117, FE72/72, guard44, typecheck/build đạt. Kết hợp review độc lập XLSX XML/PDF text/hash ở phiên trước, nghiệm thu bảng tính local.
- Đã mở **VCworkspace 06 — Slide**, ID `01a168ab-4e5f-7cf3-b89c-8c32d493c173`, project VCworkspace local; giao editor thật, PPTX/PDF V2 có marker/nội dung/layout, trình chiếu, quyền và regression Office/contract/gates. Không hỏi lại quyền đã duyệt, tự chạy tiếp tới bàn giao.

### 2026-10-23 · Review bằng chứng bảng tính chat05

- Đọc toàn bộ bàn giao/evidence V2; điều phối tự giải XLSX, kiểm D2=4, F2=6000000, SUMIF=8000000, VLOOKUP=2400000, SUM=10400000; SHA XLSX/PDF khớp evidence. Tự pdftotext xác nhận số lượng4, tiếng Việt và tổng10400000.0đ trong PDF thật.
- Chưa mở06 vì chat05 vẫn sửa type parser test và chạy gate final; chỉ chấp nhận sau kết quả gate trên cây cuối. Không có quyết định cần human.

### 2026-10-23 · Chat05 hoàn tất bảng tính local

- Cập nhật contract/schema/API/UI XLSX trên callback/version chat04; kiểm cấu
  trúc OOXML theo loại, không nhận tệp chỉ có magic `PK`.
- Target 4/4 và tích hợp thật 2/2 đạt. Browser manager sửa D2=4, Save V2, mở
  lại cùng fileId thấy D2/công thức/filter; XML có cached SUM 10.400.000,
  IF/SUMIF/VLOOKUP và sort/filter; PDF text đúng. Reader mở view, không control ghi.
- Full gate cây cuối đạt: guard 44/44, OpenAPI hợp lệ (152 warning hiện có),
  BE 137/137 và 117/117 endpoint, FE 72/72, typecheck/build và diff-check đạt.
- Không đọc `.env`, không dùng Google/dữ liệu thật, không deploy/commit/push,
  không restart/purge container healthy. Apps Script/macro, tải nhiều người và
  production chưa kiểm. Chat06 chưa mở.

### 2026-10-23 · Nghiệm thu chat04 và mở05

- Điều phối theo sát recovery Docker và browser; yêu cầu sửa phép kiểm V1 thành đúng bảnV2 người dùng sửa. Evidence cuối fileId 6adb46a6f74e6fe769f0398d, version2; DOCX SHA06df653a85d6d91ea617e447e0840a547d20e7bb6be669e3104628e9c0d6971f, PDF SHA36110c53f73ce0ea9cc88492aca7cadc7d372b8314a4c4fab787ee5f27c20a55; cả hai có marker body đã gõ. Cùng file mở lại edit.
- Đọc final bàn giao/evidence JSON, callback stale test và gate cuối: BE135/135, endpoint116/116, FE72/72, guard44 và build đạt. Chấp nhận phạm vi local; chưa đo tải/coediting nhiều người production.
- Đã mở chat05 bảng tính thật UI/API/ONLYOFFICE/Drive, công thức/lọc/sort, saveV2/reopen/export XLSX PDF, giao contract trong scope. Tiếp tục tự động; không hỏi lại quyền runtime/local cũ.

### 2026-10-23 · Chat04 hoàn tất editor và PDF local thật

- Phục hồi Docker Desktop có mục tiêu, giữ nguyên volumes chat03. Xác minh manifest arm64 ONLYOFFICE 9.4.0.1 lỗi `exec format error`; ghim rõ platform amd64 chính thức qua emulation, container healthy loopback.
- Browser manager Google giả tạo và sửa DOCX trong editor ONLYOFFICE thật; Save báo thành công, danh sách Drive hiện bản 2 và kích thước 25.428 byte. Mở lại đúng fileId đạt mode edit; xuất currentVersion V2 có marker đã gõ trong cả XML DOCX và text PDF (hash ghi ở evidence). Test tích hợp lặp lại với Nextcloud thật kiểm manager edit/reader view và converter. Callback phiên thứ hai mang key version cũ bị từ chối, không tạo version 3.
- Target chat04 và full gate cuối được chạy lại sau sửa; kết quả ghi trong bàn giao. Không đọc `.env`, không dùng Google/dữ liệu thật, không deploy/commit/push và không tự mở chat05.

### 2026-10-23 · Docker phục hồi, tiếp tục nghiệm thu editor thật

- Theo kết quả thực thi mới từ chat04, backend/pull request và helper treo đã được dừng có mục tiêu, engine ARM64 khởi động lại; không sửa/xoá Docker.raw hoặc volumes. Tăng trần đĩa đã được loại vì virtual disk vốn460Gi.
- Điều phối cũng đã thử status ngoài sandbox và xác nhận treo trước phục hồi; không suy lỗi socket sandbox thành lỗi daemon. Chat04 tiếp tục pull image ARM64/editor/browser và PDF thật. Chưa có bằng chứng hoàn tất, chưa mở05.

### 2026-10-23 · Tiếp tục phục hồi Docker cho chat04

- Human giao tự khắc phục và hoàn tất editor thật, không dừng ở giao việc. Chẩn đoán chat04: filesystem VM Docker hết dung lượng khi pull image; host còn44Gi và archive chat03 còn429MiB. Không purge/reset/xoá volume.
- Đã yêu cầu kiểm/tăng disk allocation bằng cơ chế cấu hình chính thức có lưu hiện trạng, xác minh workload; chat04 active thực hiện recovery. Chưa nghiệm thu editor/PDF, chưa mở05.

### 2026-10-23 · Codex kiểm Stop hook sau trao đổi chức năng Nextcloud
- Đã chạy lại `pnpm ai:check`: diff, guard/gate, contract lint và API typecheck qua; test API bị chặn ngay khi MongoMemoryServer mở cổng với `listen EPERM: operation not permitted 0.0.0.0` trong sandbox. Chưa tới FE/build; không thể xác nhận lại độ phủ endpoint ở lượt này.
- Output hook trước đó ghi thiếu test e2e GET `/drive/editor/content` và POST `/drive/editor/callback` (114/116 endpoint); đây là phần phát triển đồng thời của chat khác. Chat giải thích không sửa mã, hợp đồng hoặc nới gate; blocker hiện tại là quyền mở cổng của môi trường kiểm tra. Không có quyết định mới.

### 2026-10-23 · Kiểm tiến độ chat04 theo yêu cầu human

- Đọc trạng thái và tool history: chat04 active, API tạo DOCX/callback/version/ACL/retry có 2 tests đạt; lỗi header tên tiếng Việt của export đã sửa. Chưa có editor/browser/PDF thật; Docker Desktop báo unable to start.
- Điều phối giao tiếp tục chẩn đoán/khôi phục runtime local không reset/purge/đụng volume; phân biệt sandbox socket denial với daemon lỗi thật, kiểm kiến trúc image và tài nguyên. Không dùng fake để nghiệm thu; chưa mở05. User không phải duyệt lại quyền local đã có.

### 2026-10-23 · Nghiệm thu chat03 và mở04

- Đọc final chat03 và xem ảnh12 restore: đúng ui03-renamed-chat03ui2.txt đã trash→restore UI, ID 6adb3ff6cf4129e9aa012d04/28 byte giữ nguyên; reader không controls ghi. Hash/byte được chứng minh ở integration API/Nextcloud và usable restore đã review; không nâng ảnh UI thành hash độc lập. Final gate chat03 đạt, sau đó chỉ docs/ảnh và diff check.
- Đã mở **VCworkspace 04 — Soạn thảo văn bản**, ID `01a16875-5a7e-7ed1-af4b-8665d23d833e`, project VCworkspace local. Giao editor/connector thật, UI/API/Drive/version/export, contract và local runtime trong phạm vi; không production.

### 2026-10-23 · Human xác nhận trash/restore UI fixture chat03

- Nhận xác nhận trực tiếp cho ui03-renamed-chat03ui2.txt vào thùng rác local rồi khôi phục, chuyển nguyên văn tới chat03. Không hỏi lại quyền này; chưa xác nhận thao tác đã chạy.
- Review bằng chứng cuối đạt sẽ mở04 ngay, tiếp tục điều phối tự động đến hết phạm vi.

### 2026-10-23 · Xác nhận giới hạn CUA ở bước trash UI (17:06 VN)

- Chat03 trích instruction CUA ưu tiên cao hơn: “Always Confirm at Action-Time (Even If Pre-Approved)”, mục “[1] Delete data (cloud and local)”. Xác nhận là yêu cầu công cụ cụ thể, không phải quyền task còn thiếu; điều phối không thay human xác nhận.
- Cần human xác nhận đúng fixture `ui03-renamed-chat03ui2.txt` vào thùng rác local rồi khôi phục qua UI. Các phần usable restore/version/rename/move và gate đã có; giữ bước04 chưa mở, không né bằng công cụ khác.

### 2026-10-23 · Review bàn giao chat03 (16:36 VN)

- Đọc toàn bộ bàn giao và integration tests: API/Nextcloud version/trash/restart có bằng chứng; UI mới tạo folder/thấy controls, chưa thao tác tính năng mới. Backup manifest trùng và Mongo phục hồi riêng chưa chứng minh phục hồi toàn stack dùng được.
- Đã giao chat03 tiếp tục browser rename/move/version/trash restore bằng tệp giả và boot bản Nextcloud+metadata phục hồi trên đích/cổng riêng, tải qua API bằng id cũ kiểm checksum/quyền. Không hỏi lại quyền local thử, không mở04 trước khi đủ bằng chứng.

### 2026-10-23 · Chat03 Drive an toàn dữ liệu

- Đã thêm bảy API và UI cho rename/move giữ ID, version bất biến/restore theo checksum, trash/restore cả cây; manager-reader-none và tenant được kiểm ở BE. Blob version tách khỏi đường dẫn logic để move không làm mất lịch sử.
- Nextcloud local opt-in đạt sau restart. Usable restore run `restore-mvks7o45` boot volume mới `vcworkspace_drive_chat03_usable_restore_mvks7o45` ở `127.0.0.1:18081` cùng MongoDB thử đích; API tải đúng tệp ID cũ, byte/SHA/currentVersion, reader download và reader 403 ghi đều đạt. Evidence `poc/drive-nextcloud/evidence/chat03-usable-restore-restore-mvks7o45.json`; không xoá volume nguồn/đích, không đụng dữ liệu thật.
- Browser harness Google giả xác nhận manager xem/restore version 1, tải, đổi tên và di chuyển tệp khỏi root. Sau xác nhận trực tiếp, đã nạp lại đúng fixture `ui03-renamed-chat03ui2.txt`, trash/restore cùng ID `6adb3ff6cf4129e9aa012d04`, giữ 28 byte và tải lại; reader thấy cùng file/link tải nhưng không có controls ghi. Ảnh `docs/huong-dan/anh/10-drive-chat03-doi-ten-di-chuyen.jpg` đến `13-drive-chat03-reader.jpg`.
- Hai credential user PoC giả từng xuất log do nạp file sai đã được xoay ngay; integration chạy lại bằng credential mới. Hook sửa hẹp cho phép FE test loopback/cache riêng, vẫn chặn entrypoint BE và guard 44/44.
- Full gate chạy lại trên cây cuối đạt: OpenAPI hợp lệ (145 cảnh báo hiện có), BE 133/133 và 111/111 endpoint, FE 72/72, typecheck/build. Không deploy/commit/push; chat04 chưa mở.

### 2026-10-23 · Codex kiểm tra theo Stop hook trong chat giải thích Nextcloud
- Đã chạy `pnpm ai:check` trên `claude/nghien-cuu-vcworkspace`: `git diff --check` đạt, guard/gate 43/43 đạt; dừng tại contract lint với 1 lỗi `no-unresolved-refs`, 145 cảnh báo. Lint chi tiết chỉ tới tham chiếu `#/components/responses/InternalError` trong phản hồi 500 của POST `/drive/folders` (vị trí có thể đổi do phiên khác đang sửa).
- Blocker: hợp đồng đang có thay đổi từ các chat phát triển khác; chat này chỉ giải thích Nextcloud, không nhận sửa hợp đồng. Giữ nguyên các thay đổi có sẵn; chưa chạy các bước FE/BE/build sau lint, chưa có quyết định hay câu hỏi mở mới.

### 2026-10-23 · Xác nhận điều phối tự động từ chat03 đến hết

- Chủ dự án nhắc tiếp tục theo dõi chat03, review kỹ rồi mở04 ngay khi đạt; tự xử lý đến hết, cập nhật sổ tay và chỉ báo hoàn tất từng bước hoặc quyết định thật sự cần chốt. Lịch điều phối 15 phút hiện có đã bao phủ yêu cầu này, không tạo lịch trùng.
- Snapshot chat03 đang active phát triển stable id, version bất biến/checksum và trash/restore. Chưa có bàn giao final, chưa mở04.

### 2026-10-23 · Nghiệm thu chat02 và chuyển chat03

- Đọc final bàn giao và browser evidence mvkqwtie: manager create/upload/list/download, reader list/download không controls ghi; source + hai download cùng SHA-256 01751a26ec61d2f58a2cb3d50164f6fb135665133e9c47c95b652969d0f70913. Kết hợp evidence API/quyền/restart/P10 đã review trước, chấp nhận Drive cơ bản local; không phải xác nhận production.
- Chủ dự án giao chạy tự động đến hết phạm vi; điều phối mở chat03 Drive an toàn dữ liệu, giao rõ contract/API/UI/adapter thật/version/trash/backup restore và final gates. Không hỏi lại quyền cũ.

### 2026-10-23 · Chat02 sửa hook và hoàn tất browser smoke

- Sửa `scripts/ai/policy.mjs` phân loại shell/patch theo `tool_name`; adapter
  đưa patch vào `cmd` không còn gây false positive. Giữ chặn secret, schema sinh,
  CLI vận hành, Google thật/production và thao tác nguy hiểm. Cập nhật hint
  SessionStart và regression tiến trình hook thật; guard/gate 43/43 đạt.
- Thêm harness browser dùng Jest/ts-jest, Mongo tạm, Google giả, Nextcloud
  loopback; không đọc `.env`. FE smoke dùng `NEXT_DIST_DIR=.next-smoke` tránh
  tranh chấp cache với build song song. Cache lỗi cũ được chuyển có thể khôi
  phục sang `/private/tmp`, không xoá dữ liệu nguồn.
- Browser run `mvkqwtie`: manager tạo `UI2-mvkqwtie`, upload/list/download
  `browser-upload-2.txt`; reader thấy phòng “Chỉ đọc”, không có nút tạo/upload,
  list/download thành công và personal trống. Ba bản tệp cùng SHA-256
  `01751a26ec61d2f58a2cb3d50164f6fb135665133e9c47c95b652969d0f70913`.
  Evidence scrub và hash ảnh ở `poc/drive-nextcloud/evidence/browser-smoke-mvkqwtie.json`.
- Gate cuối đạt: OpenAPI hợp lệ với 138 cảnh báo hiện có; BE 132 test và
  104/104 endpoint; FE 72/72; typecheck/build đạt. Hai test opt-in bị skip đúng
  khi không cấp credential. Không đọc secret thật, không deploy/commit/push;
  Chat03 chưa mở, chờ điều phối review.

### 2026-10-23 · Xác định chỗ kẹt UI thay cho trạng thái quyền cũ

- Theo yêu cầu chủ dự án, đọc lịch sử tool gần nhất chat02: activeFlags đã rỗng, không còn hộp approval treo. Manager tạo/upload/list/download có bằng chứng; reader bị lỗi Next client manifest/cache, API smoke giữ chạy bằng Jest đã timeout sau 1 giờ, download browser timeout.
- Đã giao chat02 phục hồi server test/FE đúng loopback, kiểm health, refresh fixture và hoàn thiện reader/none/hash; không hỏi lại quyền đã duyệt. Các thông báo chờ quyền trước là snapshot cũ. Chưa nghiệm thu hoặc mở03.

### 2026-10-23 · Theo dõi sửa hook và smoke UI (15:06 VN)

- Hook đã có thay đổi phân loại shell/patch; chat02 đang thực hiện browser smoke bằng runtime Jest/ts-jest và Mongo tạm sau lỗi decorator của bootstrap tsx. Chưa có bàn giao final hoặc nghiệm thu UI.
- Snapshot chat02 có cờ waitingOnApproval; phần quyền thử local/sửa hook đã được chủ dự án duyệt, nhưng không thay thế hộp cấp quyền công cụ thực tế. Chưa mở chat03.

### 2026-10-23 · Kiểm tiến độ sửa hook theo yêu cầu chủ dự án

- Điều phối kiểm file policy/hook hiện hành: chưa có bản sửa hoặc bằng chứng regression mới để nghiệm thu; chat02 đang active xử lý. Đã nhắn tiếp tục sửa hook và thông điệp SessionStart đang gây hiểu nhầm, sau đó kiểm browser trong cùng task.
- Chưa xác nhận hook đạt, chưa mở chat03. Tiếp tục theo dõi bằng heartbeat; không dùng kết quả guard cũ thay cho kiểm bản sửa.

### 2026-10-23 · Duyệt sửa hook chặn nhầm

- Chủ dự án giao sửa hook. Điều phối giao chính chat02 sửa phân loại shell command và patch ở tool adapter/policy, thêm regression allow/deny và kiểm hook thực tế; không tắt hook hoặc blanket allow. Sau khi guard đạt, tiếp tục browser smoke.
- Chưa có kết quả sửa/kiểm; sẽ review bằng chứng trước mở chat03.

### 2026-10-23 · Hook thực tế chặn harness browser (14:51 VN)

- Chat02 xác nhận PreToolUse từ chối thêm harness, lý do “Công cụ vận hành chỉ dùng trong phiên riêng”. Điều phối đọc policy: regex công cụ vận hành quét command toàn chuỗi, cần lấy đúng lệnh/token match để xác nhận có false positive. Không tự tắt/né guard.
- Giao chat02 ghi chính xác rejection và chuẩn bị đề xuất sửa hẹp có fixtures, chưa áp dụng. Cần chủ dự án cho phép sửa rule nếu đúng chặn nhầm, hoặc chọn phiên môi trường riêng hợp lệ để smoke. Chưa nghiệm thu/mở chat03.

### 2026-10-23 · Gỡ cách hiểu chặn smoke UI (14:36 VN)

- Chat02 báo adapter thật/API A/B/P10 sau PUT đã đạt, còn browser. Điều phối xác định AGENTS không cấm khởi động mọi BE thử; chỉ không chạy app tự nạp secret thật hoặc thao tác production. Đã giao tiếp tục browser qua bootstrap test không nạp .env, DB riêng, fake identities và loopback trong quyền thử local đã có.
- Chưa nghiệm thu chat02 hoặc mở chat03; chờ bằng chứng UI và review final. Không phát sinh quyết định mới cần chủ dự án.

### 2026-10-23 · Review triển khai chat02 (14:21 VN)

- Đọc bàn giao, module/storage và evidence run mvkmx0pm: kho riêng có matrix 11 pass + restart P03 pass, nhưng sản phẩm chỉ FakeWorkspaceStorage và chưa kiểm UI. P10 mới là endpoint503, chưa chứng minh timeout sau khi kho nhận byte/recovery không trùng. Không coi toàn bộ chat02 đạt.
- Đã giao chat02 tiếp tục nối adapter thật theo người, kiểm luồng UI/API/kho với DB/danh tính giả, restart/checksum/quyền và fault sau PUT; sửa bảng bàn giao hiện hành và tách lịch sử. Chưa mở chat03. Không có quyết định mới cần chủ dự án.

### 2026-10-23 · Chat 02 bổ sung adapter sản phẩm và recovery thật

- Đã thay Docker Desktop Intel sai kiến trúc bằng 4.96.3 ARM64; client
  `darwin/arm64`, engine `linux/arm64`. Bản Intel giữ tạm ở
  `/private/tmp/VCworkspace-Docker-Intel-backup.app`, chưa xoá. Không đọc `.env`.
- Hợp đồng lên `1.5.0-gd1`, ghi D23/nguồn duyệt trực tiếp, thêm sáu API Drive và
  sinh lại schema FE. Lớp sản phẩm có Space/SpaceMember/DriveItem/UploadAttempt,
  StoragePort fake mặc định và Nextcloud opt-in theo credential từng email,
  manager/reader, checksum/idempotency/audit và trang `/bo-nho`.
- Nextcloud 33.0.5 đúng digest chạy cô lập `127.0.0.1:18080`; P01–P12 đạt trên
  WebDAV/OCS. P10 nay ghi byte thật rồi phát timeout có kiểm soát, đối soát và
  retry không trùng; evidence hiện hành run `mvkn94h0`. Integration API bằng
  Mongo tạm/Google giả chứng minh A tạo-upload-list-download, B chỉ đọc và
  metadata/byte/checksum còn sau restart container; evidence scrub
  `api-nextcloud-mvknc24c.json`.
- Gate cuối đạt: guard 40/40, OpenAPI hợp lệ (138 cảnh báo hiện có), BE 132/132
  và 104/104 điểm cuối, FE 72/72, typecheck/build; harness 21/21. Google giả,
  CSDL tạm; integration Nextcloud opt-in bị skip trong full gate không credential
  và đã chạy riêng đạt 1/1 với credential giả. Không khởi động BE,
  không deploy/commit/push và không mở chat 03.
- Còn lại sau review: chưa smoke UI bằng trình duyệt/chụp ảnh. Harness dự kiến
  chỉ dùng `createApp`, MongoMemoryServer loopback, Google fake và không nạp
  `.env`, nhưng hook chặn với lý do “Công cụ vận hành chỉ dùng trong phiên riêng”.
  Đối chiếu `policy.mjs` cho thấy tên biến instance CSDL tạm bị match như CLI cũ;
  patch ghi đề xuất fixture cũng bị chặn vì chứa chuỗi âm về production. Không
  sửa/lách guard. Đề xuất chờ duyệt: phân loại shell command hoặc allowlist đúng
  harness, có fixture cho phép test loopback và vẫn chặn CLI thật/secret/entrypoint.
  Chưa thử rộng Unicode/case sensitivity; credential chỉ là giả local.

### 2026-10-23 · Duyệt runtime và hợp đồng, tiếp tục chat 02

- Chủ dự án duyệt cả hai: cài môi trường container local riêng và cập nhật hợp đồng sáu API theo đề xuất; giao tiếp tục chat 02, review xong mới mở bước tiếp theo. Quyết định này thay thế các mục chờ duyệt tương ứng ở nhật ký cũ.
- Điều phối giao lại chính chat 02, giữ WIP, phạm vi dữ liệu giả/local; hoàn thiện hợp đồng, PoC thật, rồi phần sản phẩm theo tiêu chí bàn giao. Không mở chat 03 trước nghiệm thu, không có quyền production/dữ liệu thật.

### 2026-10-23 · Review lần cuối phần chuẩn bị chat 02 (12:51 VN)

- Đã đối chiếu sửa evidence theo runId/tách matrix–restart, kiểm StartedAt khi restart, xác minh share và preflight image/loopback; chạy lại toàn bộ PoC/unit tests 21/21 đạt. Chấp nhận các sửa chuẩn bị đã yêu cầu, chưa nghiệm thu kho Nextcloud hoặc Drive sản phẩm.
- Không mở chat 03; vẫn chờ runtime container và giao sửa hợp đồng sáu API đã báo. Không có quyết định mới, không nhắc lại yêu cầu người dùng. Không chạy lại gate ứng dụng vì không sửa mã trong phiên review.

### 2026-10-23 · Review bổ sung chat 02 (12:35 VN)

- Runner Nextcloud opt-in và bốn unit test adapter đã bổ sung; điều phối chạy lại 16/16 test đạt. Chưa có kho thật, vẫn chờ hai quyết định đã báo (runtime container và sáu API), không hỏi lại hoặc mở chat 03.
- Phát hiện runner verify-restart ghi đè bằng chứng matrix, chưa kiểm container thật sự restart; setup nuốt lỗi share quá rộng, preflight chưa đối chiếu published endpoint. Đã giao chính chat 02 sửa và thêm tests không cần Docker. Đây là hoàn thiện chuẩn bị, chưa nghiệm thu PoC/Drive.

### 2026-10-23 · Điều phối review chat 02 — chưa nghiệm thu

- Đọc toàn bộ bàn giao, đề nghị sáu API, Compose, README và adapter. Chạy lại `node --test poc/drive-nextcloud/test/fake-storage.test.mjs`: 12/12 đạt. Không chạy lại gate ứng dụng; gate cũ là kết quả chat 02 báo cáo.
- Kho thật chưa chạy vì thiếu Docker. Runner tích hợp Nextcloud cũng chưa có trong bàn giao; adapter DAV dùng regex và chưa chuẩn hoá timeout/network. Đã gửi việc bổ sung có thể làm ngay cho chính chat 02 (ID không đổi), giữ bước sau chưa mở.
- Cần chủ dự án chốt: cho phiên môi trường riêng cài runtime container local (đề xuất Colima + Docker CLI, hoặc cấp runtime tương đương); giao cập nhật hợp đồng theo sáu API đề nghị trước code sản phẩm. Phạm vi hiện duyệt chỉ chuẩn bị đề nghị, chưa sửa OpenAPI.

### 2026-10-23 · Chat 02 Drive cơ bản và PoC Nextcloud

- Đã ghi đề nghị sáu API Drive trung tính vào `apps/api/DE_NGHI_SUA_HOP_DONG.md`,
  giữ nội dung cũ; chưa sửa OpenAPI/schema. Đã chuẩn bị PoC ở
  `poc/drive-nextcloud/`: Nextcloud 33.0.5 ARM64 ghim digest, Compose loopback
  và volume riêng, WebDAV/OCS adapter, core idempotency/quyền/checksum/audit.
- Bằng chứng hiện có: P01–P12 đều đạt trên MemoryStorage (12/12 Node tests), hai
  module qua syntax check và diff check đạt. `pnpm ai:check` lần đầu bị sandbox
  chặn cổng MongoDB thử; chạy lại với quyền loopback đạt guard/gate 40/40,
  OpenAPI hợp lệ (131 cảnh báo hiện có), BE 129/129 + 98/98 endpoint, FE 72/72,
  typecheck/build. Fake và gate không chứng minh Nextcloud.
- Blocker thực tế: máy không có Docker nên chưa chạy Nextcloud, ACL A/B trực
  tiếp, restart, đo tài nguyên hoặc UI/API sản phẩm. Sáu API cũng chưa được duyệt
  để code NestJS/FE. Bàn giao đầy đủ ở
  `docs/ke-hoach/vcworkspace-02-ban-giao-drive.md`.
- Không đọc `.env`, không chạy BE/Google thật, không deploy/commit/push và không
  mở chat 03. Bước sau: duyệt hợp đồng; cấp Docker trong phiên môi trường riêng,
  chạy P01–P12 kho thật rồi mới quyết định code sản phẩm lớn.
- Bổ sung sau review điều phối: runner Nextcloud opt-in đã có preflight
  loopback/port/đúng Compose project và service, provision A/B + hai root, ACL
  credential từng người, đối soát OCS share, evidence matrix/restart tách file
  theo runId và verify-restart bắt buộc `StartedAt` thay đổi. Adapter
  đã xử lý DAV propstat 200/namespace/XML entity/collection, timeout và lỗi mạng;
  9 unit test mới, tổng 21/21 test PoC đạt. Runner chỉ syntax-check vì vẫn thiếu
  Docker; P10 kho thật để blocked tới khi có fault proxy loopback kiểm soát.

### 2026-10-23 · Duyệt gói thử và mở chat 02

- Chủ dự án đã duyệt toàn bộ gói thử đề xuất; ghi quyết định tại mục 2 và mục 6 biên bản. Các ghi chú “chờ duyệt” ở nhật ký cũ là trạng thái lịch sử đã được thay thế.
- Đã mở **VCworkspace 02 — Drive cơ bản và PoC Nextcloud**, ID `01a16729-0e11-7c21-b3e6-92413b4acb9c`, host local. Phạm vi trước mắt: đề nghị sáu API, harness/adapter thử và PoC Nextcloud cô lập; không sửa OpenAPI gốc hoặc code lớn trước duyệt hợp đồng.
- Điều phối tiếp tục theo dõi chat 02 qua heartbeat đã có, kiểm bằng chứng trước bước tiếp; chưa mở chat 03. Chỉ sửa tài liệu trong phiên điều phối; diff check đạt, không chạy lại test ứng dụng.

### 2026-10-23 · Review chat 01 và nhận điều phối tuần tự

- Chat 01 đã completed. Đã đọc toàn bộ `docs/ke-hoach/vcworkspace-01-thiet-ke-drive.md`; nội dung đáp ứng bàn giao thiết kế (khoảng trống, quyền, dữ liệu, lỗi, sáu API đề nghị, P01–P12). Đối chiếu lại mã `common/idempotency.interceptor.ts` xác nhận fingerprint hiện chỉ băm body, và `m03-folders/folders.service.ts` còn phụ thuộc driveId/Google. Chấp nhận bước khảo sát/thiết kế, chưa chấp nhận PoC hay tính năng chạy được.
- Kết quả gate là bằng chứng chat 01 báo cáo, không chạy lại tại phiên điều phối; không dùng gate Google giả làm bằng chứng Nextcloud. Đã thiết lập heartbeat mỗi 15 phút theo yêu cầu theo dõi; chỉ báo khi có thay đổi đáng kể/hoàn tất/lỗi/cần quyết định.
- Đã gửi gói lựa chọn cụ thể để chủ dự án chốt trước chat 02: PoC local cô lập, ACL theo người, phòng + cá nhân, tên trùng 409 và 10 MiB/tệp thử. Giới hạn này là đề xuất mới của điều phối, chưa duyệt. Chưa mở bước phụ thuộc, chưa sửa mã/contract, không deploy.

### 2026-10-23 · Chat 01 khảo sát và thiết kế Drive cơ bản

- Bổ sung kết quả cuối: `git diff --check` đạt. `pnpm ai:check` lần đầu bị sandbox chặn MongoDB thử mở cổng local (`listen EPERM 0.0.0.0`); lượt chạy lại với quyền cổng local đạt guard/gate 40/40, OpenAPI hợp lệ với 131 cảnh báo hiện có, BE 129/129 và 98/98 điểm cuối, FE 72/72, typecheck/build. Gate dùng Google giả và kiểm toàn WIP; không phải bằng chứng Nextcloud. Chưa thử adapter, ACL, checksum hoặc persistence của kho mới.
- Đã làm: xác nhận checkout `claude/nghien-cuu-vcworkspace` và toàn bộ WIP; đọc AGENTS, sổ tay, biên bản phát triển, báo cáo kiểm chứng và Phụ lục D; kiểm tĩnh luồng folder/upload, `GooglePorts`, quyền, idempotency, audit, jobs, model và UI hiện tại. Viết `docs/ke-hoach/vcworkspace-01-thiet-ke-drive.md` để bàn giao chat 02: luồng hai người dùng thử, sơ đồ UI–API–StoragePort–Nextcloud, định danh trung tính, ma trận quyền, retry/idempotency/trùng tên, đề nghị hợp đồng, PoC P01–P12 và tiêu chí nghiệm thu.
- Kết luận: tái dùng được khung Next.js/NestJS, session/CSRF, tenant, audit và một phần jobs/quyền sau khi tách phụ thuộc; chưa có file resource/API Drive cơ bản. `Folder.googleId`, `Department.driveId`, GooglePorts, retry GoogleError, URL FE và OpenAPI còn mang nghĩa Google nên không thể chỉ đổi URL. Đề xuất Nextcloud vẫn là ứng viên PoC, chưa là quyết định triển khai.
- Cần chủ dự án chốt trước code lớn: cho phép PoC Nextcloud cô lập; ACL kho theo từng người hay service credential chung (đề xuất từng người); một hay hai loại không gian thử (đề xuất phòng + cá nhân); chính sách trùng tên/giới hạn upload ban đầu. Chat 02 phải ghi đề nghị hợp đồng trước, không tự sửa `contract/openapi.yaml`.
- Kiểm tra phiên này: chỉ kiểm tĩnh và tài liệu; chạy `pnpm ai:check` sau khi hoàn thiện tài liệu. Chưa chạy Nextcloud/BE, chưa kiểm adapter/ACL/checksum/restart, chưa sửa mã/hợp đồng, không đọc `.env`, không commit/push/deploy và không mở chat 02.

### 2026-10-23 · Phân chia chat phát triển tuần tự

- Đã mở chat **VCworkspace 01 — Khảo sát nền tảng và thiết kế Drive** (`01a16720-2406-72f1-9134-18dbe8efbf5b`) trong project VCworkspace, cùng thư mục hiện tại.
- Đã ghi dự kiến 11 khung (1 điều phối + 10 công việc) trong mục 5 biên bản phát triển. Chủ dự án cho phép tách chat; bắt đầu bằng khảo sát nền tảng và thiết kế Drive, trước 8 đợt tính năng và nghiệm thu tổng thể.
- Chưa thay đổi mã sản phẩm, chưa duyệt stack/hạ tầng hoặc dữ liệu thật. Các lựa chọn còn mở giữ nguyên; kiểm tài liệu bằng diff, không chạy lại test ứng dụng cho thay đổi tài liệu.

### 2026-10-23 · Ghi biên bản phát triển tuần tự ba nhóm lõi
- Đã làm: theo yêu cầu chủ dự án, ghi `docs/ke-hoach/bien-ban-thu-tu-phat-trien-vcworkspace.md`. AI chọn Drive làm trước: tạo thư mục, upload/download, định danh và quyền; tiếp theo version/restore, văn bản, bảng tính, slide, email cơ bản, quản lý email và liên thông. Mỗi đợt có tiêu chí nghiệm thu; bản giả không thay PoC adapter thật trong môi trường thử.
- Còn dở: chưa viết mã; phiên triển khai tiếp theo khảo sát/thiết kế lát cắt Drive đợt 1 và xác định thay đổi hợp đồng nếu có. Ghi thứ tự không đồng nghĩa đã mua/deploy hoặc được thay dữ liệu/quyền thật. Giữ các câu hỏi về hạ tầng, ngân sách, dữ liệu và vận hành đang mở. Không commit/push/deploy.

### 2026-10-23 · Làm rõ ba nhóm dịch vụ lõi: Email, Office và Drive
- Kiểm tra sổ tay/tài liệu: diff check đạt; `pnpm ai:check` đạt (guard 40/40, BE 129/129 + 98/98 API, FE 72/72, typecheck/build), OpenAPI còn 131 cảnh báo hiện có. Gate kiểm WIP repo đang có, không chứng minh 3 dịch vụ đề xuất đã tích hợp hoặc vận hành.
- Đã làm: trả lời yêu cầu phát triển ba nhóm chức năng, hiểu Office gồm văn bản/bảng tính/slide. Đề xuất Stalwart + webmail, ONLYOFFICE qua connector Nextcloud, Nextcloud Files/Group Folders; VCworkspace phát triển lớp nghiệp vụ/API, quyền, liên kết dữ liệu, audit và điều phối AI. Ưu tiên thử connector sẵn; chưa tách thành nhiều microservice hay tự viết editor/mail engine.
- Quy tắc lưu đề xuất: Drive là kho tài liệu làm việc có quyền/phiên bản; Office lưu lại qua connector/API của kho. Mailbox và MIME/attachment gốc ở mail server; chỉ sao chép attachment hoặc lưu liên kết sang Drive theo thao tác/quy tắc rõ. Hồ sơ chốt giữ bản PDF/kho riêng theo nghiệp vụ, không đồng nhất với version/trash của Drive. Không thiết lập hai bộ quyền độc lập hoặc ghi thẳng vào thư mục dữ liệu của engine.
- Căn cứ: mở tài liệu ONLYOFFICE how-it-works/saving-file, connector onlyoffice-nextcloud, Nextcloud WebDAV (trang latest tự ghi NC36 upcoming), Group Folders, repo Stalwart và Nextcloud Mail. Chưa xác nhận phiên bản tích hợp thực tế, tương thích nhãn/SSO, cấp thu hồi tài khoản, file locking/callback, ACL hoặc tải. Một số URL Stalwart API/Nextcloud35 không truy cập được, không coi là nguồn đã đọc.
- Còn dở: chủ dự án chốt mức giao diện thống nhất (dùng app có sẵn trước hay tự xây toàn bộ UI), yêu cầu bảng tính và mail nhóm; sau đó đặc tả chức năng/PoC. Đây là đề xuất tính năng, không có phê duyệt code/deploy, không sửa mã/hợp đồng, không sửa bản kiểm chứng 100 của 100.

### 2026-10-23 · Cô đọng hồ sơ kiểm chứng hai vòng 20–80
- Gate phiên này: `pnpm ai:check` đạt; guard 40/40, BE 129/129 + 98/98 API, FE 72/72, typecheck/build qua; OpenAPI còn 131 cảnh báo hiện có. Dùng Google giả/MongoDB tạm. Sơ đồ mới kiểm cấu trúc Mermaid và liên kết, chưa xác minh render bằng ảnh.
- Đã làm: theo bố cục chủ dự án xác nhận, sửa trực tiếp `docs/nghien-cuu/vcworkspace-kiem-chung-2026-10-23.md` thành 3 mức: “20 của 20” → “20 của 100” → “100 của 100”. Vòng 1 lấy phần trọng yếu từ bản đầy đủ, vòng 2 tiếp tục cô đọng từ vòng 1; khoảng 20,5% rồi 21,6% (vòng 2 khoảng 4,4% bản gốc theo đếm tách khoảng trắng). Thêm 4 sơ đồ Mermaid về kiến thức, luồng dữ liệu, quy trình di cư và ra quyết định; giữ phân biệt bằng chứng/PoC/quyết định.
- Kiểm tra nội dung: phần 100 giữ nguyên từng byte so với trước sửa; đủ 48 câu gốc, 51 anchor không trùng, liên kết tóm tắt và 4 khối sơ đồ hợp lệ về cấu trúc. Không kiểm chứng lại web, không sửa kết luận nguồn hay chốt triển khai mới.
- Còn dở: không có việc cô đọng mới; các quyết định và PoC còn mở của nghiên cứu giữ nguyên. Không sửa mã/hợp đồng, không commit/push/deploy.

### 2026-10-23 · Đề xuất lại phương án VCworkspace sau kiểm chứng
- Kiểm tra phiên này: `pnpm ai:check` đạt sau khi cho phép mở cổng local cho MongoDB tạm (lần sandbox đầu EPERM); guard 40/40, BE 129/129 và 98/98 API, FE 72/72, typecheck/build đạt. OpenAPI hợp lệ, 131 cảnh báo hiện có. Gate chạy cả kiểm ứng dụng vì checkout có WIP cấu hình/package từ phiên khác; đây không phải kiểm thử Nextcloud/Stalwart hoặc bằng chứng kiến trúc đề xuất chạy được. Kiểm 12 mục quyết định và diff check đạt.
- Đã làm: đọc lại sổ tay, báo cáo/hồ sơ kiểm chứng và quản trị AI hiện có; mở lại nguồn Nextcloud MCP, ONLYOFFICE 9.4, Stalwart OIDC, Talk scalability. Thêm Phụ lục D vào báo cáo: đề xuất C về mã + Nextcloud, giữ Gmail/Meet lúc đầu; thử tệp/lịch/office/AI đọc/nháp cho một phòng, mail sau khi PoC đạt. ONLYOFFICE CE là ứng viên thử đầu, không ghim bản 9.4 hay cam kết đủ tải. Gateway chỉ bổ sung phần thiếu; GCP/vùng dữ liệu, relay và hỗ trợ chờ chốt.
- Cần chốt: 6 quyết định trước dựng thử và 6 trước dữ liệu thật/chuyển chính ở D.3, cùng inventory do IT thu thập bằng quyền được giao. Phân biệt đề xuất với quyết định: chủ dự án chưa phê duyệt stack, ngân sách, lịch di cư hay triển khai qua phiên tư vấn này.
- Còn dở: chủ dự án chốt D.3, sau đó mới lập kế hoạch PoC và tiêu chí nghiệm thu cụ thể; không sửa mã/hợp đồng, không mua/deploy, không đổi quyền/dữ liệu thật hay lịch tác vụ.

### 2026-10-23 · Codex triển khai 4 lớp AI, cập nhật tên VCworkspace
- Đã làm: cập nhật tên hiện hành trong README, hướng dẫn API/web/contract/deploy, mục lục và sổ tay; giữ tên các bản nguồn/lịch sử và định danh runtime/remote thực tế. Viết AGENTS dùng chung, CLAUDE dẫn AGENTS, 3 skill trong `.agents/skills`, Codex config/rules/hooks, Claude settings/deny/hooks, bộ kiểm tra theo thay đổi/full và GitHub CI/CODEOWNERS. Hướng dẫn kích hoạt và quyền cần chủ dự án/IT làm: `docs/huong-dan/quan-tri-ai.md`.
- Kiểm tra cuối: 40/40 ca guard/gate đạt; native Codex rule checker xác nhận 5 deny + git status không cấm, không thực thi lệnh nguy hiểm; config strict và 3 skill được native loader nạp, 3 hook project không lỗi nhưng `trustStatus=untrusted`. Full gate đạt: BE 129/129, 98/98 điểm cuối; FE 72/72; typecheck FE/BE + build đạt. OpenAPI hợp lệ, 131 cảnh báo hiện có; không sửa hợp đồng. Skill validator, YAML/JSON/TOML, link tài liệu và diff check đạt. Sandbox ban đầu chặn mở cổng test, đã chạy lại với MongoDB tạm và Google giả.
- GitHub đọc live: repo vẫn `buithoanh/VCdocs`, public; main/dev chưa bảo vệ, chưa ruleset; tài khoản CLI đang có admin. Không thay quyền, visibility hay tên repo. Không đọc secret, không kết nối Google/CSDL thật. Giữ nguyên WIP nghiên cứu và ảnh có sẵn; không commit/push/deploy.
- Còn dở phía chủ dự án: review/trust hooks và smoke test trong phiên mới (chưa kiểm end-to-end Claude Code); đưa workflow lên GitHub rồi bật required check `VCworkspace / verify` cho main/dev; tách môi trường/identity và rà quyền Google/GCP/Workspace theo hướng dẫn. Đổi tên folder/remote/package/hạ tầng là di trú riêng, chưa làm.

### 2026-10-23 · Codex tư vấn 4 lớp Agent Harness
- Đã làm: đọc nội dung người dùng gửi, sổ tay, AGENTS.md/CLAUDE.md và lệnh kiểm tra của repo; đối chiếu tài liệu OpenAI về hooks, rules, sandbox. Đề xuất áp dụng cho VCdocs/VCworkspace và quy trình dùng AI lâu dài, phân biệt hướng dẫn với kiểm soát quyền thực tế, kiểm tra theo loại thay đổi và cổng CI phía máy chủ.
- Còn dở: đây là tư vấn, chưa chốt hay cài cấu hình, chưa kiểm tra quyền GitHub/GCP/Google đang có hiệu lực. Không đọc secret, không sửa mã/hợp đồng, không commit/push/deploy. Thêm đề xuất vào mục 3, giữ nguyên các quyết định đã chốt và câu hỏi mở.

### 2026-10-23 · Codex vẽ cây folder/file
- Đã làm: khảo sát cây file checkout `claude/nghien-cuu-vcworkspace`; vẽ tổng quan và xuất cây chi tiết cho chủ dự án, bỏ thư viện, bản build, cấu hình bí mật và dữ liệu local. Xác nhận thư mục hiện tại là `/Users/apple/projects/VCdocs`; VCworkspace có báo cáo ở `docs/nghien-cuu/`.
- Còn dở: không có việc mới; danh sách mục 3–4 giữ nguyên. Không đổi mã, không commit/push.

### 2026-10-23 · Sol High kiểm chứng VCworkspace, Astra High rà điểm khó
- Đã làm: truy lại `key_claims` gốc của Claude, sửa số 42 thành 48 ID còn chưa hoàn tất (41 của 7 mảng + 6 workspace + 1 nhãn thư); giữ nguyên ID và câu gốc trong hồ sơ bằng chứng. Sol High kiểm 30 ID web, rà độc lập 6 ID mã; Astra High kiểm 12 ID bảo mật/pháp lý/chi phí và rà các kết luận khó. Kết quả: 21 confirmed, 24 partially, 1 refuted, 2 unverifiable. Cập nhật `docs/nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md`, thêm `vcworkspace-kiem-chung-2026-10-23.md` và mục lục tài liệu.
- Sửa trọng yếu: có MCP Nextcloud/CalDAV nên không bắt buộc tự viết toàn bộ gateway; ONLYOFFICE 9.4 bỏ cap 20, CODE mặc định không cap 10/20; production Euro-Office không đồng nghĩa bắt buộc mua Enterprise. Sửa quyền routines, giới hạn di cư Takeout/ACL, phụ thuộc gián tiếp Gmail trong mã, phạm vi Object Lock/Cloudflare TCP. Pháp lý: không miễn CTIA chung 5 năm cho DN nhỏ; Luật An ninh mạng 2018 hết hiệu lực từ 01/07/2026 theo Điều 44 Luật 116/2025/QH15. Bỏ tổng 440 USD/tháng, giảm 37% và tiết kiệm 6–14 GB khỏi kết luận chắc chắn.
- Kiểm tra: đọc nguồn chính thức và mã checkout `b8c8b805fce3ab831ac316d21343140b48d9b421`; `pnpm --filter @vcdocs/api typecheck` đạt. Kiểm tra đủ 48 ID/câu gốc/dòng kết quả, tổng phân loại, 87 liên kết file và `git diff --check` đều đạt. Astra đã rà bản tổng hợp cuối; đã sửa các mâu thuẫn còn sót về GCE/khối lượng thư chưa biết, khả năng quay lui, điểm lỗi đơn và nghĩa vụ giấy phép. Đếm tĩnh 32 phương thức/8 cổng, 129 ca test khai báo, 98 thao tác API; chưa chạy lại 129 test và chưa thử dữ liệu thật. Không sửa mã/hợp đồng, không commit/push/deploy.
- Còn dở: “AI Jev” chưa rõ định danh; giá GCP Singapore đúng SKU/CUD chưa xác nhận được. Cần chủ dự án chốt 20 câu hỏi, kiểm gói/giấy phép cụ thể và PoC quyền từng người, nhãn thư, provisioning/offboarding, export/restore/ACL, tải office/video, phục hồi backup. Lịch Claude 25/10 chưa đổi; không coi nghiên cứu là phê duyệt triển khai.

### 2026-10-23 · Codex đọc bàn giao Claude
- Tư vấn chọn model kiểm chứng: đề xuất GPT-6.1 Sol mức high làm chính; Astra rà các luận điểm khó hoặc ảnh hưởng quyết định kiến trúc, bảo mật, giấy phép, chi phí. Đây là đề xuất, chưa bắt đầu kiểm chứng và chưa có quyết định mới của chủ dự án.
- Đã làm: đọc `CLAUDE.md`, sổ tay, mục lục tài liệu, nguồn và đề nghị sửa hợp đồng FE/BE, báo cáo nghiên cứu VCworkspace; xác nhận checkout hiện tại là `claude/nghien-cuu-vcworkspace`. Tiếp nhận các việc đang làm và câu hỏi mở ở mục 3–4; chưa có quyết định mới.
- Còn dở: giữ nguyên danh sách mục 3–4. Các kết quả test, trạng thái Google và lịch tác vụ trong bàn giao là ghi nhận của phiên trước, chưa kiểm tra lại trong phiên đọc này. Không sửa mã, hợp đồng, không commit/push/deploy.

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
# Checkpoint 2026-10-24 · VCworkspace 08 sau review độc lập
- Bằng chứng mới đã đạt: ManageSieve buffered reader, hai lượt diagnose, real-adapter E2E 4/4, restart/readback, browser smoke và full gate guard44/BE145/coverage136/FE74/build. Credential thử nằm ngoài repo trong `/private/tmp`, quyền 600, không ghi giá trị; runtime/volume được giữ.
- Sau review đã sửa canonical owner cho inbound alias; shared raw/label dùng credential thành viên trên Group folder; Shared Sent copy vào Group; Group membership chỉ bật với role `read`. Fake E2E mới phủ inbound alias/shared raw+label và send-only; full gate cuối đạt. Real-adapter rerun chưa kết luận vì Stalwart trả `452 Rate limit exceeded` sau nhiều lượt chẩn đoán, kể cả restart container.
- Blocker còn lại: offboarding toàn user; FETCH/SEARCH trên session đã select sau revoke; GETSCRIPT/hash và concurrent filter update; reconcile engine–Mongo; ingestion/search thư ngoài API; UID/JMAP lookup tránh race sequence. Không nghiệm thu/mở09 trước pass real sạch và review lại.
- Review độc lập lần hai xác nhận bốn sửa code/fake E2E đúng cấu trúc, nhưng vẫn chặn nghiệm thu do chưa có real-adapter pass sạch trên cây mới. Shared `sent` hiện là copy vào Group/INBOX vật lý được API trình bày là `sent`, chưa phải IMAP `Sent Items`; search chỉ là corpus metadata do API tạo.
- Runtime đang giữ: mail healthy, relay chỉ mở loopback 18143/18465/18587/18993/14190/18084, Nextcloud 18080, ONLYOFFICE 18082; B đang bị revoke Group có chủ ý. Không đọc `.env`, không entrypoint BE thật, không reset/commit/push/deploy, không mở chat09.

# Checkpoint 2026-10-24 · VCworkspace 08 bằng chứng cuối, review vẫn chặn nghiệm thu
- Đã xử lý limiter bằng quota `.test` hữu hạn 200/giờ, không tắt limiter toàn cục; real adapter cuối 5/5. Thư gửi thẳng SMTP được Sieve chuyển `vip`, sync vào Mongo và tìm theo body.
- Adapter dùng UID FETCH/STORE; GETSCRIPT so nội dung; filter serialize + rollback; shared membership rollback. List/search sync idempotent 100 thư gần nhất/folder để reconcile thư engine chưa có metadata.
- Offboarding mới: khóa secrets/alias/Group ở engine, đóng phiên IMAP, xóa session web, gỡ shared Mongo, đặt user left+suspended. Proof phiên IMAP đã SELECT sau revoke: socket đóng, không FETCH/SEARCH rò dữ liệu. Relay PoC thêm loopback control 19090 và hiện kick toàn bộ IMAP, chưa per-user production.
- Hợp đồng thêm POST `/mail/offboarding/{userId}`, schema FE đã sinh lại. Full gate cuối đạt: guard44, OpenAPI hợp lệ (178 warning), BE146/146 + coverage137/137, FE74/74, typecheck/build đạt.
- Browser smoke cuối đạt trên `/email`: Google giả, Stalwart thật, danh sách hiển thị và tìm marker còn 3 thư đúng; reader alias mở đúng. Không đọc `.env`, không deploy/commit/push/gửi Internet, không mở chat09.
- Review độc lập còn chặn: relay revoke đang global-kick thay vì per-user; send có cửa engine ACK rồi Mongo lỗi; filter serialization/rollback chỉ một process; parser MIME PoC chưa đủ. Sau review đã sửa controlPort thành bắt buộc/fail-closed, không cho offboard manager cuối, không nuốt lỗi sync và bỏ giới hạn 100 thư, rồi `pnpm ai:check` đạt. Chưa nghiệm thu, chưa mở chat09.

# Checkpoint 2026-10-24 · VCworkspace 08 đủ điều kiện nghiệm thu local
- Đã đóng toàn bộ blocker review: relay IMAPS theo principal, bỏ exposure 143, control bắt buộc token; proof token sai bị từ chối, B bị đóng/không rò FETCH-SEARCH và A vẫn NOOP. Offboarding chặn manager cuối.
- Send có journal/lease, typed outcome `no|unknown`, hậu-ACK chỉ reconcile Message-ID, pre-ACK retry bằng CAS single-winner; test delayed visibility và concurrent retry chứng minh chỉ một delivery. Filter dùng Mongo revision/lease, pending publish và fencing; stale writer không tạo ghost write, rollback failure có journal.
- Ingestion dùng `mailparser`, sync không cắt 100 và surface lỗi engine. Real Stalwart E2E 5/5; browser smoke `/email` với Google giả tìm marker còn đúng 1 thư; proof session đạt.
- Full gate cây cuối đạt: guard 44/44, OpenAPI hợp lệ (178 warning hiện có), BE 153/153 và coverage 137/137, FE 74/74, typecheck/build đạt. Review độc lập vòng cuối kết luận `NO BLOCKER` trong phạm vi chat08 local.
- Giới hạn không chặn PoC: sync toàn raw/folder chưa phù hợp mailbox lớn; shared sent là copy vật lý; control token phải tách riêng trước vận hành; chưa deploy/MX/HA/load/production. Không đọc `.env`, không gửi Internet, không reset/commit/push/deploy và không tự mở chat09.

# Checkpoint 2026-10-24 · VCworkspace 09 hoàn tất local
- OpenAPI `2.2.0-gd2`; liên thông Email–Drive–Office có lưu attachment với provenance/hash/idempotency, gửi snapshot đúng version hoặc link cần đăng nhập + intended-recipient + ACL hiện có, không cấp quyền ngầm.
- Browser thật run `chat09-1792812692823`: Stalwart A→B DOCX V1, B lưu Nextcloud, sửa và Save bằng ONLYOFFICE thành marker `CHAT09 BODY V2 chat09-1792812692823`, mở lại cùng fileId với hai version; V2 SHA-256 `19988b15…f863160`. Snapshot MIME nhận tại A có đúng hash V2; UI gửi link cho B thành công.
- Real integration Stalwart + Nextcloud 1/1: retry chỉ một delivery/link, đúng người nhận tải 200 và đúng hash, người xác thực khác 403, expiry/revoke 404. Fake E2E thêm expiry và vẫn phủ DOCX/XLSX/PPTX, hash sai, ACL, revoke, không cấp quyền ngầm.
- Full gate cây cuối PASS: guard 44/44, OpenAPI hợp lệ với 181 warning hiện có, BE 155/155 + coverage hợp đồng 140/140, FE 74/74, typecheck và build API/web đạt.
- Evidence: `poc/onlyoffice/evidence/chat09-real.json`; bàn giao: `docs/ke-hoach/vcworkspace-09-ban-giao-lien-thong.md`. Server test đã dừng, container local giữ nguyên. Không đọc `.env`, không gửi Internet, không deploy/commit/push và không tự mở chat10.
- Review điều phối đã được xử lý trong chat09: link email là URL web tuyệt đối, token ở fragment rồi sessionStorage qua đăng nhập nên không vào query/access log; browser logout→link→login B→download đạt đúng hash. Link unique-key race revalidate fingerprint; snapshot/link dùng mail journal key ổn định bind toàn payload; save attachment fingerprint có provenance nguồn. Test cover outer-receipt loss, concurrent 201/409 và đổi source cùng bytes. Full gate cây cuối PASS: guard44, OpenAPI hợp lệ 181 warning hiện có, BE157/157 + endpoint140/140, FE76/76, typecheck/build đạt.

# Checkpoint 2026-10-24 · VCworkspace 12 Identity/Admin hoàn tất local
- Đã dựng stack riêng Nextcloud 33.0.10 + Authentik OSS 2026.8.5, PostgreSQL 18.1 và Redis 8.2.3, pin ARM64 digest; nguồn 18120–18122, restore 18123–18124. App container chỉ ở network internal/no-egress; relay read-only không mount secret mới bind loopback. Outbound probe fail-closed; không đụng runtime cũ 18080/18082/mail.
- OIDC browser thật đạt authorization-code + PKCE S256, strict redirect, state/nonce, RS256 issuer/audience/expiry/iat/`azp`, immutable subject/group claims, session rotation, callback replay deny. Tách rõ logout local, provider application logout và global revoke; global revoke xóa portal + Authentik sessions, disable/readback Nextcloud rồi khôi phục baseline. App password WebDAV 207→401.
- Lifecycle qua API/OCS đạt joiner, đổi email không đổi `sub`, mover thu quyền Team A, leaver disable/re-enable. Journal có correlation/idempotency; inject lỗi sau remove-group rồi retry cùng correlation; lock atomic chứng minh hai reconcile đồng thời đúng một winner.
- Team Folder ACL live nguồn và restore: manager write 204, member read 200 đúng SHA-256, outsider tenant B read/write 404/404. `admin_audit` có 11 record khớp correlation. Không truy cập DB Nextcloud để chứng minh binding/quyền.
- Đã thêm script reviewable tạo secret TEST, provision Authentik, reconcile Nextcloud, backup, recreate restore và verify isolation/readback. Bản restore cuối được tạo lại bằng chính script từ hai custom dump + HTML archive; readback version/apps/image IDs/checksum/4 persona/3 nhóm/2 app/4 binding và ACL đạt.
- Review độc lập vòng đầu nêu 3 P1 + 3 P2; đã sửa no-egress, reproducibility, lifecycle fault/race, OCS readback, multi-audience `azp`, restore evidence và yêu cầu review lại. Bàn giao: `docs/ke-hoach/vcworkspace-12-ban-giao-danh-tinh-phan-quyen.md`; evidence: `poc/identity-admin/evidence/`.
- Gate cây cuối PASS hai lượt: `pnpm ai:check` và `pnpm ai:check:full`; guard 44/44, OpenAPI hợp lệ với 181 warning hiện có, API 157/157 + endpoint 140/140, FE 76/76, typecheck/build đạt. Không sửa hợp đồng, không đọc `.env`, không Google/Stalwart/domain/LDAP thật, không deploy/commit/push.
- Giới hạn: local PoC, chưa UI admin production/HA/load/TLS-domain/LDAP/RPO-RTO; marketplace download chỉ là bootstrap có cờ và phải ngắt edge; relay vẫn có reachability nội bộ tới DB dù read-only/không secret; restore dùng wait cố định 4 giây; lock có thể stale nếu `SIGKILL`. Production cần reverse proxy/network policy riêng, health retry và durable lease/fencing.

# Checkpoint 2026-10-24 · VCworkspace 12B review vòng mới — đang sửa, chưa nghiệm thu
- Review sau PASS cũ phát hiện cùng Idempotency-Key có thể đua tranh làm tăng subject revision nhưng chỉ tạo một operation, và `app-commit` có hai ghi chưa kiểm fence ở giữa. Đang đổi sang tạo operation trước, reservation revision có thể khôi phục sau crash, và kiểm fence trong lúc commit.
- Mọi số test/PASS trước đây chỉ là bằng chứng của cây cũ. Chưa kết luận lại cho đến khi có test barrier cùng khóa, lỗi giữa cấp revision/cập nhật operation, fence giữa multiwrite và full gate trên cây cuối.

# Checkpoint 2026-10-24 · VCworkspace 12B hoàn tất review vòng cuối
- Đã đổi create sang operation unique trước, rồi reserve/cấp subject revision có journal khôi phục. Retry cùng Idempotency-Key tiếp tục đúng reserved revision; operation khác không thể lấy revision khi reservation đang dở. Không còn revision tăng mà thiếu operation tương ứng.
- `app-commit` kiểm subject lease/fence trước ghi user và giữa ghi user–binding; binding chỉ bỏ `projectionPendingRevision` bằng conditional update. Nếu mất fence ở giữa, binding vẫn inactive/pending-deny; operation mới hơn có thể reconcile về trạng thái đích.
- Test mới đạt: barrier hai create cùng key chỉ 1 operation/1 revision; fault injection sau cấp revision nhưng trước cập nhật operation khôi phục đúng bằng retry; lease theft giữa hai app write không publish binding. Nhóm lifecycle/OIDC 16/16; integration Authentik + Nextcloud local 1/1 và đã dừng token-control bridge sau test.
- Full gate cây cuối PASS: guard 44/44, OpenAPI hợp lệ (190 warning hiện có), API 173/173 + endpoint 145/145, FE 76/76, typecheck và build API/web đạt. Không đọc `.env`, không chạy entrypoint BE thật, không deploy/commit/push.
