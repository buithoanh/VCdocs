// Chat16 debug: click the newest accept link of partner@partner.test with
// Nextcloud loglevel temporarily at 0 (restored in finally) and print the log
// lines written during that request. Optional arg "nogroup" also turns off
// shareapi_only_share_with_group_members for the click (restored in finally).
import { execFileAsync, ncBase, ncContainer, occ, sleep } from './lib.mjs';
import { listMessages } from './mail-lib.mjs';

const message = (await listMessages('partner@partner.test')).find((m) => /accept\//.test(m.text));
const link = new URL((/https?:\/\/[^\s"'<>]*\/apps\/dav\/invitation\/accept\/[A-Za-z0-9]+/.exec(message.text) ?? [])[0]);
const before = Number((await execFileAsync('docker', ['exec', ncContainer, 'wc', '-l', '/var/www/html/data/nextcloud.log'])).stdout.trim().split(' ')[0]);
const level = (await occ('config:system:get', 'loglevel').catch(() => ({ stdout: '' }))).stdout.trim();
await occ('config:system:set', 'loglevel', '--type=integer', '--value=0');
if (process.argv[2] === 'nogroup') await occ('config:app:set', 'core', 'shareapi_only_share_with_group_members', '--value=no');
try {
  const response = await fetch(`${ncBase}${link.pathname}`);
  const page = await response.text();
  console.log('subject', message.subject, 'status', response.status, /error/i.test(page) ? 'ERROR PAGE' : 'ok page');
  await sleep(500);
} finally {
  if (level) await occ('config:system:set', 'loglevel', '--type=integer', `--value=${level}`); else await occ('config:system:delete', 'loglevel');
  await occ('config:app:set', 'core', 'shareapi_only_share_with_group_members', '--value=yes');
}
const { stdout } = await execFileAsync('docker', ['exec', ncContainer, 'tail', '-n', '+' + (before + 1), '/var/www/html/data/nextcloud.log'], { maxBuffer: 20 * 1024 * 1024 });
for (const line of stdout.split('\n')) {
  try { const e = JSON.parse(line); if (/invitation/.test(e.url ?? '')) console.log(e.level, e.app, e.message?.slice(0, 300), e.exception?.Message?.slice(0, 200) ?? ''); } catch { /* skip */ }
}
