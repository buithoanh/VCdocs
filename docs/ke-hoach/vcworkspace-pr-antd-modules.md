# PR: Giao diện Ant Design – bước 2–6: sáu module nghiệp vụ

Nhánh `vcworkspace/antd-ho-so` vào `dev`. Nhánh cắt từ `claude/gop-antd` (PR #10,
đã merge 2026-10-26) nên chỉ chứa 5 commit module (mỗi module một commit) và 1 commit tài liệu PR này:

| Commit | Module |
|---|---|
| d3b7ca0 | Hồ sơ: danh sách, lập hồ sơ, chi tiết, file chưa đăng ký |
| 1ee642c | Tài liệu: danh sách, đăng ký, chi tiết, bên ngoài |
| ebfb985 | Phê duyệt: hộp duyệt, chi tiết phiếu, uỷ quyền |
| 0872c3f | Thư mục/Drive: cây thư mục, thành viên drive |
| 422875c | Email: khung ba vùng, soạn thư, quản lý hộp thư |

## Tóm tắt

Tiếp bước 1 (lớp component nền trên Ant Design 6, PR #10), chuyển sáu module
sang dùng thẳng antd: `Form` (`useForm`/`useWatch`, validator lấy từ `lib/*`
để quy tắc BR và thông điệp vẫn một nơi), `Table` có phân trang phía máy chủ,
`DatePicker` ngày/tháng (dayjs ↔ chuỗi ISO), `Upload`, `Tree`, `Select`,
`Radio`/`Checkbox`, `Descriptions`, `Card`/`Space`/`Flex`, `Affix`. Trong sáu
module không còn lớp viết tay `.btn/.field/.filters/.form/.steps/.checkbox/.list/.tree`.

- **Hồ sơ:** bộ lọc Form/Row/Col; lập hồ sơ là antd Form với Steps, DatePicker,
  Radio nguồn file, Upload (`beforeUpload` trả false); Sửa hồ sơ là Form trong
  Modal; Gắn bản scan bằng Upload.
- **Tài liệu:** đăng ký là antd Form (BR-02 tự chuyển cấp VCPV trong
  `onValuesChange`); hộp thoại góp ý/trình/ban hành/sửa đổi/rà soát dùng
  Checkbox.Group, Radio.Group, InputNumber, DateField; nhập bên ngoài có
  validator link Drive/URL.
- **Phê duyệt:** hộp duyệt là Card trong Flex (không dùng antd `List` vì 6.6
  đã deprecated); chi tiết phiếu có thanh quyết định dán đáy bằng `Affix`;
  uỷ quyền là antd Form trong Modal (InputNumber có dấu chấm nghìn, hai
  DatePicker kiểm Đến ≥ Từ).
- **Thư mục/Drive:** cây bằng antd `Tree` tải con theo `loadData`; hộp thoại
  Tạo/Đổi tên là antd Form (giữ D20); thành viên drive dùng Checkbox.
- **Email:** giữ khung ba vùng kiểu Outlook, đổi toàn bộ điều khiển sang antd;
  icon antd trong nút để `aria-hidden` để tên nút không đổi (test bám tên);
  `RichTextEditor` thanh công cụ dùng Button + icon antd.

Thay đổi dùng chung:

- `components/pickers.tsx`: tách `DeptSelectInput`, `UserSelectInput`,
  `MultiUserSelectInput` (chỉ Select, gắn thẳng `Form.Item name=…`); người
  tìm được qua `/users/lookup` được `rememberPeople` nên nhãn còn hiện sau khi chọn.
- `components/dates.tsx` (mới): `MonthPicker`/`DayPicker`/`MonthField`/`DateField`,
  `toDayjs`/`toISODate`/`toISOMonth`, `disabledFuture`/`disabledPast`.
- `DataTable` nhận prop `pagination` (phân trang antd phía máy chủ); `Button`
  nhận `style`; `DefList` (Descriptions) bỏ dấu hai chấm.
- Thêm dependency `dayjs@1.11.19` (antd đã kéo theo, nay dùng trực tiếp).
- `apps/api/test/qa-fake-server.spec.ts` bật `jobsPollMs` (mặc định 1000 ms,
  đổi bằng `QA_JOBS_POLL_MS`) để việc nền lập hồ sơ/chốt chạy trên QA trình
  duyệt; các e2e khác vẫn `jobsPollMs: 0` và `drain()` tay.
- CSS: bỏ `.tree*`, `.layout-split`; thêm `.vc-filters`, `.vc-check-list`,
  `.vc-decide-bar`, `.vc-tree`, quy tắc cho nút antd trong khung Email.
  CSS `.mail-*` cũ **giữ nguyên** vì `/bo-nho` dùng chung.

## Kiểm tra

- Mỗi commit: `pnpm --filter @vcdocs/web typecheck` đạt; test FE 96/96 (16 file),
  không sửa test nào của sáu module; `pnpm ai:check` đạt (lần cuối trên 422875c,
  FE 96/96).
- QA trình duyệt trên server giả cô lập (`qa-api` 14100 + `qa-web` 13100):
  lập hồ sơ → việc nền → chi tiết → Sửa / Gắn scan; đăng ký tài liệu → chi tiết
  (BR-02 tự khoá cấp phòng), Sửa đổi / Rà soát vai Kiểm soát tài liệu; trình
  duyệt hồ sơ → hộp duyệt vai GĐ khối → chi tiết → Yêu cầu sửa, Uỷ quyền; cây
  thư mục tải con, Tạo thư mục; gửi thư cho chính mình, đọc lại, Quản lý mail
  (khổ 1024 và 1440, điện thoại ở Hồ sơ).
- **Chưa chạy** `pnpm ai:check:full` (build) trong lượt này; bước 1 đã build
  đạt với antd, các bước sau không đổi cấu hình build. Chưa chạy runtime thật
  Nextcloud/Stalwart.

## Lưu ý trước khi merge

- Ngoài sáu module, các trang sau **vẫn dùng lớp cũ** `.btn/.field/.filters/.list`:
  đăng nhập, trang chủ, tra cứu, chia sẻ, thông báo, danh mục hồ sơ, bảng mã,
  khối/phòng/division, nhân sự, việc nền, `/bo-nho`. Giao diện vì thế còn lẫn
  hai kiểu cho tới khi chuyển nốt.
- Test FE với antd trong jsdom chậm hơn (ho-so.test ~15–35 s/6 ca,
  email.test ~25 s/10 ca; mốc 20 s/ca từ PR #10). Chạy gate khi máy rảnh;
  chạy cùng lúc với dev server QA + trình duyệt từng làm 2 ca hết giờ.
- `next build` tải font Be Vietnam Pro từ Google Fonts một lần (từ bước 1);
  Docker build có mạng nên không vướng.

## Lệnh cho chủ dự án

Chuyển sang nhánh, đẩy lên origin rồi mở PR vào `dev` với thân PR là file này:

```bash
git switch vcworkspace/antd-ho-so
```

```bash
git push -u origin vcworkspace/antd-ho-so
```

```bash
gh pr create --base dev --head vcworkspace/antd-ho-so --title "Giao diện Ant Design – bước 2–6: sáu module nghiệp vụ" --body-file docs/ke-hoach/vcworkspace-pr-antd-modules.md
```

## Tệp thay đổi (so với origin/dev)

```
 SO_TAY_DU_AN.md                                    |  44 ++
 apps/api/test/qa-fake-server.spec.ts               |   3 +-
 apps/web/package.json                              |   1 +
 apps/web/src/app/(app)/drive/[id]/page.tsx         |   6 +-
 apps/web/src/app/(app)/email/MessageBody.tsx       |  12 +-
 apps/web/src/app/(app)/email/RichTextEditor.tsx    |  35 +-
 apps/web/src/app/(app)/email/page.tsx              | 583 +++++++++++++++++----
 apps/web/src/app/(app)/ho-so/[id]/RecordView.tsx   |  71 ++-
 apps/web/src/app/(app)/ho-so/chua-dang-ky/page.tsx |  16 +-
 apps/web/src/app/(app)/ho-so/moi/NewRecordForm.tsx | 244 ++++++---
 apps/web/src/app/(app)/ho-so/page.tsx              |  92 +++-
 apps/web/src/app/(app)/phe-duyet/[id]/page.tsx     |  52 +-
 apps/web/src/app/(app)/phe-duyet/page.tsx          |  94 ++--
 apps/web/src/app/(app)/phe-duyet/uy-quyen/page.tsx | 161 ++++--
 .../src/app/(app)/tai-lieu/[id]/DocumentView.tsx   |  79 +--
 apps/web/src/app/(app)/tai-lieu/ben-ngoai/page.tsx | 106 ++--
 apps/web/src/app/(app)/tai-lieu/dang-ky/page.tsx   | 135 +++--
 apps/web/src/app/(app)/tai-lieu/page.tsx           |  73 ++-
 apps/web/src/app/(app)/thu-muc/FolderBrowser.tsx   | 298 +++++++----
 apps/web/src/app/globals.css                       |  45 +-
 apps/web/src/components/DataTable.tsx              |  29 +-
 apps/web/src/components/approvals/approvalUi.tsx   |   7 +-
 apps/web/src/components/dates.tsx                  | 103 ++++
 apps/web/src/components/pickers.tsx                | 196 ++++---
 apps/web/src/components/ui.tsx                     |   4 +-
 pnpm-lock.yaml                                     |  17 +-
 26 files changed, 1774 insertions(+), 732 deletions(-)
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
