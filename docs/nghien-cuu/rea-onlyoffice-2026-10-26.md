# Thử REA (Reverse Engineer Anything) trên ONLYOFFICE Document Server 9.4

Ngày: 2026-10-26 · Phiên Claude · Yêu cầu của chủ dự án: "dùng repo REA để làm code ngược lại ONLYOFFICE", kèm link https://github.com/morluto/rea.

## 1. Kết luận ngắn

- **ONLYOFFICE Document Server không cần "code ngược".** Toàn bộ mã của bản chạy trong image `onlyoffice/documentserver:9.4.0.1` (build 9.4.0.129) là mã nguồn mở AGPL-3.0, công khai trên GitHub (`ONLYOFFICE/web-apps`, `sdkjs`, `server`, `core`). Image còn ship **mã chưa minify** (`web-apps/apps/*/main/app/**`, `sdkjs/word/sdk-all.js` 28 MB) kèm `LICENSE.txt` AGPL và `3rd-Party.txt`.
- REA xác nhận điều đó bằng phép so sánh nguồn ↔ bundle: trong 120 tệp JS của `documenteditor/main`, **95 tệp trùng nguyên hash với nguồn tag `v9.4.0.129`**, 4 tệp khác chỉ vì build thay placeholder (`{{PRODUCT_VERSION}}`, `{{SUPPORT_URL}}`, `{{DEFAULT_LANG}}`, `{{HELP_CENTER_WEB_DE}}`), 21 tệp là bản lặp của `help/*/callback.js`.
- REA 6.8.0 chạy được trong lab Docker cô lập, nhưng với ONLYOFFICE nó **không thêm thông tin nào mà đọc nguồn trên GitHub không có**. Phần phân tích "endpoint" cho kết quả sai (nhận `.get("...")` của Backbone là gọi mạng), kiểm kê route trả 0, truy vết tính năng toàn nhiễu từ khóa JSON locale. Phần binary native (x2t, docservice) cần Ghidra/Hopper/IDA, lab chưa cài.
- Khuyến nghị: muốn hiểu hoặc tích hợp sâu ONLYOFFICE thì đọc nguồn ở nhánh `release/v9.4.0` và tài liệu API chính thức; **không cài REA vào Claude Code trên máy phát triển**; nếu sau này cần REA cho phần mềm thật sự đóng (không có mã), dùng lab `poc/rea-lab` (container, không mạng, không `.env`).

## 2. REA là gì (đã đọc trực tiếp từ repo ngày 2026-10-26)

| Mục | Thực tế |
|---|---|
| Repo, giấy phép | `morluto/rea`, MIT; gói npm `rea-agents`; release mới nhất `rea-agents-6.8.0` (2026-10-25) |
| Bản chất | MCP server + CLI cho AI agent; "phân tích chạy cục bộ", nhưng kết quả tool đi tới model provider của agent |
| Đầu vào hỗ trợ | Binary native (qua provider ngoài: Ghidra, Hopper, IDA, Kuna), JS/Electron (thư mục hoặc ASAR), .NET, Android APK (JADX), website qua Chrome, HAR/pcap, firmware, WASM, Node SEA, PyInstaller, v.v. |
| Không hỗ trợ | Không có provider `objdump` trong 6.8.0 (danh sách hợp lệ: `ghidra, hopper, ida, kuna`); không mở được binary đóng gói bằng `pkg` (vercel) nếu không có provider native; tệp ELF > 64 MiB bị `inspect-elf-notes` từ chối |
| Yêu cầu | Node `^22.23.4 || ^24.22.1 || >=26.12.1` (Node máy dev là 22.22.2, **thấp hơn yêu cầu**); Linux cần `ps` của procps |
| Bảo mật | `SECURITY.md`: "This is not a sandbox"; provider phân tích binary bằng quyền user; cài qua `npx rea-agents setup` sẽ sửa cấu hình agent (có hỏi duyệt) |
| Ranh giới sử dụng | `DISCLAIMER.md`: không hỗ trợ sao chép mã/tài sản độc quyền, vượt DRM/license; người dùng tự chịu trách nhiệm về giấy phép của đích phân tích; không sửa MIT |

