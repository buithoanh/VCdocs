import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Giao diện gọi /api/v1/... cùng tên miền; Next.js chuyển tiếp sang máy chủ API.
// BE thật: API_ORIGIN=http://localhost:4000 (tiền tố /api/v1).
// Máy chủ giả Prism: API_ORIGIN=http://localhost:4010 và API_PATH_PREFIX= (rỗng).
// Lưu ý: giá trị được đọc lúc `next dev` / `next build`.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const apiPathPrefix = process.env.API_PATH_PREFIX ?? '/api/v1';

// CSP tối thiểu cho bản build: script chỉ từ chính origin và Document Server khai báo
// (cùng biến với src/lib/document-server.ts). App Router chèn script inline khi hydrate nên
// cần 'unsafe-inline'; vẫn chặn được script ngoài origin. `next dev` không đặt (cần eval/HMR).
const documentServerOrigins = (process.env.NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const contentSecurityPolicy = [`script-src 'self' 'unsafe-inline' ${documentServerOrigins.join(' ')}`.trim(), "object-src 'none'", "base-uri 'self'"].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cho phép smoke local dùng cache riêng, tránh tranh chấp với build/gate song song.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Image Docker (deploy/web.Dockerfile) đặt NEXT_OUTPUT=standalone; local giữ nguyên `next start`.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  // Gốc workspace pnpm (2 cấp trên apps/web).
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}${apiPathPrefix}/:path*` }];
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) return nextConfig;
  return {
    ...nextConfig,
    async headers() {
      return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] }];
    },
  };
}
