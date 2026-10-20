# BA và đặc tả người dùng – Phần mềm quản lý tài liệu – hồ sơ VC Phồn Vinh

Oct 19, 2026 · @Thọ Anh Bùi

Đề xuất xây phần mềm **VCdocs** (tên tạm) bằng NestJS – Next.js – MongoDB để số hoá toàn bộ QĐ-VCPV-01, QT-VCPV-01 và QT-VCPV-02: file vẫn nằm trên Google Drive công ty, phần mềm thay các bảng tính danh mục, sổ chia sẻ ngoài và luồng email trình duyệt.

## 1. Thông tin tài liệu

| Mục | Nội dung |
| --- | --- |
| Loại | Hồ sơ đề xuất (BA – phân tích nghiệp vụ, kèm đặc tả người dùng) |
| Người đề xuất | Bùi Thọ Anh |
| Người xem xét | Anh Hùng (IT), HCNS, Giám đốc khối Vận hành nội bộ \[..\] |
| Người phê duyệt | Tổng giám đốc |
| Mức bảo mật | Nội bộ |
| Trạng thái | Nháp |

**Mục đích.** Mọi người dùng đúng bản tài liệu đang hiệu lực; hồ sơ lập đúng chỗ, chốt xong không sửa được, tìm nhanh, giữ đủ thời hạn, huỷ có kiểm soát — và tất cả có dấu vết kiểm tra được khi đánh giá ISO 9001.

**Phạm vi phần mềm.**

- Có: tài liệu hệ thống (QĐ, QT, HD, BM, tài liệu bên ngoài); hồ sơ (báo cáo, đề xuất, trình duyệt, biên bản, thông báo, hợp đồng, PO, hồ sơ xe, học viên, nhân sự); bảng mã; danh mục tài liệu, danh mục hồ sơ; trình duyệt – ban hành – huỷ bỏ; chia sẻ ngoài; bàn giao; rà soát và huỷ hồ sơ; phân quyền theo 11 drive.
- Không: soạn thảo nội dung file (vẫn làm trên Google Docs/Sheets/Slides); phần mềm kế toán, ERP; quản lý công việc (đã có VCPV\_TodoList).

**Căn cứ.** ISO 9001:2015 mục 7.5 · QĐ-VCPV-01 Quy định kiểm soát tài liệu – hồ sơ · QĐ-VCPV-03 Quy định phân quyền phê duyệt · QT-VCPV-01 Quy trình khởi tạo, ban hành và sửa đổi tài liệu · QT-VCPV-02 Quy trình lập, lưu giữ và huỷ hồ sơ · HD-VCPV-02 Hướng dẫn đặt tên và trình bày file · HD-VCPV-05 Hướng dẫn lưu, chốt và tra cứu hồ sơ · BM-VCPV-05 đến 08 · Luật Kế toán, NĐ 174/2016, Luật Bảo vệ dữ liệu cá nhân 2025.

## 2. Hiện trạng, vấn đề và mục tiêu

Hệ thống hiện chạy bằng tay trên Google Drive: đúng quy định trên giấy, nhưng phụ thuộc vào việc từng người nhớ làm đủ bước.

| Việc | Hiện tại | Vấn đề |
| --- | --- | --- |
| Cấp mã tài liệu | HCNS tra Bảng mã, Danh mục tài liệu (Google Sheets) | Dễ trùng số, quên ghi dòng; Danh mục mới ghi 1/14 văn bản |
| Trình duyệt – ban hành | Email theo BM-VCPV-05, dán link luồng email vào bảng đầu file | Không biết văn bản nào đang chờ ai; quên cập nhật Danh mục sau khi duyệt |
| Đặt tên file, thư mục | Theo HD-VCPV-02, tự gõ | Sai mẫu tên, sai thư mục tháng, lập ở Drive của tôi rồi quên chuyển |
| Chốt hồ sơ | Xuất PDF, đặt tên phiên bản bằng tay | Không có gì chặn sửa hồ sơ đã chốt |
| Chia sẻ ngoài | Ghi Sổ chia sẻ ngoài (BM-VCPV-07) | Quên gỡ quyền khi hết việc; không ai rà |
| Thời hạn lưu, huỷ | Danh mục hồ sơ + rà soát hằng năm | Không có nhắc việc; không lọc được hồ sơ hết hạn |
| Bàn giao khi nghỉ việc | BM-VCPV-08 + quản trị viên chuyển quyền | Dễ sót file nằm ngoài drive phòng |

**Mục tiêu và chỉ số thành công** (đo sau 3 tháng vận hành \[..\]):

| Mục tiêu | Chỉ số | Đích |
| --- | --- | --- |
| Danh mục đầy đủ, đúng | Tài liệu hệ thống trên Drive có trong Danh mục | 100% |
| Không trùng, không sai mã | Mã tài liệu, mã hồ sơ do phần mềm cấp | 100% |
| Duyệt nhanh | Thời gian từ trình duyệt đến ban hành | ≤ \[..\] ngày làm việc |
| Đặt tên đúng | File mới sai mẫu tên phát hiện khi rà | ≤ \[..\]% |
| Chia sẻ ngoài có kiểm soát | Lượt chia sẻ ngoài quá hạn chưa gỡ | 0 |
| Đánh giá ISO | Thời gian lấy bằng chứng cho một yêu cầu của chuyên gia đánh giá | ≤ 5 phút |

## 3. Thuật ngữ và đối tượng dữ liệu

Phần mềm quản lý 12 đối tượng; hai đối tượng chính là **Tài liệu** (hướng dẫn làm việc, sửa có kiểm soát) và **Hồ sơ** (bằng chứng việc đã làm, chốt xong không sửa).

| Đối tượng | Là gì | Thông tin chính |
| --- | --- | --- |
| Khối | Nhóm phòng ban theo QĐ-VCPV-02 | Mã, tên, giám đốc khối |
| Phòng ban (Drive) | Một Bộ nhớ dùng chung cấp 1 (11 cái) | Số (00–22), mã phòng, tên, mức bảo mật, trưởng phòng, ID drive |
| Division | Tiền tố mã (VCP, VCSO, VCE, VCSE, VCPV), không làm thư mục | Mã, tên |
| Bảng mã | Danh sách mã được phép dùng (phòng, chức năng, kênh, đối tượng) | Mã, ý nghĩa, phạm vi, trạng thái chờ duyệt / đã duyệt |
| Thư mục | Thư mục trên Drive theo khung 00–99 | Số, mã chức năng, tên, cha, ID Drive, loại (tài liệu / hồ sơ vận hành / mảng / dự án / năm / tháng / đối tượng) |
| Tài liệu | QĐ, QT, HD, BM, tài liệu bên ngoài | Mã (Loại-Mã phòng-Số), phiên bản, tên, cấp (VCPV / phòng), trạng thái, người soạn, kiểm tra, phê duyệt, ngày hiệu lực, kỳ rà soát, thay thế cho, ID file |
| Phiên bản | Mỗi lần ban hành của một tài liệu | Số phiên bản, ngày, nội dung thay đổi, người duyệt, loại sửa (lớn / nhỏ), tên phiên bản trên Google |
| Loại hồ sơ | Một dòng trong Danh mục hồ sơ | Phòng, tên loại, quy tắc tên + ví dụ, nơi lưu, người giữ, thời hạn (số năm + căn cứ luật), cách huỷ, mức bảo mật |
| Hồ sơ | Một file bằng chứng | Mã, loại (Kế hoạch · Báo cáo · Đề xuất · Trình duyệt · Giao việc · Biên bản · Thông báo), nội dung, ngày lập, tháng công việc, thư mục, trạng thái, ID file, ID bản PDF, vị trí bản giấy, hạn lưu đến |
| Phiếu trình duyệt | Một lần xin phê duyệt (thay luồng email) | Đối tượng, người trình, người duyệt theo thẩm quyền, ý kiến, kết quả, thời điểm |
| Lượt chia sẻ ngoài | Một dòng Sổ chia sẻ ngoài | File, email đối tác, quyền (Xem / Nhận xét), lý do, người chia sẻ, ngày hết hạn, ngày gỡ |
| Biên bản | Bàn giao (BM-VCPV-08) hoặc huỷ (BM-VCPV-06) | Danh sách file, người giao – nhận hoặc người duyệt huỷ, trạng thái |

**Trạng thái tài liệu:** Đang soạn → Nháp → Chờ phê duyệt → Hiệu lực → (Đang sửa đổi) → Hết hiệu lực. **Trạng thái hồ sơ:** Đang lập → Chờ phê duyệt → Đã chốt → Giữ lại (không được huỷ) → Đề nghị huỷ → Đã huỷ.

## 4. Vai trò người dùng và ma trận quyền

Phần mềm có 9 vai trò; một người có thể giữ nhiều vai trò, và quyền trên dữ liệu luôn bị giới hạn thêm bởi mức bảo mật của drive (Nội bộ · Phòng ban · Mật).

