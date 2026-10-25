// Mint one Nextcloud app password per persona for direct API tests. Values go
// straight to secrets/app_password_<username> (0600) and are never printed.
// Re-running revokes the previous chat13 token first.
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { occ, personas, root } from './lib.mjs';

const tokenName = 'work13-api-test';
for (const binding of Object.values(await personas())) {
  const existing = JSON.parse((await occ('user:auth-tokens:list', '--output=json', binding.nextcloudUserId)).stdout);
  for (const token of existing.filter((item) => item.name === tokenName)) await occ('user:auth-tokens:delete', binding.nextcloudUserId, String(token.id));
  const { stdout } = await occ('user:auth-tokens:add', `--name=${tokenName}`, binding.nextcloudUserId);
  const password = stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean).at(-1);
  if (!password || password.length < 40 || /\s/.test(password)) throw new Error(`APP_PASSWORD_PARSE_FAILED:${binding.username}`);
  const path = join(root, 'secrets', `app_password_${binding.username}`);
  await writeFile(path, `${password}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
console.log('App passwords minted for all personas into secrets/ (0600); values not printed.');
