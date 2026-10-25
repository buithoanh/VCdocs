// Chat17: fail if any chat17 secret value (talk17 app passwords, restore DB
// password) appears in a committable file under poc/talk, docs or the sổ tay.
// Values are compared, never printed. secrets/, backup/, chrome profiles skipped.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { secretsDir, talkRoot } from './lib.mjs';

const repo = join(talkRoot, '..', '..');
const values = [];
if (existsSync(secretsDir)) {
  for (const entry of await readdir(secretsDir)) {
    const value = (await readFile(join(secretsDir, entry), 'utf8')).trim();
    if (value.length >= 12) values.push(value);
  }
}
const encoded = values.map((v) => Buffer.from(v).toString('base64'));
const targets = [talkRoot, join(repo, 'docs'), join(repo, 'SO_TAY_DU_AN.md')];
const skip = (name) => ['secrets', '.runtime', 'node_modules', 'backup'].includes(name) || name.startsWith('chrome-profile');
const leaks = [];
let files = 0;
async function walk(path) {
  const info = await stat(path);
  if (info.isFile()) {
    files += 1;
    const text = (await readFile(path)).toString('latin1');
    if (values.some((v) => text.includes(v)) || encoded.some((v) => text.includes(v.slice(0, 40)))) leaks.push(relative(repo, path));
    return;
  }
  for (const entry of await readdir(path, { withFileTypes: true })) if (!skip(entry.name)) await walk(join(path, entry.name));
}
for (const target of targets) await walk(target);
if (leaks.length) throw new Error(`SECRET_VALUE_FOUND:${leaks.join(',')}`);
console.log(`Secret scan PASS: ${values.length} secret values (plain + base64 prefix) checked across ${files} files, none in committable files.`);
