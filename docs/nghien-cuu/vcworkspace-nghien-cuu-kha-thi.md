# VCworkspace: nghiên cứu khả thi thay Google Workspace (bản rút gọn)

- **Ngày:** 2026-10-22 · **Người yêu cầu:** Bùi Thọ Anh · **Người viết:** Claude (Opus 5.5) tổng hợp từ 72 agent nghiên cứu
- **Trạng thái:** bản rút gọn. 13/13 mảng đã khảo sát. Luận điểm quyết định của 5 mảng đã kiểm chứng chéo (2 agent độc lập mỗi luận điểm). 8 mảng còn lại **chưa kiểm chứng**, đánh dấu ○ bên dưới. Phiên 2026-10-25 sẽ kiểm tiếp.
- **Ký hiệu:** ✅ đã kiểm, đúng · ◐ đã kiểm, đúng một phần (đã ghi lại cho đúng) · ○ chưa kiểm chứng (chỉ một agent tìm được)
- **Lưu ý chung:** giá, phiên bản, giấy phép đều "tính đến 10/2026" theo nguồn agent đọc ngày 2026-10-22. Kiểm lại trước khi ký hợp đồng hoặc mua. Vấn đề pháp lý chỉ để chủ dự án kiểm với luật sư.

## Mục lục

0. Tóm tắt điều hành
1. Yêu cầu và cách hiểu
2. Quy trình phát triển tự động: Claude Code cloud → GitHub → Google Cloud
3. Mail server trên Google Cloud
4. Kiến trúc VCworkspace đề xuất
5. Công cụ sáng tạo, REA, Creator OS, "AI Jev"
6. AI agent, trợ lý 24/7, knowledge-work-plugins
7. Bảo mật và pháp lý
8. Di cư từ Google Workspace
9. Kích cỡ và chi phí
10. Mã VCdocs hiện có
11. Lộ trình đề xuất
12. Rủi ro chính
13. Câu hỏi cần chủ dự án trả lời
- Phụ lục A: bảng luận điểm đã kiểm
- Phụ lục B: nguồn chính

---

## 0. Tóm tắt điều hành

1. **Làm được, nhưng không phải "một email server".** Không có bộ mã nguồn mở nào thay trọn Google Workspace với chất lượng đồng đều. Cách khả thi là ghép một nền chín (Nextcloud) với một mail server rời (Stalwart), nối bằng một hệ đăng nhập chung (SSO).
2. **Google Cloud chặn gửi thư ra cổng 25** (✅). Mail server trên Compute Engine nhận thư được nhưng không gửi thẳng tới Gmail/Outlook. Phải gửi qua dịch vụ chuyển tiếp (relay) như Amazon SES, chi phí dưới 1 USD/tháng ở lượng thư của VCPV, hoặc đặt máy gửi thư ở nhà cung cấp khác.
3. **Quy trình Claude Code cloud → GitHub → Google Cloud làm được ngay** (◐). Điểm vướng: repo private trên gói GitHub Free/Pro/Team không có bước "người duyệt bắt buộc" trước khi deploy (✅). Cần dùng cách thay thế hoặc nâng gói.
4. **Không nên "đập hết" VCdocs.** Mọi lời gọi Google đã gom về một lớp cổng duy nhất (○). Phần hạ tầng (nhật ký kiểm toán, hàng đợi việc, chống gửi trùng, mẫu deploy) dùng lại ngay được cho VCworkspace. Nghiệp vụ hồ sơ ISO có thể thành một ứng dụng chạy trên nền mới.
5. **REA, Creator OS, AI Jev không phải nền để xây VCworkspace** (◐/○). REA là công cụ phân tích phần mềm cho AI agent. Creator OS là dịch vụ trả phí, chỉ phần nhỏ mở mã. "Jev" tìm được là một mô hình quyết định đóng của TypeSafe AI. Các phần mềm "thay Adobe/CapCut/Office" là phần mềm viết độc lập, không phải bản dịch ngược.
6. **Hạ tầng phải lớn hơn hiện nay.** VM e2-medium không đủ. Đề xuất 2 VM, khoảng 8 vCPU/32 GB cho ứng dụng và 4 vCPU/8 GB cho họp video (○). Chi phí ước 440 USD/tháng chưa cam kết, giảm khoảng 37% nếu cam kết 1 năm (○). Google Workspace Business Standard cho 48 người ước 8.064 USD/năm (○).
7. **Quyết định lớn nhất nằm ở dữ liệu, không ở kỹ thuật.** Thư và tài liệu đi qua AI của Anthropic (lưu tại Mỹ) được không. Thư gửi ra có được đi qua relay bên thứ ba không. Dữ liệu có phải đặt tại Việt Nam không.

**Đề xuất ngay:** chưa đụng tới Google Workspace. Dựng thử VCworkspace cho 1 phòng trong 3–6 tháng, Drive và lịch trước, mail sau cùng.

---

## 1. Yêu cầu và cách hiểu

| # | Yêu cầu chủ dự án | Cách hiểu trong báo cáo |
|---|---|---|
| 1 | Code trên máy ảo Anthropic, merge qua GitHub, deploy lên Google Cloud | Claude Code cloud sessions → nhánh `claude/…` → PR → CI → `dev` → deploy GCP |
| 2 | Đập tính năng cũ VCdocs, xây email server VCworkspace thay Google Workspace | Xây bộ cộng tác tự host; xem mục 10 về mức "đập" |
| 3 | Thư (gửi, nhận, nhãn), họp, lịch, lưu trữ, Docs/Sheets/Slides; để sẵn cửa thay Adobe/CapCut/Office; REA; Creator OS chạy quảng cáo | Mục 4 (lõi), mục 5 (mở rộng) |
| 4 | Tự động hoá tối đa quá trình phát triển; AI agent; trợ lý 24/7; "AI Jev" | Mục 2 (dev), mục 6 (sản phẩm) |
| 5 | Bảo mật cao, kho trung tâm công ty | Mục 7 |
| 6 | Tận dụng mã nguồn mở, dễ mở rộng | Xuyên suốt; ưu tiên chuẩn mở (JMAP, CalDAV, WebDAV, OIDC, WOPI) |
| 7 | knowledge-work-plugins, công ty 1 thành viên | Mục 6 |

**Chưa rõ:** "AI Jev" là gì (mục 5); "đập" tới đâu (mục 10).

---

## 2. Quy trình phát triển tự động: Claude Code cloud → GitHub → Google Cloud

### 2.1 Claude Code cloud sessions (máy ảo của Anthropic)

