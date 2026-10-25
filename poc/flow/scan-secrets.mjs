// Chat14: fail if any PoC secret value (work13 secrets + chat14 webhook secrets)
// appears in a committable file under poc/flow or in the Flow code/tests.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { flowRoot, flowSecretsDir } from './lib.mjs';

const work13Secrets = process.env.WORK13_SECRETS_DIR || join(flowRoot, '..', 'work-management', 'secrets');
const values = [];
for (const dir of [work13Secrets, flowSecretsDir]) {
  for (const name of await readdir(dir)) {
    for (const line of (await readFile(join(dir, name), 'utf8')).split('\n')) {
      const value = line.includes('=') ? line.split('=').slice(1).join('=').trim() : line.trim();
      if (value.length >= 12) values.push(value);
    }
  }
}
const repo = join(flowRoot, '..', '..');
const targets = [flowRoot, join(repo, 'apps', 'api', 'src', 'modules', 'flow'), join(repo, 'apps', 'api', 'test'), join(repo, 'docs', 'ke-hoach')];
const skip = new Set(['secrets', '.runtime', 'node_modules']);
const leaks = [];
let files = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      files += 1;
      const text = (await readFile(path)).toString('latin1');
      if (values.some((value) => text.includes(value))) leaks.push(relative(repo, path));
    }
  }
}
for (const target of targets) await walk(target);
if (leaks.length) throw new Error(`SECRET_VALUE_FOUND:${leaks.join(',')}`);
console.log(`Secret scan PASS: ${values.length} secret values checked across ${files} files, none in committable files.`);
