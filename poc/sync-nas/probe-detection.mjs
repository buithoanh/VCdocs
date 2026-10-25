// Chat15: when does Nextcloud see a change made directly on the NAS?
// Team A mount (filesystem_check_changes = once per access), four cases:
//   notify on/off × change via SMB client (user) / on the NAS filesystem (NAS job)
// For each new file: time until it shows in a WebDAV Depth:1 listing (what web
// UI and sync clients see), with a 15 s cap; on timeout we try direct access to
// the file path (Depth:0) and finally `occ files:scan` for the folder.
import { client, davPath, docker, nasContainer, notifyContainer, occ, propfind, resetBruteforce, sleep, smb, smbClientContainer, stats, waitUntil, writeEvidence } from './lib.mjs';

await resetBruteforce();
const m = `det15-${Date.now()}`;
const member = await client('member-a');
const dir = `Chat15-${m}`;
const mk = await member.request('MKCOL', davPath(member, `NAS-TeamA/${dir}`));
if (mk.status !== 201) throw new Error(`MKCOL ${mk.status}`);
const names = async () => (await propfind(member, `NAS-TeamA/${dir}`, '1')).entries.slice(1).map((e) => e.path.split('/').filter(Boolean).at(-1));
const n = Number(process.env.SYNC15_DETECT_N || 6);

async function oneCase(label, write) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const name = `${label}-${i}.bin`;
    await write(name, i);
    const seen = await waitUntil(label, async () => (await names()).includes(name), { timeoutMs: 15_000, intervalMs: 100 });
    const row = { visibleMs: seen.ms };
    if (seen.ms === null) {
      row.directAccessStatus = (await propfind(member, `NAS-TeamA/${dir}/${name}`, '0')).status;
      row.listedAfterDirectAccess = (await names()).includes(name);
      if (!row.listedAfterDirectAccess) {
        const t0 = Date.now();
        await occ('files:scan', `--path=/${member.uid}/files/NAS-TeamA/${dir}`);
        row.scanMs = Date.now() - t0;
        row.listedAfterScan = (await names()).includes(name);
      }
    }
    rows.push(row);
    await sleep(1200);
  }
  const ok = rows.map((r) => r.visibleMs).filter((v) => v !== null);
  return { n, visibleWithin15s: ok.length, visibleMs: stats(ok), rows };
}
const viaSmb = async (name, i) => {
  await docker('exec', smbClientContainer, 'dd', 'if=/dev/urandom', `of=/work/p${i}`, 'bs=1024', 'count=4', 'status=none');
  await smb('nas-member-a', 'team-a', `cd ${dir}; put /work/p${i} ${name}`);
};
const viaNasFs = async (name) => {
  await docker('exec', '-u', 'nas-member-a', nasContainer, 'dd', 'if=/dev/urandom', `of=/srv/nas/team-a/${dir}/${name}`, 'bs=1024', 'count=4', 'status=none');
};

// Burst: ghi file 1 → listing (Nextcloud lưu mtime thư mục, độ phân giải giây) → ghi
// file 2 ngay trong cùng giây. Kiểm thay đổi khi truy cập so mtime thư mục > mtime đã lưu,
// nên file 2 có thể không bao giờ hiện nếu không có notify/scan.
async function burstCase(label, write) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    // bắt đầu ngay sau đầu một giây để hai lần ghi chắc chắn cùng giây
    await sleep(1000 - (Date.now() % 1000) + 20);
    const first = `${label}-${i}-a.bin`;
    const second = `${label}-${i}-b.bin`;
    await write(first, i);
    const listedFirst = (await names()).includes(first);
    await write(second, i + 100);
    const sameSecondMs = Date.now() % 1000;
    const seen = await waitUntil(label, async () => (await names()).includes(second), { timeoutMs: 15_000, intervalMs: 200 });
    const row = { listedFirst, secondWrittenAtMsOfSecond: sameSecondMs, secondVisibleMs: seen.ms };
    if (seen.ms === null) {
      row.directAccessStatus = (await propfind(member, `NAS-TeamA/${dir}/${second}`, '0')).status;
      row.listedAfterDirectAccess = (await names()).includes(second);
      const t0 = Date.now();
      await occ('files:scan', `--path=/${member.uid}/files/NAS-TeamA/${dir}`);
      row.scanMs = Date.now() - t0;
      row.listedAfterScan = (await names()).includes(second);
    }
    rows.push(row);
  }
  return { n: rows.length, secondVisibleWithin15s: rows.filter((r) => r.secondVisibleMs !== null).length, rows };
}

const results = {};
results.notifyOn_smbClient = await oneCase('on-smb', viaSmb);
results.notifyOn_nasFilesystem = await oneCase('on-fs', viaNasFs);
results.burst_notifyOn_smbClient = await burstCase('bon-smb', viaSmb);
results.burst_notifyOn_nasFilesystem = await burstCase('bon-fs', viaNasFs);
await docker('stop', notifyContainer);
try {
  results.notifyOff_smbClient = await oneCase('off-smb', viaSmb);
  results.notifyOff_nasFilesystem = await oneCase('off-fs', viaNasFs);
  results.burst_notifyOff_smbClient = await burstCase('boff-smb', viaSmb);
  results.burst_notifyOff_nasFilesystem = await burstCase('boff-fs', viaNasFs);
} finally {
  await docker('start', notifyContainer);
}
const notifyLog = (await docker('logs', '--since', '10m', notifyContainer)).stdout + (await docker('logs', '--since', '10m', notifyContainer)).stderr;
const notifySawFs = notifyLog.includes('on-fs-');
await writeEvidence('probe-detection.json', {
  marker: m,
  mount: 'NAS-TeamA (filesystem_check_changes=1)',
  results,
  notifyListenerSawNasFilesystemWrites: notifySawFs,
  result: 'LOCAL (đo đạc)',
});
console.log(JSON.stringify({ results, notifySawFs }, null, 1));
