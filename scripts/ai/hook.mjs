import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkTool } from './policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let event;
try { event = JSON.parse(fs.readFileSync(0, 'utf8')); }
catch { console.error('Hook input không phải JSON hợp lệ.'); process.exit(2); }
const mode = process.argv[2];
if (mode === 'pre') {
  const reason = checkTool(event, root);
  if (reason) { console.error(reason); process.exit(2); }
} else if (mode === 'start') {
  const result = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
  const hints = ['VCworkspace; root=' + root, 'branch=' + result.stdout.trim(),
    'Đọc AGENTS.md và SO_TAY_DU_AN.md. Hooks repo không thay thế IAM/sandbox.'];
  if (fs.existsSync(path.join(root, 'apps/api/.env'))) hints.push('Có .env local: không đọc secret, không khởi động entrypoint BE tự nạp .env thật; bootstrap TEST cô lập đã review dùng Google giả.');
  console.log(hints.join('\n'));
} else if (mode === 'stop') {
  // Stop runs on every turn. Retry at most once; CI remains the merge gate.
  if (event.stop_hook_active) {
    console.log(JSON.stringify({ systemMessage: 'Gate chưa đạt ở lượt trước: báo rõ blocker, không tuyên bố hoàn tất. CI vẫn bắt buộc.' }));
    process.exit(0);
  }
  const result = spawnSync(process.execPath, ['scripts/ai/check.mjs'], { cwd: root, encoding: 'utf8', timeout: 110000 });
  if (result.status !== 0) { console.error((result.stdout ?? '') + (result.stderr ?? '') + '\nChạy pnpm ai:check và xử lý lỗi hoặc báo blocker.'); process.exit(2); }
  console.log('{}');
} else { console.error('Hook mode không hợp lệ.'); process.exit(2); }
