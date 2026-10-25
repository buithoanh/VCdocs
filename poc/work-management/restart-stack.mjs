// Restart every chat 13 container and record StartedAt before/after; the ACL
// readback and browser matrix are run separately afterwards.
import { join } from 'node:path';
import { execFileAsync, root, writeEvidence } from './lib.mjs';

const compose = ['compose', '-f', join(root, 'compose.yaml')];
async function startedAt() {
  const { stdout: ids } = await execFileAsync('docker', [...compose, 'ps', '-q']);
  const { stdout } = await execFileAsync('docker', ['inspect', '--format', '{{.Name}} {{.State.StartedAt}} {{.State.Status}}', ...ids.trim().split('\n')]);
  return Object.fromEntries(stdout.trim().split('\n').map((line) => { const [name, at, status] = line.split(' '); return [name.replace(/^\//, ''), { at, status }]; }));
}
const before = await startedAt();
await execFileAsync('docker', [...compose, 'restart'], { maxBuffer: 10 * 1024 * 1024 });
const after = await startedAt();
const notRestarted = Object.keys(before).filter((name) => before[name].at === after[name]?.at || after[name]?.status !== 'running');
if (notRestarted.length) throw new Error(`NOT_RESTARTED:${notRestarted.join(',')}`);
await writeEvidence('restart.json', { containers: Object.keys(after).length, before, after, result: 'all containers restarted and running; see verify-acl-after-restart.json and browser-ui.json' });
console.log(`Restarted ${Object.keys(after).length} containers.`);
