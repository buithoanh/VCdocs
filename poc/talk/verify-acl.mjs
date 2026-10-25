// Chat17 deny matrix over the Talk OCS API (what the web UI, mobile apps and
// any script can call). For each conversation (Team A group room, Team A 1-1,
// Team B group room) every non-member (other team, outsider, anonymous) probes
// read / post / join / call / participant list / shared files / signaling /
// moderation endpoints. Fixture state (message ids, participants) must be
// unchanged afterwards; positive controls by members must pass.
// Usage: node verify-acl.mjs live|after-restart|restore  (restore: TALK17_NC_BASE)
import { anonymous, assert, client, ocsData, readEvidence, resetBruteforce, talk, writeEvidence } from './lib.mjs';

const mode = process.argv[2] ?? 'live';
const conv = await readEvidence('conversations.json');
const actors = Object.fromEntries(await Promise.all(['successor-a', 'member-a', 'manager-b', 'member-b', 'outsider'].map(async (n) => [n, await client(n)])));
const anon = anonymous();
await resetBruteforce();

const targets = [
  { name: 'teamA', token: conv.teamA.token, members: ['successor-a', 'member-a'], intruders: ['manager-b', 'member-b', 'outsider', 'anonymous'] },
  { name: 'oneToOneA', token: conv.oneToOneA.token, members: ['member-a', 'successor-a'], intruders: ['manager-b', 'outsider', 'anonymous'] },
  { name: 'teamB', token: conv.teamB.token, members: ['manager-b', 'member-b'], intruders: ['successor-a', 'member-a', 'outsider', 'anonymous'] },
];

const probes = (token) => [
  ['GET room', 'GET', talk.room(`/${token}`)],
  ['GET participants', 'GET', talk.room(`/${token}/participants`)],
  ['GET chat', 'GET', `${talk.chat(token)}?lookIntoFuture=0&limit=10&setReadMarker=0`],
  ['GET chat context', 'GET', `${talk.chat(token)}/1/context?limit=5`],
  ['POST chat', 'POST', talk.chat(token), { message: 'intruder' }],
  ['POST reaction', 'POST', `/ocs/v2.php/apps/spreed/api/v1/reaction/${token}/1`, { reaction: '👍' }],
  ['GET shared items', 'GET', `${talk.chat(token)}/share?objectType=file&limit=10`],
  ['GET shared overview', 'GET', `${talk.chat(token)}/share/overview?limit=5`],
  ['GET mentions', 'GET', `${talk.chat(token)}/mentions?search=a&limit=5`],
  ['POST share file into room', 'POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', { shareType: 10, shareWith: token, path: '/' }],
  ['POST join room (active)', 'POST', talk.room(`/${token}/participants/active`), { force: true }],
  ['POST join call', 'POST', talk.call(token), { flags: 3 }],
  ['GET call peers', 'GET', talk.call(token)],
  ['GET signaling settings', 'GET', talk.signaling(`/settings?token=${token}`)],
  ['POST signaling message', 'POST', talk.signaling(`/${token}`), { messages: JSON.stringify([{ ev: 'message', data: { to: 'x', type: 'offer', payload: {} } }]) }],
  ['GET signaling pull', 'GET', talk.signaling(`/${token}`)],
  ['POST add self', 'POST', talk.room(`/${token}/participants`), { newParticipant: 'SELF', source: 'users' }],
  ['POST make public', 'POST', talk.room(`/${token}/public`), { password: 'Intruder-Passw0rd-17' }],
  ['PUT rename', 'PUT', talk.room(`/${token}`), { roomName: 'hacked' }],
  ['PUT lobby off', 'PUT', `/ocs/v2.php/apps/spreed/api/v4/room/${token}/webinar/lobby`, { state: 0 }],
  ['POST pin', 'POST', `${talk.chat(token)}/1/pin`, {}],
  ['DELETE room', 'DELETE', talk.room(`/${token}`)],
  ['GET avatar', 'GET', `/ocs/v2.php/apps/spreed/api/v1/room/${token}/avatar`],
  ['GET public page /call', 'GET', `/call/${token}`],
];

