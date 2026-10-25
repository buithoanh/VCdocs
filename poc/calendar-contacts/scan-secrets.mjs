// Chat16: fail if any chat16 secret value (Stalwart recovery admin, mailbox
// passwords, restore DB password, cal16 app passwords) appears in a committable
// file under poc/calendar-contacts, docs or the sổ tay. Values are compared,
// never printed. The backup/ folder is git-ignored and skipped.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { calRoot, secretsDir } from './lib.mjs';

const repo = join(calRoot, '..', '..');
const values = [];
if (existsSync(secretsDir)) {
  for (const entry of await readdir(secretsDir)) {
    const value = (await readFile(join(secretsDir, entry), 'utf8')).trim();
    if (value.length >= 12) values.push(value);
  }
}
const targets = [calRoot, join(repo, 'docs'), join(repo, 'SO_TAY_DU_AN.md')];
const skip = new Set(['secrets', '.runtime', 'node_modules', 'backup']);
const leaks = [];
let files = 0;
async function walk(path) {
  const info = await stat(path);
  if (info.isFile()) {
    files += 1;
    const text = (await readFile(path)).toString('latin1');
    if (values.some((value) => text.includes(value))) leaks.push(relative(repo, path));
    return;
  }
  for (const entry of await readdir(path, { withFileTypes: true })) if (!skip.has(entry.name)) await walk(join(path, entry.name));
}
for (const target of targets) await walk(target);
if (leaks.length) throw new Error(`SECRET_VALUE_FOUND:${leaks.join(',')}`);
console.log(`Secret scan PASS: ${values.length} secret values checked across ${files} files, none in committable files.`);
