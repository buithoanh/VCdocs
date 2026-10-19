# Nguồn của openapi.yaml

| Ngày | Bản hợp đồng (rev tab Claude Docs) | Mục đã đưa vào | Ghi chú |
|------|-------------------------------------|----------------|---------|
| 2026-10-19 | rev 7 | 1–6 (mục 7 Bảo mật, 8 Sửa đổi BA còn trống) | Giai đoạn 1: M01–M09, M14, /jobs |
| 2026-10-19 | rev 16 | 7, 8 (đối chiếu lại 1–6) | Mục 7: 429 kèm Retry-After (600/phút/người, tìm kiếm 60/phút), thân ≤ 1 MB, file ≤ 100 MB (413, giả định), trường lạ bị loại không báo lỗi → bỏ additionalProperties: false ở schema đầu vào. Mục 8 Q4: phiên 8 giờ tự gia hạn. M16 (giai đoạn 2), format_violation, MAIL_MODE: ngoài phạm vi, không đổi openapi. Thân tài liệu ghi "ĐÃ CHỐT v1" nhưng tên vẫn [Đề xuất] |
| 2026-10-20 | rev 19 | 9 (chốt sau lần code đầu) + sửa đầu tài liệu, mục 7, 8 | D1–D14: R4 lập hồ sơ; người soạn được trình; GET /users/lookup; nghỉ việc → leaving; hold.reasonType; Delegation.recordTypeId + isLegalSignature; chia sẻ detected không cần hạn; thư mục gốc drive; enum allowedActions từng đối tượng; people; Job.type + result; /me blockId + limits; callback lỗi → 302 /dang-nhap?loi=; thêm mã lỗi 403/409/413/422. Phiên bản 1.1.0-gd1 |
