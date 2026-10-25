// Chat15: fail if any PoC secret value (work13 secrets, chat14/15 webhook
// secrets, NAS passwords, SMB auth files, device app passwords) appears in a
// committable file under poc/sync-nas, poc/flow, the Flow code/tests, docs or
// the sổ tay. Values are compared, never printed.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { syncRoot } from './lib.mjs';

const repo = join(syncRoot, '..', '..');
const secretDirs = [process.env.WORK13_SECRETS_DIR, join(repo, 'poc', 'flow', 'secrets'), join(syncRoot, 'secrets')].filter(Boolean);
const values = [];
async function collect(dir) {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await collect(path); continue; }
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      // smbclient auth file: chỉ dòng password là bí mật (username/domain là định danh công khai)
      if (/^\s*(username|domain)\s*=/.test(line)) continue;
      const value = line.includes('=') ? line.split('=').slice(1).join('=').trim() : line.trim();
      if (value.length >= 12) values.push(value);
    }
  }
}
for (const dir of secretDirs) await collect(dir);
const targets = [syncRoot, join(repo, 'poc', 'flow'), join(repo, 'apps', 'api', 'src', 'modules', 'flow'), join(repo, 'apps', 'api', 'test'), join(repo, 'docs'), join(repo, 'SO_TAY_DU_AN.md')];
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
