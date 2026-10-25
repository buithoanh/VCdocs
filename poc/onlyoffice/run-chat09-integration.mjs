import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const read = async (path) => Object.fromEntries(
  (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const drive = await read(new URL('../drive-nextcloud/.poc-secrets', import.meta.url));
const mail = await read(process.argv[2]);
const child = spawn('pnpm', [
  '--filter', '@vcdocs/api', 'run', 'test', '--runInBand',
  'test/workspace-interop-real.integration.spec.ts',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...drive,
    ...mail,
    RUN_CHAT09_REAL_INTEGRATION: '1',
    ALLOW_PARTIAL_COVERAGE: '1',
  },
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
