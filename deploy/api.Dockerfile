# Máy chủ nghiệp vụ VCdocs (apps/api) – build từ gốc repo:
#   docker build -f deploy/api.Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.2.0 --activate
WORKDIR /repo
# Không tải mongod cho mongodb-memory-server (chỉ dùng khi test)
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @vcdocs/api
COPY contract contract
COPY apps/api apps/api
RUN pnpm --filter @vcdocs/api build \
 && pnpm --filter @vcdocs/api deploy --prod /out \
 && cp -r /repo/apps/api/dist /out/dist

FROM node:22-bookworm-slim
# Font DejaVu để in dấu "ĐÃ CHỐT" có dấu tiếng Việt (pdf-stamp.ts tự tìm đường dẫn này)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
COPY contract/openapi.yaml contract/openapi.yaml
ENV NODE_ENV=production \
    PORT=4000 \
    OPENAPI_PATH=/app/contract/openapi.yaml \
    VAULT_DIR=/data/vault \
    UPLOAD_TMP_DIR=/data/uploads
RUN mkdir -p /data/vault /data/uploads && chown -R node:node /data
USER node
EXPOSE 4000
# API chưa có điểm cuối kiểm tra sức khoẻ riêng: /me trả 401 khi chưa đăng nhập là đủ biết máy chủ còn sống
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/me').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
