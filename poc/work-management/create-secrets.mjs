import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const target = join(root, 'secrets');
await mkdir(target, { recursive: true, mode: 0o700 });
for (const [name, size] of Object.entries({
  nc_db_password: 32,
  nc_admin_password: 24,
  ak_db_password: 32,
  ak_secret_key: 64,
  ak_bootstrap_password: 24,
  ak_bootstrap_token: 40,
  oidc_nc_client_secret: 40,
  'persona_manager-a_password': 20,
  'persona_member-a_password': 20,
  'persona_successor-a_password': 20,
  'persona_manager-b_password': 20,
  'persona_member-b_password': 20,
  persona_outsider_password: 20,
})) {
  const path = join(target, name);
  try {
    await writeFile(path, `${randomBytes(size).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await chmod(path, 0o600);
}
// Authentik bootstrap password/token do not support file:// values, so they
// live in a 0600 env-file mounted only into the worker.
const bootstrapEnv = [
  `AUTHENTIK_BOOTSTRAP_PASSWORD=${(await readFile(join(target, 'ak_bootstrap_password'), 'utf8')).trim()}`,
  `AUTHENTIK_BOOTSTRAP_TOKEN=${(await readFile(join(target, 'ak_bootstrap_token'), 'utf8')).trim()}`,
  '',
].join('\n');
await writeFile(join(target, 'authentik-bootstrap.env'), bootstrapEnv, { mode: 0o600 });
await chmod(join(target, 'authentik-bootstrap.env'), 0o600);
console.log('Local test secret files are present with mode 0600; values were not printed.');