- **Máy ảo:** Ubuntu 24.04, khoảng 4 vCPU, 16 GB RAM, 30 GB đĩa. Có sẵn Node 22, pnpm, Docker, docker compose, PostgreSQL 16, Redis 7, `gh`. MongoDB không có sẵn, phải chạy bằng container. (◐)
- **Kết nối GitHub:** cài Claude GitHub App, chỉ chọn repo `buithoanh/VCdocs`. Không dùng `/web-setup` vì nó dùng token có quyền trên mọi repo. Thông tin đăng nhập GitHub giữ ở máy chủ Anthropic, không vào máy ảo.
- **Hạn chế:** proxy GitHub chặn GraphQL, nên `gh pr` trả lỗi 403, phải dùng `gh api` (REST).
- **Dữ liệu:** code và transcript lưu ở Anthropic. Nếu công ty bật Zero Data Retention (ZDR) thì cloud sessions, Remote Control và môi trường tự host đều bị tắt (◐). Model Fable bắt buộc lưu 30 ngày, không đủ điều kiện ZDR (◐).
- **Gói Claude:** không có gói tổ chức 1 người. Team tối thiểu 2 thành viên, Enterprise tối thiểu 20 (◐). Lựa chọn thực tế: Pro/Max cá nhân (tắt tuỳ chọn cho phép huấn luyện), API key, hoặc Team 2 thành viên.
- **Tác vụ định kỳ trên cloud** (tên cũ routines): đang ở bản thử nghiệm (research preview). Chạy không hỏi quyền, connector có quyền ghi (◐). Không dùng cho việc chạm production.
- **Remote Control** không phải giải pháp 24/7: máy local phải bật.

Giá model (đọc ngày 2026-10-22, ◐):

| Model | Đầu vào / đầu ra (USD mỗi triệu token) |
|---|---|
| Opus 5.5 | 4 / 20 |
| Sonnet 5.5 | 2 / 10 |
| Haiku 5.5 | 0,10 / 0,50 (prompt ≤100K token) |
| Fable 5.1 | 10 / 50 |

### 2.2 GitHub → Google Cloud

- **Xác thực không cần khoá:** GitHub Actions vào GCP bằng Workload Identity Federation. Không cần khoá service account, nên chính sách chặn tạo khoá của tổ chức không cản. (◐)
- **Đẩy image lên Artifact Registry:** phải dùng chế độ WIF mượn service account riêng cho CI. Chế độ "Direct WIF" không sinh access token cho Docker. (◐)
- **Nơi chạy:** Cloud Run không chạy được SMTP/IMAP/UDP vì chỉ nhận HTTP (◐). GKE Autopilot làm được nhưng quá nặng cho 1–2 người. **Giữ VM Compute Engine + Docker Compose.**
- **Bước duyệt trước production:** trên GitHub Free/Pro/Team, "required reviewers" của Environments chỉ có cho repo public (✅). Repo private cần GitHub Enterprise, từ 21 USD/người/tháng. Cách thay thế rẻ: GitHub Team (4 USD/người) + workflow chạy tay + action `trstringer/manual-approval`.
- **Phút CI:** 2.000 phút/tháng (Free) hoặc 3.000 (Team) cho repo private; vượt thì 0,006 USD/phút (✅).
- **SSH qua IAP:** không dành cho truyền dữ liệu lớn, tự ngắt sau 1 giờ không dùng (◐). Hợp cho lệnh deploy, không hợp để chép dữ liệu.

### 2.3 Pipeline đề xuất

1. Chủ dự án ra lệnh bằng chat. Claude Code cloud làm trên nhánh `claude/…`, mở PR vào `dev`.
2. CI trên GitHub Actions: lint, test, build image, quét lỗ hổng bằng Trivy.
3. Claude review PR (GitHub Action `anthropics/claude-code-action` hoặc Code Review nếu có gói Team).
4. **Người bấm merge** vào `dev`. Merge xong thì tự deploy staging và chạy smoke test.
5. Gắn tag `v*` từ `main`, **người duyệt**, rồi deploy production. Rollback bằng tag cũ.
6. Bí mật để ở GCP Secret Manager. VM tự kéo lúc deploy.
7. Hạ tầng viết bằng OpenTofu (giấy phép MPL-2.0, không rủi ro BSL như Terraform), state để trong bucket GCS.

Giai đoạn sau: chuyển sang cơ chế VM tự kéo bản mới (doco-cd hoặc Komodo) để CI không còn quyền SSH vào production.

**Hai bước vẫn cần người:** merge vào `dev` và duyệt production. Bỏ hai bước này thì một PR độc hại hay một token lộ có thể chạm thẳng production.

---

## 3. Mail server trên Google Cloud

| Câu hỏi | Kết luận | Trạng thái |
|---|---|---|
| GCE có chặn gửi ra cổng 25? | Có, mặc định chặn tới mọi IP ngoài VPC. Không có form tự xin mở; Google chỉ gỡ khi tự đánh giá "rủi ro thấp" hoặc qua kênh bán hàng | ✅◐ |
| Cổng 465/587 ra ngoài? | Không bị chặn | ✅ |
| Nhận thư vào cổng 25? | Không bị chặn. Cần rule firewall ingress tcp:25 | ◐ |
| Relay rẻ nhất | Amazon SES, 0,10 USD/1.000 thư, có hướng dẫn chính thức làm smarthost cho Postfix qua cổng 587 | ◐ |
| Ngưỡng "người gửi số lượng lớn" Gmail/Outlook | VCPV dưới 5.000 thư/tháng, xa ngưỡng khoảng 5.000 thư/ngày | ◐ |
| DigitalOcean | Chặn cả 25, 465, 587; loại | ◐ |
| Hetzner Cloud | Chặn 25 và 465 mặc định; xin mở sau 1 tháng và đã trả hoá đơn đầu; có Singapore | ◐ |

**Kiến trúc đề xuất (lai):**

- Hộp thư, IMAP/JMAP, webmail, chống spam, lưu trữ nằm trên GCE asia-southeast1. MX của `vcprosperous.com` trỏ về IP tĩnh, PTR khớp hostname mail.
- Thư gửi ra đi qua Amazon SES (Singapore) cổng 587. Xin ra khỏi sandbox SES từ đầu.
- DNS: DKIM bằng domain công ty, SPF, MAIL FROM riêng để SPF khớp, DMARC bắt đầu `p=none` rồi nâng dần lên `p=reject` sau 2–4 tuần. Thêm MTA-STS và TLS-RPT.
- Cấu hình sẵn relay dự phòng thứ hai (SMTP2GO hoặc Mailjet).

