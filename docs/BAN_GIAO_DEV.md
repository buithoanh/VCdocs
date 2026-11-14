# Bàn giao VCworkspace cho team DEV

- Ngày bàn giao: 2026-11-06. Người giao: chủ dự án Bùi Thọ Anh (soạn cùng Claude).
- Mốc mã: `origin/dev` = 6656766 (PR #14), `origin/main` = PR #15 (`dev` → `main`).
- Trang này là **điểm vào** cho người mới. Chi tiết từng việc nằm ở [sổ tay](../SO_TAY_DU_AN.md)
  (quyết định mục 2, việc mục 3, câu hỏi mục 4, bài học mục 5, nhật ký mục 6) và các file trong `docs/`.
  Khi hai nơi lệch nhau, sổ tay và mã trên nhánh mới hơn đúng; sửa trang này cho khớp.

## 1. Sản phẩm trong một trang

Repo chứa hai lớp sống chung một ứng dụng:

| Lớp | Là gì | Trạng thái |
|---|---|---|
| **VCdocs** (nghiệp vụ cũ) | Quản lý tài liệu – hồ sơ VCPV theo BA 15 phân hệ, lưu trên Google Drive | M01–M09, M14 chạy trên `main`. M10 Bàn giao, M15 Nhật ký đã code, **chờ gộp** (nhánh `claude/gd2-m10-m15-vao-dev-c7c4dd`). M11–M13, M16 chưa làm |
| **VCworkspace** (mở rộng) | Bộ công cụ văn phòng tự host thay Google Workspace: Drive, Office, Email, SSO, Flow… trên Nextcloud / ONLYOFFICE / Stalwart / Authentik | Đã **nghiệm thu LOCAL** (PoC Docker, dữ liệu giả). **Chưa chạy production.** Production hiện phải tắt các phân hệ này (xem mục 5, P0) |

Chín nhóm chức năng VCworkspace (ma trận đầy đủ: [lộ trình 9 nhóm](ke-hoach/vcworkspace-11-lo-trinh-9-nhom.md)):

| Nhóm | Có trong app (`apps/`) | PoC (`poc/`) | Bàn giao chi tiết |
|---|---|---|---|
| Files/Drive (version, thùng rác, restore) | `drive-basic`, `/drive`, `/bo-nho` | `drive-nextcloud` | [02](ke-hoach/vcworkspace-02-ban-giao-drive.md), [03](ke-hoach/vcworkspace-03-ban-giao-drive-an-toan.md) |
| Office DOCX/XLSX/PPTX (ONLYOFFICE CE 9.4) | `drive-basic` + trang soạn | `onlyoffice`, `office-load` | [04](ke-hoach/vcworkspace-04-ban-giao-van-ban.md), [05](ke-hoach/vcworkspace-05-ban-giao-bang-tinh.md), [06](ke-hoach/vcworkspace-06-ban-giao-slide.md) |
| Email (Stalwart) | `mail-basic`, `/email` | `mail-stalwart` | [07](ke-hoach/vcworkspace-07-ban-giao-email-co-ban.md), [08](ke-hoach/vcworkspace-08-ban-giao-quan-ly-email.md) |
| Liên thông Mail ↔ Drive | `workspace-interop` | — | [09](ke-hoach/vcworkspace-09-ban-giao-lien-thong.md) |
| Danh tính / SSO (Authentik OIDC, lifecycle) | `m01-auth` | `identity-admin` | [12](ke-hoach/vcworkspace-12-ban-giao-danh-tinh-phan-quyen.md), [12B](ke-hoach/vcworkspace-12b-ban-giao-sso-ung-dung.md) |
| Work management (Deck, Notes, Forms, Tables) | — | `work-management` | [13](ke-hoach/vcworkspace-13-ban-giao-work-management.md) |
| Flow (webhook Nextcloud → NestJS) | `flow` | `flow` | [14](ke-hoach/vcworkspace-14-ban-giao-flow.md) |
| Sync + NAS (SMB) | — | `sync-nas` | [15](ke-hoach/vcworkspace-15-ban-giao-sync-nas.md) |
| Lịch / Danh bạ (CalDAV/CardDAV) | — | `calendar-contacts` | [16](ke-hoach/vcworkspace-16-ban-giao-calendar-contacts.md) |
| Talk (họp nhỏ, không HPB) | — | `talk` | [17](ke-hoach/vcworkspace-17-ban-giao-talk.md) |
| Assistant AI chỉ đọc (Ollama local) | — | `assistant-ai` | [19](ke-hoach/vcworkspace-19-ban-giao-assistant-ai.md) |

"LOCAL PASS" nghĩa là đạt trên Docker của máy dev với tài khoản giả. Chưa đo trên VM x86 thật,
chưa thử client desktop/mobile thật, chưa có dữ liệu Google thật. Đừng suy ra production-ready.

## 2. Kiến trúc và công nghệ

- **Monorepo pnpm 9.2.0, Node ≥ 22.** Không đổi package manager, không sửa tay `pnpm-lock.yaml`.
- `apps/web` — Next.js 15, React 19, **Ant Design 6** (theme HD-VCPV-02: navy `#13233A`, font Be Vietnam Pro).
  Gọi API qua kiểu sinh từ hợp đồng (`src/api/schema.d.ts`). Test: Vitest + Testing Library (jsdom).
- `apps/api` — NestJS + MongoDB. Mỗi phân hệ một thư mục trong `src/modules/` (`m01-auth` … `m14-notifications`,
  `drive-basic`, `mail-basic`, `workspace-interop`, `flow`). Google đi qua adapter `src/google/` có bản
  **giả** và bản thật (`GOOGLE_MODE=fake|real`). Nextcloud, ONLYOFFICE, Stalwart cũng có cổng giả/thật/tắt.
  Test: Jest e2e trong `apps/api/test/`, MongoDB trong bộ nhớ.
- **Hợp đồng là gốc:** `contract/openapi.yaml` viết tay (bản trên `dev`: **2.6.0-gd2**). FE và BE code theo nó;
  test BE kiểm độ phủ mọi điểm cuối. Nguồn rev ghi ở `contract/NGUON.md`.
- Sơ đồ kiến trúc: [kien-truc/kien-truc.html](kien-truc/kien-truc.html) (mở bằng trình duyệt; bản vẽ cho
  VCdocs giai đoạn 1, chưa vẽ lại phần VCworkspace).

| Thư mục | Nội dung |
|---|---|
| `apps/api`, `apps/web` | Mã sản phẩm. Mỗi app có `README.md` và `DE_NGHI_SUA_HOP_DONG.md` |
| `contract/` | OpenAPI, nguồn rev, đề nghị sửa |
| `deploy/` | Docker Compose production (caddy, web, api, mongo), Caddyfile, `backup.sh`, mẫu env, [README deploy](../deploy/README.md) |
| `poc/` | Stack Docker từng nhóm VCworkspace, script nghiệm thu, bằng chứng JSON |
| `scripts/ai/` | Gate kiểm tra (`check.mjs`), hook và policy cho phiên AI |
| `.github/workflows/verify.yml` | CI: chạy `pnpm ai:check:full` cho PR/push vào `dev`, `main`; PR vào `main` chỉ nhận từ `dev` |
| `docs/` | BA, hợp đồng, kiến trúc, kế hoạch/bàn giao từng chat, nghiên cứu, bảo mật |

## 3. Bắt đầu trên máy mới

```bash
pnpm install
```

Kiểm tra (không cần secret, không cần Docker):

```bash
pnpm ai:check
```

```bash
pnpm ai:check:full
```

`ai:check` kiểm theo file đã đổi; `ai:check:full` chạy lint hợp đồng, typecheck, toàn bộ test FE/BE và build
(đúng như CI). Gate cuối trên các nhánh mới nhất (2026-10-26): BE ~390–411 test (10 skip), độ phủ hợp đồng đủ,
FE 103–127 test, build đạt. Test lẻ:

```bash
pnpm --filter @vcdocs/web test src/api/client.test.ts
```

```bash
ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/m01-auth.e2e-spec.ts
```

**Chạy app để bấm thử (mọi thứ giả, không Docker):** một API QA dựng MongoDB trong bộ nhớ, Google/Drive/Email
giả và dữ liệu mẫu, cổng 14100; web Next dev trỏ vào đó, cổng 13100.

```bash
cd apps/api && RUN_QA_FAKE_SERVER=1 ALLOW_PARTIAL_COVERAGE=1 SKIP_CONTRACT_COVERAGE=1 pnpm run test --runInBand test/qa-fake-server.spec.ts
```

```bash
cd apps/web && NEXT_DIST_DIR=.next-qa API_ORIGIN=http://127.0.0.1:14100 pnpm exec next dev -p 13100
```

Mở http://localhost:13100, chọn một vai mẫu ở trang đăng nhập Google giả. Biến tuỳ chọn: `QA_API_PORT`,
`QA_WEB_ORIGIN`, `QA_HOLD_MS` (giữ server), `QA_JOBS_POLL_MS` (việc nền; bản bật mặc định nằm ở nhánh antd, mục 4).

Lưu ý khi chạy local:

- **Không chạy `node apps/api/dist/main.js` trên máy có `apps/api/.env`** — nó nạp cấu hình Google thật.
  Dev luôn dùng Google giả và CSDL thử riêng.
- `next dev`/`next build` tự sửa `apps/web/tsconfig.json`; kiểm `git diff` trước khi commit.
  Chạy song song nhiều bản web thì đặt `NEXT_DIST_DIR` riêng.
- PoC VCworkspace cần Docker; mỗi `poc/<nhóm>/` có README, compose và script. Image ONLYOFFICE chạy amd64
  qua emulation trên Mac ARM (chậm).

## 4. Quy trình làm việc

- Nhánh công việc → PR vào `dev`. `main` chỉ nhận PR từ `dev` khi chủ dự án đồng ý (CI ép điều này).
- Không push thẳng `main`/`dev`, không force-push, không `--no-verify`. Hiện GitHub **chưa bật branch
  protection** cho `main`/`dev` (kiểm 2026-11-06) — nên bật (hướng dẫn: [quản trị AI](huong-dan/quan-tri-ai.md)).
- Đổi API: sửa `contract/openapi.yaml` trước (tăng version, ghi `contract/NGUON.md`), sinh lại kiểu FE bằng
  `pnpm --filter @vcdocs/web gen:api`, rồi mới code. Người không được giao sửa hợp đồng thì ghi đề nghị vào
  `apps/api|web/DE_NGHI_SUA_HOP_DONG.md`.
- Không nới assertion, bỏ test hay tắt kiểm độ phủ để báo xanh. Ghi rõ đã chạy / chưa chạy / bị chặn.
- Ghi sổ tay khi kết thúc việc (mới nhất ở trên, ngày `YYYY-MM-DD`, không ghi secret).
- Team dùng trợ lý AI thì đọc [AGENTS.md](../AGENTS.md) và [quản trị AI](huong-dan/quan-tri-ai.md):
  repo có hook chặn lệnh nguy hiểm và gate Stop chạy `pnpm ai:check`.

## 5. Trạng thái nhánh: việc đầu tiên của team

> **Cập nhật 2026-11-14:** cả bảy nhánh dưới đây (và nhánh tài liệu này) đã được gộp sẵn vào
> `claude/tich-hop-dev`, xung đột đã gỡ, `pnpm ai:check:full` PASS 2026-11-14 (guard, lint hợp đồng, typecheck, BE 466 đạt/10 skip, hợp đồng 169/169, FE 137/137, build production). Việc còn lại là đẩy nhánh đó,
> mở **một** PR vào `dev` (nội dung: [PR tích hợp](ke-hoach/vcworkspace-pr-tich-hop.md)) rồi `dev` → `main`.
> Bảng bên dưới giữ lại để tra từng nhánh con chứa gì.

`dev` đang đứng ở 6656766. Bảy nhánh có việc đã xong, đã qua gate local, **chưa vào `dev`**.
Đề xuất gộp theo thứ tự dưới (đã thử gộp khô bằng `git merge-tree` ngày 2026-11-06; cột cuối là file
xung đột nếu gộp theo đúng thứ tự này):

| # | Nhánh | Nội dung | Gate đã chạy | Xung đột dự kiến |
|---|---|---|---|---|
| 1 | `claude/prod-cau-hinh-vcworkspace-2fe0b0` (2 commit) | Chế độ `disabled` cho Drive/Email, guard 503, FE ẩn menu theo `NEXT_PUBLIC_WORKSPACE_MODULES`, mẫu env deploy | `ai:check:full` PASS 2026-11-06 (BE 379, FE 104); chưa build Docker. Nội dung PR: `docs/ke-hoach/vcworkspace-pr-prod-disabled.md` trên nhánh | không |
| 2 | `vcworkspace/antd-ho-so` = **PR #12** | Ant Design bước 2–6: Hồ sơ, Tài liệu, Phê duyệt, Thư mục/Drive, Email; QA server bật việc nền | FE 96/96, `ai:check` đạt | sổ tay |
| 3 | `claude/bao-mat-o1-o15-3028d0` (14 commit) | Sửa review O1–O15 (ONLYOFFICE forcesave, thùng rác, mail Đã gửi, idempotency, header bảo mật, OIDC…) | `ai:check:full` PASS | sổ tay, `email/page.tsx` |
| 4 | `claude/gd2-m10-m15-vao-dev-c7c4dd` | VCdocs M10 Bàn giao + M15 Nhật ký, OpenAPI **2.7.0-gd2** | `ai:check:full` PASS (BE 411, FE 127) | sổ tay, `RecordView.tsx`, `DocumentView.tsx`, `globals.css`, `permissions.ts`, `apps/web/DE_NGHI_SUA_HOP_DONG.md` |
| 5 | `claude/tai-lieu-xem-tai-cho` (1 commit) | Xem nội dung file ngay trong trang chi tiết tài liệu | test FE kèm theo | không |
| 6 | `claude/b1-drive-office-prod` (gồm #1) | B1: Nextcloud bắt buộc https, kiểm cấu hình ONLYOFFICE, credential Nextcloud mã hoá AES-GCM theo người, lệnh `kho-credential` | `ai:check` PASS, test lẻ 41/41 | sổ tay |
| 7 | `claude/office-engine-onlyoffice` (gồm #2) | Chỉ tài liệu + harness: chốt ONLYOFFICE CE 9.4, đo tải 48 phiên, REA | không đổi mã app | sổ tay |

Ghi chú:

- **#1 là P0.** Ngày 2026-10-26 production `git pull` lên `main` sau PR #15 và API khởi động lại liên tục
  ("Không được chạy WORKSPACE_STORAGE_MODE=fake ở production"); chủ dự án đã rollback VM về 39e02f7.
  **`main` không deploy được cho tới khi #1 vào `dev` rồi `main`.**
- Nhánh #2 trên GitHub thiếu commit gộp ca04977 (đã có ở local) — chủ dự án push lại thì PR #12 mới hết
  xung đột và CI mới chạy (hiện CI chưa báo check nào).
- Sau mỗi lần gộp chạy `pnpm ai:check:full`. Xung đột `SO_TAY_DU_AN.md` chỉ là các khối ghi thêm: giữ
  cả hai phía, mới nhất ở trên.
- Xung đột giao diện ở #3, #4: nhánh antd (#2) đã đổi các trang sang antd; #3/#4 được viết trên `dev`
  cũ. Giữ antd, áp lại logic của #3/#4. Các trang M10/M15 (`/ban-giao`, `/nhat-ky`) còn dùng lớp CSS cũ.
- Việc dở **chưa commit** trong worktree local của chủ dự án (không nằm trên GitHub):
  `.claude/worktrees/phuong-an-b-chi-tiet` — tài liệu "phương án B chi tiết" (dung lượng Google ~3,6 TB,
  51 tài khoản, sizing máy, sự cố trên); `.claude/worktrees/chay-dev-local` — seed dữ liệu review
  `apps/api/test/qa-review-data.spec.ts` (50 bước, 12 vai). Chủ dự án quyết commit hay bỏ.
- Nhánh cũ có thể dọn sau khi gộp xong: `giai-doan-1`, `giai-doan-2`, `claude/giai-doan-2-52f0f9`,
  `claude/silly-perlman-f78be6`, `claude/strange-pare-e56c3f` (đã nằm trong #4), `claude/phuong-an-b-chi-tiet`,
  `claude/amazing-noether-0178c7` (nằm trong #6), `tmp-reader`, `claude/mail-reply`, `claude/chat1x-*` (đã vào `dev`).

## 6. Việc tiếp theo (ưu tiên)

**P0 — làm production chạy lại được**

1. Gộp nhánh #1 → `dev` → `main`; build Docker theo `deploy/README.md`, đặt `*_MODE=disabled`,
   `NEXT_PUBLIC_WORKSPACE_MODULES=` trống.
2. Kiểm hồi quy nghiệp vụ VCdocs trên **bản sao** CSDL production, sao lưu + snapshot rồi mới deploy
   (phương án A, [trang 20](ke-hoach/vcworkspace-20-production-phuong-an.md) trên nhánh #6). Việc này là
   vận hành: làm bằng phiên/người có quyền riêng, không làm từ máy dev.

**P1 — đưa mã đã xong vào `dev`**

3. ~~Gộp #2 → #7 theo bảng mục 5~~ — đã gộp trên `claude/tich-hop-dev` (2026-11-14), chờ PR.
4. Nối M10 Bàn giao với vòng đời VCworkspace — **đã làm phần hộp thư** (chuyển người quản lý hộp thư nhóm khi
   chuyển quyền; thu hồi hộp thư, alias, credential kho tệp khi khoá tài khoản; nhật ký Drive phòng ban gắn phòng).
   Thêm: khoá danh tính IdP/Nextcloud (`IDENTITY_LIFECYCLE_MODE=remote`), dòng bàn giao `workspace_space` (người nhận đọc
   không gian cá nhân), nhật ký bí danh/hộp thư nhóm gắn phòng. Còn: thử `remote` với Authentik/Nextcloud thật trên staging;
   đọc tệp của người khác trên Nextcloud thật phụ thuộc O13.
5. FE: ~~chi tiết bàn giao hiện chữ máy `drafting`~~ (đã sửa); chuyển nốt các trang còn lớp cũ sang antd
   (`/bo-nho`, `/chia-se`, `/thong-bao`, `/danh-muc*`, `/bang-ma`, `/nhan-su`, `/tra-cuu`, `/viec-nen`,
   `/ban-giao`, `/nhat-ky`, đăng nhập) — chờ chủ dự án đồng ý phạm vi.

**P2 — B1 Drive/Office lên production (phương án B, Drive/Office trước, Email sau cùng)**

6. Theo [trang 21 B1](ke-hoach/vcworkspace-21-b1-drive-office-production.md) (nhánh #6): staging Nextcloud +
   ONLYOFFICE qua https, `AppPasswordIssuer` thật (cần chế độ production cho identity lifecycle), job xoay
   app password, diễn tập backup/restore, người vận hành.
7. O13: không gian phòng ban trên Nextcloud (Team Folder hay tài khoản dịch vụ) — hiện tệp nằm trong home
   người tải lên.
8. Đo lại ONLYOFFICE 48 phiên trên VM x86 thật; thử XLSX/PPTX và bản 10.0
   ([báo cáo](nghien-cuu/office-engine-tai-48-2026-10-26.md)).
9. Chạy lại tích hợp ONLYOFFICE/Stalwart/Authentik thật cho các bản sửa O1–O15 (mới kiểm bằng giả); dọn
   `token` rõ của link chia sẻ tạo trước commit acc802c.

**P3 — sau pilot**

10. Email production (Stalwart, tên miền `mail.vcprosperous.com`), Work management, Flow, Sync/NAS,
    Lịch/Danh bạ, Talk, Assistant AI: mỗi nhóm còn phần thiết bị/mạng thật và chính sách (mục 7).
11. Chat20 nghiệm thu liên nhóm (phạm vi ở mục 13 bàn giao chat19).
12. VCdocs Google thật: chủ dự án điền `apps/api/so-do-to-chuc.yaml` → `nap-so-do` → `nhan-cay-thu-muc`;
    IT tạo 64 nhóm C1, thêm 2 quyền DWD (`admin.datatransfer`, `admin.directory.group.member`) cho M10.

## 7. Quyết định đang chờ chủ dự án

Danh sách đầy đủ ở sổ tay mục 4. Những câu chặn việc của DEV:

| Chặn việc | Câu hỏi |
|---|---|
| P0 | Bản sao CSDL/staging lấy ở đâu, ai vận hành deploy |
| P2 (B1) | Chu kỳ xoay app password (mã mặc định 90 ngày), ai giữ bản sao keyring `WORKSPACE_CREDENTIAL_KEYS`; Nextcloud production cùng máy sau Caddy hay máy riêng; làm production mode cho identity lifecycle trong B1 không |
| P2 (O3) | Phiên OIDC hết sau 300 giây: refresh token, `prompt=none`, hay nâng thời lượng (đề xuất nâng cho pilot) |
| P2 (O13) | Không gian phòng ban: Team Folder hay tài khoản dịch vụ |
| P1 (O14) | Thành viên quyền `read` của hộp thư nhóm có được gán nhãn không |
| P3 | Quy mô họp (Talk HPB), phần cứng/mô hình AI, thiết bị thật cho sync/lịch, chính sách liên phòng |
| VCdocs | "Đập tính năng cũ" tới đâu; sơ đồ tổ chức; đổi tên ~70 thư mục `Tháng NN` của MKT |

## 8. Bẫy đã gặp (đọc trước khi sửa)

- Production chặn mọi chế độ `fake`; thiếu biến thì phải là `disabled` (nhánh #1), không được rơi về giả.
- antd 6 trong jsdom cần mock `matchMedia`, `ResizeObserver`, `getComputedStyle`; render test qua
  `UiProvider test`. Truy vấn `getByRole` trên trang lớn chậm (~0,5 s/lần), CI chậm 2–3 lần máy dev →
  `testTimeout` 60 s; ưu tiên `getByLabelText`/`getByText`. Helper chọn Select: `apps/web/src/test/antd.ts`.
- antd Form: validator chạy trước render lại — đọc `form.getFieldsValue(true)`, đừng dùng biến `useWatch`.
- Google Drive: bỏ thư mục vào thùng rác thì tệp con vẫn `trashed: false`. Thêm scope Google ở
  `real-google.ts` thì IT phải thêm cả domain-wide delegation ở admin.google.com.
- ONLYOFFICE "20 kết nối" là giới hạn bản có license; CE 9.4 không cap. Kiểm `server/Common/sources/license.js`
  của đúng bản định dùng.
- Nextcloud: probe sai nhiều lần bật brute-force (cần `trusted_proxies` sau reverse proxy); mount SMB đặt
  `case_sensitive=false`; webhook không gửi lại khi receiver lỗi (receiver phải đối soát).
- Calendar: sổ địa chỉ hệ thống mặc định lộ cả công ty → bật `shareapi_restrict_user_enumeration_to_group`.
- Talk: STUN rỗng thì tự gọi `stun.nextcloud.com`; moderator thêm được người khác nhóm.
- Assistant AI: prompt injection, IDOR xoá phiên chat, prompt lưu nguyên văn 6 tháng — chưa được bật cho người dùng.
- Phát hiện bảo mật và trạng thái sửa: [review QA](ke-hoach/vcworkspace-review-qa-2026-10-25.md),
  [audit](bao-mat/audit-cloudflare-2026-10-25.md), [nhật ký sửa audit](bao-mat/audit-fix-log.md).

## 9. Những thứ không nằm trong repo

| Thứ | Ai giữ | Ghi chú |
|---|---|---|
| Khoá service account `vcdocs-backend`, `apps/api/.env`, secret PoC (`poc/*/secrets/`) | Chủ dự án | Không commit, không gửi qua chat. Xin cấp riêng theo quyền tối thiểu |
| GCP project `vcdocs`, VM `vcdocs-prod`, bucket sao lưu, DNS | Chủ dự án | Vận hành bằng tài khoản riêng, không từ phiên code |
| Google Admin (DWD, nhóm C1) | IT (anh Hùng) | |
| Bản gốc BA, hợp đồng API, kiến trúc (Claude artifact, riêng tư) | Chủ dự án | Bản xuất trong `docs/`; cần chia sẻ link nếu team muốn xem hình vẽ gốc |
| Repo GitHub `buithoanh/VCdocs` (public) | Chủ dự án | Thêm thành viên team, bật branch protection |

## 10. Mục lục tài liệu

- Nghiệp vụ: [BA và đặc tả người dùng](ba/BA-dac-ta-nguoi-dung.md), [hợp đồng API v1](hop-dong-api/hop-dong-api-v1.md)
  (bản xuất rev 22; mục 10 giai đoạn 2 xem `contract/openapi.yaml` trên nhánh #4).
- Kế hoạch: [thứ tự phát triển](ke-hoach/bien-ban-thu-tu-phat-trien-vcworkspace.md),
  [lộ trình 9 nhóm](ke-hoach/vcworkspace-11-lo-trinh-9-nhom.md),
  [nghiệm thu tổng thể chat10](ke-hoach/vcworkspace-10-nghiem-thu-tong-the.md),
  [deploy và chuyển Google](ke-hoach/vcworkspace-ke-hoach-deploy-chuyen-google.md).
- Bàn giao từng chat: `docs/ke-hoach/vcworkspace-0x…19-ban-giao-*.md` (bảng mục 1).
- Nghiên cứu: [khả thi](nghien-cuu/vcworkspace-nghien-cuu-kha-thi.md), [kiểm chứng](nghien-cuu/vcworkspace-kiem-chung-2026-10-23.md),
  [engine soạn thảo](nghien-cuu/office-engine-tai-48-2026-10-26.md) (nhánh #7).
- Vận hành: [deploy](../deploy/README.md), [README API](../apps/api/README.md), [README web](../apps/web/README.md),
  [quản trị AI](huong-dan/quan-tri-ai.md).