Điểm khớp với báo cáo khả thi mục 5 (`vcworkspace-nghien-cuu-kha-thi.md`): REA là công cụ phân tích, không phải nguồn "bản thiết kế lại"; cần lab riêng.

## 3. Cách đã chạy (lab cô lập, không cài lên máy)

- Image lab: `poc/rea-lab/Dockerfile` (`node:24-bookworm` → Node 24.22.1, `rea-agents@6.8.0` ghim phiên bản, user không phải root). Build xong 1,51 GB.
- Mọi lần phân tích chạy `docker run --rm --network none`, mount đích chỉ đọc (`/target:ro`), kết quả ra thư mục scratch (`/out`). Không mount repo, không `.env`, không khoá nào.
- Đích: tệp trích từ image `onlyoffice/documentserver:9.4.0.1` (đã có sẵn trên máy từ chat04) bằng `docker create` + `docker cp`, không chạy container mới. Không đụng container `vcworkspace-onlyoffice-chat04` đang chạy.
- Chỉ `rea` CLI; **không** đăng ký REA làm MCP server của Claude Code, không chạy `npx rea-agents setup`.

Bố cục tệp trong image (`/var/www/onlyoffice/documentserver`):

| Thư mục | Kích thước | Nội dung |
|---|---|---|
| `web-apps` | 756 MB | Giao diện editor (`apps/{documenteditor,spreadsheeteditor,presentationeditor,pdfeditor,visioeditor}/main`), mỗi app có `app/**` chưa minify + `code.js` đã gộp |
| `sdkjs` | 246 MB | Lõi editor JS: `word/sdk-all.js` (28 MB, chưa minify), `sdk-all-min.js` (3,5 MB), tương tự `cell`, `slide`, `pdf`, `visio` |
| `server` | 613 MB | `DocService/docservice` (243 MB, ELF x86-64, Node đóng gói bằng `pkg`: còn chuỗi `/snapshot/server/DocService/sources/server.js`), `FileConverter/converter` (141 MB, cùng kiểu), `FileConverter/bin/x2t` (46 MB, C++ từ repo `core`, chuỗi "Version: 9.4.0.129") và các `.so` |

## 4. Kết quả từng phép thử

| # | Lệnh REA | Đích | Kết quả | Nhận xét |
|---|---|---|---|---|
| 1 | `analyze-javascript-application` | `web-apps/apps/documenteditor/main` (102 MB) | Xong sau 2 phút 24 giây; Evidence 124 MB; 998 tệp liên quan, 121 JS parse (120 cú pháp đủ, 1 lỗi), 732.422 nút AST, 3.999 phát hiện, 0 Electron | 13 tệp view bị cắt quan hệ vì vượt ngân sách kết quả; 181 unknown đồ thị ứng dụng, 25.309 unknown ngữ nghĩa |
| 2 | `inspect-analysis-view` (summary, modules) | Evidence #1 | Mặc định **thất bại** "Insufficient heap headroom" (cần ~2 GB, có 1,8 GB); chạy được với `NODE_OPTIONS=--max-old-space-size=6144` | Trang module liệt kê đúng `app/controller/*.js`, `app/view/*.js` |
| 3 | `javascript-facts` lọc `endpoint_kind` | Evidence #1 | 177 "endpoint network", **tất cả** là `Common.Utils.InternalSettings.get("de-…")`, `record.get("name")`… của Backbone | Dương tính giả; không tìm thấy URL thật nào (`/coauthoring/...`, websocket nằm trong sdkjs, chưa phân tích được) |
| 4 | `--view javascript-routes` | như #1, chạy lại 3 phút | 0 route | REA tự ghi: 10 khối script inline trong `index.html` không được phân tích |
| 5 | `trace-application-feature` seed chuỗi `downloadas` | Evidence #1 | 48 seed khớp (46 là khóa trong JSON locale), 2.233 nút, 290 đường | Nhiễu; 2 khớp đúng là module `app/controller/Main.js` |
| 6 | `import-reference-source` | nguồn công khai `web-apps` tag `v9.4.0.129`, thư mục `apps/documenteditor/main` (5.186 mục) | Xong 12 giây, đồ thị 1,3 MB | Tag trùng build 129 ghi trong `build.txt` của image |
| 7 | `compare-source-to-bundle` | #6 ↔ Evidence #1 | **unchanged 95, modified 4, duplicated 21, removed 0, unknown 414** | 4 modified = `app.js`, `controller/Main.js`, `view/FileMenuPanels.js`, `view/LeftMenu.js` (thay placeholder). 414 unknown = 385 `resources/help/**` + 27 `app/template/*.template` (không phải JS) + `app_dev.js`, `app_pack.js` không ship |
| 8 | `analyze-javascript-application` | `sdkjs/word` | `sdk-all-min.js` (3,5 MB) **hết giờ 300 s**; chạy lại với hạn 25 phút và heap 3 GB cũng **hết giờ** (mục 4.1) | Lõi editor là nơi có endpoint thật; REA không đọc nổi |
| 9 | `inspect-artifact` | `server/DocService/docservice` | Nhận ELF, không phải Node SEA → "cần `open_binary` với provider native" | Binary `pkg` không bóc được |
| 10 | `inspect-elf-notes` | `x2t` | OK: ELF64 x86-64, build-id `ecfa6d79…d151deb6` | `docservice` bị từ chối vì > 64 MiB |
| 11 | `analyze --provider objdump` | `x2t` | Lỗi `capability_unavailable`: provider hợp lệ chỉ `ghidra, hopper, ida, kuna` | Lab chưa cài Ghidra (cần Java 21 + Ghidra 12.1.x) |

