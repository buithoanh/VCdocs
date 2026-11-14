// Chat07: kiểm chứng khôi phục. Đọc lại mọi thư qua IMAP trên bản khôi phục (127.0.0.1:18994),
// so hash MIME với mốc `backup/mail07-reference.json` (chụp lúc sao lưu), kiểm cô lập mạng.
// Thoát mã 1 nếu có lệch/thiếu/thừa, hộp thư rỗng, hoặc cô lập mạng sai.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountsFromEnv, backupDir, compareManifests, docker, formatTable, live, restoreNetwork, restoreProject, restoreVolumes, sleep, snapshotMailboxes, writePrivate } from './mail07-lib.mjs';

const host = process.env.MAIL07_RESTORE_HOST || '127.0.0.1';
const port = Number(process.env.MAIL07_RESTORE_IMAP_PORT || 18994);
const reference = JSON.parse(await readFile(join(backupDir, 'mail07-reference.json'), 'utf8'));
const accounts = accountsFromEnv();

let restored;
for (let attempt = 0; ; attempt += 1) {
  try { restored = await snapshotMailboxes({ host, port, accounts }); break; } catch (error) {
    if (attempt >= 30) throw error;
    await sleep(2000);
  }
}
const result = compareManifests(reference, restored);
console.log(formatTable(result.rows));

const checks = [];
const net = JSON.parse((await docker('network', 'inspect', restoreNetwork)).stdout)[0];
checks.push(['mạng restore_internal có Internal=true', net.Internal === true]);
const mailId = `${restoreProject}-restore-mail-1`;
const mail = JSON.parse((await docker('inspect', mailId)).stdout)[0];
checks.push(['Stalwart khôi phục không publish cổng', Object.values(mail.NetworkSettings.Ports ?? {}).every((v) => !v)]);
checks.push(['Stalwart khôi phục chỉ nối mạng internal', Object.keys(mail.NetworkSettings.Networks).join() === restoreNetwork]);
const used = mail.Mounts.map((m) => m.Name);
checks.push(['dùng volume khôi phục, không dùng volume gốc', used.every((n) => Object.values(restoreVolumes).includes(n)) && used.every((n) => !Object.values(live.volumes).includes(n))]);
const relay = JSON.parse((await docker('inspect', `${restoreProject}-restore-relay-1`)).stdout)[0];
const binds = Object.values(relay.NetworkSettings.Ports ?? {}).flat().filter(Boolean);
checks.push(['relay chỉ bind 127.0.0.1', binds.length > 0 && binds.every((b) => b.HostIp === '127.0.0.1')]);
checks.push(['mốc có ít nhất 1 thư', !result.empty]);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
for (const p of result.problems.slice(0, 20)) console.log(`  - ${p}`);

const ok = result.ok && checks.every(([, passed]) => passed);
await writePrivate(join(backupDir, 'mail07-verify-restore.json'), { verifiedAt: new Date().toISOString(), ok, rows: result.rows, problems: result.problems, checks: Object.fromEntries(checks) });
console.log(ok ? 'KẾT QUẢ: PASS — hash MIME bản khôi phục khớp bản gốc' : 'KẾT QUẢ: FAIL');
process.exit(ok ? 0 : 1);