**Đánh đổi:** thư gửi ra đi qua hạ tầng Amazon (Mỹ). Nếu không chấp nhận, phải tự đặt máy gửi thư ở nhà cung cấp cho mở cổng 25 và tự lo uy tín IP. Đây là câu hỏi cho chủ dự án (mục 13).

---

## 4. Kiến trúc VCworkspace đề xuất

### 4.1 Hướng chọn

Có hai hướng:

- **A. Một bộ trọn gói làm xương sống + mail server rời.**
- **B. Ghép từng mảnh tốt nhất qua SSO.**

Agent khuyên **A' (lai): Nextcloud làm xương sống, Stalwart làm mail server**, vì B có quá nhiều mảnh cho 1–2 người vận hành. Các bộ trọn gói khác bị loại:

- **grommunio:** bản miễn phí chỉ cho tối đa 5 người (✅). 48 người phải trả 1,99–3,99 EUR/người/tháng.
- **Carbonio CE:** thiếu ActiveSync, thiếu backup thời gian thực (○).
- **Zimbra OSE, Kopano:** đã dừng phát triển.
- **Twake:** còn non.

### 4.2 Thành phần

| Mảng | Chọn chính | Dự phòng | Giấy phép | Ghi chú |
|---|---|---|---|---|
| Mail server | **Stalwart** v0.16.x | Mailcow | AGPL-3.0 / GPL-3.0 | Stalwart: một chương trình gồm SMTP, IMAP, JMAP, CalDAV, CardDAV, WebDAV, Sieve, chống spam, OIDC/LDAP; khoảng 1 GB RAM cho 5–10 người (◐). Chưa có bản 1.0, mỗi bản minor đều có thay đổi phá vỡ (✅), phụ thuộc gần như một lập trình viên chính. Mailcow chín hơn nhưng cần 6–8 GiB RAM, không có JMAP |
| Webmail + nhãn | Nextcloud Mail hoặc Twake Mail | root-fr JMAP Webmail | AGPL / MIT | Nhãn lưu bằng IMAP keyword hoặc JMAP keyword, một thư nhiều nhãn (○) |
| Lưu trữ tệp | **Nextcloud Hub** (server 35) | — | AGPL-3.0 | 11 shared drive thành 11 Group Folder theo phòng |
| Lịch, danh bạ | Nextcloud Calendar | Stalwart CalDAV | AGPL-3.0 | Nextcloud có giao diện, đặt phòng, đặt lịch hẹn; Stalwart không có giao diện lịch |
| Office trên web | **ONLYOFFICE Docs CE ≥ 9.4** hoặc Euro-Office | Collabora Online | AGPL-3.0 / MPL-2.0 | ONLYOFFICE 9.4 đã bỏ giới hạn 20 tài liệu mở cùng lúc (○). Euro-Office là bản tách nhánh từ ONLYOFFICE của liên minh châu Âu; Nextcloud Office nay dùng nó (○). Bản Collabora miễn phí (CODE) "không khuyến nghị production" |
| Ghi chú, wiki | La Suite Docs | Docmost | MIT / AGPL | La Suite Docs dùng Next.js, gần stack VCdocs |
| Họp video | **LiveKit** + La Suite Meet | Jitsi Meet / Nextcloud Talk + máy chủ hiệu năng cao | Apache-2.0 / MIT | LiveKit cho AI "tham gia phòng" để ghi chép; Jitsi không cần code (○) |
| Đăng nhập chung (SSO) | **Authentik** | Keycloak; Pocket ID + LLDAP | MIT / Apache-2.0 | Thay Google Directory; bắt buộc passkey |
| Tự động hoá | Windmill | n8n (dùng nội bộ) | AGPL / Sustainable Use | n8n cho dùng nội bộ, không được bán lại (○) |
| Tìm kiếm | Meilisearch + pgvector | Qdrant | MIT / PostgreSQL | Cần model embedding tiếng Việt, chưa khảo sát |

**Câu hỏi then chốt:** VCworkspace tự viết giao diện bằng TypeScript và chỉ nhúng các engine (ONLYOFFICE, LiveKit, Stalwart), hay nhận Nextcloud (PHP) làm nền? Chọn Nextcloud nhanh hơn nhiều. Tự viết thì kiểm soát hoàn toàn nhưng tốn công. Agent nghiêng về Nextcloud cho giai đoạn đầu.

---

## 5. Công cụ sáng tạo, REA, Creator OS, "AI Jev"

### 5.1 Đính chính

"Nhiều mã nguồn mở đã reverse Adobe, CapCut, Office" không đúng bản chất (◐). GIMP, Krita, Penpot, Kdenlive, LibreOffice, ONLYOFFICE đều là phần mềm **thay thế viết độc lập**, không phải bản dịch ngược mã của Adobe, ByteDance hay Microsoft.

### 5.2 Ba cái tên chủ dự án nhắc

| Tên | Thực chất | Trạng thái |
|---|---|---|
| **REA – Reverse Engineer Anything** | Repo `morluto/rea` (MIT). MCP server + skill cho Claude Code/Codex/Cursor, bọc Ghidra, IDA, jadx để AI agent phân tích phần mềm không có mã nguồn. Không tự có decompiler. Bản điều khoản của chính REA cấm dùng để chép phần mềm độc quyền hay vượt DRM | ◐ (bản mới nhất 6.7.0 ngày 2026-10-18). Agent ghi khoảng 358.000 sao GitHub, con số rất cao, **cần kiểm lại** |
| **Creator OS** | Dịch vụ trả phí `creatoros.ca` của Kev Builds (Canada, ra mắt 08/2026): đăng bài, lịch đăng, phân tích mạng xã hội; gói quảng cáo thêm 19,99 USD/tháng chạy Meta/Google/TikTok Ads qua API. Phần mở mã (MIT) chỉ là bộ khung agent nhỏ, vẫn cần API key trả phí | ○ |
| **"AI Jev"** | Kết quả khớp nhất: **Jev** của TypeSafe AI (ra mắt 2026-09-15). Đây là "mô hình quyết định" đóng, chỉ gọi qua API, đặt tại Mỹ. Không sinh văn bản, không phải trợ lý 24/7 | ○, **cần chủ dự án xác nhận** |

Thay cho Creator OS: agent mã mở `langchain-ai/paid-media-agent` (Apache-2.0, tự host), cùng Postiz (lên lịch mạng xã hội), Mautic hoặc Listmonk (email marketing), Umami (đo truy cập).

### 5.3 Ranh giới pháp lý khi "reverse"

