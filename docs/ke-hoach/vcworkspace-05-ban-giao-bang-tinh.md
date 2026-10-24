# VCworkspace 05 — bàn giao bảng tính

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, Nextcloud và ONLYOFFICE thật;
  không deploy, dữ liệu thật, commit hoặc push.
- Kết luận: **API/UI/Drive version, editor browser thật và xuất XLSX/PDF thật
  đạt trong phạm vi bảng tính cơ bản.**

## 1. Hợp đồng và mã

Hợp đồng lên `1.8.0-gd1`; nguồn và đề nghị S01–S04 đã ghi trong
`contract/NGUON.md` và `apps/api/DE_NGHI_SUA_HOP_DONG.md`, schema FE sinh lại từ
OpenAPI viết tay.

- `POST /drive/spreadsheets` tạo XLSX OOXML mẫu và lưu version 1.
- Editor dùng chung luồng chat04: `documentType=cell`, manager `edit`, reader
  `view`, key gồm fileId/version, vé HMAC và JWT ngắn hạn.
- Callback kiểm magic và cấu trúc workbook/worksheet/content type đúng loại
  trước khi tạo version bất biến. DOCX chat04 giữ kiểm tra riêng.
- Export native lấy current version (`docx`/`xlsx`); PDF qua converter có JWT,
  khóa same-origin URL và kiểm `%PDF`.
- UI `/bo-nho` tạo/mở/xuất bảng tính; upload nhận MIME OOXML XLSX.

## 2. Mẫu và expected độc lập

Mẫu có tiếng Việt, ngày, số, tiền; cố định dòng đầu; auto-filter và sort state
giảm dần theo `F2:F4`. Công thức gồm nhân số lượng–đơn giá, `SUM`, `IF`, `SUMIF`
và `VLOOKUP`. Test tính expected độc lập, không đọc cached value để tự xác nhận:
V1 tổng 7.400.000; browser đổi D2 từ 2 thành 4 thì V2 phải có F2=6.000.000,
SUMIF=8.000.000, SUM=10.400.000 và IF = “Vượt ngưỡng”.

## 3. Engine/browser thật

Tái dùng container đang healthy, không pull/restart/reset/purge: Nextcloud
`127.0.0.1:18080`; ONLYOFFICE `onlyoffice/documentserver:9.4.0.1`,
`linux/amd64` qua emulation, JWT bật tại `127.0.0.1:18082`.

Fixture authoritative browser:

- `Bao-cao-chat05-verified.xlsx`, fileId `6adb4cfe8dc500771673bc51`;
- V1 hash `3b2fd180e1531014b28acbe7a4de31c84e9f213a03ee2ab3e6ee36441a00c205`;
- manager mở edit, đổi D2=4, thấy tổng 10.400.000/filter, Save báo
  “All changes saved”; danh sách chỉ có version 1 và 2;
- mở lại cùng fileId thấy D2=4 và đủ SUM/IF/SUMIF/VLOOKUP;
- V2/current/XLSX hash
  `1ffcf25fb3e1410c1884c4ae21e23d7b2b8615a06e7d8b0be06c3938285cec1b`;
- PDF V2 62.245 byte, hash
  `8a3c69e1a5f69cb676224e9a4f28a7e66fbbce6ace7ec38f2960174b04b85e69`;
- reader đăng nhập riêng chỉ có tải/mở/xuất/phiên bản; editor báo “Sẵn sàng
  xem”, không có Save/control sửa.

Giải nén chính XLSX V2: `sheet1.xml` có D2=4, thẻ `<f>` và cached values
6.000.000 / 8.000.000 / 2.400.000 / 10.400.000, cùng `autoFilter` và
`sortState`; `sharedStrings.xml` giữ tiếng Việt. `pdftotext` trên PDF V2 thấy
tiêu đề tiếng Việt, D2=4 và tổng `10400000.0 ₫`, không chỉ kiểm magic/size.

Bằng chứng: `poc/onlyoffice/evidence/chat05-browser-v2.json`, cùng hai tệp
`chat05-browser-v2.xlsx` và `chat05-browser-v2.pdf`. Tích hợp lặp lại
`node poc/onlyoffice/run-integration.mjs` đạt cả DOCX regression và XLSX→PDF
thật; ca V1 converter riêng không được dùng thay bằng chứng V2 browser.

## 4. An toàn, đồng thời và giới hạn

- Tenant/membership kiểm ở API/model; reader callback bị từ chối.
- Callback cần vé/JWT, URL đúng editor origin, không redirect, chặn metadata;
  sai loại DOCX/XLSX bị từ chối.
- Replay idempotent không sinh version; callback key cũ bị từ chối, không silent
  overwrite/lost update. Hai phiên cùng version dùng key coediting chung.
- V1 template và browser-saved V2 luôn gắn cùng fileId/version/hash.

Target chat04+05 đạt 4/4; tích hợp thật đạt 2/2. `pnpm ai:check:full` trên cây
cuối **PASS**: guard 44/44, OpenAPI hợp lệ (152 warning hiện có), BE 137/137
(3 integration opt-in skip trong full gate), coverage hợp đồng 117/117, FE 72/72,
typecheck và production build đạt. `git diff --check` đạt.

Không mặc định Apps Script/macro tương thích. Chưa kiểm mọi hàm Excel, workbook
lớn, external links, pivot/chart phức tạp, coediting nhiều người dưới tải, 48
người, SLA, license/legal hoặc production. Phiên này không mở chat06.
