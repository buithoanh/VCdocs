# @vcdocs/web – giao diện VCdocs

Next.js (App Router) + TypeScript. Gọi API theo `contract/openapi.yaml` (giai đoạn 1: M01–M09, M14, /jobs).

## Chạy

Cần Node 22 và pnpm 9. Cài một lần ở gốc repo:

    pnpm install

### Với máy chủ giả (Prism, không cần BE)

    pnpm contract:mock                      # ở gốc repo, cổng 4010
    pnpm --filter @vcdocs/web dev:mock      # cổng 3000

Mở http://localhost:3000 → bấm **Vào bằng phiên thử (máy chủ giả)** (chỉ hiện khi
`NEXT_PUBLIC_MOCK=1`): nút này đặt cookie `vcdocs_sid` giả vì Prism đòi cookie.

- Prism phục vụ đường dẫn không có tiền tố `/api/v1`, nên `dev:mock` đặt
  `API_PATH_PREFIX=` (rỗng). Prism đang chạy ở cổng khác thì đổi `API_ORIGIN`:

      API_ORIGIN=http://localhost:4011 API_PATH_PREFIX= NEXT_PUBLIC_MOCK=1 pnpm --filter @vcdocs/web dev

- Prism trả dữ liệu ngẫu nhiên theo schema mỗi lần gọi (tên, trạng thái,
  `allowedActions` là chuỗi bất kỳ…), nên nút hành động trên mock thường không
  hiện. Muốn xem đủ nút thì dùng test (MSW, dữ liệu cố định) hoặc BE thật.
- Prism có kiểm tra yêu cầu: thiếu header bắt buộc (`X-CSRF-Token`,
  `Idempotency-Key`) hay thân sai schema thì trả 422.

### Với BE thật (`apps/api`, cổng 4000)

    pnpm dev:api                            # ở gốc repo
    pnpm --filter @vcdocs/web dev           # API_ORIGIN mặc định http://localhost:4000, tiền tố /api/v1

Đăng nhập bằng nút Google; BE đặt cookie phiên HttpOnly qua đường chuyển tiếp
của Next.js (cùng tên miền với giao diện).

### Bản chạy thật

    API_ORIGIN=https://… pnpm --filter @vcdocs/web build
    pnpm --filter @vcdocs/web start

`API_ORIGIN`, `API_PATH_PREFIX` được đọc **lúc build** (đường chuyển tiếp nằm
trong `next.config.ts`).

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `API_ORIGIN` | `http://localhost:4000` | Máy chủ API mà `/api/v1/*` chuyển tiếp tới |
| `API_PATH_PREFIX` | `/api/v1` | Tiền tố đường dẫn phía máy chủ API (Prism: rỗng) |
| `NEXT_PUBLIC_MOCK` | (trống) | `1` = hiện nút vào bằng phiên thử |

## Lệnh

    pnpm --filter @vcdocs/web gen:api     # sinh lại src/api/schema.d.ts khi contract đổi
    pnpm --filter @vcdocs/web test        # Vitest + Testing Library + MSW
    pnpm --filter @vcdocs/web typecheck
    pnpm --filter @vcdocs/web build

## Cấu trúc

    src/api/client.ts        lớp gọi API: X-Request-Id, X-CSRF-Token, Idempotency-Key, 401 → đăng nhập, lỗi
    src/api/schema.d.ts      kiểu sinh từ OpenAPI (không sửa tay)
    src/api/queries.ts       truy vấn dùng chung, useAction (giữ Idempotency-Key tới khi thành công)
    src/lib/permissions.ts   allowedActions, quyền theo vai trò, menu
    src/lib/labels.ts        tên tiếng Việt cho các giá trị cố định
    src/components/          khung, bảng (màu HD-VCPV-02), hộp thoại, theo dõi việc nền
    src/app/(app)/…          các màn hình (đã đăng nhập)
    src/app/dang-nhap        trang đăng nhập
    src/test/                MSW: dữ liệu mẫu có kiểu từ schema

## Quy ước

- Giao diện không giữ token; phiên là cookie HttpOnly do BE đặt. `csrfToken`
  lấy từ `GET /me`, chỉ giữ trong bộ nhớ.
- Nút hành động trên một đối tượng chỉ hiện khi tên hành động có trong
  `allowedActions` (so khớp không phân biệt `assign-code` / `assignCode`).
  Nút tạo mới (chưa có đối tượng) và mục menu dựa vào vai trò R1–R9.
- Việc trả 202 hiện tiến độ bằng `GET /jobs/{id}` (ngay trong trang, hoặc ở
  góc trái màn hình).
- Lỗi hiện `error.message`; 422 thêm "(Quy tắc BR-xx)".
- Bảng: dòng tiêu đề nền #13233A chữ trắng, dòng xen kẽ #FFFFFF / #E8EDF3; số
  có dấu "." ngăn nghìn. Trên điện thoại mỗi dòng thành một thẻ.

## Màn hình

| Đường dẫn | Phân hệ |
|-----------|---------|
| `/dang-nhap` | M01 đăng nhập Google |
| `/` | Trang chủ: chờ tôi duyệt, thông báo, làm nhanh |
| `/nhan-su`, `/nhan-su/[id]`, `/drive`, `/drive/[id]` | M01 nhân sự, vai trò, drive |
| `/danh-muc`, `/bang-ma` | M02 khối, phòng, division, Bảng mã |
| `/thu-muc` | M03 cây thư mục |
| `/tai-lieu`, `/tai-lieu/dang-ky`, `/tai-lieu/ben-ngoai`, `/tai-lieu/[id]`, `/tai-lieu/ma/[code]` | M04 tài liệu |
| `/phe-duyet`, `/phe-duyet/[id]`, `/phe-duyet/uy-quyen` | M05 phê duyệt |
| `/danh-muc-ho-so`, `/danh-muc-ho-so/moi`, `/danh-muc-ho-so/[id]` | M06 danh mục hồ sơ |
| `/ho-so`, `/ho-so/moi`, `/ho-so/[id]`, `/ho-so/chua-dang-ky`, `/kiem-tra/[mã]` | M07 hồ sơ |
| `/tra-cuu` | M08 tra cứu |
| `/chia-se`, `/chia-se/moi` | M09 chia sẻ ngoài |
| `/thong-bao`, `/viec-nen` | M14 thông báo, việc nền |

Chỗ hợp đồng thiếu / FE phải tự chọn: xem `DE_NGHI_SUA_HOP_DONG.md`.
