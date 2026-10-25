import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = { ...process.env, GOOGLE_MODE: 'fake', NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of Object.keys(env)) if (/TOKEN|SECRET|KEY|GOOGLE_|CLOUDSDK_|AWS_|AZURE_|MONGODB_URI|SKIP_CONTRACT_COVERAGE|ALLOW_PARTIAL_COVERAGE/.test(key) && key !== 'GOOGLE_MODE') delete env[key];
function run(cmd, args, overrides = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, env: { ...env, ...overrides }, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'Không đọc được Git diff.');
  return r.stdout.split('\0').filter(Boolean);
}
const full = process.argv.includes('--full');
const baseIndex = process.argv.indexOf('--base');
const files = [...new Set([
  ...git(['diff', '--name-only', '-z', ...(baseIndex >= 0 ? [process.argv[baseIndex + 1], 'HEAD'] : [])]),
  ...git(['diff', '--cached', '--name-only', '-z']), ...git(['ls-files', '--others', '--exclude-standard', '-z']),
])];
run('git', ['diff', '--check']);
const secretPath = /(^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|api\.env|[^/]+\.(?:pem|key|p12))$|(^|\/)secrets\//;
for (const file of files) {
  if (secretPath.test(file)) throw new Error('File nhạy cảm trong thay đổi: ' + file);
  if (!fs.existsSync(path.join(root, file))) continue;
  if (fs.statSync(path.join(root, file)).size > 2_000_000) continue;
  const body = fs.readFileSync(path.join(root, file), 'utf8');
  // Report only the filename; never echo a matching credential.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"private_key"\s*:\s*"-----BEGIN/.test(body)) throw new Error('Phát hiện khoá riêng trong: ' + file);
}
run(process.execPath, ['--test', 'scripts/ai/guard.test.mjs', 'scripts/ai/gate.test.mjs']);
const applicationFile = f => !/\.(?:md|png|jpe?g|gif|svg)$/i.test(f);
const api = full || files.some(f => /^apps\/api\//.test(f) && applicationFile(f));
const web = full || files.some(f => /^apps\/web\//.test(f) && applicationFile(f));
const contract = full || files.some(f => /^contract\//.test(f) && applicationFile(f));
const dependencies = files.some(f => /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(f));
if (contract || dependencies || api || web) run('pnpm', ['contract:lint']);
if (api || contract || dependencies) {
  run('pnpm', ['--filter', '@vcdocs/api', 'typecheck']);
  run('pnpm', ['--filter', '@vcdocs/api', 'run', 'test', '--runInBand']);
}
if (web || contract || dependencies) {
  run('pnpm', ['--filter', '@vcdocs/web', 'typecheck']);
  run('pnpm', ['--filter', '@vcdocs/web', 'run', 'test']);
}
if (full || contract || dependencies) {
  // Builds need production NODE_ENV; they do not start the API or load its .env.
  run('pnpm', ['build'], { NODE_ENV: 'production' });
}
console.log(`PASS: ${full ? 'full' : 'changed'} gate; ${files.length} file thay đổi. Google giả; không khởi động dịch vụ thật.`);
