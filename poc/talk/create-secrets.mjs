// Chat17: local-only test secret for the restore DB (0600, git-ignored
// secrets/). Existing value kept (idempotent). Never printed.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { secretsDir } from './lib.mjs';

await mkdir(secretsDir, { recursive: true, mode: 0o700 });
await chmod(secretsDir, 0o700);
const path = join(secretsDir, 'restore_db_password');
let created = 0;
try { await stat(path); } catch {
  await writeFile(path, `${randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  created = 1;
}
console.log(`secrets ready (restore_db_password, ${created} created); value not printed`);
