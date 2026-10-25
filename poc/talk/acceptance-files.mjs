// Chat17 acceptance: sharing a Files file into a Talk conversation.
// Talk shares are Files shares of type 10 (room); the chat message only points
// to the file. Checks: participants get it, non-participants (Team B,
// outsider, anonymous) do not through any path (Talk shared-items API, the /f/
// link in the message, WebDAV, preview, OCS share API), reshare permission of
// the source share is enforced, removal from the room / unshare revokes,
// permissions of the room share, and the cross-group case.
import { assert, anonymous, client, ocsData, readEvidence, resetBruteforce, sleep, talk, writeEvidence } from './lib.mjs';

const conv = await readEvidence('conversations.json');
const ownerA = await client('successor-a');
const memberA = await client('member-a');
const managerB = await client('manager-b');
const memberB = await client('member-b');
const outsider = await client('outsider');
const anon = anonymous();
const run = Date.now().toString(36);
const ev = { run };
await resetBruteforce();

const files = (uid, path = '') => `/remote.php/dav/files/${encodeURIComponent(uid)}/${path.split('/').map(encodeURIComponent).join('/')}`;
const sharesApi = '/ocs/v2.php/apps/files_sharing/api/v1/shares';
const put = (actor, path, body) => actor.request('PUT', files(actor.uid, path), { body, headers: { 'Content-Type': 'text/plain' } });
const mkcol = (actor, path) => actor.request('MKCOL', files(actor.uid, path));
const shareTo = (actor, body) => actor.request('POST', sharesApi, { json: body });
const fileIdOf = async (actor, path) => {
  const res = await actor.request('PROPFIND', files(actor.uid, path), { body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>', headers: { Depth: '0', 'Content-Type': 'application/xml' } });
  return Number((/<oc:fileid>(\d+)<\/oc:fileid>/.exec(res.text) ?? [])[1]);
};
/** How a recipient finds a received share: OCS "shared with me" (path in their tree). */
const receivedPath = async (actor, fileId) => {
  const list = ocsData(await actor.request('GET', `${sharesApi}?shared_with_me=true&include_tags=false`)) ?? [];
  return list.find((s) => s.item_source === fileId || s.file_source === fileId)?.path ?? null;
};
const readAs = async (actor, fileId, knownPath) => {
  const path = knownPath ?? await receivedPath(actor, fileId);
  const dav = path ? (await actor.request('GET', files(actor.uid, path.replace(/^\//, '')))).status : 'no-path';
  return dav;
};

await mkcol(ownerA, 'talk17');
const content = `talk17 ${run} bao cao noi bo Team A`;
const name = `talk17/${run}-bao-cao.txt`;
assert([201, 204].includes((await put(ownerA, name, content)).status), 'upload');
const fileId = await fileIdOf(ownerA, name);

// 1. Share into Team A conversation (as the Talk UI "Share from Files" does).
const t0 = Date.now();
const share = await shareTo(ownerA, { shareType: 10, shareWith: conv.teamA.token, path: `/${name}` });
assert(share.status === 200, 'room share', { status: share.status, body: share.text.slice(0, 300) });
const roomShare = ocsData(share);
ev.roomShare = { status: share.status, permissions: roomShare.permissions, shareType: roomShare.share_type, msToCreate: Date.now() - t0 };
await sleep(300);
const chat = ocsData(await memberA.request('GET', `${talk.chat(conv.teamA.token)}?lookIntoFuture=0&limit=20&setReadMarker=0`)) ?? [];
const fileMessage = chat.find((m) => m.messageParameters?.file?.id === String(fileId));
ev.chatMessage = fileMessage ? { message: fileMessage.message, fileParam: { type: fileMessage.messageParameters.file.type, name: fileMessage.messageParameters.file.name, linkPath: new URL(fileMessage.messageParameters.file.link).pathname, mimetype: fileMessage.messageParameters.file.mimetype, permissions: fileMessage.messageParameters.file.permissions, previewAvailable: fileMessage.messageParameters.file['preview-available'] } } : null;
assert(ev.chatMessage, 'file message in chat', chat.map((m) => m.message));
const sharedItems = async (actor, token = conv.teamA.token) => {
  const res = await actor.request('GET', `${talk.chat(token)}/share?objectType=file&limit=50`);
  return { status: res.status, count: res.status === 200 ? Object.keys(ocsData(res) ?? {}).length : 0 };
};
const memberPath = await receivedPath(memberA, fileId);
ev.participant = {
  receivedPath: memberPath,
  davGet: await readAs(memberA, fileId, memberPath),
  sharedItemsApi: await sharedItems(memberA),
  content: (await memberA.request('GET', files(memberA.uid, memberPath.replace(/^\//, '')))).text === content,
  overwrite: (await memberA.request('PUT', files(memberA.uid, memberPath.replace(/^\//, '')), { body: 'ghi de', headers: { 'Content-Type': 'text/plain' } })).status,
  reshareToOwnTeamMate: null,
};
assert(ev.participant.davGet === 200 && ev.participant.content, 'participant reads shared file', ev.participant);

// 2. Non-participants: every path to the file.
const link = new URL(fileMessage.messageParameters.file.link).pathname;
const denyPaths = async (actor) => ({
  sharedItemsApi: (await sharedItems(actor)).status,
  sharedWithMe: (await receivedPath(actor, fileId)) ?? 'none',
  fLink: (await actor.request('GET', link)).status,
  davGuessOwnerPath: (await actor.request('GET', files(ownerA.uid, name))).status,
  davGuessOwnTree: (await actor.request('GET', files(actor.uid ?? 'x', `${run}-bao-cao.txt`))).status,
  preview: (await actor.request('GET', `/index.php/core/preview?fileId=${fileId}&x=64&y=64`)).status,
  shareById: (await actor.request('GET', `${sharesApi}/${roomShare.id}`)).status,
  davSearchByFileId: (await actor.request('GET', `/remote.php/dav/meta/${fileId}/v`)).status,
});
ev.nonParticipants = {};
for (const actor of [managerB, memberB, outsider, anon]) ev.nonParticipants[actor.username] = await denyPaths(actor);
for (const [who, r] of Object.entries(ev.nonParticipants)) {
  assert(r.sharedWithMe === 'none' && r.sharedItemsApi !== 200 && ![200, 206].includes(r.davGuessOwnerPath) && ![200, 206].includes(r.davGuessOwnTree) && r.preview !== 200 && r.shareById !== 200, `deny file for ${who}`, r);
  // /f/<id> for a logged-in user without access → 404 / redirect, never content
}

// 3. Files ACL is followed: read-only (no reshare) recipient cannot push it into a room.
const roName = `talk17/${run}-chi-doc.txt`;
await put(ownerA, roName, `chi doc ${run}`);
const roShare = await shareTo(ownerA, { shareType: 0, shareWith: memberA.uid, path: `/${roName}`, permissions: 1 });
assert(roShare.status === 200, 'read-only user share', roShare.text.slice(0, 200));
const roFileId = await fileIdOf(ownerA, roName);
const roPath = await receivedPath(memberA, roFileId);
const reshare = await shareTo(memberA, { shareType: 10, shareWith: conv.teamA.token, path: roPath });
ev.reshareWithoutPermission = { status: reshare.status, message: reshare.data?.ocs?.meta?.message ?? null };
assert(reshare.status !== 200, 'no reshare without share permission', ev.reshareWithoutPermission);
// A read-only room share (permissions=1) cannot be overwritten by participants.
const ro2 = `talk17/${run}-phong-chi-doc.txt`;
await put(ownerA, ro2, `phong chi doc ${run}`);
const ro2Share = await shareTo(ownerA, { shareType: 10, shareWith: conv.teamA.token, path: `/${ro2}`, permissions: 1 });
const ro2Id = await fileIdOf(ownerA, ro2);
await sleep(200);
const ro2Path = await receivedPath(memberA, ro2Id);
ev.readOnlyRoomShare = {
  status: ro2Share.status,
  permissions: ocsData(ro2Share)?.permissions,
  participantRead: await readAs(memberA, ro2Id, ro2Path),
  participantOverwrite: (await memberA.request('PUT', files(memberA.uid, ro2Path.replace(/^\//, '')), { body: 'x', headers: { 'Content-Type': 'text/plain' } })).status,
};
assert(ev.readOnlyRoomShare.participantOverwrite === 403, 'read-only room share not writable', ev.readOnlyRoomShare);

// 4. Revocation: removed participant / deleted share lose access.
const tmp = ocsData(await ownerA.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-files-${run}` } }));
await ownerA.request('POST', talk.room(`/${tmp.token}/participants`), { json: { newParticipant: memberA.uid, source: 'users' } });
const revName = `talk17/${run}-thu-hoi.txt`;
await put(ownerA, revName, `thu hoi ${run}`);
const revShare = ocsData(await shareTo(ownerA, { shareType: 10, shareWith: tmp.token, path: `/${revName}` }));
const revId = await fileIdOf(ownerA, revName);
await sleep(200);
const revPath = await receivedPath(memberA, revId);
const revocation = { before: await readAs(memberA, revId, revPath) };
const participantsList = ocsData(await ownerA.request('GET', talk.room(`/${tmp.token}/participants`)));
const attendee = participantsList.find((p) => p.actorId === memberA.uid);
const tRemove = Date.now();
await ownerA.request('DELETE', talk.room(`/${tmp.token}/attendees`), { json: { attendeeId: attendee.attendeeId } });
revocation.afterRemovedFromRoom = await readAs(memberA, revId, revPath);
revocation.afterRemovedMs = Date.now() - tRemove;
revocation.sharedWithMeAfterRemoval = (await receivedPath(memberA, revId)) ?? 'none';
// re-add, then delete the share itself
await ownerA.request('POST', talk.room(`/${tmp.token}/participants`), { json: { newParticipant: memberA.uid, source: 'users' } });
await sleep(200);
const revPath2 = await receivedPath(memberA, revId);
revocation.afterReAdd = await readAs(memberA, revId, revPath2);
await ownerA.request('DELETE', `${sharesApi}/${revShare.id}`);
revocation.afterUnshare = await readAs(memberA, revId, revPath2);
ev.revocation = revocation;
assert(revocation.before === 200 && revocation.afterRemovedFromRoom !== 200 && revocation.afterReAdd === 200 && revocation.afterUnshare !== 200, 'revocation', revocation);

// 5. Cross-group: a moderator added a Team B user by uid (Talk allows it, see
// acceptance-chat crossGroupPolicyProbes). A file shared into that room reaches
// the Team B user although Files' "share only with group members" would refuse
// a direct user share.
const direct = await shareTo(ownerA, { shareType: 0, shareWith: managerB.uid, path: `/${name}` });
await ownerA.request('POST', talk.room(`/${tmp.token}/participants`), { json: { newParticipant: managerB.uid, source: 'users' } });
const xName = `talk17/${run}-cheo-nhom.txt`;
await put(ownerA, xName, `cheo nhom ${run}`);
const xShare = await shareTo(ownerA, { shareType: 10, shareWith: tmp.token, path: `/${xName}` });
const xId = await fileIdOf(ownerA, xName);
await sleep(200);
ev.crossGroup = {
  directUserShareToTeamB: { status: direct.status, message: direct.data?.ocs?.meta?.message ?? null },
  roomShareIntoMixedRoom: xShare.status,
  teamBReadsViaRoom: await readAs(managerB, xId),
};
await ownerA.request('DELETE', talk.room(`/${tmp.token}`));
ev.crossGroup.teamBAfterRoomDeleted = await readAs(managerB, xId);
await writeEvidence('acceptance-files.json', ev);
console.log(JSON.stringify(ev, null, 1));
