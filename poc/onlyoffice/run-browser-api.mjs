import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const secretPath = resolve('poc/drive-nextcloud/.poc-secrets');
const values = {};
for (const line of (await readFile(secretPath, 'utf8')).split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const at = line.indexOf('=');
  if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
}
const required = ['POC_BASE_URL', 'POC_USER_A_VALUE', 'POC_USER_B_VALUE'];
for (const name of required) if (!values[name]) throw new Error('Thiếu biến thử ' + name);
const child = spawn('pnpm', ['--filter', '@vcdocs/api', 'run', 'test', '--runInBand',
  'test/browser-smoke-server.spec.ts'], {
  stdio: 'inherit',
  env: { ...process.env, ...values, RUN_BROWSER_SMOKE_SERVER: '1',
    BROWSER_SMOKE_HOLD_MS: process.env.BROWSER_SMOKE_HOLD_MS || '1200000',
    BROWSER_SMOKE_RUN_ID: process.env.BROWSER_SMOKE_RUN_ID || 'chat04',
    DOCUMENT_EDITOR_JWT_SECRET: 'vcworkspace-test-editor-secret',
    ALLOW_PARTIAL_COVERAGE: '1' },
});
child.on('exit', (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
