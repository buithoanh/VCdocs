import path from 'node:path';
import type { NextConfig } from 'next';

// Giao diện gọi /api/v1/... cùng tên miền; Next.js chuyển tiếp sang máy chủ API.
// BE thật: API_ORIGIN=http://localhost:4000 (tiền tố /api/v1).
// Máy chủ giả Prism: API_ORIGIN=http://localhost:4010 và API_PATH_PREFIX= (rỗng).
// Lưu ý: giá trị được đọc lúc `next dev` / `next build`.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const apiPathPrefix = process.env.API_PATH_PREFIX ?? '/api/v1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Image Docker (deploy/web.Dockerfile) đặt NEXT_OUTPUT=standalone; local giữ nguyên `next start`.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  // Gốc workspace pnpm (2 cấp trên apps/web).
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}${apiPathPrefix}/:path*` }];
  },
};

export default nextConfig;
