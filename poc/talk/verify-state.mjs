// Chat17: read-only snapshot of Talk state as each persona sees it through the
// API (conversation list, participants, message ids/text hashes, shared files,
// Talk config), used before/after restart and backup/restore.
// Usage: node verify-state.mjs snapshot <name> | compare <a> <b>
//   (TALK17_NC_BASE + CAL16_NC_CONTAINER for the restore stack)
import { createHash } from 'node:crypto';
import { actorNames, assert, client, occ, ocsData, readEvidence, resetBruteforce, talk, writeEvidence } from './lib.mjs';

const [mode, a, b] = process.argv.slice(2);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
// Volatile render-time fields: absolute link/icon-url (host of the request: 18130 vs
// restore 18173), etag and preview-available (preview cache) are excluded.
// The recipient-side "delete" bit (8 = unshare from own tree) in file
// permissions flips between 9/27 and 1/19 depending on a warm mount cache
// (observed across a plain restart, same share); it is masked. Real write
// enforcement is tested in acceptance-files.mjs (readOnlyRoomShare).
const stable = (params) => JSON.stringify(Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, Object.fromEntries(Object.entries(v)
  .filter(([f]) => !['link', 'icon-url', 'etag', 'preview-available'].includes(f))
  .map(([f, val]) => (f === 'permissions' ? [f, String(Number(val) & ~8)] : [f, val])))])));

if (mode === 'snapshot') {
  await resetBruteforce();
  const conv = await readEvidence('conversations.json');
  const fixture = [conv.teamA.token, conv.teamB.token, conv.oneToOneA.token];
  const personas = {};
  for (const name of actorNames) {
    const c = await client(name);
    const rooms = (ocsData(await c.request('GET', talk.room())) ?? []).filter((r) => fixture.includes(r.token)).sort((x, y) => x.token.localeCompare(y.token));
    personas[name] = {};
    for (const room of rooms) {
      const msgs = ocsData(await c.request('GET', `${talk.chat(room.token)}?lookIntoFuture=0&limit=200&setReadMarker=0`)) ?? [];
      const parts = ocsData(await c.request('GET', talk.room(`/${room.token}/participants`))) ?? [];
      const shared = ocsData(await c.request('GET', `${talk.chat(room.token)}/share?objectType=file&limit=200`)) ?? {};
      personas[name][room.token] = {
        name: room.name, type: room.type, participantType: room.participantType, lobbyState: room.lobbyState, hasPassword: room.hasPassword,
        participants: parts.map((p) => `${p.actorType}:${p.actorId}:${p.participantType}`).sort(),
        messages: msgs.length, messageIds: hash(msgs.map((m) => m.id).join(',')), messageText: hash(msgs.map((m) => `${m.actorId}|${m.message}|${stable(m.messageParameters)}`).join('\n')),
        sharedFiles: Object.keys(shared).length,
      };
    }
  }
  const config = {};
  for (const key of ['stun_servers', 'turn_servers', 'force_passwords', 'call_recording', 'federation_enabled']) config[key] = (await occ('config:app:get', 'spreed', key).catch(() => ({ stdout: '(unset)' }))).stdout.trim();
  config.has_internet_connection = (await occ('config:system:get', 'has_internet_connection').catch(() => ({ stdout: '(unset)' }))).stdout.trim();
  for (const key of ['shareapi_only_share_with_group_members', 'shareapi_restrict_user_enumeration_to_group', 'shareapi_restrict_user_enumeration_full_match']) config[key] = (await occ('config:app:get', 'core', key)).stdout.trim();
  config.spreedVersion = (await occ('app:list')).stdout.match(/spreed: ([\d.]+)/)?.[1];
  await writeEvidence(`state-${a}.json`, { base: process.env.TALK17_NC_BASE || 'http://localhost:18130', personas, config });
  console.log(`state-${a}.json: ${Object.entries(personas).map(([n, r]) => `${n}=${Object.keys(r).length}`).join(' ')}`);
} else if (mode === 'compare') {
  const x = await readEvidence(`state-${a}.json`);
  const y = await readEvidence(`state-${b}.json`);
  const same = JSON.stringify(x.personas) === JSON.stringify(y.personas) && JSON.stringify(x.config) === JSON.stringify(y.config);
  const diff = [];
  for (const n of Object.keys(x.personas)) if (JSON.stringify(x.personas[n]) !== JSON.stringify(y.personas[n])) diff.push(n);
  await writeEvidence(`state-compare-${a}-vs-${b}.json`, { same, differingPersonas: diff, configSame: JSON.stringify(x.config) === JSON.stringify(y.config) });
  console.log(`compare ${a} vs ${b}: same=${same} diff=${diff.join(',')}`);
  assert(same, 'state identical', { diff });
} else throw new Error('usage: snapshot <name> | compare <a> <b>');