| Mã | Vai trò | Ai (hiện tại) | Việc chính trong phần mềm |
| --- | --- | --- | --- |
| R1 | Tổng giám đốc / Ban Điều hành | Anh Thọ Anh, thành viên BĐH \[..\] | Phê duyệt QĐ, QT cấp VCPV, Bảng mã, thời hạn lưu, danh sách huỷ; xem bảng điều khiển toàn công ty |
| R2 | Giám đốc khối | Theo QĐ-VCPV-02 \[..\] | Phê duyệt QT cấp phòng trong khối; GĐ khối Vận hành nội bộ kiểm tra QĐ, QT và phê duyệt HD cấp VCPV |
| R3 | Kiểm soát tài liệu | HCNS \[..\] | Cấp mã, giữ danh mục, ban hành tài liệu cấp VCPV, kiểm tra bàn giao, xem nhật ký |
| R4 | Trưởng phòng (Quản lý drive) | Anh Toàn, Hiếu, Trung, Hà, Hùng, Tú | Đề nghị và rà soát tài liệu phòng; phê duyệt HD, BM cấp phòng; lập danh mục hồ sơ phòng; duyệt huỷ; nhận bàn giao; quản lý quyền drive |
| R5 | Leader (Quản lý nội dung) | Phi, Hữu Hùng, Hữu, Công, Huyền | Như nhân viên + sắp xếp thư mục mảng, duyệt hồ sơ nghiệp vụ theo bảng uỷ quyền của khối |
| R6 | Nhân viên (Đóng góp) | Mọi nhân sự | Lập hồ sơ, soạn nháp tài liệu được giao, trình duyệt, chia sẻ ngoài, tra cứu |
| R7 | Người xem | Nhân sự phòng khác, thực tập | Xem, tìm kiếm trong phạm vi được phép |
| R8 | Kế toán trưởng | Anh Hà \[..\] | Xác nhận thời hạn lưu chứng từ kế toán; chủ trì huỷ chứng từ kế toán |
| R9 | Quản trị hệ thống | IT – anh Hùng | Cấu hình kết nối Google, nhóm Google, sao lưu; không mặc nhiên xem drive Mật |

**Ma trận quyền** (L = làm · P = phê duyệt · X = xem · — = không):

| Chức năng | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cấp mã tài liệu | X | X | L | Đề nghị | — | — | — | — | — |
| Soạn nháp tài liệu | X | X | X | L | L | L (được giao) | — | — | — |
| Phê duyệt QĐ, QT cấp VCPV | P | Kiểm tra | X | X | — | — | — | — | — |
| Phê duyệt QT cấp phòng | X | P | X | X | — | — | — | — | — |
| Phê duyệt HD, BM cấp phòng | X | X | X | P | — | — | — | — | — |
| Ban hành, huỷ bỏ tài liệu | P | P | L (VCPV) | L (phòng) | — | — | — | — | — |
| Lập, chốt hồ sơ | X | X | X | L | L | L | — | L | — |
| Danh mục hồ sơ phòng | P (thời hạn) | X | X | L | X | X | X | Xác nhận (kế toán) | — |
| Chia sẻ ngoài | X | X | X | L + gỡ | L | L | — | L | — |
| Bàn giao | X | X | Kiểm tra | Nhận | L | L | — | — | Chuyển quyền |
| Đề nghị, duyệt huỷ hồ sơ | P | X | X | P | L (người giữ) | — | — | Chủ trì (kế toán) | — |
| Xoá vĩnh viễn file | — | — | — | L (sau khi duyệt) | — | — | — | — | — |
| Bảng mã | P | X | L | Đề nghị | X | X | X | X | — |
| Người dùng, nhóm, cấu hình | X | — | X | X (phòng mình) | — | — | — | — | L |
| Nhật ký thao tác | X | X (khối) | X | X (phòng) | — | — | — | — | X |

## 5. Quy trình nghiệp vụ

Phần mềm chạy đúng hai vòng đời đã viết trong QT-VCPV-01 và QT-VCPV-02; điểm mới là nó khoá lại ở hai chỗ (Ban hành, Chốt) và tự làm các bước giấy tờ đi kèm.

> Sơ đồ "vòng đời tài liệu và hồ sơ" (8 bước mỗi loại) là hình vẽ trong bản gốc, bản Markdown không giữ được. Xem ở https://claude.ai/artifact/74kFt4rhgHd3ecPmgitRYc (mục 5).

Đọc từ trái sang phải ở hàng trên, rồi phải sang trái ở hàng dưới. Tài liệu: người soạn hoặc trưởng phòng trình; huỷ bỏ phải qua phiếu duyệt; sửa lớn quay lại bước 3 với phiên bản mới trong lúc bản cũ vẫn dùng. Hồ sơ: người duyệt yêu cầu sửa thì quay về người lập; hồ sơ Giữ lại bị bỏ khỏi danh sách huỷ.

**Phần mềm tự làm thay người ở từng bước:**

| Bước | Trước đây làm tay | Phần mềm làm |
| --- | --- | --- |
| Cấp mã | Tra Danh mục, gõ số kế tiếp | Đánh số, chặn trùng, ghi sổ |
| Soạn nháp | Tạo bản sao biểu mẫu, đặt tên, chuyển thư mục | Tạo file đúng chỗ, đúng tên, điền sẵn bảng nhận diện |
| Trình duyệt | Email BM-VCPV-05, tự tìm người duyệt | Phiếu duyệt, chọn người theo thẩm quyền, nhắc hạn |
| Ban hành | 6 việc rời: bảng đầu file, tên phiên bản, chuyển file, Danh mục, thông báo | Một nút làm cả 6 |
| Lập hồ sơ | Tự gõ tên, tìm thư mục tháng | Chọn loại + tháng, tự đặt tên, đặt chỗ |
| Chốt | Xuất PDF, đặt tên phiên bản | Xuất PDF, đặt tên, hạ quyền xuống Xem |
| Chia sẻ ngoài | Ghi Sổ, nhớ gỡ | Có hạn, tự gỡ, tự ghi sổ |
| Bàn giao | Liệt kê file bằng tay | Liệt kê tự động mọi thứ người đó giữ |
| Lọc hết hạn | Lọc Danh mục bằng tay | Lọc sẵn, bỏ hồ sơ Giữ lại, lập biên bản |

## 6. Danh sách chức năng

Phần mềm gồm 15 phân hệ (module); giai đoạn 1 (MVP) làm 9 phân hệ đủ để bỏ các bảng tính danh mục và luồng email trình duyệt.

| Mã | Phân hệ | Làm được gì | Giai đoạn |
| --- | --- | --- | --- |
| M01 | Đăng nhập, người dùng | Đăng nhập bằng tài khoản Google @vcprosperous.com; đồng bộ nhân sự, nhóm Google; gán vai trò | 1 |
| M02 | Danh mục nền | Khối, 11 phòng – drive, division, Bảng mã (đề nghị – phê duyệt mã mới) | 1 |
| M03 | Cây thư mục | Đọc cây thư mục từ Drive; tạo thư mục đúng khung 00–99 và đúng mẫu tên; tự tạo thư mục năm / tháng | 1 |
| M04 | Tài liệu hệ thống | Đăng ký, cấp mã, theo dõi trạng thái, phiên bản, ban hành, sửa đổi, huỷ bỏ, tài liệu bên ngoài; thay Danh mục tài liệu VCPV | 1 |
| M05 | Phê duyệt | Phiếu trình duyệt tự tìm đúng người duyệt theo thẩm quyền (QT-VCPV-01 mục 3, QĐ-VCPV-03, bảng uỷ quyền của khối); đồng ý / yêu cầu sửa; thay luồng email BM-VCPV-05 | 1 |
| M06 | Danh mục hồ sơ | Loại hồ sơ từng phòng, quy tắc tên, nơi lưu, người giữ, thời hạn + căn cứ, cách huỷ; thay Danh mục hồ sơ VCPV | 1 |
| M07 | Hồ sơ | Lập hồ sơ từ biểu mẫu, tự đặt tên và đặt đúng thư mục tháng; chốt (xuất PDF, khoá sửa); hồ sơ điều chỉnh; scan hồ sơ giấy, vị trí bản giấy | 1 |
| M08 | Tra cứu | Tìm theo mã, tên, loại, phòng, tháng, trạng thái, người lập; chỉ trả kết quả người tìm được phép xem | 1 |
| M09 | Chia sẻ ngoài | Chia sẻ một file tới email đối tác có hạn; tự gỡ khi hết hạn; thay Sổ chia sẻ ngoài BM-VCPV-07 | 1 |
| M10 | Bàn giao | Lập biên bản bàn giao BM-VCPV-08 tự liệt kê file của người nghỉ; HCNS kiểm tra; chuyển quyền sở hữu | 2 |
| M11 | Rà soát, huỷ hồ sơ | Lọc hồ sơ hết hạn; danh sách đề nghị huỷ; phê duyệt; biên bản huỷ BM-VCPV-06; đánh dấu Giữ lại | 2 |
| M12 | Kiểm tra tuân thủ | Quét Drive hằng đêm tìm 9 lỗi (sai tên, sai chỗ, file .xlsx/.docx, chia sẻ "bất kỳ ai", file ở Drive của tôi…) và giao người sửa | 2 |
| M13 | Bảng điều khiển | Việc chờ tôi; tài liệu sắp tới kỳ rà soát; chia sẻ sắp hết hạn; chỉ số mục 2 theo phòng | 2 |
| M14 | Thông báo | Email (và Zalo \[..\]) khi có việc chờ duyệt, ban hành, sắp hết hạn | 1 |
| M15 | Nhật ký, đánh giá ISO | Ghi mọi thao tác không sửa được; gói bằng chứng cho chuyên gia đánh giá (quyền xem tạm có hạn) | 3 |

