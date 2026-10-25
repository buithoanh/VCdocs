// Consistent local backup: Nextcloud maintenance mode on, PostgreSQL custom
// dump of Nextcloud + Authentik, archive of the Nextcloud HTML/data volume,
// maintenance off (always). Files are 0600 in the git-ignored backup/ folder.
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileAsync, occ, root, writeEvidence } from './lib.mjs';

const backup = join(root, 'backup');
await mkdir(backup, { recursive: true, mode: 0o700 });
const docker = (...args) => execFileAsync('docker', args, { maxBuffer: 20 * 1024 * 1024 });
await occ('maintenance:mode', '--on');
try {
  for (const [container, user, database, name] of [
    ['vcworkspace-work13-nc-db-1', 'nextcloud', 'nextcloud', 'nextcloud.dump'],
    ['vcworkspace-work13-ak-db-1', 'authentik', 'authentik', 'authentik.dump'],
  ]) {
    await docker('exec', container, 'pg_dump', '-Fc', '-U', user, '-d', database, '-f', `/tmp/${name}`);
    await docker('cp', `${container}:/tmp/${name}`, join(backup, name));
    await docker('exec', container, 'rm', '-f', `/tmp/${name}`);
    await chmod(join(backup, name), 0o600);
  }
  await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_work13_nextcloud:/source:ro', '-v', `${backup}:/backup`, '--entrypoint', 'tar',
    'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33', '-C', '/source', '-czf', '/backup/nextcloud-html.tgz', '.');
  await chmod(join(backup, 'nextcloud-html.tgz'), 0o600);
} finally {
  await occ('maintenance:mode', '--off');
}
const checksums = {};
for (const name of ['nextcloud.dump', 'authentik.dump', 'nextcloud-html.tgz']) checksums[name] = createHash('sha256').update(await readFile(join(backup, name))).digest('hex');
await writeEvidence('backup.json', { checksums, mode: '0600', maintenanceModeDuringBackup: true, location: 'poc/work-management/backup/ (git-ignored)' });
console.log('Backup PASS: Nextcloud + Authentik dumps and Nextcloud volume archived under maintenance mode; SHA-256 recorded.');
