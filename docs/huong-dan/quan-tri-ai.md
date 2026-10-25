# Quản trị AI cho VCworkspace — 4 lớp

Ngày thiết lập: 2026-10-23. Tên hiện tại là **VCworkspace**, trước đây VCdocs.
Repo GitHub và đường dẫn local hiện vẫn là `buithoanh/VCdocs` và
`/Users/apple/projects/VCdocs`; không suy ra URL mới đã tồn tại. Package `@vcdocs/*`,
cookie, project GCP `vcdocs`, service account và tên miền cũ chưa được di trú.
Đổi tên dự án không có nghĩa các phương án kiến trúc nghiên cứu đã được duyệt.

## 1. Đã đặt trong repo

| Lớp | Nguồn chung | Hiệu lực |
|---|---|---|
| Instructions | `AGENTS.md`, `CLAUDE.md` dẫn cùng nguồn | Hướng dẫn model, không phải rào chắn bảo mật |
| Skills | `.agents/skills/vcworkspace-{change,contract,research}/SKILL.md` | Codex tự khám phá; Claude đọc đường dẫn theo AGENTS |
| Deny | `.codex/rules/workspace.rules`, `.claude/settings.json`, `scripts/ai/policy.mjs` | Rules native + hook trước tool; chỉ áp dụng khi được công cụ nạp |
| Hooks | `.codex/hooks.json`, `.claude/settings.json`, `scripts/ai/hook.mjs` | Đầu phiên, trước tool và trước kết thúc |
| Cổng máy chủ | `.github/workflows/verify.yml`, `.github/CODEOWNERS` | CI chỉ bắt buộc khi chủ dự án bật bảo vệ nhánh |

`pnpm ai:guard:test` thử allow/deny bằng fixtures; tuyệt đối không chạy lệnh xoá thật.
`pnpm ai:check` kiểm file thay đổi gồm staged, unstaged, untracked; `--base <ref>`
so thêm thay đổi đã commit. `pnpm ai:check:full` kiểm đầy đủ dù Git không có diff.
Full gate bỏ biến skip/partial coverage, dùng Google giả, test BE tự dựng Mongo riêng.
Gate không khởi động API. Không dùng số test của phiên trước làm kết quả hiện tại.
Stop hook chạy gate, trả exit 2 khi lỗi; chỉ yêu cầu tiếp tục một lần để tránh vòng lặp.
Nếu vẫn vướng môi trường phải báo blocker. CI là cổng ghép mã cuối cùng.

## 2. Chủ dự án kích hoạt trên máy chạy agent

### Codex
1. Mở đúng thư mục repo. Đọc diff `.codex/config.toml`, `hooks.json`, rules và script.
2. Khởi động phiên mới sau khi trust project; mở `/hooks` ở CLI để review/trust các hook.
   Hook không được trust sẽ bị bỏ qua. Không dùng cờ bypass trust/sandbox để cài.
3. Chạy `pnpm ai:guard:test`; xem SessionStart thông báo root/branch và cảnh báo có
   `.env` (chỉ kiểm tồn tại, không đọc giá trị).
4. Trong phiên mới thử yêu cầu chạy `npm --version`: phải bị chặn; `git status` phải chạy.
   Có thể kiểm native rule không thực thi lệnh bằng:
   `codex execpolicy check --rules .codex/rules/workspace.rules -- git push origin main`.
5. Với CLI hiện tại, kiểm config bằng `codex exec --strict-config` khi mở công việc kế tiếp;
   nếu version không nhận trường cấu hình, dừng và nâng cấp/đối chiếu trước khi dùng.
   Managed policy của tổ chức có thể ưu tiên hơn project config.

### Claude Code
1. `.claude/settings.json` được commit riêng; cấu hình local khác vẫn gitignore.
2. Mở lại repo, kiểm `/hooks` và `/permissions`; review hooks trước khi chấp nhận trust.
3. Thử `npm --version` phải deny, `git status` phải được; đọc `.env.example` được,
   yêu cầu đọc `.env` phải bị chặn. Không thử với secret thật để lấy bằng chứng.
4. Claude Code khác Codex về tên tool/schema; script chung nhận `command`/`cmd`
   và `file_path`, không giả định hỗ trợ Cursor. Cursor chưa được cấu hình trong đợt này.

### Giới hạn phải hiểu
- Đã kiểm native loader Codex 0.163.0-alpha.11 bằng `config/read`, `hooks/list`,
  `skills/list`: config hợp lệ, 3 skill enabled, 3 hook project enabled nhưng
  `trustStatus=untrusted`, không có lỗi nạp. Anh còn cần review/trust.
- Repo config không tự cài vào phiên đang chạy. Test script/native rule không chứng minh
  mọi tool của desktop đã nạp hook; cần smoke test phiên mới như trên.