Bổ sung 19/10: **M16 Kiểm tra quy cách** (giai đoạn 2) — khi trình duyệt và khi quét, máy kiểm định dạng file theo HD-VCPV-02, HD-VCPV-04; AI (Claude API) đọc nội dung và gửi nhận xét kèm phiếu duyệt. Báo và sửa giúp, không chặn trình.

## 7. Đặc tả người dùng

Mỗi câu chuyện người dùng (US) viết theo mẫu "Là … tôi muốn … để …", kèm tiêu chí nghiệm thu: lập trình viên làm đủ và người kiểm thử bấm thử đạt hết mới được tính xong.

### M01 Đăng nhập, người dùng

**US-01.1** Là nhân viên, tôi muốn đăng nhập bằng tài khoản Google công ty để không phải nhớ thêm mật khẩu.

- Chỉ tài khoản @vcprosperous.com vào được; tài khoản khác (kể cả @vcpart.vn \[..\]) báo "Không có quyền".
- Tài khoản bị khoá trên Google Workspace thì không vào được trong vòng 15 phút.
- Lần đầu đăng nhập, phần mềm tự gán phòng và vai trò theo nhóm Google người đó thuộc về.

**US-01.2** Là quản trị hệ thống, tôi muốn đồng bộ nhóm Google với vai trò trong phần mềm để chỉ cấp quyền một nơi.

- Đồng bộ tự động mỗi đêm và khi bấm "Đồng bộ ngay".
- Thêm người vào nhóm "11-mkt-dong-gop" \[..\] thì người đó có vai trò Nhân viên của 11 MKT.
- Mọi thay đổi vai trò ghi nhật ký: ai, lúc nào, từ gì sang gì.

### M02 Danh mục nền, Bảng mã

**US-02.1** Là trưởng phòng, tôi muốn đề nghị một mã mới (chức năng, kênh, đối tượng) để đặt tên thư mục, hồ sơ đúng quy định.

- Phiếu đề nghị có: mã, ý nghĩa, phạm vi dùng, lý do.
- Mã trùng với mã đã có thì báo lỗi ngay khi gõ.
- Mã ở trạng thái "Chờ duyệt" chưa dùng được để đặt tên; Ban Điều hành phê duyệt xong mới dùng được.

**US-02.2** Là kiểm soát tài liệu, tôi muốn xem Bảng mã theo phòng để trả lời nhanh câu hỏi "mã này nghĩa là gì".

- Lọc theo phòng, loại mã, trạng thái; xuất ra Google Sheets.

### M03 Cây thư mục

**US-03.1** Là trưởng phòng, tôi muốn tạo thư mục mảng hoặc dự án mới từ phần mềm để tên và số luôn đúng khung.

- Chọn loại (mảng 10–49 / dự án 50–89 / hồ sơ vận hành 02–09), phần mềm gợi ý số kế tiếp còn trống.
- Chỉ chọn mã từ Bảng mã đã duyệt; tên ghép tự động "số + MÃ-TÊN NGẮN + tên đầy đủ".
- Thư mục được tạo thật trên đúng Bộ nhớ dùng chung và hiện ngay trên Drive.

**US-03.2** Là nhân viên, tôi không muốn tự tạo thư mục năm, tháng để khỏi đặt sai.

- Ngày 25 hằng tháng \[..\] phần mềm tự tạo thư mục tháng sau (YYYY-MM) trong mọi thư mục có chia năm / tháng.
- Thư mục năm, tháng, đối tượng không có số thứ tự đầu tên.

**US-03.3** Là trưởng phòng, tôi muốn kết thúc một dự án để cây thư mục gọn.

- Bấm "Kết thúc dự án": thư mục chuyển vào 98 Đã kết thúc, giữ nguyên ID; số dự án không cấp lại.

### M04 Tài liệu hệ thống

**US-04.1** Là trưởng phòng, tôi muốn đăng ký một tài liệu mới để được cấp mã và giao người soạn.

- Chọn loại (QĐ chỉ chọn được khi cấp VCPV), cấp (VCPV / phòng), tên, người soạn, hạn soạn.
- Phần mềm hiện tài liệu có tên gần giống để tránh soạn trùng.
- Kiểm soát tài liệu bấm "Cấp mã": số kế tiếp theo Loại-Mã phòng, không trùng, không cấp lại mã đã huỷ; trạng thái "Đang soạn".

**US-04.2** Là người soạn, tôi muốn phần mềm tạo sẵn file nháp từ biểu mẫu khung để khỏi chép tay.

- QĐ lấy BM-VCPV-02, QT lấy BM-VCPV-03, HD lấy BM-VCPV-04 (bản đang hiệu lực).
- File tạo trong đúng thư mục 00 Tài liệu / 01–04 của phòng soạn, tên "Loại-Mã-Số v1 Tên", bảng nhận diện điền sẵn mã, phiên bản, trạng thái Nháp, người soạn.

**US-04.3** Là người soạn, tôi muốn gửi lấy góp ý để người thực hiện đọc trước khi trình.

- Chọn người, phòng nhận góp ý; phần mềm cấp quyền Nhận xét trên file và gửi thông báo.
- Không trình duyệt được khi file còn nhận xét chưa đóng (cảnh báo, trưởng phòng được bỏ qua kèm lý do).

**US-04.4** Là kiểm soát tài liệu, tôi muốn ban hành tài liệu đã duyệt chỉ bằng một nút để không sót bước.

- Một nút làm đủ: đổi trạng thái Hiệu lực; ghi ngày hiệu lực, người duyệt, link phiếu duyệt vào bảng đầu file; đặt tên phiên bản "vN – hiệu lực YYYY-MM-DD"; chuyển file vào thư mục chính thức; cập nhật danh mục; gửi thông báo ban hành tới người áp dụng.
- Bước nào lỗi (ví dụ không chuyển được file) thì dừng, báo rõ, không đổi trạng thái nửa vời.

**US-04.5** Là trưởng phòng, tôi muốn sửa đổi tài liệu đang hiệu lực mà người dùng vẫn đọc bản cũ.

- Chọn "Sửa nhỏ" (không đổi phiên bản, ghi một dòng lịch sử, không cần duyệt) hoặc "Sửa lớn" (lên vN+1, đi lại góp ý – trình duyệt – ban hành).
- Trong lúc sửa lớn, mọi người vẫn thấy bản vN là bản hiệu lực.

**US-04.6** Là trưởng phòng, tôi muốn huỷ bỏ một tài liệu để không ai dùng nhầm.

- Trình huỷ bỏ cùng người duyệt như khi ban hành, ghi lý do và tài liệu thay thế.
- Duyệt xong: thêm "\[HẾT HIỆU LỰC\]" đầu tên, chuyển vào 99 Hết hiệu lực, cập nhật danh mục; không xoá file.

**US-04.7** Là trưởng phòng, tôi muốn được nhắc rà soát tài liệu định kỳ.

- Nhắc trước 30 ngày \[..\] kỳ rà soát; kết quả chọn Giữ nguyên / Sửa / Huỷ bỏ, ghi vào lịch sử phiên bản.

**US-04.8** Là nhân viên, tôi muốn đăng ký tài liệu bên ngoài (luật, tài liệu hãng) để cả công ty biết bản nào đang dùng.

- Không cấp mã nội bộ; ghi nơi ban hành, số hiệu, ngày ban hành, ngày kiểm tra hiệu lực gần nhất.
- Đánh dấu "bị thay thế" thì phần mềm liệt kê tài liệu nội bộ đang dẫn chiếu tới nó.

### M05 Phê duyệt

**US-05.1** Là người trình, tôi muốn phần mềm tự chọn đúng người duyệt để khỏi tra quy định.

- Người duyệt lấy theo bảng thẩm quyền: QĐ, QT cấp VCPV → TGĐ (GĐ khối Vận hành nội bộ kiểm tra trước); QT cấp phòng → GĐ khối; HD, BM cấp phòng → trưởng phòng; hồ sơ nghiệp vụ → theo QĐ-VCPV-03 và bảng uỷ quyền của khối còn hiệu lực.
- Người trình không tự chọn được mình làm người duyệt.

**US-05.2** Là người duyệt, tôi muốn duyệt ngay trên điện thoại để không làm chậm việc.

- Thấy danh sách "Chờ tôi duyệt" kèm link file; bấm Đồng ý hoặc Yêu cầu sửa (bắt buộc ghi nội dung).
- Quá \[..\] ngày làm việc chưa duyệt thì nhắc lại, sau đó báo người trình.
- Ý kiến, thời điểm, người duyệt lưu vĩnh viễn, không sửa được: đây là bằng chứng phê duyệt thay luồng email.

**US-05.3** Là giám đốc khối, tôi muốn nhập bảng uỷ quyền phê duyệt của khối để phần mềm giao duyệt đúng người dưới tôi.

- Mỗi dòng: việc, hạn mức, người được uỷ quyền, từ ngày – đến ngày.
- Hạn mức vượt mức tối đa của GĐ khối trong QĐ-VCPV-03 thì không lưu được.
- Việc liên khối và việc luật yêu cầu người có thẩm quyền ký không giao xuống được.

