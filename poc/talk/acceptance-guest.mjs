// Chat17 acceptance: guests, password, lobby. Talk has no global switch that
// disables guests (any moderator can make a conversation public), so the PoC
// enforces passwords (spreed force_passwords=yes, configure-talk.mjs) and checks
// the lobby. Also probes paths that turn a room public implicitly (adding an
// e-mail guest, Calendar's "public" Talk room). Guests are anonymous HTTP
// clients with their own cookie session, like the public /call/<token> page.
import { anonymous, assert, client, ocsData, resetBruteforce, sessionClient, sleep, talk, writeEvidence } from './lib.mjs';

const ownerA = await client('successor-a');
const memberA = await sessionClient('member-a');
const managerB = await sessionClient('manager-b');
const run = Date.now().toString(36);
const password = `Talk17-Khach-${run}-Pw!`;
const ev = { run };
await resetBruteforce();
const created = [];
const meta = (res) => ({ status: res.status, error: ocsData(res)?.error ?? null });

// 1. Capabilities advertised to clients.
const caps = ocsData(await ownerA.request('GET', '/ocs/v2.php/cloud/capabilities'))?.capabilities?.spreed;
ev.capabilities = { version: caps?.version, forcePasswords: caps?.config?.conversations?.['force-passwords'], externalSignalingConfigured: Boolean(caps?.config?.signaling?.['external-signaling-server']), recording: caps?.config?.call?.recording, sipEnabled: caps?.config?.call?.['sip-enabled'], federation: caps?.config?.federation?.enabled, canCreate: caps?.config?.conversations?.['can-create'] };