Bằng chứng rút gọn (JSON) lưu ở `poc/onlyoffice/evidence/rea-2026-10-26/`; Evidence đầy đủ (124 MB và 230 MB) chỉ nằm trong scratch của phiên, không đưa vào repo.

### 4.1 Lần chạy lại `sdk-all-min.js`

Chạy lại chỉ riêng `sdk-all-min.js` với `--analysis-timeout-ms 1500000 --max-heap-mb 3072` (2026-10-26, 14:21–14:46): **lại hết giờ** sau 25 phút, mã `provider_timeout`, tiến trình dừng ở pha `javascript_worker_static` giống lần đầu. REA không trả Evidence một phần cho tệp này. Kết luận: REA 6.8.0 không phân tích được lõi editor ONLYOFFICE đã minify (3,5 MB) trong hạn hợp lý trên máy này; bản chưa minify `sdk-all.js` (28 MB) còn lớn gấp tám lần nên không thử tiếp. Lõi này đọc trực tiếp ở repo `ONLYOFFICE/sdkjs`, nhánh `release/v9.4.0`.

## 5. Đối chiếu độc lập với mã nguồn công khai (không qua REA)

Tải bốn tệp từ `https://raw.githubusercontent.com/ONLYOFFICE/web-apps/v9.4.0.129/...` rồi `diff` với bản trong image:

| Tệp | Khác biệt |
|---|---|
| `apps/documenteditor/main/app/controller/Main.js` | Chỉ `{{HELP_CENTER_WEB_DE}}` → URL help, `{{APP_TITLE_TEXT}}` → tên app |
| `apps/documenteditor/main/app.js` | Chỉ thêm `'use strict'` khi build |
| `apps/documenteditor/main/app/view/LeftMenu.js` | Chỉ `{{SUPPORT_URL}}` → `https://support.onlyoffice.com` |
| `apps/api/documents/api.js` ↔ `api.js.tpl` | Thêm worker nhúng `AscEmbed`, `{{PRODUCT_VERSION}}` → `9.4.0`, `_dc=9.4.0-129` |

Mỗi tệp đều mang header AGPL-3.0 của Ascensio System SIA, kèm điều khoản bổ sung (hiển thị "Appropriate Legal Notices" theo AGPL §5, không cấp quyền nhãn hiệu, phần phi mã theo CC BY-SA 4.0).

## 6. Giấy phép và ranh giới dùng kết quả

