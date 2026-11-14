// Chat07: sao lưu Stalwart. (1) chụp mốc IMAP (băm MIME từng thư) khi live đang chạy,
// (2) DỪNG container chat07 (RocksDB không được chép khi đang chạy), (3) tar hai volume
// ở chế độ chỉ đọc, không mạng, (4) luôn khởi động lại trong finally, (5) SHA-256 các tệp.
// Chạy: node poc/mail-stalwart/run-with-secrets.mjs <file-credential-thử> poc/mail-stalwart/backup-mail07.mjs
import { createReadStream } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { accountsFromEnv, alpine, archives, backupDir, docker, live, snapshotMailboxes, writePrivate } from './mail07-lib.mjs';

const host = process.env.MAIL07_LIVE_HOST || '127.0.0.1';
const port = Number(process.env.MAIL07_LIVE_IMAP_PORT || 18993);
const fileSha = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

const inspect = JSON.parse((await docker('inspect', live.container)).stdout)[0];
if (!inspect.State.Running) throw new Error('LIVE_NOT_RUNNING: cần chạy để chụp mốc IMAP trước khi dừng');
await mkdir(backupDir, { recursive: true, mode: 0o700 });

const reference = await snapshotMailboxes({ host, port, accounts: accountsFromEnv() });
if (reference.messages.length === 0) console.warn('CẢNH BÁO: hộp thư rỗng, diễn tập sẽ không chứng minh được gì (verify sẽ thất bại).');

const t0 = Date.now();
let stoppedMs;
await docker('stop', '-t', '60', live.container);
try {
  for (const [kind, volume] of Object.entries(live.volumes)) {
    await docker('run', '--rm', '--network', 'none', '-v', `${volume}:/source:ro`, '-v', `${backupDir}:/backup`, alpine, 'tar', '-C', '/source', '-czpf', `/backup/mail07-${kind}.tgz`, '.');
  }
} finally {
  await docker('start', live.container);
  stoppedMs = Date.now() - t0;
}

const files = {};
for (const name of archives) {
  const path = join(backupDir, name);
  await chmod(path, 0o600);
  files[name] = { sha256: await fileSha(path), bytes: (await stat(path)).size };
}
await writePrivate(join(backupDir, 'mail07-backup.json'), {
  createdAt: new Date().toISOString(), container: live.container, volumes: live.volumes, image: inspect.Image, imageName: inspect.Config.Image,
  files, containerStoppedMs: stoppedMs, messages: reference.messages.length, mode: '0600',
});
await writePrivate(join(backupDir, 'mail07-reference.json'), { createdAt: new Date().toISOString(), ...reference });
console.log(JSON.stringify({ files, containerStoppedMs: stoppedMs, messages: reference.messages.length }, null, 1));
