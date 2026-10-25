# VCworkspace 06 — bàn giao Slide

- Ngày: 2026-10-23.
- Checkout: `/Users/apple/projects/VCdocs`, nhánh `claude/nghien-cuu-vcworkspace`.
- Phạm vi: local cô lập, Google giả, MongoDB thử, Nextcloud và ONLYOFFICE thật;
  không deploy, dữ liệu thật, commit hoặc push.
- Kết luận: **API/UI/Drive version, editor và slideshow browser thật, reader
  chỉ xem, xuất PPTX/PDF V2 và render QA đều đạt trong phạm vi local cô lập.**
  Phiên này không tự mở chat07.

## 1. Hợp đồng và mã đã làm

Hợp đồng lên `1.9.0-gd1`; nguồn quyết định chat06 và đề nghị P01–P04 đã ghi ở
`contract/NGUON.md` và `apps/api/DE_NGHI_SUA_HOP_DONG.md`; schema FE được sinh
lại từ OpenAPI viết tay.

- `POST /drive/presentations` tạo PPTX ba slide tỷ lệ 16:9, tiếng Việt, gồm
  title/body, ba khối bố cục và bảng; font Liberation Sans.
- Editor dùng chung vé HMAC, JWT, callback same-origin/chặn SSRF, key theo
  fileId + version, idempotency và stale-key của chat04/05; PPTX dùng
  `documentType=slide`, manager `edit`, reader `view`.
- Callback kiểm package PPTX có presentation và slide thật trước khi tạo version
  bất biến; package chỉ có magic `PK` không đủ điều kiện.
- Export native trả đúng current version PPTX; PDF đi qua converter thật và
  kiểm `%PDF`.
- UI `/bo-nho` có tạo từ mẫu, mở trình chiếu, xuất PPTX/PDF và nhận upload PPTX.
  DOCX/XLSX giữ các nhánh MIME/documentType/export riêng.
- Browser phát hiện `height=calc(...)` bị DocsAPI đặt thành thuộc tính iframe
  HTML không hợp lệ và rơi về 150px; đã sửa thành `720px`, canvas editor hiển
  thị đủ thay vì chỉ còn toolbar.

## 2. Bằng chứng test và engine thật đã chạy

- Target local: `drive-presentations.e2e-spec.ts` + regression
  `drive-documents.e2e-spec.ts`: **4/4 đạt**. Chứng minh manager/reader,
  V1→V2, mở lại key V2, retry không sinh V3 và callback stale bị từ chối.
- Tích hợp thật `node poc/onlyoffice/run-integration.mjs`: **3/3 đạt** cho
  DOCX, XLSX và PPTX. Ca PPTX tạo trong Nextcloud, config slide edit/view,
  package có 3 slide/font/text tiếng Việt; ONLYOFFICE 9.4.0.1 xuất PDF 64.393
  byte, `pdfinfo` xác nhận 3 trang và `pdftotext` thấy nội dung slide 2/3.
- Full gate trên cây hiện tại: **PASS** — guard/gate 44/44, OpenAPI hợp lệ
  (153 warning hiện có), BE 139/139 (3 integration opt-in skip), coverage hợp
  đồng 118/118, FE 72/72, typecheck và production build đạt.

## 3. Browser V2 và kiểm nội dung xuất

Harness TEST đã chạy ở loopback, seed trình chiếu:

- runId `chat06final`;
- fileId `6adb4f76f2890f1546ee8087`;
- V1 SHA-256 `1f24da388d98addadb43e3d7f178cc6dfa4e6a59c0d455f85f1598e0685ec303`.

Sau khi human mở khóa macOS, browser manager đã:

1. mở đúng PPTX bằng ONLYOFFICE thật ở mode `edit`;
2. thay tiêu đề slide 1 thành marker chỉ có ở V2 `NOI DUNG CHAT06 V2`;
3. thêm ellipse trên slide 2 để chứng minh sửa bố cục, bấm Save và thấy
   “Đã lưu mọi thay đổi”;
4. về Drive thấy kích thước 20.241 byte và đúng hai nút bản 2/bản 1;
5. mở lại cùng fileId, thấy marker V2 và ellipse; chạy slideshow hiện
   “Slide 1 trên 3”;
6. đăng nhập reader riêng, danh sách không có nút ghi và editor ở “Sẵn sàng
   xem”, toolbar không có Save/chỉnh sửa.

Xuất chính currentVersion V2:

- PPTX: 20.241 byte, SHA-256
  `aca135f2564580909a34f3539cf197475e198345ef1ceca06d7f78ec51e08e7a`;
- PDF: 65.797 byte, SHA-256
  `0743fd3546b44bbc424da53d75d52185dd7e74934d104615ec76fd29976469cb`;
- giải PPTX xác nhận ba slide, relationships, `screen16x9`, marker V2,
  `prst="ellipse"` ở slide 2 và Liberation Sans;
- `pdfinfo` xác nhận 3 trang 960×540; `pdftotext -layout` thấy đầy đủ marker,
  tiếng Việt, nội dung ba slide;
- render 120 DPI ba trang được xem trực tiếp: không thấy tràn, cắt nội dung hay
  mất glyph tiếng Việt. Ellipse V2 nằm trong trang và chồng có chủ ý một phần
  lên khối giữa để chứng minh thay đổi bố cục.

Bằng chứng: `poc/onlyoffice/evidence/chat06-browser-v2.json`, `.pptx`, `.pdf`
và ba PNG trong `poc/onlyoffice/evidence/chat06-render/`.

## 4. Giới hạn chưa được nâng thành kết luận production

Chưa kiểm hiệu ứng/chuyển cảnh phức tạp, font bên ngoài, coediting nhiều người
dưới tải, 48 người, SLA, sizing hay legal/license production. Chưa deploy,
commit, push, dùng Google/dữ liệu thật hoặc restart/purge container healthy.
