// Chat17 local backup of Talk data: Talk keeps rooms, attendees, sessions,
// bots and chat messages (oc_comments) in the Nextcloud DB, attachments in
// users' Files (/Talk) and shares in oc_share. Sequence: snapshot state via API
// → maintenance mode on → pg_dump → archive of the Nextcloud volume (read-only
// mount) → maintenance off (always, in finally). Output in git-ignored backup/
// (0600) with SHA-256. The Nextcloud DB/data are only read, never written.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { docker, occ, talkRoot, writeEvidence } from './lib.mjs';

execFileSync('node', ['verify-state.mjs', 'snapshot', 'before-backup'], { cwd: talkRoot, stdio: 'inherit' });
const backup = join(talkRoot, 'backup');
await mkdir(backup, { recursive: true, mode: 0o700 });
const ncImage = 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33';
const t0 = Date.now();
let maintenanceMs;
await occ('maintenance:mode', '--on');
try {
  await docker('exec', 'vcworkspace-work13-nc-db-1', 'pg_dump', '-Fc', '-U', 'nextcloud', '-d', 'nextcloud', '-f', '/tmp/talk17-nextcloud.dump');
  await docker('cp', 'vcworkspace-work13-nc-db-1:/tmp/talk17-nextcloud.dump', join(backup, 'nextcloud.dump'));
  await docker('exec', 'vcworkspace-work13-nc-db-1', 'rm', '-f', '/tmp/talk17-nextcloud.dump');
  await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_work13_nextcloud:/source:ro', '-v', `${backup}:/backup`, '--entrypoint', 'tar', ncImage, '-C', '/source', '-czf', '/backup/nextcloud-html.tgz', '.');
} finally {
  await occ('maintenance:mode', '--off');
  maintenanceMs = Date.now() - t0;
}
const sha = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const files = {};
for (const name of ['nextcloud.dump', 'nextcloud-html.tgz']) {
  const path = join(backup, name);
  await chmod(path, 0o600);
  files[name] = { sha256: await sha(path), bytes: (await stat(path)).size };
}
await writeEvidence('backup.json', { files, maintenanceModeMs: maintenanceMs, mode: '0600', location: 'poc/talk/backup/ (git-ignored)', note: 'Phòng/thành viên/tin nhắn/bot Talk nằm trong DB Nextcloud; tệp đính kèm trong Files (thư mục /Talk) + oc_share' });
console.log(JSON.stringify({ files, maintenanceMs }, null, 1));
