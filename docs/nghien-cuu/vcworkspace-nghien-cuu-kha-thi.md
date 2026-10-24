# VCworkspace: nghiên cứu khả thi thay Google Workspace

- **Ngày:** 2026-10-22 · **Người yêu cầu:** Bùi Thọ Anh · **Người viết:** Claude (Opus 5.5) tổng hợp từ 72 agent nghiên cứu
- **Cập nhật kiểm chứng:** 2026-10-23, theo yêu cầu chủ dự án: GPT-6.1 Sol mức high làm chính, GPT-6 Astra mức high kiểm các điểm khó về bảo mật, pháp lý, chi phí và rà chéo kết luận. Kết quả, nguồn đã mở và giới hạn bằng chứng ở [hồ sơ kiểm chứng](vcworkspace-kiem-chung-2026-10-23.md) và Phụ lục C. Đây vẫn là nghiên cứu, chưa phê duyệt kiến trúc hay triển khai.
- **Sửa phạm vi bàn giao:** số “42” không khớp dữ liệu gốc. Có 41 luận điểm của 7 mảng chưa bắt đầu, 6 của workspace đang dở và 1 về nhãn thư: **48 mục** chưa hoàn tất kiểm chéo; 47 mục ○ và workspace-suites#2 đã có 1 lượt kiểm. Phiên này xét đủ 48 ID, kể cả các mục trùng nội dung; không tự tạo 42 mục mới. Những thông tin bổ trợ ngoài bộ ID này chưa được coi là đã kiểm chỉ vì nằm trong cùng đoạn.
- **Ký hiệu:** ✅ đúng trong phạm vi đã nêu · ◐ đúng một phần/cần điều kiện · ❌ bị bác theo nguồn đã mở · ? đã tìm nhưng chưa đủ bằng chứng · ○ thông tin bổ trợ chưa thuộc đợt kiểm này. Kết quả gắn với từng luận điểm gốc, không phải điểm đánh giá toàn bộ sản phẩm.
- **Giới hạn:** nguồn web và mã nguồn được đối chiếu ngày 2026-10-23 cho bộ 48 ID; nhóm đã kiểm ngày 22/10 giữ lịch sử riêng. Giá phụ thuộc SKU/vùng/thuế/gói; bản master hoặc tài liệu latest không thay cho kiểm tra image/version định dùng. Không có thử tải, di cư dữ liệu thật hay kiểm toán bảo mật trong phiên này. Pháp lý cần đối chiếu hoàn cảnh và hợp đồng thực tế của VCPV.

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
- Phụ lục C: kết quả đợt kiểm chứng 2026-10-23
- Phụ lục D: phương án nên chọn và các quyết định trước triển khai

---

## 0. Tóm tắt điều hành

**Đề xuất mới nhất:** xem Phụ lục D. Chọn hướng C về mã và Nextcloud làm nền, thí điểm theo từng bước; các lựa chọn cũ về video, gateway và lịch triển khai là phương án khảo sát, không phải quyết định đã duyệt. Bộ quản trị AI mới trong repo cũng chưa đồng nghĩa hook, CI và quyền ngoài dịch vụ đã có hiệu lực.

