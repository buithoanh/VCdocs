// Chat07: khôi phục sang VOLUME MỚI (vcworkspace_mail07_restore_*), không chạm volume gốc.
// Kiểm SHA-256 tệp lưu trữ trước; nếu volume khôi phục đã có thì cần MAIL07_RECREATE_RESTORE=1
// (chỉ xoá đúng hai volume mail07). Sau đó dựng Stalwart khôi phục trên mạng internal.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { alpine, assertOwnResource, backupDir, docker, restoreProject, restoreVolumes, root } from './mail07-lib.mjs';

const fileSha = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const manifest = JSON.parse(await readFile(join(backupDir, 'mail07-backup.json'), 'utf8'));
for (const [name, meta] of Object.entries(manifest.files)) {
  if (await fileSha(join(backupDir, name)) !== meta.sha256) throw new Error(`ARCHIVE_HASH_MISMATCH:${name}`);
}
const volumes = Object.values(restoreVolumes).map(assertOwnResource);
const recovery = process.env.STALWART_RECOVERY_ADMIN;
if (!recovery) throw new Error('Thiếu STALWART_RECOVERY_ADMIN: chạy qua run-with-secrets.mjs');
const env = { ...process.env, STALWART_RECOVERY_ADMIN: recovery, MAIL07_STALWART_IMAGE: process.env.MAIL07_STALWART_IMAGE || manifest.image };
const compose = (...args) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['compose', '-f', join(root, 'compose.restore.yaml'), ...args], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`COMPOSE_${args.join('_')}:${err.slice(-400)}`))));
});
const existing = (await docker('volume', 'ls', '--format', '{{.Name}}')).stdout.split('\n').filter((v) => volumes.includes(v));
if (existing.length) {
  if (process.env.MAIL07_RECREATE_RESTORE !== '1') throw new Error(`RESTORE_VOLUMES_EXIST:${existing.join(',')} (đặt MAIL07_RECREATE_RESTORE=1 để dựng lại)`);
  await compose('down');
  for (const v of existing) await docker('volume', 'rm', assertOwnResource(v));
}
for (const v of volumes) await docker('volume', 'create', v);
for (const kind of ['etc', 'data']) {
  await docker('run', '--rm', '--network', 'none', '-v', `${restoreVolumes[kind]}:/target`, '-v', `${backupDir}:/backup:ro`, alpine, 'tar', '-C', '/target', '-xzpf', `/backup/mail07-${kind}.tgz`);
}
await compose('up', '-d', 'restore-mail', 'restore-relay');
console.log('Stalwart khôi phục đã dựng (mạng internal); IMAPS tại 127.0.0.1:18994. Chạy tiếp verify-restore-mail07.mjs.');
