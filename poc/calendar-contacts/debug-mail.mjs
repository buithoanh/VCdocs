// Chat16 debug: show the newest messages of one local test mailbox (subject,
// links to our own Nextcloud, calendar METHOD). `node debug-mail.mjs <address> [n]`.
import { listMessages } from './mail-lib.mjs';
import { lines } from './dav-lib.mjs';

const [address, n = '3'] = process.argv.slice(2);
for (const m of (await listMessages(address)).slice(0, Number(n))) {
  console.log('---', m.receivedAt, m.subject, JSON.stringify(m.from), lines(m.calendar ?? '', 'METHOD'));
  console.log((m.text.match(/https?:\/\/\S+/g) ?? []).slice(0, 6).join('\n'));
  if (process.env.SHOW_TEXT) console.log(m.text.slice(0, 3000));
}