### M06 Danh mục hồ sơ

**US-06.1** Là trưởng phòng, tôi muốn khai báo các loại hồ sơ của phòng để phần mềm biết đặt tên, lưu ở đâu, giữ bao lâu.

- Mỗi loại: tên, quy tắc tên + ví dụ, thư mục lưu, người giữ (theo chức danh), thời hạn (số năm + căn cứ luật), cách huỷ, mức bảo mật.
- Thời hạn chỉ có hiệu lực khi Ban Điều hành phê duyệt; chứng từ kế toán cần kế toán trưởng xác nhận, hồ sơ nhân sự cần HCNS xác nhận.
- Chưa khai báo loại hồ sơ thì không lập được hồ sơ loại đó qua phần mềm.

### M07 Hồ sơ

**US-07.1** Là nhân viên, tôi muốn lập hồ sơ mới chỉ bằng vài lựa chọn để tên và chỗ lưu luôn đúng.

- Chọn loại hồ sơ, tháng công việc, nhập nội dung ngắn (và số định danh: biển số, số PO, mã lớp nếu là hồ sơ vận hành).
- Phần mềm tạo file Google từ biểu mẫu (nếu có) trong đúng drive / thư mục năm / tháng, tên "\[Mã\] \[Loại\] Nội dung – YYYY-MM-DD" với ngày là ngày lập.
- Tải file lên (ảnh, PDF, XML hoá đơn) cũng được đặt tên, đặt chỗ như vậy; file .xlsx/.docx/.pptx được đổi sang định dạng Google, trừ hoá đơn, giấy tờ ký, scan.

**US-07.2** Là người lập, tôi muốn chốt hồ sơ sau khi duyệt để không ai sửa được bằng chứng.

- Bấm "Chốt": xuất PDF cùng thư mục cùng tên, đặt tên phiên bản "Đã chốt – YYYY-MM-DD", khoá cả file gốc và PDF bằng tính năng khoá file của Google ở chế độ chỉ Quản lý mới mở được; lưu số phiên bản Google và mã băm (dấu vân tay số) của PDF vào VCdocs và kho riêng.
- Hồ sơ đã chốt không có nút sửa; file bị mở khoá hay đổi nội dung thì VCdocs báo đỏ và khoá lại; muốn sửa phải lập "hồ sơ Điều chỉnh" có link tới hồ sơ cũ.
- Không dùng cách hạ quyền từng người trên file: Bộ nhớ dùng chung không cho phép (xem mục 11.1).

**US-07.3** Là người lập, tôi muốn ghi hồ sơ giấy đã scan để tìm được bản giấy khi cần.

- Tải bản scan, nhập vị trí bản giấy (tủ, ngăn, kệ); vị trí ghi cả vào phần Mô tả của file trên Drive.

### M08 Tra cứu

**US-08.1** Là nhân viên, tôi muốn tìm hồ sơ, tài liệu bằng một ô tìm kiếm để khỏi lục từng thư mục.

- Tìm theo mã, từ trong tên, biển số / PO / mã lớp; lọc theo phòng, loại, tháng, trạng thái, người lập.
- Kết quả không bao giờ hiện file người tìm không được xem (kể cả tên file thuộc drive Mật).
- Có kết quả trong ≤ 2 giây với 100.000 hồ sơ \[..\].

**US-08.2** Là nhân viên, tôi muốn thấy ngay bản tài liệu đang hiệu lực để không dùng nhầm bản cũ.

- Tìm một mã tài liệu luôn mở bản Hiệu lực; bản cũ chỉ xem được qua "Lịch sử phiên bản".

### M09 Chia sẻ ngoài

**US-09.1** Là nhân viên, tôi muốn chia sẻ một file cho đối tác có thời hạn để không phải nhớ gỡ.

- Chỉ chia sẻ được từng file, quyền Xem hoặc Nhận xét, tới đúng email; bắt buộc nhập lý do và ngày hết hạn (tối đa \[..\] ngày).
- Không có lựa chọn "Bất kỳ ai có liên kết".
- File thuộc drive Mật cần trưởng phòng phê duyệt trước khi chia sẻ.
- Đến hạn phần mềm tự gỡ quyền và ghi ngày gỡ; trước 3 ngày nhắc người chia sẻ để gia hạn nếu cần.

**US-09.2** Là trưởng phòng, tôi muốn xem sổ chia sẻ ngoài của phòng để biết dữ liệu nào đang ở ngoài công ty.

- Danh sách đang chia sẻ, đã gỡ, quá hạn; gỡ ngay một lượt bằng một nút.

### M10 Bàn giao

**US-10.1** Là HCNS, tôi muốn khi nhập ngày nghỉ việc của một người, phần mềm lập sẵn biên bản bàn giao để không sót file.

- Biên bản BM-VCPV-08 liệt kê: hồ sơ, tài liệu người đó đang giữ hoặc đang soạn, việc chờ duyệt, lượt chia sẻ ngoài còn hiệu lực, file nằm trong Drive của tôi.
- Trưởng phòng xác nhận nhận bàn giao; HCNS kiểm tra trước ngày làm việc cuối; quản trị chuyển quyền sở hữu và gỡ khỏi nhóm.
- Việc chờ duyệt của người nghỉ tự chuyển cho trưởng phòng.

### M11 Rà soát, huỷ hồ sơ

**US-11.1** Là người giữ hồ sơ, tôi muốn phần mềm lọc sẵn hồ sơ hết hạn lưu để lập danh sách đề nghị huỷ.

- Tháng \[..\] hằng năm phần mềm tạo danh sách (phần A BM-VCPV-06) theo từng phòng.
- Hồ sơ đánh dấu "Giữ lại" (tranh chấp, thanh tra, bảo hành, công nợ, hợp đồng chưa thanh lý, BĐH yêu cầu) không vào danh sách.

**US-11.2** Là trưởng phòng và Ban Điều hành, tôi muốn duyệt từng dòng danh sách huỷ.

- Bỏ chọn được từng dòng kèm lý do; chứng từ kế toán phải có kế toán trưởng duyệt.
- Chỉ người quản lý drive xoá vĩnh viễn được, sau khi danh sách đã duyệt; phần mềm lập phần B Biên bản huỷ và lưu vào thư mục năm huỷ.

### M12 Kiểm tra tuân thủ

**US-12.1** Là trưởng phòng, tôi muốn mỗi sáng biết drive phòng mình có gì sai quy định.

- Quét hằng đêm, báo theo phòng: tên sai mẫu, thư mục không đúng khung, file .xlsx/.docx/.pptx không thuộc ngoại lệ, chia sẻ "bất kỳ ai" hoặc ra ngoài không có trong sổ, hồ sơ đã chốt bị sửa, tài liệu hiệu lực chưa có trong danh mục, file công việc ở Drive của tôi, thư mục rỗng lâu ngày, thiếu thư mục tháng.
- Mỗi lỗi có nút "Sửa giúp" khi sửa được tự động (đổi tên, chuyển chỗ) và giao người phụ trách khi không.

### M13 Bảng điều khiển

**US-13.1** Là bất kỳ ai, tôi muốn trang đầu cho thấy việc của tôi.

- Chờ tôi duyệt · tôi đang trình · tài liệu tôi soạn sắp tới kỳ rà soát · chia sẻ của tôi sắp hết hạn · lỗi tuân thủ giao cho tôi.

**US-13.2** Là Tổng giám đốc, tôi muốn thấy tình hình hệ thống tài liệu toàn công ty.

- Số tài liệu theo trạng thái và phòng; tiến độ 10 quy trình ưu tiên; thời gian duyệt trung bình; số lỗi tuân thủ theo phòng; các chỉ số ở mục 2.

### M15 Nhật ký, đánh giá ISO

**US-15.1** Là kiểm soát tài liệu, tôi muốn có nhật ký mọi thao tác để chứng minh khi đánh giá.

- Ghi: ai, lúc nào, làm gì, trên đối tượng nào, giá trị trước – sau; không ai sửa, xoá được nhật ký.

**US-15.2** Là TGĐ, tôi muốn cấp cho chuyên gia đánh giá quyền xem tạm để họ tự tra bằng chứng.

- Quyền xem có hạn ngày, giới hạn theo phòng, chỉ đọc, mọi lượt xem được ghi nhật ký.

### M16 Kiểm tra quy cách (bổ sung 19/10, giai đoạn 2)

**US-16.1** Là người soạn, tôi muốn biết file sai quy cách trình bày ở đâu trước khi trình, để người duyệt không phải trả về vì lỗi hình thức.

