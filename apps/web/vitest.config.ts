import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // antd trong jsdom: mỗi truy vấn *ByRole của Testing Library trên trang lớn (Email ~230 phần tử) mất
    // ~0,5 s vì tính vai trò ngầm cho từng phần tử; các ca dài (email, ho-so) mất 8–10 s trên máy dev và
    // 21 s trên runner CI (PR #12 đỏ với mốc 20 s). Chỉ nới thời gian chờ, không đổi assertion.
    testTimeout: 60_000,
  },
});
