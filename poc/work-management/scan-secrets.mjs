// Fail if any value from secrets/ appears in a file that would be committed
// (everything under poc/work-management except secrets/, backup/, chrome-profile/).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { root } from './lib.mjs';

const skip = new Set(['secrets', 'backup', 'chrome-profile', 'node_modules']);
const values = [];
for (const name of await readdir(join(root, 'secrets'))) {
  for (const line of (await readFile(join(root, 'secrets', name), 'utf8')).split('\n')) {
    const value = line.includes('=') ? line.split('=').slice(1).join('=').trim() : line.trim();
    if (value.length >= 12) values.push(value);
  }
}
const leaks = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const text = (await readFile(path)).toString('latin1');
      if (values.some((value) => text.includes(value))) leaks.push(relative(root, path));
    }
  }
}
await walk(root);
if (leaks.length) throw new Error(`SECRET_VALUE_FOUND:${leaks.join(',')}`);
console.log(`Secret scan PASS: ${values.length} secret values checked, none in committable files.`);