- Bấm "Kiểm tra quy cách" hoặc tự chạy khi trình duyệt; kết quả trong ≤ 30 giây với file ≤ 30 trang.
- Docs kiểm: font Times New Roman, cỡ 13 thân và 14 đề mục; có bảng nhận diện 8 ô; có bảng Lịch sử phiên bản cuối file; đủ mục bắt buộc theo loại (HD-VCPV-04 mục 4: QĐ có Xử lý vi phạm, QT có Đầu vào – đầu ra…); tiêu đề cột bảng nền #13233A chữ trắng; không còn ô \[..\] (cảnh báo vàng, không đỏ).
- Sheets kiểm: font Times New Roman cỡ 11; ngôn ngữ bảng tính Việt Nam; cố định dòng 1; dòng tiêu đề nền #13233A chữ trắng; dòng xen kẽ #FFFFFF/#E8EDF3; có tab Hướng dẫn chứa phần nhận diện.
- Mỗi lỗi chỉ đúng vị trí (đoạn, ô, tab) và có nút "Sửa giúp" với lỗi máy sửa được (font, cỡ chữ, màu tiêu đề, cố định dòng, ngôn ngữ, dòng xen kẽ).
- Lỗi định dạng **không chặn** trình duyệt; phiếu duyệt hiện số lỗi còn lại để người duyệt quyết.

**US-16.2** Là người duyệt, tôi muốn có nhận xét nội dung của AI kèm phiếu, để đọc nhanh hơn.

- AI đọc bản đã chụp lúc trình, đối chiếu với loại tài liệu và tài liệu liên quan; nhận xét tối đa 10 ý: sai loại (QT viết như HD), thiếu người làm hoặc thời hạn ở bước, mâu thuẫn với tài liệu đang hiệu lực, câu mơ hồ, chỗ chưa điền.
- Nhận xét ghi rõ "do AI đề xuất", người duyệt đánh dấu Đúng / Bỏ qua từng ý; không ý nào tự sửa file hay tự chặn.
- Chạy với mọi drive, kể cả drive Mật (anh chốt 19/10); nội dung gửi qua Claude API không lưu lại ở VCdocs sau khi có nhận xét, mỗi lượt đọc ghi nhật ký.

**US-16.3** Là trưởng phòng, tôi muốn thấy file đã ban hành, đã chốt nhưng sai quy cách, để sửa dần.

- Quét đêm theo lô các file trong 00 Tài liệu và hồ sơ đã chốt tháng gần nhất; lỗi vào M12 với loại format\_violation, màu vàng.
- File đã khoá: chỉ báo, sửa qua phiếu sửa nhỏ (US-04.5).

**Quy tắc bổ sung:** BR-32 Quy cách định dạng lấy từ HD-VCPV-02, HD-VCPV-04 bản đang hiệu lực, cấu hình được, không viết cứng trong mã. · BR-33 Kết quả kiểm tra quy cách và nhận xét AI không chặn trình duyệt, ban hành, chốt. · BR-34 Nhận xét AI lưu kèm phiếu duyệt, ghi rõ nguồn AI và lựa chọn của người duyệt.

## 8. Quy tắc nghiệp vụ

25 quy tắc dưới đây phần mềm phải tự kiểm tra, không trông vào người dùng nhớ; mỗi quy tắc dẫn về điều khoản gốc để khi quy định đổi thì biết sửa chỗ nào.

| Mã | Quy tắc | Nguồn |
| --- | --- | --- |
| BR-01 | Mã tài liệu = Loại-Mã phòng-Số (2 chữ số), tên file = "Mã vN Tên". Mã đã dùng không cấp lại, kể cả khi tài liệu bị huỷ bỏ | QĐ-VCPV-01 mục 4; QT-VCPV-01 mục 6 |
| BR-02 | QĐ chỉ ban hành ở cấp VCPV. Tài liệu liên quan từ hai phòng trở lên tính là cấp VCPV | QT-VCPV-01 mục 3 |
| BR-03 | Người duyệt: QĐ, QT cấp VCPV → TGĐ; HD cấp VCPV → GĐ khối Vận hành nội bộ; QT cấp phòng → GĐ khối phụ trách; HD, BM cấp phòng → trưởng phòng; BM đi kèm → người duyệt tài liệu chính | QT-VCPV-01 mục 3 |
| BR-04 | Người kiểm tra QĐ, QT là GĐ khối Vận hành nội bộ; của HD là HCNS \[..\] | Sổ tay mục 4, Q1 |
| BR-05 | Người trình không được tự phê duyệt; người soạn không được là người phê duyệt cùng văn bản | ISO 9001 7.5.2 |
| BR-06 | Chỉ một phiên bản Hiệu lực cho mỗi mã tại một thời điểm | QĐ-VCPV-01 mục 5 |
| BR-07 | Sửa nhỏ: không đổi phiên bản, không duyệt lại. Sửa lớn: tăng phiên bản, đi lại góp ý → ban hành | QT-VCPV-01 mục 5 |
| BR-08 | Tài liệu hết hiệu lực không xoá; thêm "\[HẾT HIỆU LỰC\]" đầu tên, chuyển vào 99 Hết hiệu lực | QT-VCPV-01 mục 6 |
| BR-09 | Tên hồ sơ = "\[Mã\] \[Loại\] Nội dung – YYYY-MM-DD"; Loại thuộc 7 giá trị; ngày là ngày lập; hồ sơ vận hành bắt đầu bằng số định danh | HD-VCPV-02 |
| BR-10 | Hồ sơ lưu ở thư mục tháng của công việc (không phải tháng lập); file cả năm để ở thư mục năm | Sổ tay mục 2 |
| BR-11 | Tên thư mục = số 2 chữ số + MÃ-TÊN NGẮN + tên đầy đủ; năm, tháng, đối tượng không đánh số. Số trong khung: 00 Tài liệu, 01 Kế hoạch – Báo cáo, 02–09 vận hành, 10–49 mảng, 50–89 dự án, 98 Đã kết thúc, 99 Lưu trữ | Sổ tay mục 2 |
| BR-12 | Chỉ dùng mã đã duyệt trong Bảng mã | QĐ-VCPV-01 mục 4 |
| BR-13 | Hồ sơ đã chốt không sửa; sai thì lập hồ sơ "Điều chỉnh" dẫn link hồ sơ cũ | QT-VCPV-02 bước 4 |
| BR-14 | Chỉ lưu định dạng Google; ngoại lệ: hoá đơn XML/PDF, giấy tờ ký, scan | Sổ tay mục 2 |
| BR-15 | Chỉ tài khoản @vcprosperous.com; quyền cấp qua nhóm Google, không cấp từng người | QĐ-VCPV-01 mục 6 |
| BR-16 | Mức bảo mật gắn theo drive: Nội bộ (00 Chung), Phòng ban (mặc định), Mật (01, 20, 21, 21b, 22). Danh mục chỉ ghi tên tài liệu Mật, không hiện nội dung | QĐ-VCPV-01 mục 6 |
| BR-17 | Chia sẻ ngoài: từng file, quyền Xem hoặc Nhận xét, đúng email, có hạn, ghi sổ; cấm "Bất kỳ ai có liên kết" | QĐ-VCPV-01 mục 6; HD-VCPV-05 |
| BR-18 | Dữ liệu cá nhân nhân viên, học viên, khách hàng chỉ ở drive phòng xử lý nó | Luật BVDLCN 2025 |
| BR-19 | Không lưu mật khẩu, khoá truy cập trong phần mềm hay Drive; phần mềm cảnh báo khi nội dung tải lên có dạng mật khẩu \[..\] | QĐ-VCPV-01 mục 6 |
| BR-20 | Thời hạn lưu chỉ có hiệu lực khi BĐH duyệt; chứng từ kế toán cần kế toán trưởng xác nhận; luật chặt hơn thì theo luật | QT-VCPV-02 bước 1, mục 2 |
| BR-21 | Hạn lưu đến = ngày kết thúc kỳ của hồ sơ + số năm lưu \[..\] | Chờ chốt |
| BR-22 | Hồ sơ đang tranh chấp, thanh tra, bảo hành, công nợ, hợp đồng chưa thanh lý, hoặc BĐH yêu cầu giữ: không được huỷ | QT-VCPV-02 mục 5 |
| BR-23 | Chỉ người quản lý drive xoá vĩnh viễn, và chỉ hồ sơ trong danh sách huỷ đã duyệt | QT-VCPV-02 bước 10 |
| BR-24 | Uỷ quyền phê duyệt của khối không vượt hạn mức tối đa của GĐ khối; việc liên khối và việc luật yêu cầu người có thẩm quyền ký không giao xuống | QĐ-VCPV-03 Điều 6 |
| BR-25 | Nhân sự nghỉ việc: biên bản bàn giao được HCNS kiểm tra trước ngày làm việc cuối; khoá tài khoản trong ngày nghỉ | QT-VCPV-02 bước 7 |

## 9. Kiến trúc, mô hình dữ liệu, yêu cầu phi chức năng

Nguyên tắc gốc: **Google Drive giữ file, MongoDB giữ sổ sách.** Phần mềm không chứa nội dung file; nó ghi mã, trạng thái, người duyệt, thời hạn, quyền, và ra lệnh cho Drive tạo – đổi tên – chuyển – chia sẻ – gỡ quyền. Ai sửa thẳng trên Drive thì lượt đồng bộ đêm phát hiện và báo lệch.

### 9.1 Thành phần kỹ thuật

