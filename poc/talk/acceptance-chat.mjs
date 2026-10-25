// Chat17 acceptance: conversations by group id, chat, mentions/notifications,
// user search under the chat16 directory policy, cross-group policy probes and
// group-membership sync. Talk OCS API only (the same endpoints the web UI and
// the mobile apps call), as personas with talk17 app passwords. No DB access.
import { assert, client, occ, ocsData, readEvidence, resetBruteforce, sleep, talk, teamGroups, writeEvidence } from './lib.mjs';

const conv = await readEvidence('conversations.json');
const ownerA = await client('successor-a');
const memberA = await client('member-a');
const managerB = await client('manager-b');
const memberB = await client('member-b');
const outsider = await client('outsider');
const run = Date.now().toString(36);
const ev = { run };
await resetBruteforce();

// 1. Which conversations does each persona see?
const visible = {};
for (const actor of [ownerA, memberA, managerB, memberB, outsider]) {
  const rooms = ocsData(await actor.request('GET', talk.room())) ?? [];
  visible[actor.username] = rooms.filter((r) => [conv.teamA.token, conv.teamB.token, conv.oneToOneA.token].includes(r.token)).map((r) => r.name || r.token).sort();
}
ev.visible = visible;
assert(visible['member-a'].includes('talk17-team-a') && !visible['member-a'].includes('talk17-team-b'), 'member-a sees only Team A', visible);
assert(visible['manager-b'].includes('talk17-team-b') && !visible['manager-b'].includes('talk17-team-a'), 'manager-b sees only Team B', visible);
assert(visible.outsider.length === 0, 'outsider sees none', visible);

// 2. Chat round trip + mentions.
const notificationsOf = async (actor) => (ocsData(await actor.request('GET', '/ocs/v2.php/apps/notifications/api/v2/notifications')) ?? [])
  .filter((n) => n.app === 'spreed');
