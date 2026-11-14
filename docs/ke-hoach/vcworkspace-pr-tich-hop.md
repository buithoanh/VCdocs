# PR: Tích hợp các nhánh đã xong vào dev (production disabled, antd, O1–O15, M10/M15, B1) + M10 nối offboard

Nhánh `claude/tich-hop-dev` vào `dev`. Cắt từ `dev` 6656766 (PR #14). PR này **thay cho PR #12** và PR riêng của
`claude/prod-cau-hinh-vcworkspace-2fe0b0` (đóng hai PR đó sau khi merge).

## Vì sao gộp một lần

Bảy nhánh đều đã qua gate riêng nhưng sửa chồng lên cùng các trang (Email, Hồ sơ, Tài liệu, menu). Gộp từng PR thì
mỗi PR sau phải gỡ lại xung đột với PR trước. Ở đây xung đột được gỡ một lần và kiểm bằng full gate trên bản gộp.

## Nội dung (theo thứ tự gộp)

| # | Nhánh | Nội dung |
|---|---|---|
| 1 | `claude/prod-cau-hinh-vcworkspace-2fe0b0` | **P0 production.** Chế độ `disabled` cho Drive/Email (mặc định khi production không khai báo), guard 503, FE ẩn menu theo `NEXT_PUBLIC_WORKSPACE_MODULES`, mẫu env deploy. Chi tiết: `docs/ke-hoach/vcworkspace-pr-prod-disabled.md` |
| 2 | `vcworkspace/antd-ho-so` (PR #12) | Ant Design bước 2–6: Hồ sơ, Tài liệu, Phê duyệt, Thư mục/Drive, Email. Chi tiết: `docs/ke-hoach/vcworkspace-pr-antd-modules.md` |
| 3 | `claude/bao-mat-o1-o15-3028d0` | Sửa review O2, O5, O7–O12, O14 (5/6 ý), O15. Bảng trạng thái: `docs/ke-hoach/vcworkspace-review-qa-2026-10-25.md` |
| 4 | `claude/gd2-m10-m15-vao-dev-c7c4dd` | VCdocs giai đoạn 2 đợt 1: M10 Bàn giao, M15 Nhật ký. **OpenAPI 2.7.0-gd2** (+20 điểm cuối) |
| 5 | `claude/tai-lieu-xem-tai-cho` | Xem nội dung file ngay trong trang chi tiết tài liệu |
| 6 | `claude/b1-drive-office-prod` | B1: Nextcloud production bắt buộc https, kiểm cấu hình ONLYOFFICE, credential Nextcloud mã hoá AES-GCM theo người, lệnh `kho-credential` |
| 7 | `claude/office-engine-onlyoffice` | Tài liệu + harness: chốt ONLYOFFICE CE 9.4, đo tải 48 phiên, REA |
| 8 | `claude/ban-giao-dev` | `docs/BAN_GIAO_DEV.md`: trang vào cho team DEV |

## Xung đột đã gỡ

- `apps/web/src/app/(app)/email/page.tsx`: giữ bản antd; áp lại O7 (ô tìm chờ ngừng gõ 300 ms) và O11 (Gửi lại dùng cùng
  Idempotency-Key, khoá nút khi đang gửi).
- `ho-so/[id]/RecordView.tsx`, `tai-lieu/[id]/DocumentView.tsx`: thêm `AuditTools` (M15) vào hàng nút antd `Space`.
- `lib/permissions.ts`: `navFor` xét cả kiểm toán viên (M15) lẫn phân hệ VCworkspace đang bật (#1).
- `globals.css`, `apps/web/DE_NGHI_SUA_HOP_DONG.md`, `SO_TAY_DU_AN.md`: giữ cả hai phía; sổ tay đã sắp lại theo ngày.

## Ba commit mới trên nhánh này

- **M10 chữ Việt + dòng Lập:** BE sinh `detail` của dòng bàn giao bằng chữ thay cho mã trạng thái; FE hiện tên người lập.
- **M10 nối offboard VCworkspace** (phần 1 không đổi hợp đồng; phần 2 lên **2.8.0-gd2**, chỉ thêm giá trị enum):
  - `handover.execute` thêm bước "Chuyển quyền quản lý hộp thư nhóm": hộp nhóm mà người nghỉ là người quản lý duy nhất
    được thêm người nhận làm quản lý.
  - `markLeft` (00:30, sau ngày làm việc cuối): khoá tài khoản xong thì thu hồi hộp thư (engine, alias, quyền hộp nhóm)
    và credential kho tệp. Lỗi không chặn việc khoá; ghi audit `workspace_mail.user.offboard_failed` để R3/R9 chạy lại
    `POST /mail/offboarding/{userId}`.
  - Audit `workspace_drive_item` trong không gian phòng ban có `departmentId` (trưởng phòng xem được trong `/nhat-ky`).
  - `IDENTITY_LIFECYCLE_MODE=remote`: cùng adapter chat12B, URL https hoặc tên dịch vụ Docker, kiểm khi khởi động. Khi khoá
    tài khoản, người có binding OIDC được đặt `active=false` ở Authentik/Nextcloud và thu hồi phiên; lỗi → audit
    `identity.lifecycle.offboard_failed`, R9 reconcile.
  - Loại dòng bàn giao mới `workspace_space`: không gian cá nhân Drive VCworkspace còn tệp. `reassign` (mặc định) cho người
    nhận quyền chỉ đọc; `keep` để nguyên.
  - Audit bí danh và hộp thư nhóm gắn phòng của người thao tác; nội dung thư và Flow vẫn chỉ R1/R3/R9 xem.
  - Mail/kho/lifecycle ở chế độ `disabled` thì các bước tương ứng bỏ qua.

## Kiểm tra

- `pnpm ai:check:full` trên bản cuối: PASS 2026-11-14 (guard, lint hợp đồng, typecheck, BE 466 đạt/10 skip, hợp đồng 169/169, FE 137/137, build production).
- Test mới: `apps/api/test/m10-workspace-offboard.e2e-spec.ts` (8 ca), thêm ca trong `m10-handovers.e2e-spec.ts` và
  `ban-giao.test.tsx`. Không nới assertion nào.
- **Chưa chạy:** xem bằng trình duyệt trên bản gộp; build Docker; Nextcloud/ONLYOFFICE/Stalwart/Authentik thật; Google thật.

## Lưu ý khi review

- Hợp đồng lên 2.7.0-gd2 (nhánh #4) rồi 2.8.0-gd2 (`workspace_space`); `apps/web/src/api/schema.d.ts` đã sinh lại và khớp.
- Chế độ `remote` chưa chạy với Authentik/Nextcloud thật: production giữ `disabled` cho tới khi thử trên staging.
- Đọc không gian cá nhân của người nghỉ trên Nextcloud thật phụ thuộc O13 (tệp nằm trong home người tải lên).
- Các trang `/ban-giao`, `/nhat-ky` (M10/M15) còn dùng lớp CSS cũ, chưa chuyển antd.
- Chờ chủ dự án quyết: O3, O13, một ý O14; xác nhận ba lựa chọn của phần 2 (sổ tay mục 4).
- Sau merge: PR `dev` → `main`, rồi deploy theo phương án A (`deploy/README.md`, mọi phân hệ VCworkspace để `disabled`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
