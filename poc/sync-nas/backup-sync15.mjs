// Chat15 local backup of the Nextcloud side and the simulated NAS:
// maintenance mode on → pg_dump Nextcloud DB → archive Nextcloud volume →
// archive NAS volume (the 1 GiB test folders Chat15-big15-* are excluded to keep
// the backup small) → maintenance off (always). Files are 0600 in the
// git-ignored backup/ folder; SHA-256 recorded. The Nextcloud DB/data are only
// read (pg_dump, read-only volume mounts), never written.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { docker, occ, syncRoot, writeEvidence } from './lib.mjs';

const backup = join(syncRoot, 'backup');
await mkdir(backup, { recursive: true, mode: 0o700 });
const ncImage = 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33';
const alpine = 'alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412';
const t0 = Date.now();
await occ('maintenance:mode', '--on');
let maintenanceMs;
try {
  await docker('exec', 'vcworkspace-work13-nc-db-1', 'pg_dump', '-Fc', '-U', 'nextcloud', '-d', 'nextcloud', '-f', '/tmp/sync15-nextcloud.dump');
  await docker('cp', 'vcworkspace-work13-nc-db-1:/tmp/sync15-nextcloud.dump', join(backup, 'nextcloud.dump'));
  await docker('exec', 'vcworkspace-work13-nc-db-1', 'rm', '-f', '/tmp/sync15-nextcloud.dump');
  await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_work13_nextcloud:/source:ro', '-v', `${backup}:/backup`, '--entrypoint', 'tar', ncImage, '-C', '/source', '-czf', '/backup/nextcloud-html.tgz', '.');
  await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_sync15_nas:/source:ro', '-v', `${backup}:/backup`, alpine, 'tar', '-C', '/source', '--exclude=./team-a/Chat15-big15-*', '-czf', '/backup/nas.tgz', '.');
} finally {
  await occ('maintenance:mode', '--off');
  maintenanceMs = Date.now() - t0;
}
const sha = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const files = {};
for (const name of ['nextcloud.dump', 'nextcloud-html.tgz', 'nas.tgz']) {
  const path = join(backup, name);
  await chmod(path, 0o600);
  files[name] = { sha256: await sha(path), bytes: (await stat(path)).size };
}
await writeEvidence('backup.json', { files, maintenanceModeMs: maintenanceMs, mode: '0600', location: 'poc/sync-nas/backup/ (git-ignored)', excluded: ['NAS team-a/Chat15-big15-* (file 1 GiB thử)'], note: 'NAS account DB (Samba passdb) không nằm trong volume: tạo lại từ secrets/ khi container NAS khởi động' });
console.log(JSON.stringify({ files, maintenanceMs }, null, 1));
