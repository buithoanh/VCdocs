// Chat17: mint one Nextcloud app password per persona (token name talk17-api)
// with occ, like the Talk mobile/desktop clients get after Login Flow. Values go
// straight to secrets/app_password_<name> (0600) and are never printed. Only
// talk17 tokens are replaced; tokens of earlier chats are left untouched.
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { actorNames, occ, occJson, secretsDir, tokenName, uidOf } from './lib.mjs';

await mkdir(secretsDir, { recursive: true, mode: 0o700 });
await chmod(secretsDir, 0o700);
const only = process.argv.slice(2);
const targets = [...actorNames, 'admin13'].filter((n) => !only.length || only.includes(n));
for (const name of targets) {
  const uid = await uidOf(name);
  const existing = await occJson('user:auth-tokens:list', uid);
  for (const token of existing.filter((item) => item.name === tokenName || item.name === `${tokenName}-2`)) await occ('user:auth-tokens:delete', uid, String(token.id));
  for (const [suffix, file] of [['', `app_password_${name}`], ['-2', `app_password_${name}_2`]]) {
    if (suffix && name === 'admin13') continue;
    const { stdout } = await occ('user:auth-tokens:add', `--name=${tokenName}${suffix}`, uid);
    const password = stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean).at(-1);
    if (!password || password.length < 40 || /\s/.test(password)) throw new Error(`APP_PASSWORD_PARSE_FAILED:${name}`);
    const path = join(secretsDir, file);
    await writeFile(path, `${password}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  }
}
console.log(`App passwords (${tokenName}, ${tokenName}-2 = second device) minted for ${targets.join(', ')} into secrets/ (0600); values not printed.`);
