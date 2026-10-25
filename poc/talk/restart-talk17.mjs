// Chat17 restart: snapshot Talk state, `docker restart` the work13 Nextcloud and
// its Redis (volumes untouched), wait for status.php, snapshot again, compare,
// and check that a chat message posted right after restart arrives.
// Afterwards run `node verify-acl.mjs after-restart`.
import { execFileSync } from 'node:child_process';
import { client, docker, ncBase, ocsData, readEvidence, sleep, talk, talkRoot, writeEvidence } from './lib.mjs';

const step = (...args) => execFileSync('node', args, { cwd: talkRoot, stdio: 'inherit' });
step('verify-state.mjs', 'snapshot', 'before-restart');
const containers = ['vcworkspace-work13-redis-1', 'vcworkspace-work13-nextcloud-1'];
const t0 = Date.now();
await docker('restart', ...containers);
let readyMs = null;
for (;;) {
  try {
    const r = await fetch(`${ncBase}/status.php`, { signal: AbortSignal.timeout(3000) });
    if (r.ok && (await r.json()).maintenance === false) { readyMs = Date.now() - t0; break; }
  } catch { /* not yet */ }
  if (Date.now() - t0 > 180000) throw new Error('NOT_READY');
  await sleep(250);
}
// First Talk API answer after restart.
const conv = await readEvidence('conversations.json');
const member = await client('member-a');
let firstTalkOkMs = null;
for (;;) {
  const r = await member.request('GET', talk.room()).catch(() => ({ status: 0 }));
  if (r.status === 200) { firstTalkOkMs = Date.now() - t0; break; }
  await sleep(250);
}
step('verify-state.mjs', 'snapshot', 'after-restart');
step('verify-state.mjs', 'compare', 'before-restart', 'after-restart');
const post = await member.request('POST', talk.chat(conv.teamA.token), { json: { message: `sau restart ${Date.now().toString(36)}` } });
const owner = await client('successor-a');
const seen = (ocsData(await owner.request('GET', `${talk.chat(conv.teamA.token)}?lookIntoFuture=0&limit=5&setReadMarker=0`)) ?? []).some((m) => m.id === ocsData(post).id);
await writeEvidence('restart.json', { containers, nextcloudReadyMs: readyMs, firstTalkApi200Ms: firstTalkOkMs, stateIdentical: true, postAfterRestart: post.status, ownerSeesIt: seen, note: 'Sau restart chạy verify-acl.mjs after-restart' });
console.log(JSON.stringify({ readyMs, firstTalkOkMs, post: post.status, seen }));
