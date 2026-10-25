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
  '--testMatch', '<rootDir>/test/**/*.integration-spec.ts',
  'test/onlyoffice-nextcloud.integration-spec.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...values,
    RUN_ONLYOFFICE_NEXTCLOUD_INTEGRATION: '1',
    DOCUMENT_EDITOR_JWT_SECRET: 'vcworkspace-test-editor-secret',
    ALLOW_PARTIAL_COVERAGE: '1',
  },
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
