// Chat19: `node state.mjs snapshot <label>` / `node state.mjs compare <a> <b>`
// (read-only; evidence/state-<label>.json, evidence/state-compare-<a>-vs-<b>.json).
import { readEvidence, writeEvidence } from './lib.mjs';
import { diff, snapshot } from './state-lib.mjs';

const [mode, a, b] = process.argv.slice(2);
if (mode === 'snapshot') {
  const s = await snapshot();
  await writeEvidence(`state-${a}.json`, s);
  console.log(`state ${a}: ${Object.entries(s.personas).map(([n, p]) => `${n} files=${Object.keys(p.files).length} deck=${Object.keys(p.deck).length} rooms=${Object.keys(p.talk).length} shares=${p.sharesOwned.length}/${p.sharesWithMe.length}`).join('; ')}`);
} else if (mode === 'compare') {
  const x = await readEvidence(`state-${a}.json`);
  const y = await readEvidence(`state-${b}.json`);
  delete x.generatedAt; delete y.generatedAt;
  const changes = diff(x, y);
  await writeEvidence(`state-compare-${a}-vs-${b}.json`, { identical: changes.length === 0, changes });
  console.log(changes.length ? `CHANGED (${changes.length}): ${JSON.stringify(changes).slice(0, 2000)}` : `identical: ${a} == ${b}`);
  if (changes.length && !process.argv.includes('--allow-changes')) process.exitCode = 1;
} else throw new Error('usage: snapshot <label> | compare <a> <b>');