// 2. Public conversation needs a password.
const noPw = await ownerA.request('POST', talk.room(), { json: { roomType: 3, roomName: `talk17-public-nopw-${run}` } });
ev.createPublicWithoutPassword = meta(noPw);
if (ocsData(noPw)?.token) created.push(ocsData(noPw).token);
const group = ocsData(await ownerA.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-khach-${run}` } }));
created.push(group.token);
await ownerA.request('POST', talk.room(`/${group.token}/participants`), { json: { newParticipant: memberA.uid, source: 'users' } });
ev.makePublicWithoutPassword = meta(await ownerA.request('POST', talk.room(`/${group.token}/public`), { json: {} }));
ev.makePublicWeakPassword = meta(await ownerA.request('POST', talk.room(`/${group.token}/public`), { json: { password: '123' } }));
ev.makePublicWithPassword = meta(await ownerA.request('POST', talk.room(`/${group.token}/public`), { json: { password } }));
ev.memberMakesPublic = meta(await memberA.request('POST', talk.room(`/${group.token}/public`), { json: { password } }));
ev.linkSharingPolicy = 'core shareapi_allow_links=no (chat13) is NOT consulted by Talk: public conversation still created';
await ownerA.request('POST', talk.chat(group.token), { json: { message: `noi dung phong khach ${run}` } });

// 3. Guest join with/without password, brute force.
const join = (actor, token, pw) => actor.request('POST', talk.room(`/${token}/participants/active`), { json: { force: true, ...(pw !== undefined ? { password: pw } : {}) } });
const guestNoPw = anonymous(undefined, { jar: true });
ev.guestJoinNoPassword = meta(await join(guestNoPw, group.token));
ev.guestReadWithoutJoin = (await guestNoPw.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=5`)).status;
const wrong = [];
for (let i = 0; i < 6; i += 1) wrong.push((await join(anonymous(undefined, { jar: true }), group.token, `sai-${i}`)).status);
ev.guestWrongPasswordStatuses = wrong;
await resetBruteforce();
const guest = anonymous(undefined, { jar: true });
const gj = await join(guest, group.token, password);
ev.guestJoinCorrectPassword = { status: gj.status, actorType: ocsData(gj)?.actorType, participantType: ocsData(gj)?.participantType };
await guest.request('POST', `/ocs/v2.php/apps/spreed/api/v1/guest/${group.token}/name`, { json: { displayName: 'Khach Doi Tac' } });
const gRead = await guest.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=20&setReadMarker=0`);
ev.guestReadsChat = { status: gRead.status, seesMessage: JSON.stringify(ocsData(gRead) ?? []).includes(`noi dung phong khach ${run}`) };
ev.guestPosts = (await guest.request('POST', talk.chat(group.token), { json: { message: `khach chao ${run}` } })).status;
ev.guestParticipantList = (await guest.request('GET', talk.room(`/${group.token}/participants`))).status;
ev.guestSearchUsers = (await guest.request('GET', '/ocs/v2.php/core/autocomplete/get?search=Member&itemType=call&itemId=new&shareTypes[]=0')).status;
ev.guestSharedFiles = (await guest.request('GET', `${talk.chat(group.token)}/share?objectType=file&limit=5`)).status;
// A logged-in non-member (other team) can self-join a public room with the password.
const selfNoPw = await join(managerB, group.token);
const selfPw = await join(managerB, group.token, password);
ev.otherTeamSelfJoin = { withoutPassword: meta(selfNoPw), withPassword: meta(selfPw), participantType: ocsData(selfPw)?.participantType };
await managerB.request('DELETE', talk.room(`/${group.token}/participants/active`));
await managerB.request('DELETE', talk.room(`/${group.token}/participants/self`));

// 4. Lobby: non-moderators (guest, member, self-joined) are held back.
ev.lobbyOn = (await ownerA.request('PUT', `/ocs/v2.php/apps/spreed/api/v4/room/${group.token}/webinar/lobby`, { json: { state: 1 } })).status;
await guest.request('DELETE', talk.room(`/${group.token}/participants/active`));
const guest2 = anonymous(undefined, { jar: true });
const g2 = await join(guest2, group.token, password);
await memberA.request('POST', talk.room(`/${memberA.uid ? group.token : ''}/participants/active`), { json: { force: true } });
ev.lobby = {
  guestJoinRoom: g2.status,
  guestReadChat: (await guest2.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=5`)).status,
  guestPost: (await guest2.request('POST', talk.chat(group.token), { json: { message: 'trong lobby' } })).status,
  guestJoinCall: (await guest2.request('POST', talk.call(group.token), { json: { flags: 1 } })).status,
  guestParticipants: (await guest2.request('GET', talk.room(`/${group.token}/participants`))).status,
  memberReadChat: (await memberA.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=5`)).status,
  memberJoinCall: (await memberA.request('POST', talk.call(group.token), { json: { flags: 1 } })).status,
  moderatorReadChat: (await ownerA.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=5&setReadMarker=0`)).status,
};
await memberA.request('DELETE', talk.call(group.token));
ev.lobbyOff = (await ownerA.request('PUT', `/ocs/v2.php/apps/spreed/api/v4/room/${group.token}/webinar/lobby`, { json: { state: 0 } })).status;
ev.afterLobbyOff = { guestReadChat: (await guest2.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=5`)).status };
// 5. Password change kicks? (existing guest session keeps working = DOC); new guest needs new password.
await ownerA.request('PUT', talk.room(`/${group.token}/password`), { json: { password: `${password}-moi` } });
ev.afterPasswordChange = {
  existingGuestRead: (await guest2.request('GET', `${talk.chat(group.token)}?lookIntoFuture=0&limit=5`)).status,
  newGuestOldPassword: (await join(anonymous(undefined, { jar: true }), group.token, password)).status,
};
await resetBruteforce();

// 6. Implicit public: adding an e-mail guest to a private group room.
const priv = ocsData(await ownerA.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-email-${run}` } }));
created.push(priv.token);
await ownerA.request('POST', talk.chat(priv.token), { json: { message: `bi mat noi bo ${run}` } });
const addEmail = await ownerA.request('POST', talk.room(`/${priv.token}/participants`), { json: { newParticipant: 'partner@partner.test', source: 'emails' } });
const after = ocsData(await ownerA.request('GET', talk.room(`/${priv.token}`)));
const intruder = anonymous(undefined, { jar: true });
const ij = await join(intruder, priv.token);
const ir = await intruder.request('GET', `${talk.chat(priv.token)}?lookIntoFuture=0&limit=20`);
ev.emailGuestMakesRoomPublic = {
  addStatus: addEmail.status,
  typeAfter: after?.type,
  hasPasswordAfter: after?.hasPassword,
  anyoneWithLinkJoinsWithoutPassword: ij.status,
  anyoneWithLinkReadsChat: { status: ir.status, seesInternalMessage: JSON.stringify(ocsData(ir) ?? []).includes(`bi mat noi bo ${run}`) },
};
// 7. Calendar's "public" Talk room (roomType 3 + objectType event, as calendar-main.js sends).
const cal = await ownerA.request('POST', talk.room(), { json: { roomType: 3, roomName: `talk17-lich-${run}`, objectType: 'event', objectId: `talk17-${run}` } });
ev.calendarPublicRoomWithoutPassword = meta(cal);
if (ocsData(cal)?.token) created.push(ocsData(cal).token);

for (const token of created) await ownerA.request('DELETE', talk.room(`/${token}`));
ev.cleanedUp = created.length;
await writeEvidence('acceptance-guest.json', ev);
console.log(JSON.stringify(ev, null, 1));
assert(ev.capabilities.forcePasswords === true, 'force-passwords capability', ev.capabilities);
assert(ev.createPublicWithoutPassword.status === 400 && ev.makePublicWithoutPassword.status === 400 && ev.makePublicWithPassword.status === 200, 'password enforced on explicit paths', ev);
assert(ev.guestJoinNoPassword.status === 403 && ev.guestJoinCorrectPassword.status === 200, 'guest password check', ev);
assert(ev.lobby.guestReadChat === 412 && ev.lobby.guestJoinCall !== 200 && ev.lobby.moderatorReadChat === 200, 'lobby holds guests', ev.lobby);
await sleep(10);