- Prefix rules của Codex kiểm các yêu cầu chạy ngoài sandbox. Hook kiểm mẫu lệnh dễ sai;
  không phải bộ phân tích mọi ngôn ngữ, alias, SDK, script hay connector.
- Secret nằm ngoài repo vẫn có thể đọc được nếu cùng tài khoản hệ điều hành có quyền.
  Lọc biến môi trường không bảo vệ file, trình duyệt, Keychain hay MCP đã đăng nhập.
- Agent có thể sửa script/rule trong repo. Muốn cưỡng chế tổ chức: đặt policy/hook đã
  review ở lớp managed, quyền chỉ quản trị được sửa; cấu hình IAM/OS/network độc lập.
- Tách tài khoản macOS hoặc VM phát triển không chứa credentials thật là bước cần làm.
  Worktree hay container gắn toàn bộ home/credential socket không tạo được ranh giới đó.

## 3. Google/GCP — chủ dự án hoặc IT thực hiện

Các định danh dưới đây lấy từ sổ tay; phiên cài đặt không đăng nhập/đổi quyền Google.
Trước thay đổi kiểm lại người sở hữu, workload đang dùng và khả năng quay lui.

### A. Tách phát triển khỏi dữ liệu thật
1. Tạo user macOS/VM dành cho agent. Chỉ chép repo sạch và dependencies, không chép
   `.env`, khoá JSON, `~/.config/gcloud`, ADC, SSH, Keychain hay browser profile của anh.
2. Dùng `GOOGLE_MODE=fake` và CSDL mới. Không mount `vcdocs_that`, kho PDF thật hay backup.
3. Nếu cần test Google: tạo project/service account thử riêng; thêm nó vào **shared drive thử**,
   không thêm vào 11 drive công ty. Không cấp Owner/Editor hoặc domain-wide delegation mặc định.
4. Thử: tài khoản test tạo/đọc tệp trong drive thử; truy cập drive thật phải bị từ chối.
   Ghi ID drive thử, quyền đã cấp và kết quả (không ghi token).

### B. Rà service account hiện có và uỷ quyền toàn miền
1. Cloud Console → chọn project `vcdocs` → IAM & Admin → Service Accounts →
   `vcdocs-backend` → Keys. Lập danh sách key ID/ngày tạo/người dùng (không tải key về máy agent).
2. IAM → rà principal của runtime và tài khoản làm dev. Gỡ quyền quản trị không cần thiết
   sau khi xác nhận workload; người phát triển không mặc nhiên có quyền xoá resource/đổi IAM.
3. Google Admin → Security → Access and data control → API controls → Manage Domain Wide
   Delegation. Đối chiếu client ID với service account và 8 scope ghi trong sổ tay/mã nguồn;
   chỉ giữ scope thực sự cần. Đây là quyền riêng với IAM GCP; sửa một bên không thay bên còn lại.
4. Drive → Shared drives → Manage members: rà quyền `vcdocs-backend` trên từng drive;
   runtime chỉ giữ quyền cần nghiệp vụ. Dev/test dùng identity khác, không dùng chung key runtime.
5. Thay key theo thứ tự: chuẩn bị credential thay thế ở runtime → kiểm đăng nhập/đọc/ghi thử
   có kiểm soát → tắt key cũ → theo dõi → xoá key cũ khi xác nhận không còn phụ thuộc.
   Không tắt service account/key đang phục vụ trước khi có đường thay thế đã thử.
6. Organization Policies → kiểm `iam.disableServiceAccountKeyCreation` và policy managed
   tương ứng nếu tổ chức dùng; sổ tay ghi từng nới riêng project. Siết lại khi không còn cần
   tạo key. Ưu tiên identity ngắn hạn cho CI/GCP; tích hợp Google Workspace/DWD hiện dùng
   key cần PoC tương thích trước khi di trú, không tự bỏ key chỉ vì GCP hỗ trợ ADC.
7. Backup dùng identity riêng; không cấp quyền xoá backup cho identity phát triển.
   Thử restore vào CSDL/kho riêng rồi ghi kết quả; không ghi đè dữ liệu thật.

## 4. GitHub — chủ dự án thiết lập

**Đọc live 2026-10-23:** API trả repo `buithoanh/VCdocs`, `private=false`, nhánh mặc định
`main`, tài khoản CLI có quyền admin. Chưa có ruleset; `main` và `dev` trả
`Branch not protected`. Đây là trạng thái đọc được, khác ghi chú private cũ trong sổ tay.
Không đổi visibility, tên repo, quyền hay nhánh trong phiên này.

1. Repository → Settings → Rules → Rulesets → New branch ruleset (hoặc Branches →
   Add branch protection rule). Tạo bảo vệ cho cả `main` và `dev`; enforcement **Active**.