| Thành phần | Công nghệ | Việc |
| --- | --- | --- |
| Giao diện web | Next.js (App Router), TypeScript, giao diện tiếng Việt, dùng tốt trên điện thoại | Mọi màn hình người dùng; duyệt nhanh trên điện thoại |
| Máy chủ nghiệp vụ (API) | NestJS, TypeScript; mỗi phân hệ M01–M15 là một module | Kiểm tra quyền, quy tắc BR-01…25, gọi Google |
| Cơ sở dữ liệu | MongoDB (bộ 3 máy chạy song song – replica set – để ghi nhiều bảng cùng lúc an toàn) | Sổ sách, nhật ký |
| Việc chạy nền | Hàng đợi việc trên chính MongoDB (Agenda) hoặc Redis + BullMQ \[..\] | Quét đêm, tạo thư mục tháng, nhắc hạn, gỡ chia sẻ hết hạn |
| Kết nối Google | Drive API, Admin SDK (nhân sự, nhóm), Gmail API gửi thông báo; một tài khoản dịch vụ được uỷ quyền toàn tên miền, là Quản lý trên cả 11 Bộ nhớ dùng chung | Thao tác file, thư mục, quyền |
| Đăng nhập | Google OAuth, chỉ nhận tên miền vcprosperous.com | Không có mật khẩu riêng |
| Nơi chạy | \[..\] (máy chủ thuê tại Việt Nam hoặc Google Cloud) |  |

### 9.2 Các bảng dữ liệu (collection) chính

Mọi collection có trường company\_id (chốt 19/10, Q5) để sau này VCsoft bán cho nhiều công ty trên cùng một hệ thống; giai đoạn 1 chỉ có một giá trị là VC Phồn Vinh.

| Collection | Giữ gì | Liên kết |
| --- | --- | --- |
| users | Nhân sự, email, phòng, chức danh, trạng thái làm việc, ngày nghỉ | groups, departments |
| groups | Nhóm Google ↔ vai trò ↔ drive | users, departments |
| blocks · departments · divisions | Khối, 11 phòng – drive (ID drive, mức bảo mật, trưởng phòng), tiền tố division |  |
| codes | Bảng mã, trạng thái duyệt | approvals |
| folders | Cây thư mục, ID Drive, số, mã, loại, cha | departments |
| documents · document\_versions | Tài liệu và từng phiên bản | approvals, folders |
| record\_types | Danh mục hồ sơ: quy tắc tên, nơi lưu, thời hạn, căn cứ | departments |
| records | Hồ sơ: mã, loại, tháng công việc, trạng thái, ID file, ID PDF, vị trí giấy, hạn lưu, cờ Giữ lại | record\_types, folders, approvals |
| approvals | Phiếu trình duyệt + các bước + ý kiến | mọi đối tượng cần duyệt |
| delegations | Bảng uỷ quyền phê duyệt của khối | blocks, users |
| external\_shares | Sổ chia sẻ ngoài | records, documents |
| handovers · disposals | Biên bản bàn giao, biên bản huỷ | users, records |
| compliance\_issues | Lỗi tuân thủ phát hiện khi quét | folders, files |
| audit\_logs | Nhật ký thao tác, chỉ được thêm, không sửa xoá; mỗi dòng có mã kiểm tra nối với dòng trước để phát hiện bị can thiệp | mọi đối tượng |

### 9.3 Yêu cầu phi chức năng

| Nhóm | Yêu cầu |
| --- | --- |
| Bảo mật | Kiểm tra quyền ở máy chủ cho mọi lệnh (không tin giao diện); drive Mật lọc từ câu truy vấn; mã hoá đường truyền (HTTPS); phiên đăng nhập hết hạn sau 8 giờ \[..\]; quản trị hệ thống không mặc nhiên xem drive Mật |
| Dấu vết | Mọi thay đổi trạng thái, quyền, phê duyệt ghi audit\_logs; giữ nhật ký tối thiểu 10 năm \[..\] |
| Tốc độ | Trang mở ≤ 2 giây; tìm kiếm ≤ 2 giây với 100.000 hồ sơ; 100 người dùng đồng thời \[..\] |
| Sẵn sàng | 99,5% trong giờ hành chính; lỗi Google API tự thử lại, không để trạng thái nửa vời (ghi sổ sau khi Drive làm xong) |
| Sao lưu | MongoDB sao lưu mỗi đêm, giữ 30 ngày, thử khôi phục mỗi quý; file đã nằm trên Drive |
| Dễ dùng | Tiếng Việt, không thuật ngữ IT; tối đa 3 bước cho việc lập hồ sơ, duyệt; dùng được trên điện thoại |
| File sinh ra | Đúng quy cách HD-VCPV-02: Times New Roman, dòng tiêu đề nền #13233A chữ trắng, dòng xen kẽ #FFFFFF / #E8EDF3, số có dấu "." ngăn nghìn |
| Mở rộng | Thêm phòng, loại hồ sơ, bảng uỷ quyền bằng cấu hình, không sửa mã nguồn |
| Pháp lý | Đáp ứng Luật BVDLCN 2025 + NĐ 356/2025: ghi ai xem dữ liệu cá nhân, xoá theo thời hạn |

## 10. Lộ trình và câu hỏi còn mở

Làm 3 giai đoạn, chạy thử ở 00 VCPV Chung và 11 MKT (phòng mẫu) trước khi mở cho cả công ty.

| Giai đoạn | Phân hệ | Điều kiện qua giai đoạn | Thời gian |
| --- | --- | --- | --- |
| 1 – MVP | M01–M09, M14 | 14 tài liệu cấp VCPV và toàn bộ Bảng mã, Danh mục hồ sơ đã nhập vào phần mềm; một tài liệu đi trọn trình duyệt → ban hành; 11 MKT lập hồ sơ tháng qua phần mềm | \[..\] |
| 2 – Kiểm soát | M10–M13 | Rà soát 11 drive không còn lỗi đỏ; một lần bàn giao thật; một vòng rà soát hồ sơ hết hạn | \[..\] |
| 3 – Đánh giá ISO | M15, Zalo, đọc chữ bản scan | Chuyên gia đánh giá nội bộ tự tra bằng chứng trong phần mềm | \[..\] |

**Quyết định** (anh chốt 19/10; Q3 chưa trả lời, làm theo đề xuất):

- **Q1. File để ở đâu?** Chốt: giữ trên Google Drive, phần mềm chỉ là lớp quản lý. Lớp lưu file viết tách rời (một "bộ chuyển đổi" lưu trữ) để sau này đổi sang Nextcloud hoặc MinIO nếu công ty rời Google Workspace mà không phải viết lại phần mềm.
- **Q2. Ai làm?** Chốt: Claude viết 100% mã nguồn và kiểm thử theo đặc tả này; IT nội bộ (anh Hùng) nhận bàn giao mã nguồn, vận hành máy chủ và cấp quyền Google. Kho mã nguồn \[..\].
- **Q3. Chạy ở đâu?** Theo đề xuất (chưa chốt): máy chủ thuê tại Việt Nam, cùng nơi các ứng dụng VCsoft đang chạy \[..\].
- **Q4. Kênh thông báo?** Chốt: email giai đoạn 1; Zalo (qua VCZALO) giai đoạn 3.
- **Q5. Có bán cho khách sau này không?** Chốt: có. Mọi bảng dữ liệu có trường company\_id (công ty) ngay từ giai đoạn 1; giai đoạn đầu chỉ dùng nội bộ.

**Còn để trống \[..\]:** người kiểm tra HD (Q1 sổ tay), GĐ khối Kinh doanh và Tài chính, thành viên Ban Điều hành, tên nhóm Google, ngày tạo thư mục tháng, số ngày nhắc rà soát, hạn trả lời phê duyệt, hạn tối đa chia sẻ ngoài, tháng rà soát hồ sơ hằng năm, cách tính "hạn lưu đến", chỉ tiêu tốc độ và số người dùng, thời gian từng giai đoạn.

## 11. Rà soát: lỗ hổng do nền tảng Google Drive và cách bịt

Kết luận rà soát (19/10): vì file nằm trên Google Drive và nhân viên có quyền thao tác thẳng trên Drive, có 20 cách lách đã nhận diện; 12 cách chặn được bằng cấu hình Google và khoá file, 6 cách chỉ phát hiện và tự sửa được trong vài phút, 2 cách phải chấp nhận và xử lý bằng kỷ luật. Một tiêu chí nghiệm thu đã viết (US-07.2 "hạ quyền mọi người xuống Xem") không làm được trên Bộ nhớ dùng chung và đã sửa lại.

Nguyên tắc phòng vệ ba lớp, vì VCdocs không giữ file:

1. **Chặn** bằng chính Google: vai trò trên drive, khoá file, cài đặt quản trị. Việc nào Google chặn được thì không trông vào quét.
2. **Phát hiện và tự sửa** theo sự kiện: Google báo cho VCdocs mỗi khi có thay đổi (Drive Changes) và VCdocs đọc nhật ký kiểm tra của Google (ai chia sẻ, tải, xoá, mở khoá) — vài phút, không chờ đêm.
3. **Bằng chứng độc lập với file**: khi chốt hoặc ban hành, VCdocs giữ số phiên bản Google, bản PDF và mã băm (dấu vân tay số) của PDF trong kho riêng; file trên Drive có bị sửa thì vẫn chứng minh được bản đã chốt.

### 11.1 Google cho phép và không cho phép gì