const snapshot = async () => {
  const out = {};
  for (const t of targets) {
    const owner = actors[t.members[0]];
    const msgs = ocsData(await owner.request('GET', `${talk.chat(t.token)}?lookIntoFuture=0&limit=200&setReadMarker=0`)) ?? [];
    const parts = ocsData(await owner.request('GET', talk.room(`/${t.token}/participants`))) ?? [];
    const room = ocsData(await owner.request('GET', talk.room(`/${t.token}`)));
    out[t.name] = { lastMessageId: msgs[0]?.id ?? null, participants: parts.map((p) => `${p.actorType}:${p.actorId}:${p.participantType}`).sort(), name: room?.name, type: room?.type, lobby: room?.lobbyState, hasPassword: room?.hasPassword };
  }
  return out;
};

const before = await snapshot();
const results = [];
let pass = 0;
for (const t of targets) {
  for (const who of t.intruders) {
    const actor = who === 'anonymous' ? anon : actors[who];
    // Talk throttles failed room-token lookups per IP (429, brute-force
    // action talkRoomToken); everything comes from the single relay IP, so
    // reset per intruder block. Protection stays enabled.
    await resetBruteforce();
    for (const [label, method, path, body] of probes(t.token)) {
      const json = body && JSON.parse(JSON.stringify(body).replace('"SELF"', JSON.stringify(actor.uid ?? 'x')));
      const res = await actor.request(method, path, { json, timeoutMs: 8000 }).catch((e) => ({ status: `ERR:${e.name}` }));
      const loc = res.headers?.get?.('location') ?? null;
      // Allowed outcomes: 401/403/404 (and for the public /call page, a redirect to login or a 404 page).
      const status = res.status;
      let ok = [401, 403, 404].includes(status);
      let note;
      if (label === 'GET public page /call') {
        // Logged-in non-member gets the generic Talk app shell (the SPA then
        // reports "conversation not found"); it must not embed room data.
        const leak = [conv.teamA.name, conv.teamB.name, ...Object.values(actors).map((a) => a.uid).filter((uid) => uid !== actor.uid)].filter((s) => (res.text ?? '').includes(s));
        ok = (status === 303 || status === 302) ? /login/.test(loc ?? '') : [401, 403, 404].includes(status) || (status === 200 && leak.length === 0);
        note = status === 200 ? `generic app shell, leaked=${leak.length}` : undefined;
      }
      if (label === 'POST signaling message') {
        // Internal signaling answers 200/null to everyone and silently drops
        // messages whose sessionId is not the caller's session in that room
        // (DOC SignalingController::sendMessages; LOCAL in acceptance-call.mjs).
        ok = [401, 403, 404].includes(status) || (status === 200 && res.data?.ocs?.data === null);
        note = status === 200 ? 'accepted-and-discarded (no session in room)' : undefined;
      }
      if (ok) pass += 1;
      results.push({ target: t.name, who, probe: label, status, ...(loc ? { location: new URL(loc, 'http://x').pathname } : {}), ...(note ? { note } : {}), ok });
    }
  }
}
// Positive controls.
await resetBruteforce();
const positive = [];
for (const t of targets) {
  for (const who of t.members) {
    const a = actors[who];
    positive.push({ target: t.name, who, room: (await a.request('GET', talk.room(`/${t.token}`))).status, chat: (await a.request('GET', `${talk.chat(t.token)}?lookIntoFuture=0&limit=1&setReadMarker=0`)).status, participants: (await a.request('GET', talk.room(`/${t.token}/participants`))).status });
  }
}
await resetBruteforce();
const after = await snapshot();
const unchanged = JSON.stringify(before) === JSON.stringify(after);
const failures = results.filter((r) => !r.ok);
await writeEvidence(`verify-acl-${mode}.json`, { mode, total: results.length, pass, failures, unchanged, positive, statusHistogram: results.reduce((h, r) => ({ ...h, [r.status]: (h[r.status] ?? 0) + 1 }), {}), before, after: unchanged ? 'same as before' : after, results });
console.log(`verify-acl ${mode}: ${pass}/${results.length} denied; fixtures unchanged=${unchanged}; positive=${JSON.stringify(positive.map((p) => `${p.target}/${p.who}:${p.room}/${p.chat}/${p.participants}`))}`);
if (failures.length) console.log(JSON.stringify(failures, null, 1));
assert(!failures.length && unchanged && positive.every((p) => p.room === 200 && [200, 304].includes(p.chat) && p.participants === 200), 'deny matrix', { failures: failures.length, unchanged });
