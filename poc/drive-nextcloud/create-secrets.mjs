import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

function secret() {
  return randomBytes(24).toString('base64url');
}

function basic(user, password) {
  return 'Basic ' + btoa(user + ':' + password);
}

const adminUser = 'vcw-poc-admin';
const adminPassword = secret();
const userA = secret();
const userB = secret();
const lines = [
  'COMPOSE_PROJECT_NAME=vcworkspace-drive-poc',
  'POC_BASE_URL=http://127.0.0.1:18080',
  'POC_ADMIN_USER=' + adminUser,
  'POC_ADMIN_PASSWORD=' + adminPassword,
  'POC_ADMIN_AUTH=' + JSON.stringify(basic(adminUser, adminPassword)),
  'POC_USER_A_VALUE=' + userA,
  'POC_USER_B_VALUE=' + userB,
  'POC_USER_A_AUTH=' + JSON.stringify(basic('vcw-poc-a', userA)),
  'POC_USER_B_AUTH=' + JSON.stringify(basic('vcw-poc-b', userB)),
];

await writeFile('.poc-secrets', lines.join('\n') + '\n', {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
process.stdout.write('Created .poc-secrets with mode 600; values were not printed.\n');
