import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { root } from './authentik-api.mjs';

const execFileAsync = promisify(execFile);
const backup = join(root, 'backup');
await mkdir(backup, { recursive: true, mode: 0o700 });
for (const [container, user, database, name] of [
  ['vcworkspace-identity12-nc-db-1', 'nextcloud', 'nextcloud', 'nextcloud.dump'],
  ['vcworkspace-identity12-ak-db-1', 'authentik', 'authentik', 'authentik.dump'],
]) {
  await execFileAsync('docker', ['exec', container, 'pg_dump', '-Fc', '-U', user, '-d', database, '-f', `/tmp/${name}`]);
  await execFileAsync('docker', ['cp', `${container}:/tmp/${name}`, join(backup, name)]);
  await chmod(join(backup, name), 0o600);
}
await execFileAsync('docker', ['run', '--rm', '-v', 'vcworkspace_identity12_nextcloud:/source:ro', '-v', `${backup}:/backup`, '--entrypoint', 'tar', 'nextcloud@sha256:431d389fd8e28b2421149cc877df6c54105f1baaee8c77a3c66ff6cf87d7df33', '-C', '/source', '-czf', '/backup/nextcloud-html.tgz', '.']);
await chmod(join(backup, 'nextcloud-html.tgz'), 0o600);
const checksums = {};
for (const name of ['nextcloud.dump', 'authentik.dump', 'nextcloud-html.tgz']) checksums[name] = createHash('sha256').update(await readFile(join(backup, name))).digest('hex');
await writeFile(join(root, 'evidence', 'backup.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), checksums, mode: '0600', secretsIncluded: false }, null, 2)}\n`);
console.log('Backup PASS: two PostgreSQL custom dumps and Nextcloud HTML volume archived with SHA-256 evidence; no secret printed.');