- Điều khoản dịch vụ của Google, Microsoft, Adobe, CapCut đều cấm dịch ngược, trừ phạm vi luật bắt buộc cho phép (○).
- **Được làm:** học ý tưởng và tính năng, tự xây sạch (clean-room), đọc định dạng tệp và giao thức để tương thích.
- **Không được làm:** chép mã, giao diện, icon, font, tài sản.
- **Rủi ro thực tế:** dịch ngược client Google bằng tài khoản công ty có thể bị khoá cả Google Workspace của 48 người trong lúc chưa chuyển xong.

### 5.4 Để nhân viên dùng REA phát triển thêm, có kiểm soát

1. **Chính sách 3 tầng.** Được phép: phần mềm công ty sở hữu, mã nguồn mở, định dạng tệp. Phải xin phép: phần mềm bên thứ ba đã mua. Cấm: mọi SaaS công ty đang dùng.
2. **Chạy trong VM hoặc container riêng.** Không đăng nhập Google công ty, không có SSH key, không có tệp `.env`. REA tự nhận "không phải sandbox", và MCP server chạy ngoài sandbox của Claude Code (○).
3. **Chỉ cài từ `github.com/morluto/rea` hoặc npm `rea-agents`**, ghim phiên bản. Đã có bản giả mạo chứa mã độc. Phương án nhẹ hơn: `aicodeking/leanrea`.
4. **Mọi tính năng mới đi qua nhánh riêng, PR, review bắt buộc**, kèm kiểm giấy phép phụ thuộc.

### 5.5 Công cụ nhúng được vào VCworkspace

| Nhu cầu | Giai đoạn 1 (không tốn license) | Ghi chú |
|---|---|---|
| Bảng trắng, sơ đồ | Excalidraw (MIT) | tldraw cần license key cho production (✅) |
| Thiết kế (thay Figma/XD) | Penpot (MPL-2.0) | Có OIDC, API, webhook |
| PDF | PDF.js (Apache) xem; Stirling-PDF thao tác | Stirling-PDF bản Free chỉ 5 người; Team 99 USD/tháng (◐) |
| Chỉnh ảnh nhanh | Filerobot Image Editor (MIT) | Không thay được Photoshop; dùng GIMP, Krita trên máy |
| Video | Kdenlive, Shotcut trên máy; Revideo, Mediabunny để tự xây | OpenCut đang viết lại từ đầu, chưa dùng production (◐). Remotion phải mua license khi công ty từ 4 người (◐) |
| Âm thanh | Audacity 4 trên máy | — |
| Model AI tự host | FLUX.1-schnell (Apache) cho ảnh | Kokoro TTS không có tiếng Việt; F5-TTS weights cấm thương mại (◐) |

---

## 6. AI agent, trợ lý 24/7, knowledge-work-plugins

### 6.1 Nền cho trợ lý 24/7

| Lựa chọn | Đánh giá |
|---|---|
| **Claude Agent SDK (TypeScript) tự host trên VM VCPV** | Phù hợp nhất. Cùng stack với VCdocs. Tệp và dữ liệu ở lại VM, chỉ prompt đi Anthropic. Phải dùng API key, không dùng gói đăng ký cho sản phẩm (◐) |
| **Claude Managed Agents** (beta) | Ít hạ tầng nhất, có lịch chạy, kho bí mật, giới hạn ngân sách. Tính thêm 0,08 USD mỗi giờ phiên chạy. Không đủ điều kiện ZDR (◐) |
| OpenClaw (MIT) | Nhiều kênh chat nhất, nhưng đầu 2026 có lỗ hổng chạy mã từ xa và 341 skill độc hại. Không dùng làm lõi cho kho dữ liệu công ty (○) |
| Hermes Agent (MIT) | Có lịch chạy và sandbox, nhưng thiết kế cho cá nhân, viết bằng Python (○) |
| Nextcloud Assistant + Context Agent | Có sẵn nếu chọn Nextcloud. Không hỗ trợ Anthropic trực tiếp, cần proxy kiểu OpenAI (○) |

### 6.2 knowledge-work-plugins sau khi bỏ Google

- `anthropics/knowledge-work-plugins` (Apache-2.0) chỉ là Markdown + JSON trỏ tới MCP server từ xa (○). Các plugin productivity, marketing, sales, data, HR... vẫn dùng được.
- Connector Gmail, Calendar, Drive sẽ mất tác dụng khi bỏ Google.
- Chưa thấy MCP server mã mở nào đủ chín cho IMAP/JMAP, CalDAV, Nextcloud, Jitsi (○).

→ **Phải tự viết "VCworkspace MCP Gateway"** (NestJS + MCP TypeScript SDK, đăng nhập qua SSO công ty, token theo từng người):

- Công cụ đặt tên theo nhóm: `mail_*`, `calendar_*`, `files_*`, `meet_*`, `tasks_*`.
- Mỗi công cụ đánh dấu đọc hay ghi; mọi lời gọi đều ghi nhật ký.
- Claude Desktop, Cowork, knowledge-work-plugins, Agent SDK, Windmill đều trỏ vào một địa chỉ này.
- Đây là chỗ tái dùng tốt nhất của code VCdocs: phiên đăng nhập, nhật ký kiểm toán, hàng đợi việc.

### 6.3 Tính năng AI trong sản phẩm

- **Thư:** tự gắn nhãn và phân loại thư, tóm tắt chuỗi thư, soạn nháp trả lời, rút việc cần làm.
- **Họp:** ghi biên bản họp bằng Whisper/WhisperX kèm LLM.
- **Tìm kiếm:** tìm theo nghĩa trên cả thư và tệp.
- **Trợ lý cá nhân:** nhắc lịch, tổng hợp đầu ngày, theo dõi việc qua Zalo, Telegram hoặc email.

### 6.4 Nguyên tắc an toàn

- **Prompt injection qua email là rủi ro số 1.** Tách agent phân loại (không có công cụ) khỏi agent hành động (gửi thư, chia sẻ tệp phải có người duyệt).
- **Dữ liệu đi Anthropic:** API không dùng để huấn luyện, xoá sau 30 ngày theo mặc định. Model Fable bắt buộc lưu 30 ngày. Kho lưu workspace của Anthropic hiện chỉ đặt ở Mỹ (○).
- **Dữ liệu nhạy cảm** (kế toán, HĐQT) cân nhắc chạy model local.
- **Chi phí token phải có trần**, ví dụ 100 / 300 / 1.000 USD mỗi tháng. Đây là câu hỏi cho chủ dự án.

### 6.5 Hướng "công ty 1 thành viên"