const clearNotifications = (actor) => actor.request('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications');
for (const actor of [ownerA, memberA, managerB, outsider]) await clearNotifications(actor);
const send = (actor, token, message, extra = {}) => actor.request('POST', talk.chat(token), { json: { message, ...extra } });
const readChat = async (actor, token) => {
  const res = await actor.request('GET', `${talk.chat(token)}?lookIntoFuture=0&limit=100&setReadMarker=0`);
  return { status: res.status, messages: res.status === 200 ? ocsData(res) : [] };
};
const plain = `talk17 ${run} tin thuong tieng Viet: Hop luc 9h nhe`;
const t0 = Date.now();
const sent = await send(memberA, conv.teamA.token, plain);
assert(sent.status === 201, 'member-a posts', sent.status);
const sentId = ocsData(sent).id;
let seenMs = null;
for (let i = 0; i < 40 && seenMs === null; i += 1) {
  const { messages } = await readChat(ownerA, conv.teamA.token);
  if (messages.some((m) => m.id === sentId)) seenMs = Date.now() - t0;
  else await sleep(50);
}
ev.chat = { postStatus: sent.status, ownerSawMessageMs: seenMs };
const mention = `@"${ownerA.uid}" xem giup file nay, va @"${outsider.uid}" (khong o trong phong) ${run}`;
const mentionRes = await send(memberA, conv.teamA.token, mention);
await sleep(1500);
// Posting in a room clears the poster's own chat notifications of that room, so
// read successor-a's mention notification before successor-a posts @all.
const ownerNotifAfterMention = await notificationsOf(ownerA);
const allRes = await send(ownerA, conv.teamA.token, `@all hop khan ${run}`);
// Mention parsing as rendered by the API.
const { messages } = await readChat(ownerA, conv.teamA.token);
const parsed = messages.find((m) => m.id === ocsData(mentionRes).id);
await sleep(1500);
const notif = {
  'successor-a': ownerNotifAfterMention.map((n) => ({ subject: n.subject, object_type: n.object_type, object_id: n.object_id, messageHasPlaceholder: /\{/.test(n.messageRich ?? '') })),
  'member-a': (await notificationsOf(memberA)).map((n) => ({ subject: n.subject, object_type: n.object_type })),
  outsider: (await notificationsOf(outsider)).map((n) => ({ subject: n.subject, object_type: n.object_type })),
  'manager-b': (await notificationsOf(managerB)).map((n) => ({ subject: n.subject, object_type: n.object_type })),
};
ev.mentions = {
  mentionPost: mentionRes.status,
  allPost: allRes.status,
  messageParameters: Object.fromEntries(Object.entries(parsed?.messageParameters ?? {}).map(([k, v]) => [k, { type: v.type, id: v.id === ownerA.uid ? 'successor-a' : v.id === outsider.uid ? 'outsider' : v.id, mentionDisplayName: v['mention-id'] ? 'yes' : undefined }])),
  messageTemplate: parsed?.message?.replace(run, '<run>'),
  notifications: notif,
};
assert(notif['successor-a'].some((n) => n.object_type === 'chat'), 'successor-a notified by mention', notif);
assert(notif.outsider.length === 0 && notif['manager-b'].length === 0, 'no notification outside the room', notif);
assert(notif['member-a'].some((n) => n.object_type === 'chat'), 'member-a notified by @all', notif);
// Notification of the mention must not leak the message to anyone not in the room
// (checked above); the notification itself carries the message text (DOC/LOCAL):
const rawNotif = ownerNotifAfterMention.find((n) => n.app === 'spreed');
ev.mentions.ownerNotificationsAfterOwnPost = (await notificationsOf(ownerA)).length;
ev.mentions.notificationContainsMessageText = Boolean(rawNotif && JSON.stringify(rawNotif).includes('xem giup file nay'));

// Mention autocomplete inside the room: only participants (+ "all").
const mentionSearch = async (actor, token, search) => (ocsData(await actor.request('GET', `${talk.chat(token)}/mentions?search=${encodeURIComponent(search)}&limit=20&includeStatus=0`)) ?? []).map((m) => m.source === 'calls' ? 'all' : m.id);
ev.mentionAutocomplete = {
  memberA_search_successor: (await mentionSearch(memberA, conv.teamA.token, 'Successor')).map((id) => (id === ownerA.uid ? 'successor-a' : id)),
  memberA_search_manager_b: await mentionSearch(memberA, conv.teamA.token, 'Manager B'),
  memberA_search_outsider: await mentionSearch(memberA, conv.teamA.token, 'outsider'),
};
assert(ev.mentionAutocomplete.memberA_search_successor.includes('successor-a'), 'mention autocomplete positive', ev.mentionAutocomplete);
assert(ev.mentionAutocomplete.memberA_search_manager_b.length === 0 && ev.mentionAutocomplete.memberA_search_outsider.length === 0, 'mention autocomplete no outsiders', ev.mentionAutocomplete);

// 3. User search as Talk's "add participant"/"new conversation" dialog does
// (core autocomplete itemType=call, shareTypes user/group/email/circle).
const autocomplete = async (actor, search, token = '') => {
  const qs = `search=${encodeURIComponent(search)}&itemType=call&itemId=${token}&shareTypes[]=0&shareTypes[]=1&shareTypes[]=4&shareTypes[]=7&limit=20`;
  const res = await actor.request('GET', `/ocs/v2.php/core/autocomplete/get?${qs}`);
  return (ocsData(res) ?? []).map((r) => `${r.source}:${r.id === ownerA.uid ? 'successor-a' : r.id === memberA.uid ? 'member-a' : r.id === managerB.uid ? 'manager-b' : r.id === memberB.uid ? 'member-b' : r.id === outsider.uid ? 'outsider' : r.id === teamGroups.a ? 'team-a' : r.id === teamGroups.b ? 'team-b' : r.id === teamGroups.outsiders ? 'outsiders' : r.id}`);
};
const searches = {};
for (const [actor, terms] of [
  [memberA, ['Successor', 'Manager B', 'member-b', 'member-b@team-b.test', managerB.uid, 'outsider', 'manager-a@outsider.test', 'Team', 'vcw-team-b']],
  [managerB, ['Member B', 'Member A', 'successor-a@team-a.test', ownerA.uid, 'outsider']],
  [outsider, ['Member', 'Manager', 'Successor', 'member-a@team-a.test', memberA.uid, 'team']],
]) {
  searches[actor.username] = {};
  // itemId '' = "new conversation" dialog (with a room token, existing
  // participants are filtered out). A typed e-mail address is echoed back as
  // an "emails:" candidate (= invite as e-mail guest); that echo is not a
  // directory hit and is recorded separately.
  for (const term of terms) {
    const label = term.length === 64 ? `<uid ${term === managerB.uid ? 'manager-b' : term === ownerA.uid ? 'successor-a' : 'member-a'}>` : term;
    const hits = await autocomplete(actor, term, '');
    searches[actor.username][label] = hits.filter((h) => h !== `emails:${term}`);
    if (hits.includes(`emails:${term}`)) (ev.typedEmailEchoedAsGuestCandidate ??= []).push(`${actor.username}:${term}`);
  }
}
ev.userSearch = searches;
const crossA = Object.values(searches['member-a']).flat().filter((x) => /manager-b|member-b|outsider|team-b|outsiders/.test(x));
const crossB = Object.values(searches['manager-b']).flat().filter((x) => /successor-a|member-a|outsider|team-a/.test(x));
const crossO = Object.values(searches.outsider).flat().filter((x) => /successor-a|member-a|manager-b|member-b|team-a|team-b/.test(x));
ev.userSearchCrossGroupHits = { 'member-a': crossA, 'manager-b': crossB, outsider: crossO };
assert(searches['member-a'].Successor.includes('users:successor-a'), 'search positive control', searches['member-a']);
assert(!crossA.length && !crossB.length && !crossO.length, 'no cross-group search hits', ev.userSearchCrossGroupHits);
// Open ("listable") conversations search.
ev.listedRooms = {};
for (const actor of [memberA, managerB, outsider]) ev.listedRooms[actor.username] = (ocsData(await actor.request('GET', `${talk.room('')}`.replace('/room', '/listed-room') + '?searchTerm=talk17')) ?? []).map((r) => r.name);

// 4. Policy probes: does Talk enforce "share only with group members"?
// Done as moderators/users who know the immutable uid / group id (not
// discoverable through search, see 3). Everything created here is removed again.
const probes = {};
const tmpA = ocsData(await ownerA.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-probe-${run}` } }));
const addUser = await ownerA.request('POST', talk.room(`/${tmpA.token}/participants`), { json: { newParticipant: managerB.uid, source: 'users' } });
probes.moderatorAddsTeamBUserByUid = addUser.status;
const addOutsider = await ownerA.request('POST', talk.room(`/${tmpA.token}/participants`), { json: { newParticipant: outsider.uid, source: 'users' } });
probes.moderatorAddsOutsiderByUid = addOutsider.status;
const addGroup = await ownerA.request('POST', talk.room(`/${tmpA.token}/participants`), { json: { newParticipant: teamGroups.outsiders, source: 'groups' } });
probes.moderatorAddsOutsidersGroupById = addGroup.status;
const addEmail = await ownerA.request('POST', talk.room(`/${tmpA.token}/participants`), { json: { newParticipant: `guest-${run}@partner.test`, source: 'emails' } });
probes.moderatorAddsEmailGuest = { status: addEmail.status, roomBecame: ocsData(addEmail)?.type ?? null, error: ocsData(addEmail)?.error ?? null };
probes.outsiderSeesProbeRoom = (ocsData(await outsider.request('GET', talk.room())) ?? []).some((r) => r.token === tmpA.token);
probes.outsiderCanPost = (await send(outsider, tmpA.token, `outsider ${run}`)).status;
const one = await memberA.request('POST', talk.room(), { json: { roomType: 1, invite: outsider.uid } });
probes.oneToOneWithOutsiderByUid = { status: one.status, error: ocsData(one)?.error ?? null };
const oneB = await memberA.request('POST', talk.room(), { json: { roomType: 1, invite: managerB.uid } });
probes.oneToOneWithTeamBByUid = { status: oneB.status, error: ocsData(oneB)?.error ?? null };
ev.crossGroupPolicyProbes = probes;
// cleanup of the probe conversations (moderator delete / leave 1-1)
await ownerA.request('DELETE', talk.room(`/${tmpA.token}`));
for (const r of [one, oneB]) if (ocsData(r)?.token) await memberA.request('DELETE', talk.room(`/${ocsData(r).token}`));

// 5. Group-id binding follows membership changes (temporary local group, so
// the OIDC-provisioned Team groups are not touched).
const gid = `talk17-sync-${run}`;
await occ('group:add', gid);
await occ('group:adduser', gid, memberA.uid);
const syncRoom = ocsData(await memberA.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-sync-${run}`, invite: gid, source: 'groups' } }));
const isIn = async (actor) => (ocsData(await actor.request('GET', talk.room())) ?? []).some((r) => r.token === syncRoom.token);
const sync = { before: await isIn(memberB) };
const tAdd = Date.now();
await occ('group:adduser', gid, memberB.uid);
sync.afterAddUser = await isIn(memberB);
sync.addVisibleMs = Date.now() - tAdd;
sync.memberBReadAfterAdd = (await readChat(memberB, syncRoom.token)).status;
await occ('group:removeuser', gid, memberB.uid);
sync.afterRemoveUser = await isIn(memberB);
sync.memberBReadAfterRemove = (await readChat(memberB, syncRoom.token)).status;
await occ('group:delete', gid);
sync.memberAAfterGroupDeleted = await isIn(memberA);
await memberA.request('DELETE', talk.room(`/${syncRoom.token}`));
ev.groupSync = sync;
assert(!sync.before && sync.afterAddUser && sync.memberBReadAfterAdd === 200 && !sync.afterRemoveUser && sync.memberBReadAfterRemove === 404, 'group membership sync', sync);

await writeEvidence('acceptance-chat.json', ev);
console.log(JSON.stringify(ev, null, 1));
