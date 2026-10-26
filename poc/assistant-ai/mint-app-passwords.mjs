// Chat19: mint one Nextcloud app password per persona (token name ai19-api)
// with occ. Values go straight to secrets/app_password_<name> (0600) and are
// never printed. Only ai19 tokens are replaced; tokens of earlier chats are
// left untouched.
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { actorNames, occ, occJson, secretsDir, tokenName, uidOf } from './lib.mjs';

await mkdir(secretsDir, { recursive: true, mode: 0o700 });
await chmod(secretsDir, 0o700);
const targets = [...actorNames, 'admin13'];
for (const name of targets) {
  const uid = await uidOf(name);
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