Chủ dự án ra lệnh. Đội agent chia vai: agent code (Claude Code cloud), agent vận hành (theo dõi, sao lưu, cập nhật qua PR), agent nghiệp vụ (trợ lý cá nhân, marketing). Tất cả đi qua MCP Gateway với quyền tối thiểu. Mọi việc ghi đều có nhật ký và có thể quay lui.

---

## 7. Bảo mật và pháp lý

Toàn bộ mục này **chưa kiểm chứng (○)**.

**Kiến trúc tối thiểu:**

1. **Danh tính:** Authentik (lõi MIT có OIDC, SAML, LDAP, SCIM, WebAuthn). Bắt buộc passkey cho mọi người. LDAP outpost cấp thư mục cho Stalwart và Nextcloud. Nhập 48 người từ Google Directory bằng script dựa trên adapter VCdocs. Chỉ giữ 2–3 tài khoản Google miễn phí để quản trị GCP.
2. **Offboarding Stalwart:** Stalwart bản miễn phí không có SCIM. Tài khoản đăng nhập qua OIDC chỉ được biết sau lần đăng nhập đầu, nên thư gửi tới trước đó bị từ chối. Xoá trong LDAP không xoá hộp thư. Cách xử lý: mua Stalwart Enterprise (khoảng 2 EUR/hộp thư/năm, tối thiểu 25 hộp thư) hoặc tự viết script offboarding.
3. **Truy cập mạng:** Cloudflare Zero Trust bản miễn phí (tối đa 50 người, 48/50 là sát trần, log chỉ 24 giờ) che giao diện web, trang quản trị và SSH. Cloudflare không che được SMTP/IMAP, nên cổng 25/465/587/993 vẫn mở công khai. Chặn bằng CrowdSec và giới hạn tốc độ. SSH quản trị qua IAP + OS Login 2FA.
4. **Mã hoá:** mã hoá đĩa mặc định của GCE là đủ. Mã hoá cấp ứng dụng chặn tìm kiếm, xem trước và AI, nên chỉ bật cho nhóm hộp thư hoặc thư mục nhạy cảm.
5. **Sao lưu 3-2-1:** snapshot đĩa hằng ngày; Kopia sang Backblaze B2 với Object Lock chế độ COMPLIANCE, không xoá được kể cả khi bị chiếm quyền; thêm một bản sang GCS. Diễn tập phục hồi định kỳ.
6. **Cập nhật:** Renovate mở PR, ghim theo digest; Trivy quét image. **Không dùng Watchtower** (tự cập nhật không kiểm soát).
7. **Giám sát:** Loki/Grafana, Uptime Kuma. Wazuh quá nặng cho cấu hình hiện tại.
8. **Không đặt mọi thứ trên một VM nhỏ.** Mất IdP là mất đăng nhập toàn công ty.

**Pháp lý Việt Nam (chỉ để kiểm với luật sư):**

- Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (hiệu lực 2026-01-01) và Nghị định 356/2025. Lưu dữ liệu cá nhân trên máy chủ nước ngoài (Singapore, Mỹ) có thể bị coi là chuyển dữ liệu xuyên biên giới.
- Có điều khoản miễn hoặc hoãn cho doanh nghiệp nhỏ và cho dữ liệu nhân viên. Cần xác định VCPV có thuộc diện này không và có lưu dữ liệu cá nhân khách hàng không.
- Luật An ninh mạng 2018 + Nghị định 53/2022 về lưu trữ dữ liệu trong nước.
- GCP không có vùng đặt máy tại Việt Nam.

**Checklist trước khi đưa dữ liệu thật lên:**

- [ ] SSO + passkey bắt buộc
- [ ] Trang quản trị không lộ ra Internet
- [ ] Sao lưu không xoá được + đã diễn tập phục hồi
- [ ] DMARC + SPF + DKIM
- [ ] CrowdSec trên cổng mail
- [ ] Nhật ký tập trung
- [ ] Quy trình offboarding
- [ ] Luật sư xác nhận chỗ đặt dữ liệu

---

## 8. Di cư từ Google Workspace

Toàn bộ mục này **chưa kiểm chứng (○)**.

**Ràng buộc kỹ thuật:**

1. Gmail giới hạn tải qua IMAP 2.500 MB/ngày/tài khoản. Từ 2025-03-14 chỉ chấp nhận app password hoặc OAuth.
2. Nhãn Gmail qua IMAP thành thư mục. Thư có nhiều nhãn bị nhân bản, hoặc imapsync chỉ giữ một nhãn. **Đường giữ trọn nhãn:** Google Takeout (header `X-Gmail-Labels`) rồi chạy `vandelay import takeout` của Stalwart. Vandelay là công cụ mới, phải thử trước.
3. Docs/Sheets chuyển sang DOCX/XLSX (rclone). Mất lịch sử phiên bản, Apps Script, Forms, Sites, hàm QUERY và IMPORTRANGE, và các liên kết `docs.google.com`.
4. Cổng 25 bị chặn (mục 3).

**Công cụ:**

- **GAM 7.48:** kiểm kê người dùng, bí danh, nhóm, chữ ký, filter, quyền Drive, quyền lịch, phòng họp.
- **Google Data Export:** xuất toàn tổ chức, kể cả shared drive và nhóm.
- **rclone:** chép Drive.
- **imapsync:** đồng bộ phần chênh vào ngày cuối.
- **Sieve:** filter Gmail xuất bằng GAM rồi sinh script Sieve.
- **Danh sách thư:** Google Groups chuyển sang Stalwart Lists hoặc Mailman 3.

**Trình tự: Drive và lịch trước, mail sau cùng.** Drive và lịch chạy song song được, không rủi ro. Mail là bước chuyển MX một chiều, nên làm cuối.

1. **Tuần 1–2:** kiểm kê bằng GAM, đo dung lượng, chọn phòng thí điểm. Nên chọn phòng dùng Docs/Sheets nhiều để lộ lỗi chuyển đổi sớm.
2. **Tuần 2–4, thí điểm:** chép shared drive của phòng đó, mở thử 20–30 tệp thật bằng ONLYOFFICE và Collabora, nhập Takeout cho người thí điểm.
3. **Các phòng tiếp theo:** Drive, lịch, danh bạ.
4. **Mail:** hạ TTL DNS. Bật "Also deliver to" trên Gmail để nhận song song. Chuyển MX. Giữ Gmail đọc được 1–3 tháng.

**Quay lui:** MX trỏ lại Google; Drive vẫn còn bản gốc trên Google.

Dịch vụ trả phí thay thế: audriga khoảng 10 EUR/tài khoản, tức khoảng 480 EUR cho 48 người. Chưa kiểm audriga có hỗ trợ đích Stalwart/Nextcloud không.

