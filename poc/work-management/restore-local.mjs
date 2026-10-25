// Recreate the chat 13 restore stack from backup/. Refuses unless
// WORK13_RECREATE_RESTORE=1, and only ever removes the two restore volumes.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { execFileAsync, root } from './lib.mjs';

if (process.env.WORK13_RECREATE_RESTORE !== '1') throw new Error('REFUSING_RESTORE_WITHOUT_WORK13_RECREATE_RESTORE_1');
const docker = (...args) => execFileAsync('docker', args, { maxBuffer: 20 * 1024 * 1024 });
const compose = ['compose', '-f', join(root, 'compose.restore.yaml')];
const restoreVolumes = ['vcworkspace_work13_restore_nc_db_pg18', 'vcworkspace_work13_restore_nextcloud'];
await docker(...compose, 'down');
for (const volume of restoreVolumes) {
  try { await docker('volume', 'rm', volume); } catch (error) { if (!String(error.stderr).includes('no such volume')) throw error; }
}
await docker('volume', 'create', 'vcworkspace_work13_restore_nextcloud');
await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_work13_restore_nextcloud:/target', '-v', `${join(root, 'backup')}:/backup:ro`, '--entrypoint', 'tar',
  'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33', '-C', '/target', '-xzf', '/backup/nextcloud-html.tgz');
await docker(...compose, 'up', '-d', 'restore-nc-db', 'restore-redis');
const db = 'vcworkspace-work13-restore-restore-nc-db-1';
for (let attempt = 0; ; attempt += 1) {
  try { await docker('exec', db, 'pg_isready', '-U', 'nextcloud', '-d', 'nextcloud'); break; } catch (error) {
    if (attempt > 30) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
// The Nextcloud installer created its own DB role (dbuser/dbpassword in the
// archived config.php). Roles are cluster objects outside pg_dump, so recreate
// it from the restored config without printing the value, then restore with
// that role as owner.
const image = 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33';
const { stdout: credentials } = await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_work13_restore_nextcloud:/t:ro', '--entrypoint', 'php', image,
  '-r', 'include "/t/config/config.php"; echo json_encode([$CONFIG["dbuser"], $CONFIG["dbpassword"]]);');
const [dbUser, dbPassword] = JSON.parse(credentials);
if (!/^[a-z_][a-z0-9_]*$/.test(dbUser)) throw new Error('UNEXPECTED_DB_ROLE_NAME');
const quoted = `'${dbPassword.replaceAll("'", "''")}'`;
await new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', db, 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', 'nextcloud', '-d', 'nextcloud'], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`CREATE_DB_ROLE_FAILED:${stderr.replaceAll(dbPassword, '***')}`))));
  child.stdin.end(`CREATE ROLE ${dbUser} LOGIN PASSWORD ${quoted};\nGRANT ALL PRIVILEGES ON DATABASE nextcloud TO ${dbUser};\nALTER SCHEMA public OWNER TO ${dbUser};\n`);
});
await docker('cp', join(root, 'backup', 'nextcloud.dump'), `${db}:/tmp/nextcloud.dump`);
await docker('exec', db, 'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', `--role=${dbUser}`, '-U', 'nextcloud', '-d', 'nextcloud', '/tmp/nextcloud.dump');
await docker('exec', db, 'rm', '-f', '/tmp/nextcloud.dump');
await docker(...compose, 'up', '-d', 'restore-nextcloud', 'restore-nextcloud-loopback-relay');
// The archive was taken in maintenance mode; leave it only after the DB is back.
const nc = 'vcworkspace-work13-restore-restore-nextcloud-1';
for (let attempt = 0; ; attempt += 1) {
  try { await docker('exec', '-u', 'www-data', nc, 'php', 'occ', '--no-interaction', 'maintenance:mode', '--off'); break; } catch (error) {
    if (attempt > 60) throw error;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
console.log('Restore stack recreated on 127.0.0.1:18133; run verify-acl.mjs against it for readback.');
