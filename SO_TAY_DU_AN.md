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

- **Mục tiêu:** _(chưa xác định — điền khi rõ)_
- **Chủ dự án:** Bùi Thọ Anh
- **Trạng thái hiện tại:** Khởi tạo kho, mới có README, `CLAUDE.md` và sổ tay.
- **Kho mã:** https://github.com/buithoanh/VCdocs (private), nhánh chính `main`.
- **Thư mục local:** `/Users/apple/projects/VCdocs`

## 2. Quyết định đã chốt

| Ngày | Quyết định | Lý do |
|------|-----------|-------|
| 2026-10-19 | Đổi tên dự án từ VCknowledge sang VCdocs | Theo yêu cầu chủ dự án |
| 2026-10-19 | Dùng `SO_TAY_DU_AN.md` làm kênh trao đổi giữa các phiên | Giữ ngữ cảnh chung, tránh làm lại |

## 3. Việc đang làm / cần làm

- [ ] Xác định mục tiêu và phạm vi của VCdocs
- [ ] Chủ dự án quyết định xoá repo cũ `buithoanh/VCknowledge` (vẫn còn trên GitHub, nội dung trùng)

## 4. Câu hỏi mở (chờ người dùng trả lời)

- _(trống)_

## 5. Lưu ý & bài học

- Máy local chưa cài `gh` CLI; thao tác GitHub (tạo, đổi tên, xoá repo) phải làm trên web.
- Git dùng thông tin đăng nhập trong macOS Keychain. Repo private nên gọi API GitHub không đăng nhập luôn trả 404.
- `VCdocs` là repo tạo mới chứ không phải đổi tên từ `VCknowledge`, nên GitHub không tự chuyển hướng URL cũ.

## 6. Nhật ký các phiên

### 2026-10-19 · Khởi tạo repo và đổi tên sang VCdocs
- Đã làm: clone repo trống `VCknowledge`, tạo README và commit đầu tiên. Đổi tên thư mục local, README và remote sang `VCdocs`. Push `main` lên repo trống `buithoanh/VCdocs`.
- Còn dở: repo cũ `VCknowledge` chưa xoá, chờ chủ dự án quyết định.

### 2026-10-19 · Tạo sổ tay dự án
- Đã làm: tạo `SO_TAY_DU_AN.md` và `CLAUDE.md` (nhắc mọi phiên đọc/ghi sổ tay).
- Còn dở: chưa có nội dung dự án.