---

## 9. Kích cỡ và chi phí

Toàn bộ mục này **chưa kiểm chứng (○)**. Giá egress, GCS, IP tĩnh, snapshot tại Singapore **chưa đọc được**, nên phải lấy từ Pricing Calculator.

**Kích cỡ 48–100 người:** tổng khoảng 8–12 vCPU, 28–40 GB RAM, 500 GB–1 TB đĩa.

| VM | Cấu hình | Chạy gì |
|---|---|---|
| VM-A | 8 vCPU / 32 GB | Stalwart, Nextcloud + PostgreSQL + Redis, ONLYOFFICE/Collabora, Authentik, giám sát |
| VM-B | 4 vCPU riêng / 8 GB | Họp video (Jitsi hoặc LiveKit), ăn CPU và băng thông theo số người họp |

Chọn Stalwart thay Mailcow tiết kiệm 6–14 GB RAM.

**Giá GCP asia-southeast1 (nguồn gcloud-compute.com, 2026-10-18):**

| Máy | Theo giờ | Cam kết 1 năm | Cam kết 3 năm |
|---|---|---|---|
| e2-medium (hiện tại) | 30,17 USD/tháng | — | — |
| e2-standard-8 | 241,39 | 152,07 | 108,62 |
| e2-standard-4 | 120,69 | 76,04 | 54,31 |
| pd-balanced | 0,11 USD/GB-tháng | | |

**So sánh nhanh:**

| Kịch bản | Ước tính | Ghi chú |
|---|---|---|
| Giữ Google Workspace Business Standard | 8.064 USD/năm, 24.192 USD/3 năm (14 USD/người/tháng, cam kết năm) | Kiểm lại hoá đơn thật |
| Tự host GCP, 2 VM, chưa cam kết | khoảng 440 USD/tháng gồm cả đĩa, cộng egress | Họp 1 TB/tháng có thể thêm khoảng 100 USD |
| Tự host Hetzner Singapore | rẻ hơn GCP khoảng 25%; CCX33 (8 vCPU riêng / 32 GB) 174,99 EUR/tháng kèm 3 TB | Phải làm lại pipeline |
| OVHcloud | egress miễn phí | Chưa xác nhận có vùng Singapore |
| Nhà cung cấp Việt Nam | dữ liệu trong nước | Chưa có giá cho 8 vCPU/32 GB; CMC giới hạn quốc tế 10 Mbps |

**Chi phí ẩn của tự host:**

- **Thời gian vận hành:** Claude làm phần lớn, nhưng chủ dự án vẫn phải duyệt.
- **Relay SMTP:** dưới 10 USD/tháng.
- **Stalwart Enterprise (tuỳ chọn):** khoảng 96 EUR/năm.
- **Token AI:** cần đặt trần.
- **Hỗ trợ thương mại:** Nextcloud Enterprise chỉ bán từ 100 người, khoảng 71 EUR/người/năm, nên chưa đáng mua.

**Đề xuất:** thử 3–6 tháng trên GCP, chưa cam kết, để đo egress và dung lượng thật. Chỉ mua cam kết 1 năm khi số đo đã ổn. Trong lúc đó vẫn giữ Google Workspace.

---

## 10. Mã VCdocs hiện có

Toàn bộ mục này **chưa kiểm chứng (○)**; agent đã đọc mã, kiểm chứng sẽ đọc lại.

**Kích cỡ:**

| Phần | Dòng | Test |
|---|---|---|
| `apps/api` (NestJS) | 9.527 src + 2.638 test | 129 e2e |
| `apps/web` (Next.js) | 6.529 viết tay + 4.831 sinh tự động | 72 |
| `contract/openapi.yaml` | 2.184 (98 thao tác) | — |

**Phụ thuộc Google:**

- Mọi lời gọi Google đi qua một interface `GooglePorts` (8 cổng, 32 method) trong [ports.ts](../../apps/api/src/google/ports.ts).
- Chỉ `real-google.ts` dùng thư viện `@googleapis/*`.
- Bản giả `FakeGoogle` phủ đủ 32/32 method; mọi test chạy trên bản giả.
- FE không gọi Google, chỉ dựng link `drive.google.com`.

**Phần dùng lại ngay cho VCworkspace (không dính Google):**

- Nhật ký kiểm toán băm nối dòng (`audit.service.ts`)
- Hàng đợi việc trên Mongo (`jobs.service.ts`)
- Idempotency-Key, phiên cookie, CSRF, tách dữ liệu theo công ty (`tenant.plugin`)
- Bộ kiểm phản hồi khớp OpenAPI
- Đóng dấu PDF, kho PDF qua `VaultPort`, đổi được sang S3
- Mẫu deploy: Dockerfile, Compose, Caddy, `backup.sh`

**Ba phương án:**

| Phương án | Nội dung | Đánh giá của agent |
|---|---|---|
| A. Bỏ hết | Xây từ trang trắng | 2/5. Mất nghiệp vụ ISO đã code và test (vòng đời tài liệu, phê duyệt theo thẩm quyền, mã hồ sơ, chốt PDF) |
| B. Giữ nghiệp vụ, đổi adapter | Thay `GooglePorts` bằng cổng lưu trữ, danh bạ, thư mới | 4/5. Chạm khoảng 30–40% mã BE. Một số tính năng Google không có bản tương đương 1:1: khoá chủ sở hữu, chặn tải/in, lịch sử phiên bản, Admin Reports |
| **C. Tách** (khuyên dùng) | Đóng băng VCdocs trên `main`; tách khung hạ tầng làm nền VCworkspace; sau đó port VCdocs thành "ứng dụng quản lý hồ sơ" theo B | 5/5 |

**Hệ quả nếu chọn C:**

- Dừng M10 Bàn giao trên `giai-doan-2`, vì phần này dùng Google Data Transfer. M15 Nhật ký giữ được.
- Tạm dừng việc giao IT tạo 64 nhóm Google C1.
- BA mục 11 (cách lách Google Drive) và hợp đồng mục 6 phải viết lại theo quyền của kho mới.
- 129 test phải chuyển sang bản giả mới.

---

## 11. Lộ trình đề xuất

