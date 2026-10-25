// Chat15: cost of a full `occ files:scan` of each SMB mount (what a periodic
// scan job would pay when notify is not available), plus file/folder counts.
import { client, nasExec, occ, writeEvidence } from './lib.mjs';

const out = {};
for (const [mount, persona, share] of [['NAS-TeamA', 'member-a', 'team-a'], ['NAS-TeamB', 'manager-b', 'team-b']]) {
  const actor = await client(persona);
  const files = (await nasExec('find', `/srv/nas/${share}`, '-type', 'f')).stdout.split('\n').filter(Boolean).length;
  const dirs = (await nasExec('find', `/srv/nas/${share}`, '-type', 'd')).stdout.split('\n').filter(Boolean).length;
  const bytes = Number((await nasExec('du', '-sk', `/srv/nas/${share}`)).stdout.split(/\s+/)[0]) * 1024;
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const { stdout } = await occ('files:scan', `--path=/${actor.uid}/files/${mount}`);
    runs.push({ ms: Date.now() - t0, summary: stdout.split('\n').filter((l) => /Folders|^\|\s*\d/.test(l)).map((l) => l.replace(/\s+/g, ' ').trim()).slice(0, 4) });
  }
  out[mount] = { nasFiles: files, nasDirs: dirs, nasBytes: bytes, scans: runs };
}
await writeEvidence('measure-scan.json', { mounts: out, note: 'Một máy dev, NAS container cùng máy; không dùng cho sizing NAS thật' });
console.log(JSON.stringify(out, null, 1));
