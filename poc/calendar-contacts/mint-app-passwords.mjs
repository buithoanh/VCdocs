// Chat16: mint one Nextcloud app password per persona (token name cal16-dav)
// with occ, as CalDAV/CardDAV clients do after Login Flow. Values go straight to
// secrets/app_password_<name> (0600) and are never printed. Only chat16 tokens
// are replaced; chat13/14/15 tokens are left untouched. admin13 gets one too
// (webhook registration via OCS only; no admin password is read).
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { actorNames, occ, occJson, personas, secretsDir } from './lib.mjs';

const tokenName = 'cal16-dav';
const bindings = await personas();
const only = process.argv.slice(2);
const targets = [...actorNames, 'admin13'].filter((n) => !only.length || only.includes(n));
for (const name of targets) {
  const uid = name === 'admin13' ? 'admin13' : bindings[name].nextcloudUserId;
  const existing = await occJson('user:auth-tokens:list', uid);
  for (const token of existing.filter((item) => item.name === tokenName)) await occ('user:auth-tokens:delete', uid, String(token.id));
  const { stdout } = await occ('user:auth-tokens:add', `--name=${tokenName}`, uid);
  const password = stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean).at(-1);
  if (!password || password.length < 40 || /\s/.test(password)) throw new Error(`APP_PASSWORD_PARSE_FAILED:${name}`);
  const path = join(secretsDir, `app_password_${name}`);
  await writeFile(path, `${password}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
console.log(`App passwords (${tokenName}) minted for ${targets.join(', ')} into secrets/ (0600); values not printed.`);
