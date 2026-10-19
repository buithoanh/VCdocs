import * as fs from 'fs';
import * as path from 'path';
import { getContract } from '../../src/contract/openapi';

/**
 * Sau cả lượt test: kiểm mọi điểm cuối trong contract/openapi.yaml đều đã được
 * gọi ít nhất một lần (và phản hồi đã được kiểm schema). Thiếu → báo lỗi.
 */
export default async function globalTeardown() {
  await (globalThis as any).__MONGOD__?.stop();
  const dir = process.env.TEST_COVERAGE_DIR;
  if (!dir || !fs.existsSync(dir)) return;
  const hit = new Set<string>();
  const undeclared = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    data.hits.forEach((k: string) => hit.add(k));
    data.undeclared.forEach((k: string) => undeclared.add(k));
  }
  if (process.env.TEST_UNDECLARED_REPORT) fs.writeFileSync(process.env.TEST_UNDECLARED_REPORT, [...undeclared].sort().join('\n') + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  if (process.env.SKIP_CONTRACT_COVERAGE) return;
  const all = getContract().operations().map((o) => `${o.method} ${o.path}`);
  const missing = all.filter((k) => !hit.has(k));
  // eslint-disable-next-line no-console
  console.log(`\nĐộ phủ hợp đồng: ${all.length - missing.length}/${all.length} điểm cuối có test e2e`);
  if (missing.length && !process.env.ALLOW_PARTIAL_COVERAGE) {
    throw new Error(`Điểm cuối chưa có test e2e:\n  ${missing.join('\n  ')}`);
  }
}
