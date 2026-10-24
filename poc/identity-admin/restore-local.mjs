import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { root } from './authentik-api.mjs';

if (process.env.IDENTITY12_RECREATE_RESTORE !== '1') throw new Error('REFUSING_RESTORE_RECREATE_WITHOUT_IDENTITY12_RECREATE_RESTORE_1');
const execFileAsync = promisify(execFile);
const compose = ['compose', '-f', join(root, 'compose.restore.yaml')];
const docker = (...args) => execFileAsync('docker', args, { maxBuffer: 20 * 1024 * 1024 });
await docker(...compose, 'down');
for (const volume of ['vcworkspace_identity12_restore_nc_db_pg18', 'vcworkspace_identity12_restore_ak_db_pg18', 'vcworkspace_identity12_restore_nextcloud']) {
  try { await docker('volume', 'rm', volume); } catch (error) { if (!String(error.stderr).includes('no such volume')) throw error; }
}
await docker('volume', 'create', 'vcworkspace_identity12_restore_nextcloud');
await docker('run', '--rm', '-v', 'vcworkspace_identity12_restore_nextcloud:/target', '-v', `${join(root, 'backup')}:/backup:ro`, '--entrypoint', 'tar', 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33', '-C', '/target', '-xzf', '/backup/nextcloud-html.tgz');
await docker(...compose, 'up', '-d', 'restore-nc-db', 'restore-ak-db', 'restore-redis');
await new Promise((resolve) => setTimeout(resolve, 4000));
for (const [container, user, database, name] of [
  ['vcworkspace-identity12-restore-restore-nc-db-1', 'nextcloud', 'nextcloud', 'nextcloud.dump'],
  ['vcworkspace-identity12-restore-restore-ak-db-1', 'authentik', 'authentik', 'authentik.dump'],
]) {
  await docker('cp', join(root, 'backup', name), `${container}:/tmp/${name}`);
  await docker('exec', container, 'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', '-U', user, '-d', database, `/tmp/${name}`);
}
await docker(...compose, 'up', '-d', 'restore-nextcloud', 'restore-authentik', 'restore-nextcloud-loopback-relay', 'restore-authentik-loopback-relay');
await docker('cp', join(root, 'rebind-restored-nextcloud.php'), 'vcworkspace-identity12-restore-restore-nextcloud-1:/tmp/rebind-restored-nextcloud.php');
await docker('exec', 'vcworkspace-identity12-restore-restore-nextcloud-1', 'php', '/tmp/rebind-restored-nextcloud.php');
console.log('Restore stack recreated from reviewable backups; run verify-restore.mjs and restore ACL test for readback.');