| Giai đoạn | Thời gian (ước) | Nội dung | Go/no-go |
|---|---|---|---|
| 0. Quyết định | 1 tuần | Chủ dự án trả lời mục 13; chọn phương án mã (mục 10) | Có câu trả lời về dữ liệu, ngân sách, phạm vi |
| 1. Nền dev | 1–2 tuần | GitHub App, branch protection, CI, WIF, OpenTofu, staging VM, Secret Manager | PR tự chạy CI và deploy staging |
| 2. Nền hạ tầng | 2–3 tuần | Authentik, Nextcloud, Stalwart (chỉ nhận thư thử ở tên miền phụ), ONLYOFFICE, sao lưu, giám sát | Checklist mục 7 đạt |
| 3. Thí điểm 1 phòng | 4–8 tuần | Drive + lịch + office cho 1 phòng; MCP Gateway đọc-only; trợ lý AI cho chủ dự án | Nhân viên phòng thí điểm làm việc được; tệp thật mở đúng |
| 4. Mở rộng | 4–8 tuần | Các phòng còn lại; họp video; AI tự gắn nhãn, tóm tắt | Hết lỗi chặn; diễn tập phục hồi đạt |
| 5. Chuyển mail | 2–4 tuần | Nhận song song → chuyển MX → giữ Gmail đọc 1–3 tháng | Tỉ lệ thư vào spam thấp; DMARC sạch |
| 6. Tắt Google Workspace | sau 1–3 tháng | Hạ gói hoặc huỷ | Không còn phụ thuộc |

---

## 12. Rủi ro chính

1. **Stalwart còn ở bản 0.x và phụ thuộc gần như một lập trình viên.** Giảm bằng ghim phiên bản, thử nâng cấp trên staging, xuất dữ liệu định dạng mở, giữ Mailcow làm phương án B.
2. **Thư gửi ra bị vào spam** với IP và tên miền mới. Giảm bằng relay uy tín, DMARC nâng dần, MTA-STS.
3. **Prompt injection qua email làm AI agent rò dữ liệu.** Giảm bằng tách agent đọc khỏi agent hành động, việc ghi phải có người duyệt.
4. **Một VM chứa tất cả thì một sự cố là mất toàn bộ.** Giảm bằng tối thiểu 2 VM, IdP có sao lưu, snapshot hằng ngày.
5. **Mất dữ liệu đặc thù Google khi chuyển** (Apps Script, Forms, IMPORTRANGE, lịch sử phiên bản). Giảm bằng kiểm kê sớm và giữ Google chế độ đọc một thời gian.
6. **Giấy phép thay đổi** (tldraw, Remotion, ONLYOFFICE ↔ Euro-Office). Giảm bằng ghim phiên bản, lưu bản LICENSE. Nếu sau này bán VCworkspace cho bên khác, tránh sửa lõi thành phần AGPL.
7. **Pháp lý dữ liệu** (dữ liệu đặt ở Singapore, Mỹ). Giảm bằng hỏi luật sư trước giai đoạn 3.
8. **Chi phí token AI tăng không kiểm soát.** Giảm bằng trần ngân sách theo tháng và chọn model theo việc.

---

## 13. Câu hỏi cần chủ dự án trả lời

**Phạm vi:**

1. "Đập tính năng cũ" là bỏ cả nghiệp vụ hồ sơ ISO, hay chỉ bỏ phần Google? Chọn A, B hay C ở mục 10? `giai-doan-2` gộp tiếp hay dừng?
2. "AI Jev" có đúng là Jev của TypeSafe AI không, hay ý anh là "AI Dev" hoặc một trợ lý kiểu Jarvis?
3. Anh nghe về REA, Creator OS từ đâu (kênh Kev Builds?); muốn dùng REA để học tính năng của ứng dụng nào?
4. VCworkspace chỉ dùng nội bộ, hay sau này bán cho công ty khác? Điều này đổi lựa chọn giấy phép.

**Dữ liệu và bảo mật:**

5. Chấp nhận thư gửi ra đi qua Amazon SES (Mỹ) không?
6. Chấp nhận nội dung thư và tệp đi qua API Anthropic (Mỹ, không huấn luyện, xoá sau 30 ngày) không? Hay dữ liệu nhạy cảm phải dùng model local?
7. Có bắt buộc dữ liệu đặt tại Việt Nam không? VCPV có lưu dữ liệu cá nhân khách hàng không?
8. Chấp nhận phụ thuộc Cloudflare cho lớp truy cập không?

**Hiện trạng (lấy từ Google Admin):**

9. Đang dùng gói Google Workspace nào, hoá đơn năm bao nhiêu?
10. Dung lượng Drive và Gmail hiện bao nhiêu GB?
11. Lượng thư gửi và nhận mỗi tháng?
12. Số giờ họp mỗi tuần?
13. Có bao nhiêu Sheets dùng IMPORTRANGE, QUERY, Apps Script?
14. Điện thoại nhân viên có bắt buộc đồng bộ kiểu Exchange/Outlook (ActiveSync) không?

**Ngân sách và gói:**

15. Ngân sách hạ tầng mỗi tháng?
16. Ngân sách token AI mỗi tháng (ví dụ 100 / 300 / 1.000 USD)?
17. Gói Claude dùng tiếp là gì (Max cá nhân, Team 2 người, API)?
18. Repo GitHub chuyển vào Organization gói Team (4 USD/người) được không?
19. Trợ lý AI 24/7 giai đoạn đầu cho ai: chỉ chủ dự án, 11 trưởng phòng, hay cả 48 người? Kênh chat nào (Zalo, Telegram, email)?
20. Mốc thời gian muốn bỏ Google Workspace?

---

## Phụ lục A: bảng luận điểm đã kiểm

Mỗi luận điểm được 2 agent kiểm độc lập: một agent đối chiếu nguồn gốc, một agent xét thông tin còn mới không. Cột "Kết quả" ghi theo thứ tự đó. Nội dung đã sửa nằm trong thân báo cáo.

