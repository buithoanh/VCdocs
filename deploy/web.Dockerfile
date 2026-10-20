# Giao diện VCdocs (apps/web) – build từ gốc repo:
#   docker build -f deploy/web.Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.2.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @vcdocs/web
COPY contract contract
COPY apps/web apps/web
# next.config.ts đọc API_ORIGIN lúc build (chuyển tiếp /api/v1). Ở production Caddy đã chuyển
# thẳng /api/* sang api, giá trị này chỉ là dự phòng trong mạng nội bộ Docker.
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN pnpm --filter @vcdocs/web build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
