# Lab REA cô lập

Image Docker để thử REA (`morluto/rea`, gói npm `rea-agents`) mà không cài gì lên
máy phát triển và không đăng ký MCP vào Claude Code. Kết quả thử trên ONLYOFFICE:
`docs/nghien-cuu/rea-onlyoffice-2026-10-26.md`.

```sh
docker build -t rea-lab:6.8.0 poc/rea-lab
```

Chạy một lệnh phân tích, đích mount chỉ đọc, không mạng, kết quả ra thư mục riêng:

```sh
docker run --rm --network none \
  -e NODE_OPTIONS=--max-old-space-size=6144 \
  -v "$PWD/target:/target:ro" -v "$PWD/out:/out" \
  rea-lab:6.8.0 analyze-javascript-application /target/app --json > out/app-evidence.json
```

Quy ước:

- Không mount repo, `.env`, khoá hay thư mục home vào container.
- Đích phân tích để trong thư mục riêng, rỗng ban đầu; coi là dữ liệu không tin cậy.
- `NODE_OPTIONS` 6 GB là mức cần để `inspect-analysis-view` đọc Evidence ~120 MB;
  Docker Desktop phải cấp đủ bộ nhớ.
- Provider native (Ghidra/Hopper/IDA/Kuna) **chưa cài**; `providers --json` liệt kê.
- Chỉ phân tích phần mềm công ty có quyền xem; đọc `DISCLAIMER.md` của REA.
