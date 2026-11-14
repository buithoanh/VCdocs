# Lab cô lập để thử REA (morluto/rea, gói npm rea-agents) trên tệp ONLYOFFICE.
# Không mount .env, không mạng khi chạy phân tích (--network none).
FROM node:24-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends procps binutils file ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Ghim đúng phiên bản phát hành 2026-10-25 (release rea-agents-6.8.0).
RUN npm install --global rea-agents@6.8.0 \
 && rea --help > /dev/null

RUN useradd --create-home --shell /bin/bash lab
USER lab
WORKDIR /home/lab
ENV REA_ANALYSIS_PROVIDER=objdump

ENTRYPOINT ["rea"]