1. **Làm được, nhưng không phải "một email server".** Không có bộ mã nguồn mở nào thay trọn Google Workspace với chất lượng đồng đều. Cách khả thi là ghép một nền chín (Nextcloud) với một mail server rời (Stalwart), nối bằng một hệ đăng nhập chung (SSO).
2. **Google Cloud mặc định chặn egress TCP 25 ngoài VPC**, có project ngoại lệ; chưa thử project vcdocs. Relay như SES hoặc MTA ở nơi khác là phương án dự kiến khi chưa xác nhận ngoại lệ. Chưa biết lượng thư và kích thước attachment của VCPV nên chưa kết luận phí relay dưới 1 USD/tháng (migration#4).
3. **Quy trình Claude Code cloud → GitHub → Google Cloud làm được ngay** (◐). Điểm vướng: repo private trên gói GitHub Free/Pro/Team không có bước "người duyệt bắt buộc" trước khi deploy (✅). Cần dùng cách thay thế hoặc nâng gói.
4. **Đề xuất giữ phần có giá trị của VCdocs.** Các SDK Google tập trung trong adapter, nhưng hàng đợi việc phụ thuộc gián tiếp vào Gmail qua thông báo, và quyền/DB/hợp đồng còn khái niệm Drive. Có thể tái sử dụng sau khi tách các phụ thuộc; chưa có căn cứ cho tỷ lệ sửa 30–40% hay “dùng lại ngay”. Xem codebase#1–6 trong hồ sơ kiểm chứng.
5. **Phân biệt công cụ phân tích, SaaS và mô hình quyết định.** REA là công cụ phân tích; CreatorOS được kiểm là SaaS có harness MIT, chưa phải bộ tự host toàn nền. Có sản phẩm Jev của TypeSafe AI nhưng chưa xác nhận đó là “AI Jev” người dùng nói. Không dùng ba tên này làm kiến trúc đã chốt; các phương án phần mềm thay Adobe/CapCut/Office phải đánh giá riêng.
6. **Cấu hình và TCO chưa được đo.** Hai VM 8 vCPU/32 GB và 4 vCPU/8 GB chỉ là cấu hình thử dự kiến; chưa thể chứng minh e2-medium không đáp ứng mọi kịch bản hoặc cần đúng cấu hình này. Bỏ mức 440 USD/tháng và giảm 37% cho cả hệ thống vì chưa đủ báo giá chính thức và thành phần chi phí. Mốc Google Workspace 8.064 USD/năm chỉ là phép tính cho 48 tài khoản Standard ở đơn giá 14 USD, chưa phải hoá đơn VCPV. Xem mục 9.
7. **Cần chốt nơi xử lý và lưu dữ liệu.** Managed Agents workspace hiện có giới hạn vùng; điều này không đồng nghĩa mọi sản phẩm Anthropic và mọi loại dữ liệu đều cùng chính sách. SES Singapore là vùng dịch vụ dự kiến, còn AWS là nhà cung cấp chịu hệ thống pháp luật riêng. Cần chốt loại dữ liệu được gửi cho AI/relay, hợp đồng, thời hạn lưu và nghĩa vụ chuyển dữ liệu xuyên biên giới.

**Đề xuất nghiên cứu, chưa được phê duyệt triển khai:** chưa đụng tới Google Workspace. Dựng thử VCworkspace cho 1 phòng trong 3–6 tháng, Drive và lịch trước, mail sau cùng.

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
- **Tác vụ định kỳ trên cloud** (tên cũ routines): tài liệu hiện hành mô tả auto mode và bộ phân loại; có thể dừng chờ người duyệt khi gặp ask rule hoặc chặn lặp lại. Không còn dùng nhận định “mọi connector ghi đều không hỏi”. Cần cấu hình quyền riêng cho tác vụ. Xem ai-agents#4.
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
| Relay tham khảo | Amazon SES có tài liệu smarthost Postfix qua 587; giá theo thư/dữ liệu/tính năng. Chưa so sánh đủ để gọi rẻ nhất và chưa có workload VCPV | ◐, lịch sử 22/10 |
| Ngưỡng "người gửi số lượng lớn" Gmail/Outlook | Mốc khoảng 5.000 thư/ngày cần đọc điều kiện từng nhà cung cấp; chưa có số lượng thực của VCPV nên chưa kết luận thuộc nhóm nào | ◐, chưa biết workload |
| DigitalOcean | Chặn cả 25, 465, 587; loại | ◐ |
| Hetzner Cloud | Chặn 25 và 465 mặc định; xin mở sau 1 tháng và đã trả hoá đơn đầu; có Singapore | ◐ |

**Kiến trúc đề xuất (lai):**

- Hộp thư, IMAP/JMAP, webmail, chống spam, lưu trữ nằm trên GCE asia-southeast1. MX của `vcprosperous.com` trỏ về IP tĩnh, PTR khớp hostname mail.
- Thư gửi ra đi qua Amazon SES (Singapore) cổng 587. Xin ra khỏi sandbox SES từ đầu.
- DNS: DKIM bằng domain công ty, SPF, MAIL FROM riêng để SPF khớp, DMARC bắt đầu `p=none` rồi nâng dần lên `p=reject` sau 2–4 tuần. Thêm MTA-STS và TLS-RPT.
- Cấu hình sẵn relay dự phòng thứ hai (SMTP2GO hoặc Mailjet).

**Đánh đổi:** thư gửi ra đi qua dịch vụ AWS; vùng SES dự kiến là Singapore. Không đồng nhất quốc tịch nhà cung cấp với vị trí mọi bản dữ liệu, log và hỗ trợ; phải đối chiếu hợp đồng và cấu hình vùng. Nếu không chấp nhận, phải tự đặt máy gửi thư ở nhà cung cấp cho mở cổng 25 và tự lo uy tín IP. Đây là câu hỏi cho chủ dự án (mục 13).

---

## 4. Kiến trúc VCworkspace đề xuất

### 4.1 Hướng chọn

Có hai hướng:

- **A. Một bộ trọn gói làm xương sống + mail server rời.**
- **B. Ghép từng mảnh tốt nhất qua SSO.**

Agent khuyên **A' (lai): Nextcloud làm xương sống, Stalwart làm mail server**, vì B có quá nhiều mảnh cho 1–2 người vận hành. Các bộ trọn gói khác bị loại:

- **grommunio:** gói Community hãng cung cấp tới 5 người; Basic/Plus từ 6 người có giá niêm yết 1,99/3,99 EUR/người/tháng. Đây là phạm vi gói hãng, không phải kết luận mọi component OSS cấm tự build trên 5 người (workspace-suites#2).
- **Carbonio CE:** thiếu tính năng ActiveSync và bộ backup/HSM/legal hold thương mại; vẫn có thể sao lưu ngoài (workspace-suites#5).
- **Zimbra OSE, Kopano, Twake:** đánh giá loại/chọn trong bản cũ chưa phải kết quả của bộ 48 ID; không dùng nhận định tuyệt đối về tình trạng phát triển làm căn cứ loại nếu chưa kiểm phiên bản và sản phẩm cụ thể.

### 4.2 Thành phần

| Mảng | Chọn chính | Dự phòng | Giấy phép | Ghi chú |
|---|---|---|---|---|
| Mail server | **Stalwart** v0.16.x | Mailcow | AGPL-3.0 / GPL-3.0 | Stalwart: một chương trình gồm SMTP, IMAP, JMAP, CalDAV, CardDAV, WebDAV, Sieve, chống spam, OIDC/LDAP; khoảng 1 GB RAM cho 5–10 người (◐). Chưa có bản 1.0, mỗi bản minor đều có thay đổi phá vỡ (✅), phụ thuộc gần như một lập trình viên chính. Mailcow chín hơn nhưng cần 6–8 GiB RAM, không có JMAP |
| Webmail + nhãn | Nextcloud Mail hoặc webmail JMAP | Twake Mail; root-fr JMAP Webmail | Xác nhận LICENSE từng repo/version | IMAP/JMAP có cơ chế nhãn; JMAP mailbox và keyword là hai khái niệm khác nhau. Twake có Label API riêng, không mặc định tương thích Stalwart. Phải thử nhiều nhãn, tìm kiếm và di cư (mail-stacks#6) |
| Lưu trữ tệp | **Nextcloud Hub** (server 35) | — | AGPL-3.0 | 11 shared drive thành 11 Group Folder theo phòng |
| Lịch, danh bạ | Nextcloud Calendar | Stalwart CalDAV | AGPL-3.0 | Stalwart có scheduling/iMIP/RSVP và free/busy; chưa xác minh UI lịch đầy đủ hay luồng đặt phòng/tài nguyên. Cần client và PoC (office-meet-calendar#3) |
| Office trên web | Thử ONLYOFFICE CE 9.4 và Nextcloud Office/Euro-Office | Collabora Online/CODE | Kiểm LICENSE và distribution từng bản; Euro-Office có nhiều thành phần | Nguồn phát hành ONLYOFFICE 9.4 xác nhận bỏ hard cap 20; không đồng nghĩa tải vô hạn. Euro-Office có thật; phân biệt community testing builds với production distribution. Bản production công khai không đồng nghĩa bắt buộc mua Enterprise; Enterprise là kênh hỗ trợ chuyên nghiệp. CODE mặc định không còn hard cap 10/20; Home Mode có giới hạn. Xem workspace-suites#4 và office-meet-calendar#1–2 |
| Ghi chú, wiki | La Suite Docs | Docmost | MIT / AGPL | La Suite Docs dùng Next.js, gần stack VCdocs |
| Họp video | **LiveKit** + La Suite Meet | Jitsi Meet / Nextcloud Talk + máy chủ hiệu năng cao | Apache-2.0 / MIT | LiveKit cho AI "tham gia phòng" để ghi chép; Jitsi có hệ triển khai sẵn; vẫn cần cấu hình, xác thực và tích hợp. Phiên âm mới xem office-meet-calendar#4 |
| Đăng nhập chung (SSO) | **Authentik** | Keycloak; Pocket ID + LLDAP | MIT / Apache-2.0 | Thay Google Directory; bắt buộc passkey |
| Tự động hoá | Windmill | n8n (dùng nội bộ) | AGPL / Sustainable Use | n8n cho internal business purposes; cần xét cách cung cấp cho khách hàng, giá trị sản phẩm và mã .ee., không giản lược thành cấm mọi hoạt động có thu phí (ai-agents#5) |
| Tìm kiếm | Meilisearch + pgvector | Qdrant | MIT / PostgreSQL | Cần model embedding tiếng Việt, chưa khảo sát |

**Nguồn và điều kiện chọn:** workspace-suites#1–6 và office-meet-calendar#1–6 ở Phụ lục C; ONLYOFFICE 9.4 còn có additional attribution terms và trademark policy, cần đọc license của bản phân phối định dùng.

**Câu hỏi then chốt:** VCworkspace tự viết giao diện bằng TypeScript và chỉ nhúng các engine (ONLYOFFICE, LiveKit, Stalwart), hay nhận Nextcloud (PHP) làm nền? Chọn Nextcloud nhanh hơn nhiều. Tự viết thì kiểm soát hoàn toàn nhưng tốn công. Agent nghiêng về Nextcloud cho giai đoạn đầu.

---

## 5. Công cụ sáng tạo, REA, Creator OS, "AI Jev"

### 5.1 Đính chính

"Nhiều mã nguồn mở đã reverse Adobe, CapCut, Office" không đúng bản chất (◐). GIMP, Krita, Penpot, Kdenlive, LibreOffice, ONLYOFFICE đều là phần mềm **thay thế viết độc lập**, không phải bản dịch ngược mã của Adobe, ByteDance hay Microsoft.

### 5.2 Ba cái tên chủ dự án nhắc

| Tên | Thực chất | Trạng thái |
|---|---|---|
| **REA – Reverse Engineer Anything** | Repo `morluto/rea` (MIT). MCP server + skill cho Claude Code/Codex/Cursor, bọc Ghidra, IDA, jadx để AI agent phân tích phần mềm không có mã nguồn. Không tự có decompiler. DISCLAIMER nêu ranh giới sử dụng/hỗ trợ và quyền bên thứ ba, nhưng nói rõ không sửa giấy phép MIT; không gọi đây là điều kiện bổ sung của MIT | ◐; thông tin phiên bản/sao là ảnh chụp động, xem rea-creatoros#1; không dùng độ phổ biến làm bằng chứng an toàn |
| **Creator OS** | SaaS `creatoros.ca` có gói solo 14,99 USD/tháng, Ads add-on 19,99 USD/tháng theo công bố. `social-agents` MIT gọi dịch vụ bên dưới, không phải toàn nền tự host. Chưa kiểm mọi repo/kênh quảng cáo/định danh trùng tên | ◐ rea-creatoros#2 |
| **"AI Jev"** | Có sản phẩm Jev của TypeSafe AI (15/9/2026), mô hình quyết định qua API, không phải LLM hội thoại/tự gọi tool. Chưa xác nhận đây là ý người dùng, mối liên hệ với CreatorOS hoặc nơi inference | ? rea-creatoros#3; **cần xác nhận định danh** |

Thay cho Creator OS: agent mã mở `langchain-ai/paid-media-agent` (Apache-2.0, tự host), cùng Postiz (lên lịch mạng xã hội), Mautic hoặc Listmonk (email marketing), Umami (đo truy cập).

### 5.3 Ranh giới pháp lý khi "reverse"

- Các điều khoản đã mở có hạn chế reverse engineering/extraction nhưng khác sản phẩm, vùng và ngày hiệu lực; Google/Microsoft consumer terms không tự động là hợp đồng Google Workspace/Microsoft 365 của VCPV. CapCut URL năm 2020 là nguồn cũ. Xem rea-creatoros#4 và phần Astra rà chéo.
- Học chức năng, clean-room và tương thích là hướng nghiên cứu; chưa thể kết luận được phép trong mọi trường hợp. Phải xét hợp đồng, quyền tác giả, sáng chế, bí mật kinh doanh và ngoại lệ luật áp dụng.
- Dùng mã/tài sản bên thứ ba phải có quyền phù hợp. Chưa có bằng chứng để dự báo một hành vi sẽ tự động khoá toàn bộ 48 tài khoản.

### 5.4 Để nhân viên dùng REA phát triển thêm, có kiểm soát

1. **Đề xuất chính sách nội bộ, chưa được chủ dự án chốt:** chỉ thử trên đối tượng có quyền phù hợp; đánh giá riêng phần mềm và SaaS bên thứ ba. Không coi lệnh cấm mọi SaaS là hệ quả tự động của giấy phép REA hoặc pháp luật.
2. **Chạy trong VM hoặc container riêng.** Không đăng nhập Google công ty, không có SSH key, không có tệp `.env`. REA tự nhận "không phải sandbox"; sandbox Bash của Claude Code không tự bao phủ MCP server. Đây là cơ sở kỹ thuật cho đề xuất lab riêng, không phải chứng nhận container luôn đủ an toàn (rea-creatoros#5).
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
| **Claude Agent SDK (TypeScript) tự host trên VM VCPV** | Phù hợp nhất. Cùng stack với VCdocs. Tệp gốc có thể ở VM nhưng nội dung tệp, thư và kết quả công cụ đưa vào ngữ cảnh vẫn có thể đi Anthropic; phải kiểm soát dữ liệu gửi đi. Phải dùng API key, không dùng gói đăng ký cho sản phẩm (◐) |
| **Claude Managed Agents** (beta) | Ít hạ tầng nhất, có lịch chạy, kho bí mật, giới hạn ngân sách. Tính thêm 0,08 USD mỗi giờ phiên chạy. Không đủ điều kiện ZDR (◐) |
| OpenClaw (MIT) | Nhiều kênh chat nhất, nhưng đầu 2026 có lỗ hổng chạy mã từ xa và 341 skill độc hại. Không dùng làm lõi cho kho dữ liệu công ty (○) |
| Hermes Agent (MIT) | Có lịch chạy và sandbox, nhưng thiết kế cho cá nhân, viết bằng Python (○) |
| Nextcloud Assistant + Context Agent | Có sẵn nếu chọn Nextcloud. Không hỗ trợ Anthropic trực tiếp, cần proxy kiểu OpenAI (○) |

### 6.2 knowledge-work-plugins sau khi bỏ Google

- `anthropics/knowledge-work-plugins` (Apache-2.0) chỉ là Markdown + JSON trỏ tới MCP server từ xa (○). Các plugin productivity, marketing, sales, data, HR... vẫn dùng được.
- Connector Gmail, Calendar, Drive sẽ mất tác dụng khi bỏ Google.
- Luận điểm “không có MCP mã mở trên 100 sao” bị bác: đã mở được `cbcoutinho/nextcloud-mcp-server` và `dominik1001/caldav-mcp`. Số sao không chứng minh độ chín hay bảo mật. Nextcloud Context Agent còn có MCP endpoint và cấu hình server bên ngoài; phải kiểm đúng phiên bản và giới hạn token theo người (workspace-suites#3, ai-agents#6).

→ **Đề xuất đánh giá connector có sẵn trước khi quyết định viết "VCworkspace MCP Gateway".** Chỉ viết phần còn thiếu về SSO, phân quyền từng người, audit và điều phối; NestJS + MCP TypeScript SDK là một lựa chọn chưa được chốt:

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
- **Dữ liệu đi Anthropic:** Commercial Terms và chính sách API có điều kiện, ngoại lệ và khác biệt theo tính năng/model. Managed Agents không đủ điều kiện ZDR; self-hosted sandbox vẫn có tool input/output đi control plane và workspace geography hiện chỉ `us`. Không đồng nhất các giới hạn này với toàn bộ API hoặc với gói cá nhân (ai-agents#2–3).
- **Dữ liệu nhạy cảm** (kế toán, HĐQT) cân nhắc chạy model local.
- **Chi phí token phải có trần**, ví dụ 100 / 300 / 1.000 USD mỗi tháng. Đây là câu hỏi cho chủ dự án.

### 6.5 Hướng "công ty 1 thành viên"

Chủ dự án ra lệnh. Đội agent chia vai: agent code (Claude Code cloud), agent vận hành (theo dõi, sao lưu, cập nhật qua PR), agent nghiệp vụ (trợ lý cá nhân, marketing). Tất cả đi qua MCP Gateway với quyền tối thiểu. Đề xuất mọi thao tác ghi có nhật ký và kiểm quyền; thao tác không thể thu hồi như gửi email cần duyệt phù hợp. Phục hồi, bù trừ hoặc quay lui phải thiết kế theo từng loại hành động, không bảo đảm chung cho mọi thao tác.

---

## 7. Bảo mật và pháp lý

Các luận điểm quyết định đã được xét trong đợt 23/10; xem các ID tương ứng ở Phụ lục C và hồ sơ bằng chứng. Các cấu hình đề xuất chưa được triển khai hay thử nghiệm.

**Kiến trúc tối thiểu:**

1. **Danh tính:** Authentik có OIDC, SAML, LDAP, WebAuthn và SCIM cơ bản trong mã MIT; OAuth authentication for SCIM và scheduled offboarding là Enterprise. Bắt buộc passkey là đề xuất cấu hình, chưa bật. Phải thử cấp/thu hồi người dùng giữa IdP và mail. Chưa xác nhận cách chuyển gói và số tài khoản Google quản trị cần giữ (security#1).
2. **Offboarding Stalwart:** Community không có SCIM. OIDC cần provision người trước khi nhận mail nếu chưa từng đăng nhập; LDAP không tự xoá hộp thư khi xoá người. Enterprise 2 EUR/hộp thư/năm ở bậc 25–499 là giá niêm yết tính năng, dưới 150 hộp thư chưa gồm Premium Support. Dù chọn Enterprise hay script vẫn phải thử suspend, thu hồi phiên, bàn giao và retention (security#2).
3. **Truy cập mạng:** Cloudflare Free có 50 người và standard log tới 24 giờ. Arbitrary TCP/private-network có thể bảo vệ IMAP/submission nếu client có cloudflared/WARP và cấu hình phù hợp; không buộc mở cả 465/587/993 công khai. MX nhận thư từ MTA Internet vẫn cần SMTP public hoặc gateway/relay. Phải thử mail client, điện thoại và kết nối dài; SSH qua IAP + OS Login là phương án đề xuất (security#3).
4. **Mã hoá:** GCE có mã hoá at-rest mặc định, nhưng chưa có threat model để kết luận “là đủ”. Tác động của mã hoá ứng dụng/E2EE tới tìm kiếm, preview và AI phụ thuộc cách triển khai; phải thử theo loại dữ liệu, không khẳng định mọi cơ chế đều chặn các tính năng đó.
5. **Sao lưu 3-2-1:** Kopia + B2 qua S3 backend là một phương án; cần COMPLIANCE, extend-object-locks và maintenance. Kopia docs còn nêu Azure/GCS, nên không coi S3 là backend duy nhất. Khoá chỉ bảo vệ trong hạn retention, không bảo đảm backup đầy đủ hay đọc được. Phải thử xoá/khôi phục đúng cấu hình và tách quyền; chưa có thiết kế sao lưu được chứng nhận (security#4).
6. **Cập nhật:** Renovate mở PR, ghim theo digest; Trivy quét image. **Không dùng Watchtower** (tự cập nhật không kiểm soát).
7. **Giám sát:** Loki/Grafana, Uptime Kuma là đề xuất. Wazuh all-in-one và CrowdSec khác chức năng; không dùng minimum riêng của Wazuh server để ước RAM cả hệ thống. e2-medium có 2 vCPU hiển thị nhưng tổng mức CPU duy trì tương đương 1 vCPU, RAM 4 GB; phải đo tải chung (security#6).
8. **Không đặt mọi thứ trên một VM nhỏ.** Mất IdP là mất đăng nhập toàn công ty.

**Pháp lý Việt Nam — đã đọc các điều liên quan, chưa là ý kiến pháp lý cho VCPV:**

- [Luật 91/2025/QH15](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/91qh.signed.pdf), hiệu lực 01/01/2026, Điều 20 quy định chuyển dữ liệu xuyên biên giới và đánh giá tác động. Điều 20(6)(b) có miễn riêng đánh giá chuyển xuyên biên giới cho dữ liệu của chính người lao động lưu trên cloud; không tự bao gồm khách hàng/đối tác trong thư và tệp.
- Luật Điều 38(2) và [Nghị định 356/2025, Điều 41](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/356-nd.signed.pdf) cho DN nhỏ/khởi nghiệp đủ điều kiện chọn không thực hiện Điều 21, Điều 22 và khoản 2 Điều 33 trong 5 năm; **không liệt kê Điều 20 về đánh giá tác động chuyển xuyên biên giới ban đầu**. Không ghi miễn chung “DPIA/CTIA/DPO 5 năm”. Phải xét ngoại lệ về dịch vụ xử lý dữ liệu, dữ liệu nhạy cảm và lượng chủ thể; chưa xác định VCPV đủ điều kiện (security#5).
- [Luật An ninh mạng 116/2025/QH15, Điều 44](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/01/luat116-2025.pdf) có hiệu lực 01/07/2026 và làm Luật 24/2018/QH14 hết hiệu lực. Sửa viện dẫn Luật 2018 như luật hiện hành trong bản cũ; vẫn phải rà hướng dẫn/chuyển tiếp và phạm vi NĐ53/2022, không tự kết luận mọi dữ liệu nội bộ phải lưu tại VN.
- Bảng vùng Compute Engine đã mở không có vùng tại Việt Nam; asia-southeast1 là Singapore. Điều này không tự quyết định tính hợp pháp của một phương án lưu trữ (security#6).

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

Các luận điểm quyết định đã được xét trong đợt 23/10; xem các ID tương ứng ở Phụ lục C và hồ sơ bằng chứng. Các cấu hình đề xuất chưa được triển khai hay thử nghiệm.

**Ràng buộc kỹ thuật:**

1. Gmail công bố IMAP download 2.500 MB/ngày/tài khoản. Help còn mốc 14/3/2025 nhưng blog chính thức cập nhật 29/4 đã dời hạn ngừng less-secure-apps sang **01/5/2025**; dùng OAuth hoặc app password theo chính sách tenant, không dùng mật khẩu tài khoản thường (migration#2).
2. Cần giữ semantics nhiều nhãn của Gmail khi chuyển. Docs Vandelay mô tả `import takeout` ánh xạ nhãn/mailbox, gộp raw messages giống hệt và bỏ category tự động, nhưng đầu ra là **SQLite archive offline**. Còn bước restore sang server đích và thử đa nhãn; chưa chứng minh migration end-to-end hay mọi bản trùng được gộp (migration#1).
3. rclone xuất Docs/Sheets/Slides mặc định DOCX/XLSX/PPTX; export không tự tái tạo Apps Script, Forms/Sites, lịch sử chỉnh sửa hoặc liên kết Google trong hệ mới. Không khẳng định mọi hàm QUERY/IMPORTRANGE đều mất theo cùng cách: phải kiểm 20–30 tệp đại diện. Metadata quyền rclone bỏ quyền inherited ở shared drives và owner ở My Drive; chưa bảo toàn ACL sang Nextcloud. `files.export` giới hạn nội dung xuất 10 MB (migration#5).
4. GCE mặc định chặn egress TCP 25 ngoài VPC, có project ngoại lệ; chưa thử project vcdocs. Relay là phương án dự kiến khi chưa xác nhận ngoại lệ (migration#4).

**Công cụ:**

- **GAM 7.48:** kiểm kê người dùng, bí danh, nhóm, chữ ký, filter, quyền Drive, quyền lịch, phòng họp.
- **Google Data Export:** xuất toàn tổ chức gồm shared drives/Groups, có điều kiện super-admin, 2SV và tài khoản/subscription; sớm nhất 48 giờ, thường 72 giờ, có thể 14 ngày. Bucket Google cung cấp xoá sau 60 ngày **từ khi bắt đầu export** (migration#3).
- **rclone:** chép/xuất Drive; phải lưu inventory và ánh xạ ACL riêng. Chưa ghim/test v1.75.2 như câu gốc (migration#5).
- **imapsync:** đồng bộ phần chênh vào ngày cuối.
- **Sieve:** filter Gmail xuất bằng GAM rồi sinh script Sieve.
- **Danh sách thư:** Google Groups chuyển sang Stalwart Lists hoặc Mailman 3.

**Trình tự đề xuất: Drive và lịch trước, mail sau cùng.** Chạy song song vẫn có rủi ro lệch dữ liệu, quyền và xung đột lịch; phải định nguồn ghi chính. MX có thể đổi lại nhưng rollback mail cần đồng bộ thư phát sinh và tránh vòng lặp, không coi là thao tác một chiều hay không rủi ro.

1. **Tuần 1–2:** kiểm kê bằng GAM, đo dung lượng, chọn phòng thí điểm. Nên chọn phòng dùng Docs/Sheets nhiều để lộ lỗi chuyển đổi sớm.
2. **Tuần 2–4, thí điểm:** chép shared drive của phòng đó, mở thử 20–30 tệp thật bằng ONLYOFFICE và Collabora, nhập Takeout cho người thí điểm.
3. **Các phòng tiếp theo:** Drive, lịch, danh bạ.
4. **Mail:** thử dual-delivery khi MX còn ở Google, cấu hình `Also deliver to` + `Change route` đúng OU/group và loại thư inbound/internal; rules/spam có thể đổi tập thư nhận. Sau khi thử thành công mới đề nghị chuyển MX; giữ Gmail 1–3 tháng là phương án cần duyệt (migration#6).

**Quay lui cần kế hoạch:** MX có thể trỏ lại Google nhưng phải xử lý DNS propagation, đối soát và đồng bộ thư phát sinh ở cả hai hệ, tránh routing loop/trùng thư. Giữ bản gốc Drive chưa đủ nếu tài liệu/quyền đã đổi sau cutover; phải xác định nguồn ghi chính, đối soát delta/ACL và thử phục hồi trước khi chuyển thật.

Dịch vụ trả phí thay thế: audriga khoảng 10 EUR/tài khoản, tức khoảng 480 EUR cho 48 người. Chưa kiểm audriga có hỗ trợ đích Stalwart/Nextcloud không.

---

## 9. Kích cỡ và chi phí

Đã kiểm nguồn cho sizing-cost#1–6; kết quả chưa phải báo giá hoặc benchmark. Hai VM dưới đây chỉ là **giả thuyết để thử**, không phải cấu hình tối thiểu cho 48–100 người. Chưa có số liệu dung lượng, concurrency, kích thước thư, antivirus, search, office và video của VCPV.

| VM dự kiến | Cấu hình thử | Phạm vi cần đo |
|---|---|---|
| VM-A | 8 vCPU / 32 GB | Mail, Nextcloud + DB/Redis, office, IdP, giám sát, backup đồng thời |
| VM-B | 4 vCPU / 8 GB | Video, TURN, ghi hình; STT có thể cần tài nguyên khác, không mặc định đủ |

Mailcow và Stalwart công bố yêu cầu theo workload khác nhau; **không có cơ sở khẳng định tiết kiệm cố định 6–14 GB RAM**. Talk transcription cũng có ước tính RAM riêng, không được cộng/trừ máy móc (sizing-cost#6, office-meet-calendar#6).

| Khoản | Kết quả đối chiếu 23/10 | Giới hạn sử dụng |
|---|---|---|
| Google Workspace Standard | 14 USD/user/tháng annual; 16,80 flexible. 48 user annual = 8.064 USD/năm | 24.192 USD/3 năm chỉ là chiếu giá không đổi; chưa gồm thuế, ưu đãi, reseller và chưa biết gói VCPV. [Giá chính thức](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans) |
| GCP Singapore VM/disk/CUD | **Chưa đủ bằng chứng đúng SKU/vùng** cho bảng 241,39/152,07/108,62 USD và pd-balanced 0,11 cũ | Bảng giá Google động tải ra mặc định Iowa; không gán cho Singapore. Cần SKU, OS, 730 giờ quy ước, CUD resource/flexible, disk zonal/regional, IP, snapshot, backup, egress và thuế. [Compute pricing](https://cloud.google.com/products/compute/pricing/general-purpose), [disk pricing](https://cloud.google.com/compute/disks-image-pricing) |
| Hetzner CCX33 Singapore | 8 dedicated vCPU/32 GB/240 GB NVMe; 174,49 EUR/tháng **chưa IPv4/VAT**, kèm 3 TB; EU 138,49 EUR/30 TB. AP overage niêm yết 7,40 EUR/TB | Bảng từ 15/6/2026; kiểm lại cart. Không dùng số 174,99 cũ hoặc kết luận rẻ hơn GCP 25% khi chưa đồng nhất mọi khoản. [Điều chỉnh giá](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [sản phẩm](https://www.hetzner.com/cloud/general-purpose/) |
| Nextcloud Enterprise Standard | Từ 100 user, 71,29 EUR/user/năm; mức nền 7.129 EUR/năm | Không có nghĩa mọi hỗ trợ thương mại qua partner đều tối thiểu 100 user; cần báo giá đúng tính năng/thuế. [Giá hãng](https://nextcloud.com/pricing/) |
| Stalwart Enterprise | Bậc 25–499: 2 EUR/hộp thư/năm; 48 hộp thư = 96 EUR/năm | Chưa gồm thuế xác định, dưới 150 hộp thư chưa có Premium Support. [Giá hãng](https://stalw.art/pricing/) |
| Video egress | Giả sử 2,5 Mbit/s egress trung bình/người nhận: 1,125 GB/người-giờ; 80 giờ × 10 người = 900 GB | Đây là kịch bản tính, không phải định mức của họp 10 người; phụ thuộc SFU, layers, LastN, P2P, TURN, screen share. [Jitsi requirements](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/) |

**Bỏ tổng 440 USD/tháng và giảm 37% trên toàn hệ thống** khỏi kết luận tài chính. Chưa xác minh giá egress/GCS/IP/snapshot Singapore; chưa định giá thời gian vận hành, gián đoạn, backup/restore, hỗ trợ, dual-running Google, relay và token AI. Các so sánh OVH/nhà cung cấp VN trong bản cũ chưa đủ nguồn nên chưa dùng để xếp hạng.

**Đề xuất tiếp theo, chưa phải lệnh triển khai:** lấy hoá đơn/dung lượng/workload thật; lập low/base/high TCO cùng phạm vi và tiền tệ; thử tải trên cấu hình không cam kết rồi mới quyết mua CUD hoặc di cư. Giữ Google Workspace trong giai đoạn thử.

---

## 10. Mã VCdocs hiện có

Đã đọc lại mã tại commit `b8c8b805fce3ab831ac316d21343140b48d9b421` trên nhánh nghiên cứu (2026-10-23); xem codebase#1–6. Kiểm tra kiểu API đạt. 129 là số ca test khai báo đã đếm, chưa chạy lại toàn bộ; không đại diện nhánh giai đoạn 2 hay production.

**Kích cỡ:**

| Phần | Dòng | Test |
|---|---|---|
| `apps/api` (NestJS) | 9.527 src + 2.638 test | 129 ca e2e khai báo; phiên này chỉ chạy typecheck |
| `apps/web` (Next.js) | 6.529 mã ứng dụng + 4.831 schema sinh tự động; chưa gồm 983 dòng test/hỗ trợ | 72 theo bàn giao cũ, chưa chạy lại |
| `contract/openapi.yaml` | 2.184 (98 thao tác) | — |

**Phụ thuộc Google:**

- Mọi lời gọi Google đi qua một interface `GooglePorts` (8 cổng, 32 method) trong [ports.ts](../../apps/api/src/google/ports.ts).
- Chỉ `real-google.ts` dùng thư viện `@googleapis/*`.
- Bản giả `FakeGoogle` thực hiện đủ 32/32 method về kiểu; test app mặc định fake. Một test CLI đặt `GOOGLE_MODE=real` nhưng không gọi Google. Chưa có bằng chứng test tích hợp tự động adapter thật.
- FE không thấy gọi trực tiếp Google API; còn URL Drive/Docs, đăng nhập `/auth/google`, đồng bộ `/sync/google`, nhãn và schema Google. Đổi kho phải rà cả hợp đồng và quyền.

**Phần có thể tái sử dụng sau khi tách phụ thuộc (codebase#4–5):**

- Nhật ký kiểm toán băm nối dòng (`audit.service.ts`)
- Hàng đợi việc trên Mongo (`jobs.service.ts`): cần tách retry GoogleError và NotificationsService/Gmail
- Idempotency-Key, phiên cookie, CSRF, tách dữ liệu theo công ty (`tenant.plugin`); AuthGuard/AccessService vẫn mang mô hình quyền drive
- Bộ kiểm phản hồi khớp OpenAPI
- Đóng dấu PDF, kho PDF qua `VaultPort`, đổi được sang S3
- Mẫu deploy: Dockerfile, Compose, Caddy, `backup.sh`

**Ba phương án:**

| Phương án | Nội dung | Đánh giá của agent |
|---|---|---|
| A. Bỏ hết | Xây từ trang trắng | 2/5. Mất nghiệp vụ ISO đã code và test (vòng đời tài liệu, phê duyệt theo thẩm quyền, mã hồ sơ, chốt PDF) |
| B. Giữ nghiệp vụ, đổi adapter | Thay cổng lưu trữ, danh bạ, thư; sửa quyền, DB và hợp đồng tương ứng | Có cơ sở tái dùng nhưng chưa ước lượng được tỷ lệ công sửa. Cần kiểm tính tương đương khoá, chặn tải/in, revision và audit; điểm 4/5 là đánh giá, không phải số đo |
| **C. Tách** (khuyên dùng) | Đóng băng VCdocs trên `main`; tách khung hạ tầng làm nền VCworkspace; sau đó port VCdocs thành "ứng dụng quản lý hồ sơ" theo B | 5/5 |

**Hệ quả nếu chọn C:**

- Dừng M10 Bàn giao trên `giai-doan-2`, vì phần này dùng Google Data Transfer. M15 Nhật ký giữ được.
- Tạm dừng việc giao IT tạo 64 nhóm Google C1.
- BA mục 11 (cách lách Google Drive) và hợp đồng mục 6 phải viết lại theo quyền của kho mới.
- Rà 129 ca test khai báo và xây test tương đương kho mới; số ca cần sửa chỉ biết sau thiết kế adapter/hợp đồng. Việc dừng M10/tạo nhóm C1 ở trên là hệ quả đề xuất nếu chọn C, chưa là quyết định triển khai.

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
4. **Điểm lỗi đơn của các dịch vụ lõi.** Tách VM họp chỉ giảm phạm vi sự cố video; VM-A đề xuất vẫn gom mail/files/IdP nên còn điểm lỗi đơn. Cần thiết kế backup và phục hồi, đo RTO/RPO; hai VM không tự tạo HA hoặc bảo đảm không gián đoạn.
5. **Mất dữ liệu đặc thù Google khi chuyển** (Apps Script, Forms, IMPORTRANGE, lịch sử phiên bản). Giảm bằng kiểm kê sớm và giữ Google chế độ đọc một thời gian.
6. **Giấy phép và cách cung cấp phần mềm.** Ghim phiên bản, lưu LICENSE, rà nghĩa vụ theo cách sửa/phân phối/cung cấp qua mạng; giữ attribution và đáp ứng nghĩa vụ mã nguồn nếu phát sinh. Thu phí không phải tác nhân duy nhất và để nguyên lõi không tự loại mọi nghĩa vụ. Mô hình thương mại VCworkspace chưa chốt.
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

5. Chấp nhận dùng AWS SES vùng Singapore làm relay thư gửi không; yêu cầu gì về hợp đồng, vùng xử lý và lưu log?
6. Loại nội dung thư/tệp nào được gửi API Anthropic, theo sản phẩm/model, vùng và thời hạn lưu nào; dữ liệu nào phải dùng model local? Không coi chính sách 30 ngày là bảo đảm áp dụng cho mọi tính năng.
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

Lịch sử đợt 22/10: nhóm hoàn tất có 2 agent theo hai lăng kính; workspace-suites#2 mới có 1. Bảng này giữ dấu vết đợt cũ, không phải chứng nhận lại ngày 23/10. Các dòng chưa xong được thay bằng liên kết sang bảng ID của đợt mới ở Phụ lục C; mô hình kiểm ngày 23/10 là Sol làm chính, Astra rà nhóm khó, không phải mọi ID đều được hai model kiểm độc lập.

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
| Mail server | Nhãn JMAP/IMAP keyword và webmail hiển thị | Đã xét 23/10: mail-stacks#6 (Phụ lục C) |
| Workspace | grommunio gói Community tối đa 5 người | Đã xét lại 23/10: workspace-suites#2 |
| Workspace | 5 luận điểm còn lại | Đã xét 23/10: workspace-suites#1,3–6 |
| Công cụ sáng tạo | REA là công cụ phân tích, không phải nguồn "bản thiết kế lại" | ◐ / ◐ |
| Công cụ sáng tạo | Remotion cần license cho công ty từ 4 người | ◐ / ◐ |
| Công cụ sáng tạo | OpenCut đang viết lại, chưa dùng production | ◐ / ◐ |
| Công cụ sáng tạo | tldraw không mã nguồn mở, cần license key production | ✅ / ✅ |
| Công cụ sáng tạo | Stirling-PDF lõi MIT, Free 5 người | ◐ / ◐ |
| Công cụ sáng tạo | Giấy phép model AI tự host (FLUX, Kokoro, F5-TTS) | ◐ / ◐ |
| Office/họp/lịch, REA/Creator OS, AI agent, bảo mật, di cư, chi phí, mã nguồn | Thực tế 41 ID của 7 mảng; số 42 cũ sai | Đã xét 23/10: Phụ lục C và hồ sơ bằng chứng |

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
- Authentik: https://docs.goauthentik.io/enterprise/enterprise-features/ · Pocket ID: https://github.com/pocket-id/pocket-id
- Cloudflare Zero Trust: https://www.cloudflare.com/plans/ · Tailscale: https://tailscale.com/pricing
- Gmail giới hạn IMAP: https://knowledge.workspace.google.com/admin/gmail/gmail-bandwidth-limits
- Google Data Export: https://knowledge.workspace.google.com/admin/migrate/export-all-your-organizations-data
- imapsync Gmail: https://imapsync.lamiral.info/FAQ.d/FAQ.Gmail.txt · GAM: https://github.com/GAM-team/GAM
- Giá GCE chính thức: https://cloud.google.com/products/compute/pricing/general-purpose — chưa xác nhận được lựa chọn Singapore/SKU. `gcloud-compute.com` là nguồn bên thứ ba của bản cũ, không dùng làm xác nhận giá ở đợt này.
- Kết quả thô 72 agent (máy local): `~/.claude/projects/-Users-apple-projects-VCdocs/0153f5e4-10fe-4d4d-98d6-3915a62ea6bf/subagents/workflows/wf_d8f20636-759/ket-qua-da-xong.json`


## Phụ lục C: kết quả kiểm chứng 2026-10-23

Đã xét đủ **48 ID** truy từ dữ liệu gốc (số “42” cũ sai): **21 đúng trong phạm vi, 24 đúng một phần/cần điều kiện, 1 bị bác, 2 chưa đủ bằng chứng**. Đây là trạng thái câu gốc; mệnh đề con sai được sửa ngay trong thân báo cáo. Chi tiết câu gốc, nguồn đã mở, phiên bản và giới hạn: [hồ sơ kiểm chứng](vcworkspace-kiem-chung-2026-10-23.md).

| ID gốc | Kết quả | Kết luận đã sửa | Bằng chứng |
|---|---|---|---|
| [mail-stacks#6](vcworkspace-kiem-chung-2026-10-23.md#mail-stacks-6) | ◐ | RFC keywords đúng; Twake dùng thêm Label API, chưa bảo đảm tương thích Stalwart; không chứng minh mọi plugin Roundcube chỉ có nhãn cố định. | [Nguồn](https://github.com/linagora/tmail-flutter/blob/master/CHANGELOG.md) |
| [workspace-suites#1](vcworkspace-kiem-chung-2026-10-23.md#workspace-suites-1) | ✅ | Mail là client IMAP/SMTP; vẫn cần mail server riêng. AIO cho phép thêm Stalwart bằng container cộng đồng. | [Nguồn](https://github.com/nextcloud/all-in-one#mail-server) |
| [workspace-suites#2](vcworkspace-kiem-chung-2026-10-23.md#workspace-suites-2) | ✅ | Gói Community miễn phí tới 5 người; Basic 1,99 EUR, Plus 3,99 EUR/người/tháng từ 6; Business 5,49 EUR từ 50. | [Nguồn](https://grommunio.com/pricing/) |
| [workspace-suites#3](vcworkspace-kiem-chung-2026-10-23.md#workspace-suites-3) | ✅ | Có MCP server và nhận MCP ngoài; chưa hỗ trợ access token riêng từng người cho server ngoài, chưa scale được. | [Nguồn](https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_agent.html) |
| [workspace-suites#4](vcworkspace-kiem-chung-2026-10-23.md#workspace-suites-4) | ◐ | ONLYOFFICE CE 9.4 bỏ cap; CODE mặc định không giới hạn, Home Mode mới giới hạn 10 tài liệu/20 kết nối. | [Nguồn](https://forum.collaboraonline.com/t/does-collabora-code-26-04-2-4-have-any-user-or-concurrent-connection-limits/5023) |
| [workspace-suites#5](vcworkspace-kiem-chung-2026-10-23.md#workspace-suites-5) | ✅ | Carbonio CE thiếu backup tích hợp/HSM/legal hold thương mại; ActiveSync là add-on bản trả phí. | [Nguồn](https://zextras.com/editions) |
| [workspace-suites#6](vcworkspace-kiem-chung-2026-10-23.md#workspace-suites-6) | ◐ | Giao thức và tính năng Enterprise được xác nhận; WebUI mô tả quản trị, chưa chứng minh phủ định tuyệt đối về webmail. | [Nguồn](https://stalw.art/compare/) |
| [office-meet-calendar#1](vcworkspace-kiem-chung-2026-10-23.md#office-meet-calendar-1) | ✅ | CE 9.4 bỏ cap 20 kết nối và RabbitMQ/DB; hãng vẫn khuyến nghị tối đa 20 người cho CE. | [Nguồn](https://www.onlyoffice.com/blog/2026/05/onlyoffice-docs-9-4) |
| [office-meet-calendar#2](vcworkspace-kiem-chung-2026-10-23.md#office-meet-calendar-2) | ✅ | Nextcloud/CryptPad dùng Euro-Office; có production distribution công khai, Enterprise là hỗ trợ chuyên nghiệp, không mặc định paywall binary. | [Nguồn](https://euro-office.github.io/documentation/installation/releases/) |
| [office-meet-calendar#3](vcworkspace-kiem-chung-2026-10-23.md#office-meet-calendar-3) | ◐ | Scheduling/iMIP/RSVP/JMAP có thật; trang so sánh có free/busy. Chưa xác minh đặt phòng/tài nguyên. | [Nguồn](https://stalw.art/compare/) |
| [office-meet-calendar#4](vcworkspace-kiem-chung-2026-10-23.md#office-meet-calendar-4) | ✅ | Jitsi công bố thay Jigasi transcription bằng JVB/WebSocket/proxy; hỗ trợ endpoint STT tương thích OpenAI tự host. | [Nguồn](https://jitsi.org/blog/a-new-architecture-for-transcription-and-more/) |
| [office-meet-calendar#5](vcworkspace-kiem-chung-2026-10-23.md#office-meet-calendar-5) | ✅ | License và tính năng Meet được xác nhận; transcription/summary beta; 100+ người chưa được đo trên hạ tầng VCPV. | [Nguồn](https://documentation-meet.beta.numerique.gouv.fr/overview/what-is-meet/) |
| [office-meet-calendar#6](vcworkspace-kiem-chung-2026-10-23.md#office-meet-calendar-6) | ◐ | Khả năng Talk tùy mạng/thiết bị; Vosk có tiếng Việt. 16 GB là ước tính cho 1–2 cuộc, chưa phải benchmark. | [Nguồn](https://docs.nextcloud.com/server/stable/admin_manual/ai/app_live_transcription.html) |
| [ai-agents#1](vcworkspace-kiem-chung-2026-10-23.md#ai-agents-1) | ✅ | Stalwart LLM spam/Sieve là Enterprise; không ngăn tích hợp AI bên ngoài qua API. | [Nguồn](https://stalw.art/enterprise/) |
| [ai-agents#2](vcworkspace-kiem-chung-2026-10-23.md#ai-agents-2) | ✅ | Managed Agents chưa ZDR; self-hosted vẫn gửi tool I/O về control plane; workspace geo hiện us. | [Nguồn](https://platform.claude.com/docs/en/managed-agents/overview) |
| [ai-agents#3](vcworkspace-kiem-chung-2026-10-23.md#ai-agents-3) | ✅ | Commercial Terms không train; mặc định API 30 ngày có ngoại lệ theo model, tính năng và nghĩa vụ lưu. | [Nguồn](https://www.anthropic.com/legal/commercial-terms) |
| [ai-agents#4](vcworkspace-kiem-chung-2026-10-23.md#ai-agents-4) | ◐ | Cron tối đa một lần/giờ; auto mode có thể dừng chờ duyệt, không phải mọi ghi đều tự chạy. | [Nguồn](https://code.claude.com/docs/en/routines) |
| [ai-agents#5](vcworkspace-kiem-chung-2026-10-23.md#ai-agents-5) | ◐ | n8n cho nghiệp vụ nội bộ; .ee. và thư mục .ee cần giấy phép khác; không coi là OSS OSI. | [Nguồn](https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md) |
| [ai-agents#6](vcworkspace-kiem-chung-2026-10-23.md#ai-agents-6) | ❌ | Có Nextcloud/CalDAV MCP trên 100 sao; bác lý do bắt buộc tự viết gateway, chưa chứng minh độ an toàn. | [Nguồn](https://github.com/cbcoutinho/nextcloud-mcp-server) |
| [rea-creatoros#1](vcworkspace-kiem-chung-2026-10-23.md#rea-creatoros-1) | ◐ | REA MIT; disclaimer không sửa MIT. Local analysis vẫn có kết quả gửi model; chưa audit mọi provider. | [Nguồn](https://github.com/morluto/rea) |
| [rea-creatoros#2](vcworkspace-kiem-chung-2026-10-23.md#rea-creatoros-2) | ◐ | CreatorOS là SaaS; social-agents MIT dùng API dịch vụ, chưa xác nhận mọi repo/cùng tên. | [Nguồn](https://www.creatoros.ca/) |
| [rea-creatoros#3](vcworkspace-kiem-chung-2026-10-23.md#rea-creatoros-3) | ? | Xác nhận sản phẩm Jev TypeSafe; chưa xác nhận đây là “AI Jev” người dùng muốn nói. | [Nguồn](https://typesafe.ai/blog/introducing-system-one-models-and-jev) |
| [rea-creatoros#4](vcworkspace-kiem-chung-2026-10-23.md#rea-creatoros-4) | ◐ | Terms hạn chế RE nhưng khác sản phẩm/vùng/hợp đồng; không suy cấm chung mọi SaaS hoặc clean-room luôn hợp pháp. | [Nguồn](https://policies.google.com/terms) |
| [rea-creatoros#5](vcworkspace-kiem-chung-2026-10-23.md#rea-creatoros-5) | ✅ | Bash sandbox không bao phủ MCP; lab riêng là đề xuất kỹ thuật, container không tự bảo đảm cách ly. | [Nguồn](https://code.claude.com/docs/en/sandboxing) |
| [security#1](vcworkspace-kiem-chung-2026-10-23.md#security-1) | ✅ | Authentik có SCIM cơ bản MIT; OAuth SCIM và scheduled offboarding thuộc Enterprise. | [Nguồn](https://docs.goauthentik.io/enterprise/enterprise-features/) |
| [security#2](vcworkspace-kiem-chung-2026-10-23.md#security-2) | ✅ | Stalwart SCIM Enterprise; OIDC cần provision trước, LDAP không tự xoá mailbox; 96 EUR chưa gồm Premium Support. | [Nguồn](https://stalw.art/docs/auth/scim/) |
| [security#3](vcworkspace-kiem-chung-2026-10-23.md#security-3) | ◐ | Cloudflare có arbitrary TCP; IMAP/submission có thể riêng, MX Internet vẫn cần đường SMTP public/gateway. | [Nguồn](https://www.cloudflare.com/plans/) |
| [security#4](vcworkspace-kiem-chung-2026-10-23.md#security-4) | ◐ | Kopia không chỉ S3; Object Lock cần retention/maintenance, không tự bảo đảm phục hồi; restic cần phân biệt native/append-only. | [Nguồn](https://kopia.io/docs/advanced/ransomware-protection/) |
| [security#5](vcworkspace-kiem-chung-2026-10-23.md#security-5) | ◐ | Miễn dữ liệu nhân viên có phạm vi; ưu đãi DN nhỏ không liệt kê CTIA ban đầu Điều 20. | [Nguồn](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroup=) |
| [security#6](vcworkspace-kiem-chung-2026-10-23.md#security-6) | ◐ | e2-medium duy trì tương đương 1 vCPU/4 GB; Wazuh cả stack khác server; chưa xác nhận CrowdSec sizing. | [Nguồn](https://docs.cloud.google.com/compute/docs/general-purpose-machines) |
| [migration#1](vcworkspace-kiem-chung-2026-10-23.md#migration-1) | ✅ | Takeout nhập archive SQLite offline; giữ nhãn theo tài liệu nhưng còn restore và PoC vào hộp thư đích. | [Nguồn](https://stalw.art/docs/migration/import-export/import/takeout/) |
| [migration#2](vcworkspace-kiem-chung-2026-10-23.md#migration-2) | ◐ | 2.500 MB/ngày đúng; Google dời hạn LSA sang 01/5/2025, cần kiểm OAuth/app-password của tenant. | [Nguồn](https://knowledge.workspace.google.com/admin/gmail/gmail-bandwidth-limits) |
| [migration#3](vcworkspace-kiem-chung-2026-10-23.md#migration-3) | ✅ | Export đủ tổ chức có điều kiện admin; bucket Google giữ 60 ngày tính từ bắt đầu, không từ hoàn tất. | [Nguồn](https://knowledge.workspace.google.com/admin/migrate/export-all-your-organizations-data) |
| [migration#4](vcworkspace-kiem-chung-2026-10-23.md#migration-4) | ✅ | GCE mặc định chặn egress 25, có ngoại lệ; chưa kiểm project vcdocs. | [Nguồn](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail) |
| [migration#5](vcworkspace-kiem-chung-2026-10-23.md#migration-5) | ◐ | rclone export được nhưng không bảo toàn mọi ACL; 10 MB là giới hạn nội dung xuất; chưa ghim bản. | [Nguồn](https://rclone.org/drive/) |
| [migration#6](vcworkspace-kiem-chung-2026-10-23.md#migration-6) | ✅ | Dual delivery làm được; cần đúng OU/group, loại thư và routing, không bảo đảm mọi thư vô điều kiện. | [Nguồn](https://knowledge.workspace.google.com/admin/gmail/advanced/deliver-email-to-multiple-inboxes-with-dual-delivery) |
| [sizing-cost#1](vcworkspace-kiem-chung-2026-10-23.md#sizing-cost-1) | ✅ | Standard 14 USD annual, 16,80 flexible; 8.064 USD/năm cho 48 người là phép tính, chưa phải hoá đơn VCPV. | [Nguồn](https://knowledge.workspace.google.com/admin/billing/compare-flexible-and-annual-fixed-term-payment-plans) |
| [sizing-cost#2](vcworkspace-kiem-chung-2026-10-23.md#sizing-cost-2) | ? | Chưa xác nhận giá GCP đúng Singapore/SKU/CUD; không lấy bảng mặc định Iowa hoặc nguồn thứ ba làm báo giá. | [Nguồn](https://cloud.google.com/products/compute/pricing/general-purpose) |
| [sizing-cost#3](vcworkspace-kiem-chung-2026-10-23.md#sizing-cost-3) | ◐ | CCX33 Singapore 174,49 EUR chưa IPv4/VAT, 3 TB; chưa đủ cơ sở kết luận rẻ hơn GCP 25%. | [Nguồn](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) |
| [sizing-cost#4](vcworkspace-kiem-chung-2026-10-23.md#sizing-cost-4) | ◐ | Enterprise Standard từ 100 user/7.129 EUR năm; không đồng nghĩa mọi hỗ trợ partner đều cùng tối thiểu. | [Nguồn](https://nextcloud.com/pricing/) |
| [sizing-cost#5](vcworkspace-kiem-chung-2026-10-23.md#sizing-cost-5) | ◐ | 900 GB chỉ là kịch bản egress 2,5 Mbit/s/người nhận, không phải định mức mọi cuộc họp. | [Nguồn](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/) |
| [sizing-cost#6](vcworkspace-kiem-chung-2026-10-23.md#sizing-cost-6) | ◐ | Không có benchmark cùng tải chứng minh Stalwart tiết kiệm cố định 6–14 GB so với Mailcow. | [Nguồn](https://docs.mailcow.email/getstarted/prerequisite-system/) |
| [codebase#1](vcworkspace-kiem-chung-2026-10-23.md#codebase-1) | ✅ | SDK Google tập trung adapter; GooglePorts có 8 cổng, 32 method; CLI có thể tự tạo adapter. | [Nguồn](vcworkspace-kiem-chung-2026-10-23.md#codebase-1) |
| [codebase#2](vcworkspace-kiem-chung-2026-10-23.md#codebase-2) | ◐ | Fake đủ kiểu; có CLI test đặt real nhưng không gọi Google; 129 ca khai báo, chưa chạy lại. | [Nguồn](vcworkspace-kiem-chung-2026-10-23.md#codebase-2) |
| [codebase#3](vcworkspace-kiem-chung-2026-10-23.md#codebase-3) | ◐ | FE không gọi trực tiếp Google API; vẫn phụ thuộc login/sync, URL, nhãn và schema Google. | [Nguồn](vcworkspace-kiem-chung-2026-10-23.md#codebase-3) |
| [codebase#4](vcworkspace-kiem-chung-2026-10-23.md#codebase-4) | ◐ | Không import trực tiếp chưa đủ độc lập: Jobs → Notifications → Gmail; retry và access còn nghĩa Google/Drive. | [Nguồn](vcworkspace-kiem-chung-2026-10-23.md#codebase-4) |
| [codebase#5](vcworkspace-kiem-chung-2026-10-23.md#codebase-5) | ◐ | Vault tách riêng; S3 cần giữ write-once, retention, quyền xoá và thử restore, chưa tự bảo đảm pháp lý. | [Nguồn](vcworkspace-kiem-chung-2026-10-23.md#codebase-5) |
| [codebase#6](vcworkspace-kiem-chung-2026-10-23.md#codebase-6) | ✅ | Repo chưa có .github, Compose 4 service/deploy tay; Google IDs ở DB/API; chưa xác minh môi trường thật. | [Nguồn](vcworkspace-kiem-chung-2026-10-23.md#codebase-6) |

**Việc còn lại sau kiểm tài liệu:** xác nhận đúng dự án “AI Jev”; lấy báo giá GCP Singapore đúng SKU và hoá đơn/workload VCPV; kiểm giấy phép/distribution bản định triển khai; PoC MCP từng người, nhãn thư/Twake–Stalwart, provisioning/offboarding, Takeout restore/ACL, tải office/video và diễn tập phục hồi. Không chọn mua hoặc triển khai chỉ từ số sao repo hay phép tính RAM/egress.


## Phụ lục D: phương án đề xuất sau kiểm chứng — 2026-10-23

**Trạng thái: đề xuất để chủ dự án chốt, chưa phê duyệt triển khai.** Căn cứ là 48 ID ở Phụ lục C và hồ sơ nguồn. Nguồn chính Nextcloud MCP, ONLYOFFICE 9.4, Stalwart OIDC và Talk scalability được mở lại ngày 23/10; các lựa chọn dưới đây là đánh giá thiết kế từ bằng chứng, không phải kết quả thử tải.

### D.1 Phương án nên chọn

**Chọn C về mã: giữ nghiệp vụ hồ sơ VCdocs làm ứng dụng trên VCworkspace; dùng Nextcloud làm nền cộng tác, thay Google theo từng chức năng.** Tách nền và nghiệp vụ bằng module/adapter có hợp đồng rõ; chưa cần tách repo hay viết lại toàn bộ giao diện. Giữ bản ổn định của nghiệp vụ cũ, chưa gộp M10 phụ thuộc Google Data Transfer vào nền mới; quyết định tiếp tục giai đoạn 2 phải được chủ dự án chốt riêng.

Lý do: mã hiện tại có giá trị nghiệp vụ nhưng còn Google identifiers, quyền Drive và Gmail gián tiếp (codebase#1–6). Tự viết từ đầu bộ mail/office/lịch làm tăng phần phải phát triển và vận hành; kiểm chứng không cho cơ sở tính trước tiết kiệm hay tỷ lệ tái dùng. Nextcloud cung cấp nền tích hợp để thử, còn giao diện riêng VCworkspace chỉ bổ sung khi có nhu cầu nghiệp vụ rõ.

| Mảng | Lựa chọn đề xuất | Điều kiện trước dùng thật |
|---|---|---|
| Danh tính và tệp/lịch | Authentik + Nextcloud Files, Calendar, Contacts; nhóm theo phòng | Thử SSO, quyền chéo phòng, mời ngoài và thu hồi người nghỉ việc; không sao chép ACL Google rồi coi là tương đương |
| Docs/Sheets/Slides | ONLYOFFICE CE là ứng viên thử đầu; chọn bản còn được cập nhật bảo mật tương thích Nextcloud | So 20–30 tệp đại diện, công thức, định dạng, in/PDF và đồng biên tập. 9.4 bỏ cap 20 không phải khuyến nghị ghim bản cũ hoặc bảo đảm đủ tải. Nếu không đạt, thử Nextcloud Office/Euro-Office hoặc Collabora; không chạy ba bộ cùng lúc |
| Mail | Giữ Gmail trong thí điểm đầu; Stalwart + Nextcloud Mail là ứng viên chuyển sau | Dùng tên miền thử trước; kiểm nhãn, tìm kiếm, điện thoại, mailbox tồn tại trước đăng nhập, offboarding và restore. Chưa chọn Twake làm mặc định vì Label API chưa chứng minh tương thích Stalwart |
| Gửi mail | SES vùng Singapore là relay ứng viên nếu chọn GCP và được duyệt luồng dữ liệu | Kiểm vùng/chính sách, sandbox/quota, DKIM/SPF/DMARC và phí đầy đủ; chưa kết luận project vcdocs có/không ngoại lệ cổng 25 |
| Họp | Giữ Google Meet lúc đầu; thử Nextcloud Talk + HPB khi sang bước họp tự host | Đo cuộc họp đại diện, TURN, khách ngoài, điện thoại và băng thông. Chưa xây thêm LiveKit/La Suite Meet; chỉ xét nếu yêu cầu AI vào phòng/ghi âm hoặc Talk không đạt |
| AI | Dịch vụ agent riêng, dùng API với tài khoản/quyền từng người; đọc/tóm tắt/soạn nháp trước | Thử connector Nextcloud/CalDAV có sẵn, chỉ viết adapter/gateway bổ sung phần thiếu. Không bật trọn bộ tool chỉ vì có MCP; tool gửi/chia sẻ/xoá cần kiểm quyền và xác nhận phù hợp |
| Hạ tầng | Ưu tiên thử trên GCP để tận dụng hướng vận hành sẵn có, nếu vùng dữ liệu được chấp nhận | Môi trường thử tách identity và dữ liệu thật. Khi mail thành dịch vụ thật, đề xuất tách workload mail khỏi ứng dụng/office/AI; quy mô và số máy phải theo đo tải. Đây chưa phải HA; cần kế hoạch phục hồi IdP, mail và tệp |
| Sao lưu | Bản sao tách quyền xoá và một bản ngoài điểm lỗi chính, thử retention và restore | Chọn vùng hợp lệ, hạn giữ và trần chi phí; không khoá retention không thể đảo ngược trước khi chủ dự án chốt. Không coi Object Lock thay được thử phục hồi |

Nguồn kiểm lại: [Nextcloud Context Agent](https://docs.nextcloud.com/server/stable/admin_manual/ai/app_context_agent.html), [ONLYOFFICE 9.4](https://www.onlyoffice.com/blog/2026/05/onlyoffice-docs-9-4), [Stalwart OIDC](https://stalw.art/docs/auth/backend/oidc/), [Talk scalability](https://nextcloud-talk.readthedocs.io/en/latest/scalability/). Giới hạn token của Context Agent áp cho **MCP server bên ngoài mà nó kết nối tới**, không gộp thành mọi kết nối MCP đều không có quyền từng người.

Không chọn REA, CreatorOS hoặc Jev làm phụ thuộc lõi. Có thể xét riêng theo mục đích sau; “AI Jev” vẫn cần xác nhận định danh. Windmill/n8n, tìm kiếm vector, công cụ thiết kế/video và nhiều kênh chat cũng chưa cần thêm trước khi thí điểm chứng minh nhu cầu.

### D.2 Thứ tự triển khai và điểm dừng

1. **Chuẩn bị:** chủ dự án chốt D.3; lập inventory dữ liệu/ứng dụng Google, kiểm quyền môi trường, báo giá theo SKU và chọn tệp thử. Chưa di chuyển dữ liệu thật trong bước tư vấn này.
2. **Thử kỹ thuật trong môi trường riêng:** SSO + Nextcloud + một bộ office + connector AI quyền đọc. Dùng dữ liệu giả/ẩn danh trước; dữ liệu thật chỉ sau khi phân loại và được cho phép. Kiểm quyền không được vượt giữa hai người/phòng, backup/restore và offboarding.
3. **Thí điểm một phòng, đề xuất 5–10 người trong 4–6 tuần sử dụng:** tệp/lịch/office và trợ lý đọc/nháp. Đây là quy mô và thời gian đánh giá đề xuất, không phải cam kết thời gian xây dựng. Quy định thư mục/lịch nào là nguồn ghi chính, tránh sửa hai bản. Gmail và Meet tiếp tục là hệ chính.
4. **Mail/họp thử riêng:** chỉ sau khi bước 3 đạt; dùng hộp thư/tên miền thử, đo nhãn, delivery, quyền, điện thoại, restore và họp thực tế. Thử dual delivery dữ liệu thật là thay đổi vận hành cần được giao riêng; đổi MX là quyết định khác.
5. **Mở rộng/chuyển từng phần:** lập bảng kiểm dữ liệu và ACL, xử lý tính năng Google không thay được, phê duyệt ngày chuyển và kế hoạch quay lui có đồng bộ phần phát sinh. Chỉ hạ/huỷ Google khi hết phụ thuộc được chấp nhận; không gắn ngày huỷ cứng từ đầu.

**Điều kiện qua cổng:** không có truy cập chéo trái quyền trong các tình huống đã thử; tệp đại diện và nghiệp vụ trọng yếu đạt tiêu chí đã chốt; thu hồi người dùng có hiệu lực; restore vào môi trường riêng đạt mục tiêu mất dữ liệu/gián đoạn đã chọn; chi phí đo được trong trần. Mail cần thêm kiểm số lượng/nhãn/attachment, gửi nhận ngoài và nội bộ, spam/bounce, routing loop, rollback; họp cần tải và thiết bị đại diện. Không dùng số test VCdocs thay bằng chứng của hệ mới.

### D.3 Những điểm chủ dự án cần chốt

**Trước khi dựng môi trường thử:**

| # | Quyết định | Mặc định mình đề xuất, chờ chủ dự án chốt |
|---|---|---|
| 1 | Mục tiêu và phạm vi sản phẩm | Nội bộ trước; giữ nghiệp vụ hồ sơ theo C. Nếu định bán cho khách hàng phải nêu ngay để thiết kế tenant/giấy phép phù hợp |
| 2 | Nhóm và phạm vi thí điểm | Một phòng, 5–10 người; tệp/lịch/office + trợ lý đọc/nháp. Chỉ định người phụ trách nghiệm thu; chưa thay Gmail/Meet |
| 3 | Nơi đặt dữ liệu | Có chấp nhận Singapore và nhà cung cấp nước ngoài không; nếu bắt buộc VN thì đổi nơi thử trước khi đưa dữ liệu thật lên. Phân biệt dữ liệu gốc, backup, log và dữ liệu gửi AI |
| 4 | Dữ liệu nào được gửi AI | Cho phép nhóm dữ liệu đã phân loại; dữ liệu nhạy cảm chưa đưa ra API khi chưa có quyết định. Xác định người được dùng và trần token; làm rõ “AI Jev”/kênh chat mong muốn |
| 5 | Ngân sách và nguồn lực | Trần riêng cho thử nghiệm, hạ tầng/tháng, AI/tháng và license/hỗ trợ; tính cả thời gian vẫn trả Google. Chỉ định IT/người vận hành và người xử lý khi có sự cố; chưa cam kết CUD |
| 6 | Giới hạn tự động hoá | AI đọc và tạo nháp trước; gửi thư, chia sẻ ngoài, xoá dữ liệu, thay quyền, đổi MX/deploy production có người duyệt theo phạm vi. Nêu các ngoại lệ tự chạy cụ thể nếu cần |

**Trước khi đưa dữ liệu thật vào thí điểm và trước khi chuyển dịch vụ chính:**

| # | Quyết định | Nội dung phải xác nhận |
|---|---|---|
| 7 | Quyền dữ liệu và thời hạn lưu | Người chốt ma trận phòng/vai trò; loại dữ liệu thật được thử; cơ sở lưu/xử lý, thời hạn xoá/giữ và nghĩa vụ pháp lý. Không coi miễn dữ liệu nhân viên là miễn mọi nghĩa vụ |
| 8 | Mức mất dữ liệu/gián đoạn chấp nhận | Anh chọn mục tiêu; IT thiết kế và thử RPO/RTO tương ứng. Mức nghiêm ngặt hơn làm đổi chi phí, số máy và lịch backup; chưa có số cam kết từ báo cáo |
| 9 | Tính năng bắt buộc và ngoại lệ | Gmail đa nhãn, mail điện thoại/ActiveSync, Sheets/Apps Script, Form, lịch sử phiên bản, quyền ngoài công ty, họp/ghi âm. Chốt cái nào phải giữ Google hoặc cần hỗ trợ trả phí nếu PoC không đạt |
| 10 | Relay, truy cập và hỗ trợ | Có chấp nhận SES/Cloudflare theo vai trò cụ thể không; có ngân sách hỗ trợ trả phí cho IdP/office/mail không. Không mặc định mua Enterprise chỉ vì số người dùng |
| 11 | Ranh giới quyền phát triển/vận hành | Chốt visibility repo, identity agent riêng, quyền Google/GCP/GitHub, người được duyệt production; hoàn tất trust hook và bật check bắt buộc. Có file cấu hình chưa chứng minh các quyền này đã được cưỡng chế |
| 12 | Ngày chuyển và đường quay lui | Người duyệt go/no-go, thời gian chạy song song, nguồn ghi chính, đồng bộ delta mail/tệp/quyền và điều kiện dừng. Đổi MX/hạ gói Google phải duyệt riêng sau nghiệm thu |

**Số liệu cần giao IT lấy, không phải yêu cầu chủ dự án tự chọn công nghệ:** gói/hoá đơn Google, số tài khoản, GB Gmail/Drive, thư/tháng và attachment, số họp đồng thời/người tham gia, danh sách Sheets/Apps Script/Form, yêu cầu mail điện thoại và quyền nhóm hiện tại. Thu thập bằng quyền đọc được giao; không tự dùng thông tin đăng nhập quản trị từ máy agent.

### D.4 Đề nghị phê duyệt cho bước tiếp theo

Chỉ phê duyệt **lập kế hoạch và dựng thử theo phạm vi được chốt ở D.3**, với tài khoản/môi trường riêng và trần ngân sách. Mua dịch vụ, đưa dữ liệu thật vào thử, thay quyền production, chuyển MX hoặc dừng Google là các quyết định tiếp theo có kết quả thử cụ thể để xem trước. Chưa thực hiện các hành động đó trong phiên này.
