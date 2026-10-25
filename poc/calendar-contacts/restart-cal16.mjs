// Chat16 restart: `docker restart` the work13 Nextcloud, its Redis and the chat16
// Stalwart (volumes untouched), wait until both answer again, and compare the
// local mailbox message counts before/after (mail persisted). Afterwards run
// `node verify-acl.mjs after-restart` (and the acceptance scripts if wanted).
import { docker, ncBase, sleep, writeEvidence } from './lib.mjs';
import { listMessages, mailBase } from './mail-lib.mjs';

const boxes = ['partner@partner.test', 'manager-b@team-b.test', 'member-a@team-a.test'];
const count = async () => Object.fromEntries(await Promise.all(boxes.map(async (b) => [b, (await listMessages(b, { limit: 500 })).length])));
const before = await count();
const containers = ['vcworkspace-work13-redis-1', 'vcworkspace-work13-nextcloud-1', 'vcworkspace-cal16-mail16-1'];
const t0 = Date.now();
await docker('restart', ...containers);
const ready = {};
for (const [name, url] of [['nextcloud', `${ncBase}/status.php`], ['stalwart', `${mailBase}/healthz/live`]]) {
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok && (name !== 'nextcloud' || (await r.json()).maintenance === false)) { ready[name] = Date.now() - t0; break; }
    } catch { /* not yet */ }
    if (Date.now() - t0 > 180000) throw new Error(`NOT_READY:${name}`);
    await sleep(500);
  }
}
const after = await count();
await writeEvidence('restart.json', { containers, readyAfterMs: ready, mailboxCountsBefore: before, mailboxCountsAfter: after, mailPersisted: JSON.stringify(before) === JSON.stringify(after) });
console.log(JSON.stringify({ ready, before, after }));
