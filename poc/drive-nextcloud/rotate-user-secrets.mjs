import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const file = new URL('.poc-secrets', import.meta.url);
const text = await readFile(file, 'utf8');
const lines = text.trimEnd().split('\n');
const values = new Map(lines.filter((line) => line.includes('='))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const fresh = () => randomBytes(24).toString('base64url');
const rotated = { POC_USER_A_VALUE: fresh(), POC_USER_B_VALUE: fresh() };
const users = [['vcw-poc-a', rotated.POC_USER_A_VALUE], ['vcw-poc-b', rotated.POC_USER_B_VALUE]];

for (const [user, password] of users) {
  const result = spawnSync('docker', ['compose', '--env-file', '.poc-secrets', '-p', 'vcworkspace-drive-poc',
    '-f', 'compose.yaml', 'exec', '-T', '-u', 'www-data', '-e', 'OC_PASS', 'nextcloud',
    'php', 'occ', 'user:resetpassword', '--password-from-env', user], {
    cwd: new URL('.', import.meta.url), encoding: 'utf8', env: { ...process.env, OC_PASS: password },
  });
  if (result.status !== 0) throw new Error(`Không xoay được credential ${user}: ${result.stderr.trim()}`);
}

values.set('POC_USER_A_VALUE', rotated.POC_USER_A_VALUE);
values.set('POC_USER_B_VALUE', rotated.POC_USER_B_VALUE);
values.set('POC_USER_A_AUTH', JSON.stringify('Basic ' + btoa('vcw-poc-a:' + rotated.POC_USER_A_VALUE)));
values.set('POC_USER_B_AUTH', JSON.stringify('Basic ' + btoa('vcw-poc-b:' + rotated.POC_USER_B_VALUE)));
const updated = lines.map((line) => {
  const key = line.slice(0, line.indexOf('='));
  return values.has(key) ? key + '=' + values.get(key) : line;
}).join('\n') + '\n';
const temporary = new URL('.poc-secrets.rotating', import.meta.url);
await writeFile(temporary, updated, { encoding: 'utf8', mode: 0o600 });
await rename(temporary, file);
await chmod(file, 0o600);
process.stdout.write('Rotated the two local PoC user credentials; values were not printed.\n');