2. Bật Require a pull request before merging, Require status checks, Require branches
   up to date, Require conversation resolution; chặn deletion và force-push.
3. Sau khi workflow chạy thành công lần đầu, chọn check **VCworkspace / verify** với
   nguồn GitHub Actions. Không chỉ commit workflow rồi coi CI đã bắt buộc.
4. `main` chỉ nhận PR cùng repo từ `dev`: workflow đã có bước kiểm này. Không đặt bypass
   cho bot/agent. Với branch protection chọn Do not allow bypassing the above settings.
5. CODEOWNERS đã chỉ định chủ dự án cho guardrails/contract/deploy. Nếu anh là người duy
   nhất và cũng là tác giả PR, **không bật bắt buộc một approval của chính anh** vì GitHub
   không cho tự approve. Muốn bắt buộc người duyệt độc lập cần thêm người có quyền review,
   đổi CODEOWNERS phù hợp rồi bật Require review from Code Owners.
6. Settings → Actions → General → Workflow permissions: **Read repository contents**;
   tắt Allow GitHub Actions to create and approve pull requests nếu không cần.
   Workflow này không cần production secret và checkout không lưu credentials.
7. Agent dùng identity GitHub riêng, giới hạn một repo, không quyền Administration,
   Secrets, Environments hoặc quản lý policy. CLI hiện tại dùng tài khoản admin nên vẫn
   cần tách tài khoản/credential ở bước môi trường; hook không giảm quyền tài khoản đó.
8. Nếu đổi repo thành VCworkspace, làm trong Settings → General → Repository name, rồi
   cập nhật remote, các link tài liệu và integrations. Không đổi GCP project ID bằng thao tác này.
9. Kiểm chứng: mở PR vào dev và quan sát check; thử PR từ nhánh khác vào main phải đỏ;
   dùng màn hình ruleset/branch protection xác nhận Active và không bypass. Không thử
   force-push/xoá nhánh thật để kiểm. Nếu chuyển private, kiểm lại gói GitHub có hỗ trợ
   bảo vệ nhánh private; không đổi visibility chỉ để chạy bộ cấu hình này.

## 5. Nguồn cấu hình và kiểm chứng

- [Codex hooks](https://learn.chatgpt.com/docs/hooks): project trust, hook review và Stop.
- [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules): phạm vi ngoài sandbox.
- [Codex advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced): môi trường shell.
- [Claude hooks](https://code.claude.com/docs/en/hooks) và
  [permissions](https://code.claude.com/docs/en/permissions): deny và hạn chế subprocess.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- [Google service account keys](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).
- [Workspace domain-wide delegation](https://support.google.com/a/answer/162106).

Kết quả chạy thực tế được ghi ở `SO_TAY_DU_AN.md`; tài liệu này không thay thế bằng chứng
hook đã nạp trong phiên mới hoặc quyền đã bật trên dịch vụ.

## 6. Kết quả kiểm chứng ngày 2026-10-23

| Kiểm tra | Kết quả |
|---|---|
| `pnpm ai:guard:test` | 40/40; allow/deny, sai workspace, secret, generated file, lệnh chạy server, lỗi gate/Stop và lọc credentials/coverage bypass |
| Codex `execpolicy check` | 5 ca forbidden; `git status` không bị cấm. Chỉ phân tích lệnh, không thực thi thao tác nguy hiểm |
| Native `config/read` với strict config | Sandbox workspace-write, network tắt theo project config, login shell tắt; bộ lọc môi trường được nạp |
| Native `skills/list` | 3 skill của repo enabled; validator skill cả 3 đạt |
| Native `hooks/list` | 3 hook project được phát hiện, không lỗi cấu hình, **untrusted**; chưa hiệu lực trước khi anh review/trust |
| `pnpm ai:check:full` trên bản mã cuối | BE 129/129, độ phủ 98/98 API; FE 72/72; typecheck FE/BE và build đạt |
| Hợp đồng OpenAPI | Hợp lệ, còn 131 cảnh báo của hợp đồng hiện có; phiên này không sửa OpenAPI |
| YAML/JSON/TOML và link tài liệu local | Đọc/kiểm hợp lệ |
| GitHub CI | Đã viết workflow; chưa push/chạy trên GitHub, chưa bật required check |
| Quyền Google/GCP | Chưa thay đổi hay kiểm live; chủ dự án/IT làm mục 3 |

Lần test BE trong sandbox bị EPERM khi mở cổng local; chạy lại với quyền mở cổng
cho MongoDB tạm đã đạt. Không kết nối Google thật hoặc CSDL thật. Chưa thử end-to-end
Claude Code hay một phiên model Codex mới; không dùng fixture test để thay bằng chứng đó.