Căn cứ: [Cách truy cập file trong Bộ nhớ dùng chung](https://support.google.com/a/users/answer/12380484?hl=en) · [Mức truy cập Bộ nhớ dùng chung](https://support.google.com/a/users/answer/9310460?hl=en) · [Drive API – khoá nội dung file](https://developers.google.com/drive/api/guides/file-locking) · [Thư mục hạn chế truy cập (2024)](https://workspaceupdates.googleblog.com/2024/09/google-drive-beta-to-restrict-folder-access.html).

| Việc trên Bộ nhớ dùng chung | Đóng góp (nhân viên) | Quản lý nội dung (leader) | Quản lý (trưởng phòng) |
| --- | --- | --- | --- |
| Tạo, sửa file; tạo thư mục | Có | Có | Có |
| Di chuyển file, thư mục trong drive | Không | Có | Có |
| Chuyển file ra drive khác hoặc Drive của tôi | Không | Không | Có |
| Đưa vào thùng rác | Không | Có | Có |
| Khôi phục từ thùng rác (30 ngày) | Có | Có | Có |
| Xoá vĩnh viễn | Không | Không | Có |
| Chia sẻ file cho người ngoài drive | Có, trừ khi cài đặt drive cấm | Có, trừ khi cấm | Có |
| Thêm bớt thành viên, đổi cài đặt, đặt thư mục hạn chế | Không | Không | Có |
| Mở khoá file đã khoá kiểu "chỉ chủ sở hữu" | Không | Không | Có |

Ba điều cố định của Google mà thiết kế phải bám theo:

- **Không hạ được quyền một thành viên trên một file hay thư mục thấp hơn vai trò của họ trên drive** ("người Nhận xét không thể chỉ được Xem một thư mục"). Muốn nhân viên không sửa được thì phải khoá file, không phải phân quyền.
- **Khoá file** (Drive API contentRestrictions.readOnly) chặn sửa nội dung, đổi tên, nhận xét, đề xuất, tải phiên bản mới; áp dụng được cho Docs, Sheets, Slides, PDF, ảnh; không áp dụng cho Forms, Drawings. Khoá kiểu ownerRestricted thì trên Bộ nhớ dùng chung chỉ Quản lý mở được. Khoá **không** chặn di chuyển và chia sẻ.
- **Chặn tải, in, sao chép** đặt được cho từng file, kể cả với người có quyền sửa (downloadRestrictions); thư mục hạn chế chỉ **ẩn** thư mục với người ngoài danh sách, không hạ vai trò.

### 11.2 Từng trường hợp lách và cách bịt

| # | Trường hợp lách | Ai làm được | Cách bịt (chặn → phát hiện → bằng chứng) | Còn lại |
| --- | --- | --- | --- | --- |
| 1 | Sửa hồ sơ đã chốt hoặc tài liệu đang hiệu lực ngay trên Drive | Đóng góp trở lên | Chốt / ban hành = VCdocs khoá file gốc và PDF kiểu chỉ Quản lý mở; mở khoá chỉ qua phiếu sửa đổi. Quản lý mở khoá → nhật ký Google báo, VCdocs khoá lại và báo đỏ. Mã băm PDF + số phiên bản lưu trong VCdocs | Quản lý cố ý → kỷ luật |
| 2 | Duyệt một đằng, chốt một nẻo: sửa nội dung sau khi người duyệt đã bấm Đồng ý (link dẫn tới file sống) | Người lập | Khi trình: VCdocs khoá tạm file, chụp số phiên bản + PDF + mã băm; phiếu duyệt gắn với phiên bản đó. Chốt: phiên bản khác → phiếu tự huỷ, phải trình lại | Không |
| 3 | Ghi lùi ngày lập trong tên file để hợp thức hoá | Mọi người | So ngày trong tên với ngày tạo file trên Drive (không sửa được); lệch quá \[..\] ngày làm việc → cảnh báo, trừ bản scan hồ sơ giấy có ghi lý do | Không |
| 4 | Tạo file thẳng trên Drive, điện thoại, không qua VCdocs: sai tên, sai chỗ, không có mã | Đóng góp trở lên | Không chặn (nhân viên phải tạo được file). Phát hiện trong vài phút: tên đúng mẫu → tự "đăng ký ngược", hỏi người tạo xác nhận; tên sai → giao người tạo sửa trong \[..\] ngày, quá hạn báo trưởng phòng | Không |
| 5 | Đổi tên file, thư mục: bỏ "\[HẾT HIỆU LỰC\]", đổi vN, đổi ngày | Đóng góp trở lên | File đã khoá không đổi tên được. File chưa khoá và thư mục: VCdocs là nguồn tên đúng, tự đổi lại và ghi nhận ai đổi | Không |
| 6 | Di chuyển hồ sơ sang tháng khác, kéo file Mật sang drive khác | Trong drive: Quản lý nội dung; ra drive khác: Quản lý | Nhân viên không di chuyển được. Leader chuyển trong drive → tự trả về đúng chỗ theo sổ. Chuyển ra drive khác → báo đỏ ngay, tự chuyển về, đòi giải trình | Quản lý cố ý |
| 7 | Bỏ vào thùng rác, xoá vĩnh viễn | Thùng rác: Quản lý nội dung; vĩnh viễn: Quản lý | File đã đăng ký vào thùng rác → tự khôi phục trong vài phút (Drive giữ 30 ngày), báo người làm. Xoá vĩnh viễn chỉ Quản lý → giảm số Quản lý (11.4); bản PDF chốt còn trong kho riêng của VCdocs | Quản lý cố ý |
| 8 | Chia sẻ ra ngoài thẳng trên Drive: email cá nhân, đối tác, "bất kỳ ai có liên kết" | Đóng góp trở lên | Cài đặt từng drive: thành viên không được chia sẻ cho người ngoài drive; quản trị Workspace tắt "bất kỳ ai có liên kết" và chặn chia sẻ ngoài tên miền. Mọi chia sẻ ngoài đi qua tài khoản máy của VCdocs. Nhật ký Google → chia sẻ không có trong sổ bị gỡ tự động | Không |
| 9 | Tải về máy, sao chép sang Drive của tôi, gửi qua Zalo, chụp màn hình | Mọi người | Bật chặn tải, in, sao chép với file Mật và hồ sơ đã chốt (kể cả người sửa); có thể tắt Drive for desktop; nhật ký tải xuống → VCdocs báo người tải nhiều bất thường | Chụp màn hình, ảnh: kỷ luật, cam kết bảo mật |
| 10 | Làm việc trong Drive của tôi, không đưa vào drive phòng | Mọi người | Tài khoản máy quét Drive của tôi của từng người (uỷ quyền toàn tên miền) tìm file công việc → nhắc chuyển; bàn giao khi nghỉ việc đã quét | Không |
| 11 | Điền thẳng vào biểu mẫu gốc thay vì tạo bản sao | Đóng góp trở lên | Khoá mọi biểu mẫu gốc; VCdocs có nút "Tạo từ biểu mẫu" | Không |
| 12 | Tải lên .xlsx, .docx thay vì định dạng Google | Mọi người | Tự chuyển sang định dạng Google, giữ bản gốc trong thư mục con \[..\]; ngoại lệ hoá đơn, giấy tờ ký, scan | Không |
| 13 | Tạo file mới chép nội dung bản chốt rồi sửa, trình như bản gốc; lập "Điều chỉnh" không dẫn hồ sơ cũ | Người lập | PDF chốt có dấu "ĐÃ CHỐT – mã hồ sơ – ngày – mã kiểm tra (QR)"; quét mã → VCdocs hiện trạng thái. Bản không có dấu không phải hồ sơ chính thức. "Điều chỉnh" bắt buộc chọn hồ sơ gốc | Không |
| 14 | Lách người duyệt: đưa tài khoản cho người khác bấm, duyệt qua Zalo rồi không ghi | Người duyệt | Bắt buộc xác minh 2 bước cho người có quyền duyệt; VCdocs ghi thiết bị, địa chỉ mạng; văn bản nằm trong thư mục chính thức mà không có phiếu duyệt → báo đỏ, không tính là hiệu lực | Không |
| 15 | Thêm người lẻ hoặc người ngoài tên miền vào drive thay vì qua nhóm | Quản lý | Cài đặt drive: chỉ Quản lý thêm thành viên, không thêm người ngoài tổ chức; VCdocs đối chiếu thành viên drive với nhóm hằng ngày, báo thành viên lẻ | Không |
| 16 | Trưởng phòng (Quản lý) lạm quyền: mở khoá, xoá vĩnh viễn, chuyển ra ngoài, đổi cài đặt | Quản lý | Không chặn được bằng kỹ thuật nếu giữ vai trò. Giảm: trưởng phòng làm Quản lý nội dung, vai trò Quản lý chỉ còn tài khoản máy VCdocs + quản trị viên (11.4). Nếu giữ: mọi hành động Quản lý có trong nhật ký Google → VCdocs gửi TGĐ hằng tuần | Chấp nhận, kỷ luật |
| 17 | Sửa qua Drive for desktop, ứng dụng điện thoại | Đóng góp trở lên | Như #1, #4: khoá file có hiệu lực trên mọi ứng dụng; nhân viên Đóng góp trên Drive for desktop chỉ đọc được | Không |
| 18 | Tài liệu bên ngoài do đối tác chia sẻ từ Drive của họ: họ sửa, thu hồi bất cứ lúc nào | Đối tác | VCdocs có nút "Nhập tài liệu bên ngoài": tạo bản sao vào 00 Tài liệu, ghi nguồn và ngày; không dẫn chiếu link ngoài tên miền | Không |
| 19 | Tài khoản máy của VCdocs bị lộ: một chìa khoá mở mọi drive (rủi ro mới do kiến trúc) | Kẻ xấu | Khoá cất trong két bí mật của máy chủ, xoay định kỳ, chỉ máy chủ gọi được; tách tài khoản chỉ đọc (quét) và tài khoản ghi; cảnh báo khi gọi bất thường | Không |
| 20 | Quản trị hệ thống sửa thẳng cơ sở dữ liệu VCdocs: xoá nhật ký, đổi trạng thái | Quản trị hệ thống | Nhật ký chuỗi mã băm, mỗi tuần gửi "mỏ neo" (mã băm cuối chuỗi) vào email TGĐ và một file khoá ở 01 BĐH; sao lưu CSDL do người khác giữ | Không |

### 11.3 Sửa đổi đặc tả rút ra từ rà soát

Các sửa đổi dưới đây được coi là một phần của đặc tả; US-07.2 đã sửa thẳng ở mục 7, các mục còn lại giữ nguyên văn cũ và áp dụng thêm dòng tương ứng.

| Mục | Sửa gì |
| --- | --- |
| US-07.2 (đã sửa) | Bỏ "hạ quyền xuống Xem"; thay bằng khoá file gốc và PDF kiểu chỉ Quản lý mở; lưu số phiên bản và mã băm PDF |
| US-04.4 ban hành | Thêm: khoá file khi ban hành; lưu số phiên bản Google của bản hiệu lực |
| US-04.5 sửa đổi | Thêm: VCdocs đặt tên phiên bản hiện tại rồi mới mở khoá, mở có thời hạn \[..\] ngày, khoá lại khi ban hành hoặc hết hạn; sửa nhỏ cũng mở khoá qua VCdocs |
| US-04.8 tài liệu bên ngoài | Thêm: nút "Nhập tài liệu bên ngoài" tạo bản sao vào 00 Tài liệu; không ghi link ngoài tên miền |
| US-05.1 trình duyệt | Thêm: khi trình, khoá tạm file và chụp số phiên bản + PDF + mã băm; phiếu duyệt gắn với phiên bản đó; người duyệt xem đúng bản đã chụp |
| US-05.2 người duyệt | Thêm: file đổi sau khi trình → phiếu tự huỷ kèm lý do, phải trình lại; ghi thiết bị và địa chỉ mạng của lần duyệt |
| US-07.1 lập hồ sơ | Thêm: file tạo thẳng trên Drive có tên đúng mẫu được "đăng ký ngược" và hỏi người tạo xác nhận; so ngày lập với ngày tạo file |
| US-07.4 (mới) | Là người lập, tôi muốn bản PDF chốt có dấu "ĐÃ CHỐT – mã – ngày – mã kiểm tra (QR)" để ai cũng tra được bản chính thức. Nghiệm thu: quét QR mở trang tra cứu công khai trong nội bộ hiện mã, trạng thái, ngày chốt, mã băm; không hiện nội dung |
| US-09.1 chia sẻ ngoài | Thêm: mọi chia sẻ ngoài do tài khoản máy của VCdocs thực hiện; chia sẻ ngoài phát hiện trong nhật ký Google mà không có trong sổ → gỡ trong \[..\] phút và báo trưởng phòng |
| US-01.2 đồng bộ | Thêm: đối chiếu thành viên từng drive với nhóm; thành viên lẻ hoặc ngoài tên miền → báo, không tự gỡ (để Quản lý quyết) |
| US-12.1 kiểm tra | Thay "quét hằng đêm" bằng "theo sự kiện ≤ 10 phút" (Google báo thay đổi + đọc nhật ký kiểm tra), quét đêm chỉ để đối chiếu toàn bộ. Tự sửa: khôi phục từ thùng rác, đổi lại tên, trả về đúng chỗ, khoá lại, gỡ chia sẻ. Thêm 6 lỗi: file bị mở khoá, chia sẻ ngoài không có trong sổ, thành viên drive lẻ, xoá vĩnh viễn, chuyển ra ngoài drive, ngày lập lùi |
| US-12.3 (mới) | Là trưởng phòng, tôi muốn biết ai tải xuống nhiều bất thường. Nghiệm thu: trên \[..\] file/ngày hoặc tải file Mật → báo trong ngày; báo cáo tuần cho TGĐ |
| M11 huỷ | Thêm: VCdocs giữ bản PDF chốt trong kho riêng (không phải Drive) cho đến khi huỷ có biên bản; huỷ = xoá cả trên Drive và kho riêng |
| BR-26 (mới) | Hồ sơ đã chốt, tài liệu đang hiệu lực, biểu mẫu gốc luôn ở trạng thái khoá trên Drive; mở khoá chỉ qua VCdocs có phiếu |
| BR-27 (mới) | Phiếu duyệt gắn với một phiên bản file; phiên bản đổi thì phiếu hết giá trị |
| BR-28 (mới) | Ngày lập trong tên hồ sơ không sớm hơn ngày tạo file trên Drive quá \[..\] ngày làm việc, trừ bản scan hồ sơ giấy có ghi lý do |
| BR-29 (mới) | Bản chính thức của hồ sơ là bản PDF có dấu chốt và mã kiểm tra khớp với VCdocs |
| BR-30 (đề xuất, chờ chốt) | Vai trò Quản lý trên Bộ nhớ dùng chung chỉ gồm tài khoản máy VCdocs và quản trị viên Workspace; trưởng phòng là Quản lý nội dung (đổi so với QĐ-VCPV-01 mục 6 và slide 15–19) |
| BR-31 (mới) | Tài liệu nội bộ không dẫn chiếu link file ngoài tên miền vcprosperous.com |
| Mục 9.3 | Thêm: kho PDF chốt riêng (MinIO hoặc S3, chỉ VCdocs ghi); hai tài khoản máy (đọc / ghi); neo nhật ký hằng tuần; đọc nhật ký kiểm tra Google qua Admin SDK Reports |
| Mục 10 lộ trình | Các cài đặt Google ở 11.4 làm ngay tuần này, trước khi có phần mềm; khoá file và phiếu duyệt gắn phiên bản thuộc giai đoạn 1 |

### 11.4 Cài đặt Google làm ngay, không cần phần mềm

Làm trong tuần này bởi quản trị viên Workspace (anh) hoặc Claude qua Chrome; mỗi dòng bịt ít nhất một trường hợp ở 11.2.

- [ ] Từng Bộ nhớ dùng chung (11 cái): tắt "người không phải Quản lý được chia sẻ file cho người ngoài drive"; tắt "chia sẻ cho người ngoài tổ chức"; chỉ Quản lý thêm thành viên (#8, #15)
- [ ] 5 drive Mật: bật "chặn tải, in, sao chép" với người Xem và Nhận xét (#9)
- [ ] Quản trị Workspace – Drive: tắt "Bất kỳ ai có liên kết"; chặn chia sẻ ra ngoài tên miền, chỉ cho phép danh sách tên miền đối tác \[..\] và tài khoản máy VCdocs (#8)
- [ ] Bắt buộc xác minh 2 bước cho toàn công ty, trước hết cho người có quyền duyệt (#14)
- [ ] Vai trò: nhân viên = Đóng góp; leader = Quản lý nội dung; Quản lý = tài khoản máy VCdocs + quản trị viên; trưởng phòng = Quản lý nội dung (BR-30, chờ anh chốt) (#6, #7, #16)
- [ ] Khoá ngay bằng tay (chuột phải › Khoá) các biểu mẫu gốc BM-VCPV-02–08 và tài liệu đã hiệu lực, không chờ phần mềm (#1, #11)
- [ ] Tài khoản khác tên miền (cskh@vcpart.vn): thêm vcpart.vn làm tên miền phụ của Workspace hoặc coi là người ngoài (#15)
- [ ] Cân nhắc tắt Google Drive for desktop cho nhóm không cần làm việc ngoại tuyến (#9)
- [ ] Bật cảnh báo tải xuống hàng loạt trong Trung tâm cảnh báo của Workspace, gửi về email quản trị (#9)

### 11.5 Rủi ro chấp nhận và cách xử lý bằng quy định

- Chụp màn hình, chụp ảnh, đọc rồi kể lại: không kỹ thuật nào chặn được → cam kết bảo mật ký cùng hợp đồng lao động; QĐ-VCPV-01 thêm Điều Xử lý vi phạm.
- Quản lý (hoặc quản trị viên Workspace) cố ý làm sai: chỉ còn nhật ký Google và bản PDF trong kho riêng làm bằng chứng → giảm số người giữ vai trò này xuống tối thiểu, TGĐ nhận báo cáo tuần.
- File đã tải về trước khi bật chặn tải: không thu hồi được → chấp nhận, áp dụng từ ngày bật.
- Google đổi tính năng (khoá file, thuộc tính API): VCdocs phải có kiểm tra tự động hằng ngày xem khoá còn hiệu lực; mất khoá → báo đỏ toàn hệ thống.
