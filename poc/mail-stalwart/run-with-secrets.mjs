import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const [secretFile, script] = process.argv.slice(2);
if (!secretFile?.startsWith('/private/tmp/') || !script?.startsWith('poc/mail-stalwart/')) throw new Error('Đường dẫn runtime không hợp lệ');
const values = Object.fromEntries(fs.readFileSync(secretFile, 'utf8').trim().split('\n').map((line) => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));
const result = spawnSync(process.execPath, [script], {
  cwd: process.cwd(), stdio: 'inherit',
  env: { ...process.env, MAIL_TEST_A_PASSWORD: values.MAIL_TEST_A_PASSWORD, MAIL_TEST_B_PASSWORD: values.MAIL_TEST_B_PASSWORD, STALWART_RECOVERY_ADMIN: values.STALWART_RECOVERY_ADMIN },
});
process.exit(result.status ?? 1);
