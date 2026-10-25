// Chat16: build the independent restore stack from backup/ (Nextcloud DB +
// volume, chat16 Stalwart volume). Never touches live volumes: it only creates
// vcworkspace_cal16_restore_* volumes, and only removes those (when re-running)
// if CAL16_RECREATE_RESTORE=1.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { calRoot, docker, secret, sleep } from './lib.mjs';

const restoreVolumes = ['vcworkspace_cal16_restore_nc_db', 'vcworkspace_cal16_restore_nextcloud', 'vcworkspace_cal16_restore_mail'];
if (!restoreVolumes.every((v) => v.startsWith('vcworkspace_cal16_restore_'))) throw new Error('UNEXPECTED_VOLUME_NAME');
const env = { ...process.env, STALWART_RECOVERY_ADMIN: `admin16:${await secret('stalwart_recovery_password')}` };
const compose = (...args) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['compose', '-f', join(calRoot, 'compose.restore.yaml'), ...args], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`COMPOSE_${args.join('_')}:${err.slice(-400)}`))));
});
const existing = (await docker('volume', 'ls', '--format', '{{.Name}}')).stdout.split('\n').filter((v) => restoreVolumes.includes(v));
if (existing.length) {
  if (process.env.CAL16_RECREATE_RESTORE !== '1') throw new Error(`RESTORE_VOLUMES_EXIST:${existing.join(',')} (set CAL16_RECREATE_RESTORE=1 to recreate)`);
  await compose('down');
  for (const volume of existing) await docker('volume', 'rm', volume);
}
const ncImage = 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33';
const alpine = 'alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412';
const backup = join(calRoot, 'backup');
for (const volume of restoreVolumes) await docker('volume', 'create', volume);
await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_cal16_restore_nextcloud:/target', '-v', `${backup}:/backup:ro`, '--entrypoint', 'tar', ncImage, '-C', '/target', '-xzf', '/backup/nextcloud-html.tgz');
await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_cal16_restore_mail:/target', '-v', `${backup}:/backup:ro`, alpine, 'tar', '-C', '/target', '-xzpf', '/backup/mail16.tgz');
await compose('up', '-d', 'restore-nc-db', 'restore-redis', 'restore-mail16', 'restore-mail-relay');
const db = 'vcworkspace-cal16-restore-restore-nc-db-1';
for (let attempt = 0; ; attempt += 1) {
  try { await docker('exec', db, 'pg_isready', '-U', 'nextcloud', '-d', 'nextcloud'); break; } catch (error) {
    if (attempt > 30) throw error;
    await sleep(1000);
  }
}
// The Nextcloud DB role (dbuser in config.php) is a cluster object, not in pg_dump.
const { stdout: credentials } = await docker('run', '--rm', '--network', 'none', '-v', 'vcworkspace_cal16_restore_nextcloud:/t:ro', '--entrypoint', 'php', ncImage,
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
await docker('cp', join(backup, 'nextcloud.dump'), `${db}:/tmp/nextcloud.dump`);
await docker('exec', db, 'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl', `--role=${dbUser}`, '-U', 'nextcloud', '-d', 'nextcloud', '/tmp/nextcloud.dump');
await docker('exec', db, 'rm', '-f', '/tmp/nextcloud.dump');
await compose('up', '-d', 'restore-nextcloud', 'restore-relay');
const nc = 'vcworkspace-cal16-restore-restore-nextcloud-1';
for (let attempt = 0; ; attempt += 1) {
  try { await docker('exec', '-u', 'www-data', nc, 'php', 'occ', '--no-interaction', 'maintenance:mode', '--off'); break; } catch (error) {
    if (attempt > 60) throw error;
    await sleep(2000);
  }
}
console.log('Restore stack ready on 127.0.0.1:18163 (Nextcloud) and 127.0.0.1:18164 (Stalwart); run verify-acl.mjs restore + verify-restore-cal16.mjs.');