- ONLYOFFICE Docs CE: AGPL-3.0 + điều khoản bổ sung (có trong `LICENSE.txt` của image). Nhúng hoặc sửa mã ONLYOFFICE vào VCworkspace kéo theo nghĩa vụ AGPL (công bố mã sửa đổi khi cung cấp qua mạng, giữ thông báo pháp lý). Gọi Document Server qua HTTP/JWT như hiện nay (`drive-basic`, `/bo-nho/soan-thao`) là cách giữ VCworkspace tách giấy phép.
- REA MIT; `DISCLAIMER.md` nói rõ không hỗ trợ "copying proprietary software or reproducing its protected code and assets" và kết quả phân tích không cấp quyền với chương trình gốc. Với ONLYOFFICE, quyền đến từ AGPL chứ không từ REA.
- Mục 5.3 báo cáo khả thi vẫn đúng: với SaaS đóng (Google, Microsoft, Adobe, CapCut) điều khoản cấm reverse engineering; REA không đổi điều đó.

## 7. Đánh giá REA cho VCworkspace

Có ích khi: đích **không có mã nguồn** (binary thương mại, APK, Electron đóng gói) và cần bằng chứng có hash, có giới hạn rõ. Điểm mạnh thấy được: mọi kết quả đều ghi `limitations`/`unknowns`, ID bằng SHA-256, so sánh nguồn ↔ bundle có thang điểm minh bạch.

Không có ích khi: đích là mã nguồn mở (ONLYOFFICE, Nextcloud, Stalwart, Authentik): đọc repo nhanh hơn, đủ hơn, và REA còn tạo nhiễu (dương tính giả endpoint, route rỗng).

Chi phí vận hành đo được: Evidence 124 MB cho một app 102 MB; cần heap 6 GB để chiếu view; tệp minify 3,5 MB vượt hạn 5 phút; binary native cần cài thêm Ghidra (Java 21, vài trăm MB) hoặc Hopper/IDA có phí.

## 8. Chưa làm và vì sao

- Ghidra/Hopper/IDA: không cài. Mã native của ONLYOFFICE (`x2t`, `.so`) là C++ mở trong repo `core`; dịch ngược không đem lại gì.
- Quan sát website/HAR (REA điều khiển Chrome): cần trình duyệt trong lab; luồng mạng editor ↔ Document Server đã được ghi trong bàn giao chat04/05/09 bằng test thật.
- Không đăng ký REA làm MCP của Claude Code trên máy này (SECURITY.md: không phải sandbox; máy có `.env`, Docker, tài khoản).

## 9. Câu hỏi cho chủ dự án

1. "Code ngược ONLYOFFICE" nhằm mục đích gì: (a) hiểu luồng để tích hợp sâu hơn, (b) tùy biến giao diện/thương hiệu, hay (c) tự viết editor riêng? Với (a) và (b) dùng nguồn công khai và cơ chế `customization` của Document Server; (c) không khả thi trong phạm vi hiện tại và vướng AGPL nếu sao chép.
2. Có muốn giữ lab `poc/rea-lab` cho các đích đóng sau này (ví dụ app Android/Electron của bên thứ ba mà công ty được phép phân tích) không? Nếu không, xoá image `rea-lab:6.8.0` bằng `docker rmi`.

## 10. Nguồn đã đọc

- https://github.com/morluto/rea (README, `docs/cli.md`, `docs/javascript-application-workflows.md`, `docs/javascript-route-inventory.md`, `docs/node-sea.md`, `docs/mcp-contracts.md`, `SECURITY.md`, `DISCLAIMER.md`, `package.json`), release `rea-agents-6.8.0` 2026-10-25.
- https://github.com/ONLYOFFICE/DocumentServer (release v9.4.0 2026-05-19, AGPL-3.0); `web-apps`, `sdkjs`, `server`, `core` (AGPL-3.0; nhánh `release/v9.4.0`, tag `v9.4.0.129`).
- Image cục bộ `onlyoffice/documentserver:9.4.0.1` (digest lớp đã có từ chat04), `poc/onlyoffice/README.md`.
