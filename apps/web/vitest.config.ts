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
    // antd trong jsdom dựng lại nhiều lớp mỗi lần gõ/mở Select: các ca dài mất 4–6 s trên máy dev
    // và vượt mốc mặc định 5 s trên runner CI chậm hơn (PR #10). Chỉ nới thời gian chờ, không đổi assertion.
    testTimeout: 20_000,
  },
});