| Mảng | Luận điểm | Kết quả |
|---|---|---|
| Claude cloud | Cloud session clone repo private, có Node 22/pnpm/Docker, dựng Mongo bằng container | ◐ / ◐ |
| Claude cloud | Bật ZDR thì tắt cloud sessions, Remote Control, môi trường tự host | ◐ / ✅ |
| Claude cloud | Tác vụ định kỳ trên cloud ở research preview, chạy không hỏi quyền | ◐ / ✅ |
| Claude cloud | Agent always-on: Agent SDK tự host (API key) hoặc Managed Agents (beta, 0,08 USD/giờ) | ◐ / ✅ |
| Claude cloud | Team tối thiểu 2 thành viên, Enterprise tối thiểu 20 | ✅ / ◐ |
| Claude cloud | Giá Opus/Sonnet/Haiku/Fable | ◐ / ◐ |
| CI/CD | GCE chặn egress 25; 465/587 mở | ◐ / ◐ |
| CI/CD | Cloud Run chỉ HTTP, không host SMTP/IMAP/UDP | ◐ / ◐ |
| CI/CD | Required reviewers cho repo private cần GitHub Enterprise | ✅ / ✅ |
| CI/CD | Direct WIF không sinh access token cho Docker | ◐ / ◐ |
| CI/CD | Phút GitHub Actions 2.000/3.000, 0,006 USD/phút | ✅ / ✅ |
| CI/CD | IAP không dành cho truyền dữ liệu lớn, ngắt sau 1 giờ | ◐ / ✅ |
| Mail trên GCP | Chặn egress 25, không form xin mở | ✅ / ◐ |
| Mail trên GCP | Inbound 25 không bị chặn | ◐ / ◐ |
| Mail trên GCP | SES làm smarthost, 0,10 USD/1.000 thư | ◐ / ◐ |
| Mail trên GCP | Hetzner chặn 25/465, xin mở sau 1 tháng | ◐ / ✅ |
| Mail trên GCP | VCPV dưới ngưỡng người gửi lớn | ◐ / ◐ |
| Mail trên GCP | DigitalOcean chặn 25/465/587 | ◐ / ◐ |
| Mail server | Stalwart Community miễn phí, không giới hạn hộp thư, đủ giao thức | ◐ / ◐ |
| Mail server | Stalwart khoảng 1 GB RAM cho 5–10 người; không có cơ sở khẳng định 4 GB đủ cho 48 người | ◐ / ◐ |
| Mail server | Lịch phát hành Stalwart, mỗi bản minor có thay đổi phá vỡ, chưa có 1.0 | ✅ / ✅ |
| Mail server | Từ v0.16 Stalwart thay REST API quản trị bằng JMAP | ◐ / ◐ |
| Mail server | Dovecot CE vẫn LGPLv2.1 (kèm phần MIT) | ◐ / ✅ |
| Mail server | Nhãn JMAP/IMAP keyword và webmail hiển thị | ○ |
| Workspace | grommunio miễn phí tối đa 5 người | ✅ (1 agent) |
| Workspace | 5 luận điểm còn lại | ○ |
| Công cụ sáng tạo | REA là công cụ phân tích, không phải nguồn "bản thiết kế lại" | ◐ / ◐ |
| Công cụ sáng tạo | Remotion cần license cho công ty từ 4 người | ◐ / ◐ |
| Công cụ sáng tạo | OpenCut đang viết lại, chưa dùng production | ◐ / ◐ |
| Công cụ sáng tạo | tldraw không mã nguồn mở, cần license key production | ✅ / ✅ |
| Công cụ sáng tạo | Stirling-PDF lõi MIT, Free 5 người | ◐ / ◐ |
| Công cụ sáng tạo | Giấy phép model AI tự host (FLUX, Kokoro, F5-TTS) | ◐ / ◐ |
| Office/họp/lịch, REA/Creator OS, AI agent, bảo mật, di cư, chi phí, mã nguồn | 42 luận điểm | ○ (phiên 2026-10-25) |

## Phụ lục B: nguồn chính

- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web.md
- Cloud environments: https://code.claude.com/docs/en/cloud-environments.md
- Data usage: https://code.claude.com/docs/en/data-usage.md
- Routines: https://code.claude.com/docs/en/routines.md
- Models và giá: https://platform.claude.com/docs/en/models/overview.md · https://platform.claude.com/docs/en/about-claude/pricing
- Managed Agents: https://platform.claude.com/docs/en/managed-agents/overview
- Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- google-github-actions/auth: https://github.com/google-github-actions/auth
- Gửi thư từ GCE: https://docs.cloud.google.com/compute/docs/tutorials/sending-mail
- VPC firewall: https://docs.cloud.google.com/vpc/docs/firewalls
- Cloud Run container contract: https://docs.cloud.google.com/run/docs/container-contract
- Amazon SES: https://aws.amazon.com/ses/pricing/ · https://docs.aws.amazon.com/ses/latest/dg/postfix.html
- Hetzner FAQ: https://docs.hetzner.com/cloud/servers/faq/
- Vultr SMTP: https://docs.vultr.com/support/products/compute/why-is-smtp-blocked
- Stalwart: https://github.com/stalwartlabs/stalwart/releases · https://stalw.art/compare · https://stalw.art/docs/auth/backend/oidc/
- Mailcow: https://github.com/mailcow/mailcow-dockerized/releases · https://docs.mailcow.email/getstarted/prerequisite-system/
- Nextcloud: https://docs.nextcloud.com/server/stable/admin_manual/webhook_listeners/index.html · https://docs.nextcloud.com/server/latest/admin_manual/installation/system_requirements.html
- ONLYOFFICE changelog: https://raw.githubusercontent.com/ONLYOFFICE/DocumentServer/master/CHANGELOG.md
- Euro-Office: https://github.com/euro-office
- grommunio: https://grommunio.com/blog/grommunio-2026-06-1-is-here/
- La Suite Docs: https://github.com/suitenumerique/docs
- Jitsi: https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/
- REA: https://github.com/morluto/rea · DISCLAIMER: https://github.com/morluto/rea/blob/main/DISCLAIMER.md
- Creator OS: https://www.creatoros.ca/ · https://github.com/kevinbadi/social-agents
- Jev: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- OpenClaw: https://github.com/openclaw/openclaw · Hermes: https://github.com/NousResearch/hermes-agent
- Penpot: https://github.com/penpot/penpot · Stirling-PDF: https://github.com/Stirling-Tools/Stirling-PDF · OpenCut: https://github.com/OpenCut-app/OpenCut
- Authentik: https://docs.goauthentik.io/docs/enterprise/enterprise-features/ · Pocket ID: https://github.com/pocket-id/pocket-id
- Cloudflare Zero Trust: https://www.cloudflare.com/plans/sase-zero-trust/ · Tailscale: https://tailscale.com/pricing
- Gmail giới hạn IMAP: https://knowledge.workspace.google.com/admin/gmail/gmail-bandwidth-limits
- Google Data Export: https://knowledge.workspace.google.com/admin/migrate/export-all-your-organizations-data
- imapsync Gmail: https://imapsync.lamiral.info/FAQ.d/FAQ.Gmail.txt · GAM: https://github.com/GAM-team/GAM
- Giá GCE Singapore: https://gcloud-compute.com/asia-southeast1.html
- Kết quả thô 72 agent (máy local): `~/.claude/projects/-Users-apple-projects-VCdocs/0153f5e4-10fe-4d4d-98d6-3915a62ea6bf/subagents/workflows/wf_d8f20636-759/ket-qua-da-xong.json`
