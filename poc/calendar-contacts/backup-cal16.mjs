// Chat16 local backup: Nextcloud maintenance mode on → pg_dump of the Nextcloud
// DB (calendars, address books, shares, tokens, room/resource tables) → archive
// of the Nextcloud volume (read-only mount) → chat16 Stalwart stopped briefly and
// its volume archived (RocksDB is not copied while running) → everything back on
// (always, in finally). Output in git-ignored backup/ (0600) with SHA-256.
// The Nextcloud DB/data are only read, never written.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { calRoot, docker, occ, writeEvidence } from './lib.mjs';

const backup = join(calRoot, 'backup');
await mkdir(backup, { recursive: true, mode: 0o700 });
const ncImage = 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33';
const alpine = 'alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412';
const t0 = Date.now();
let maintenanceMs;
let mailStoppedMs;
await occ('maintenance:mode', '--on');
try {
  await docker('exec', 'vcworkspace-work13-nc-db-1', 'pg_dump', '-Fc', '-U', 'nextcloud', '-d', 'nextcloud', '-f', '/tmp/cal16-nextcloud.dump');
  await docker('cp', 'vcworkspace-work13-nc-db-1:/tmp/cal16-nextcloud.dump', join(backup, 'nextcloud.dump'));
  await docker('exec', 'vcworkspace-work13-nc-db-1', 'rm', '-f', '/tmp/cal16-nextcloud.dump');
  await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_work13_nextcloud:/source:ro', '-v', `${backup}:/backup`, '--entrypoint', 'tar', ncImage, '-C', '/source', '-czf', '/backup/nextcloud-html.tgz', '.');
  const m0 = Date.now();
  await docker('stop', 'vcworkspace-cal16-mail16-1');
  try {
    await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_cal16_mail_data:/source:ro', '-v', `${backup}:/backup`, alpine, 'tar', '-C', '/source', '-czpf', '/backup/mail16.tgz', '.');
  } finally {
    await docker('start', 'vcworkspace-cal16-mail16-1');
    mailStoppedMs = Date.now() - m0;
  }
} finally {
  await occ('maintenance:mode', '--off');
  maintenanceMs = Date.now() - t0;
}
const sha = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const files = {};
for (const name of ['nextcloud.dump', 'nextcloud-html.tgz', 'mail16.tgz']) {
  const path = join(backup, name);
  await chmod(path, 0o600);
  files[name] = { sha256: await sha(path), bytes: (await stat(path)).size };
}
await writeEvidence('backup.json', { files, maintenanceModeMs: maintenanceMs, mailStoppedMs, mode: '0600', location: 'poc/calendar-contacts/backup/ (git-ignored)', note: 'Lịch/danh bạ/share/token/phòng nằm trong DB Nextcloud; thư iMIP nằm trong volume Stalwart chat16' });
console.log(JSON.stringify({ files, maintenanceMs, mailStoppedMs }, null, 1));
