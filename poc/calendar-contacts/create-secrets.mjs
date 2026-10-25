// Chat16: generate local-only test secrets (0600, git-ignored secrets/):
// Stalwart recovery admin + one password per local test mailbox + restore DB
// password. Existing values are kept (idempotent). Values are never printed.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { secretsDir } from './lib.mjs';
import { mailboxes } from './mailboxes.mjs';
await mkdir(secretsDir, { recursive: true, mode: 0o700 });
await chmod(secretsDir, 0o700);
const names = ['stalwart_recovery_password', 'restore_db_password', ...mailboxes.map((m) => `mail_${m.replace(/[@.]/g, '_')}`)];
let created = 0;
for (const name of names) {
  const path = join(secretsDir, name);
  try { await stat(path); continue; } catch { /* create */ }
  await writeFile(path, `${randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  created += 1;
}
console.log(`secrets ready (${names.length} names, ${created} created); values not printed`);
