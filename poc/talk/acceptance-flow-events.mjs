// Chat17 ↔ Flow (chat14): can Talk events feed Flow?
//  1. webhook_listeners (chat14 path): try to register Talk event classes.
//  2. Talk's own bot webhooks (occ talk:bot:install --feature=webhook): signed
//     HMAC-SHA256 POST per chat message, enabled per conversation. Pointed at
//     the internal hook-sink of work13 (no route out). Checks what leaves
//     Nextcloud (message content!), signature validity, per-room scoping,
//     who can enable bots, then uninstalls the bot. The bot secret is random
//     per run and never written to evidence.
import { createHmac, randomBytes } from 'node:crypto';
import { assert, client, docker, occ, ocsData, readEvidence, sleep, talk, writeEvidence } from './lib.mjs';

const conv = await readEvidence('conversations.json');
const admin = await client('admin13');
const ownerA = await client('successor-a');
const memberA = await client('member-a');
const managerB = await client('manager-b');
const run = Date.now().toString(36);
const ev = { run };
const api = '/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks';
const sinkUri = 'http://hook-sink:8080/talk17';

// 1. webhook_listeners compatibility.
const candidates = ['OCA\\Talk\\Events\\ChatMessageSentEvent', 'OCA\\Talk\\Events\\RoomCreatedEvent', 'OCA\\Talk\\Events\\AttendeesAddedEvent', 'OCA\\Talk\\Events\\CallStartedEvent', 'OCA\\Talk\\Events\\SystemMessageSentEvent'];
ev.webhookListeners = [];
for (const event of candidates) {
  const res = await admin.request('POST', api, { json: { httpMethod: 'POST', uri: sinkUri, event, authMethod: 'none' } });
  ev.webhookListeners.push({ event, status: res.status, message: res.status === 200 ? 'registered' : (res.data?.ocs?.meta?.message ?? String(res.text).slice(0, 160)) });
  if (res.status === 200) await admin.request('DELETE', `${api}/${ocsData(res).id}`);
}

// 2. Talk bot webhook.
const secret = randomBytes(32).toString('hex'); // 64 chars, in memory only
for (const bot of JSON.parse((await occ('talk:bot:list', '--output=json')).stdout || '[]')) if (bot.name === 'Flow17') await occ('talk:bot:uninstall', String(bot.id));
await occ('talk:bot:install', '--no-setup', '--feature=webhook', 'Flow17', secret, sinkUri, 'Chat17 PoC: chuyen tin nhan sang Flow');
const bot = JSON.parse((await occ('talk:bot:list', '--output=json')).stdout).find((b) => b.name === 'Flow17');
ev.bot = { id: bot.id, features: bot.features, state: bot.state };
// Who may enable it on a conversation?
ev.enable = {
  moderatorTeamAViaApi: (await ownerA.request('POST', `/ocs/v2.php/apps/spreed/api/v1/bot/${conv.teamA.token}/${bot.id}`)).status,
  teamBUserOnTeamARoom: (await managerB.request('POST', `/ocs/v2.php/apps/spreed/api/v1/bot/${conv.teamA.token}/${bot.id}`)).status,
  memberListsBots: (await memberA.request('GET', `/ocs/v2.php/apps/spreed/api/v1/bot/${conv.teamA.token}`)).status,
};
await occ('talk:bot:setup', String(bot.id), conv.teamA.token);

const sinkLog = async () => (await docker('exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log')).stdout;
const offset = (await sinkLog()).length;
const marker = `FLOW17-NOI-DUNG-${run}`;
const t0 = Date.now();
const postA = await memberA.request('POST', talk.chat(conv.teamA.token), { json: { message: `${marker} tin Team A @"${ownerA.uid}"` } });
const postedMs = Date.now() - t0;
await managerB.request('POST', talk.chat(conv.teamB.token), { json: { message: `${marker} tin Team B` } });
let deliveries = [];
let firstSeenMs = null;
for (let i = 0; i < 60; i += 1) {
  const chunk = (await sinkLog()).slice(offset);
  deliveries = chunk.split('--END--').filter((b) => b.includes('POST /talk17'));
  if (deliveries.length && firstSeenMs === null) firstSeenMs = Date.now() - t0;
  if (deliveries.length >= 1 && i > 10) break;
  await sleep(200);
}
const parsed = deliveries.map((raw) => {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const body = rest.join('\n\n').trim();
  const header = (name) => (new RegExp(`^${name}: *(.*)$`, 'im').exec(head) ?? [])[1]?.trim();
  const random = header('X-Nextcloud-Talk-Random');
  const signature = header('X-Nextcloud-Talk-Signature');
  const expected = random ? createHmac('sha256', secret).update(random + body).digest('hex') : null;
  let json = null;
  try { json = JSON.parse(body); } catch { /* keep null */ }
  return {
    headers: { contentType: header('Content-Type'), backend: header('X-Nextcloud-Talk-Backend'), hasRandom: Boolean(random), hasSignature: Boolean(signature) },
    signatureValid: signature === expected,
    type: json?.type,
    actor: json?.actor ? { type: json.actor.type, idIsUid: json.actor.id === `users/${memberA.uid}`, hasName: Boolean(json.actor.name) } : null,
    targetIsTeamA: json?.target?.id === conv.teamA.token,
    targetName: json?.target?.name,
    containsMessageText: body.includes(marker),
    containsMentionUid: body.includes(ownerA.uid),
    teamBMessage: body.includes('tin Team B'),
    objectKeys: json?.object ? Object.keys(json.object).sort() : [],
  };
});
ev.delivery = { postStatus: postA.status, postRequestMs: postedMs, firstSeenAtSinkMs: firstSeenMs, count: parsed.length, parsed };
// Tampered signature check (what the receiver must do): flip one char.
ev.delivery.receiverCheck = 'HMAC-SHA256(secret, X-Nextcloud-Talk-Random + body) == X-Nextcloud-Talk-Signature; verified above with the run secret';

await occ('talk:bot:remove', String(bot.id), conv.teamA.token);
await occ('talk:bot:uninstall', String(bot.id));
ev.cleanup = { botsLeft: JSON.parse((await occ('talk:bot:list', '--output=json')).stdout || '[]').filter((b) => b.name === 'Flow17').length };
await writeEvidence('acceptance-flow-events.json', ev);
console.log(JSON.stringify(ev, null, 1));
assert(ev.webhookListeners.every((w) => w.status !== 200), 'Talk events not webhook_listeners compatible', ev.webhookListeners);
assert(parsed.length === 1 && parsed[0].signatureValid && parsed[0].targetIsTeamA && !parsed.some((p) => p.teamBMessage), 'bot delivery scoped + signed', parsed);
