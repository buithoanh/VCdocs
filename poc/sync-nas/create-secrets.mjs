// Chat15: generate the local-only NAS account passwords (random, 0600, in the
// git-ignored secrets/ folder) and matching smbclient auth files. Never prints
// a value. Idempotent: existing files are kept so the running NAS stays valid.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nasAccounts, syncRoot } from './lib.mjs';

const nasDir = join(syncRoot, 'secrets', 'nas');
const authDir = join(syncRoot, 'secrets', 'smbauth');
await mkdir(nasDir, { recursive: true, mode: 0o700 });
await mkdir(authDir, { recursive: true, mode: 0o700 });
let created = 0;
for (const account of nasAccounts) {
  const file = join(nasDir, account);
  if (!existsSync(file)) {
    // hex: no characters that need quoting in smb.conf-style auth files
    await writeFile(file, `${randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
    created += 1;
  }
  await chmod(file, 0o600);
}
const { readFile } = await import('node:fs/promises');
for (const account of nasAccounts) {
  const password = (await readFile(join(nasDir, account), 'utf8')).trim();
  const file = join(authDir, account);
  await writeFile(file, `username = ${account}\npassword = ${password}\ndomain = VCW15\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}
console.log(`NAS secrets ready: ${nasAccounts.length} accounts (${created} new), values not printed.`);
