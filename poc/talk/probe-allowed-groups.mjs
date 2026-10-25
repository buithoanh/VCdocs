// Chat17 hardening probe: does spreed `allowed_groups` (Talk only for the
// employee groups Team A/B) shut the outsider out, including the
// "moderator adds outsider by uid" path found in acceptance-chat? Config is
// restored to its previous value in `finally`.
import { client, occ, ocsData, resetBruteforce, talk, teamGroups, writeEvidence } from './lib.mjs';

const before = (await occ('config:app:get', 'spreed', 'allowed_groups').catch(() => ({ stdout: '' }))).stdout.trim();
const ownerA = await client('successor-a');
const outsider = await client('outsider');
const managerB = await client('manager-b');
const run = Date.now().toString(36);
const ev = { previousValue: before || '(unset)' };
let room;
try {
  await occ('config:app:set', 'spreed', 'allowed_groups', `--value=${JSON.stringify([teamGroups.a, teamGroups.b])}`);
  await resetBruteforce();
  room = ocsData(await ownerA.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-allowed-${run}` } }));
  const addOutsider = await ownerA.request('POST', talk.room(`/${room.token}/participants`), { json: { newParticipant: outsider.uid, source: 'users' } });
  const addB = await ownerA.request('POST', talk.room(`/${room.token}/participants`), { json: { newParticipant: managerB.uid, source: 'users' } });
  ev.withAllowedGroups = {
    outsiderListRooms: (await outsider.request('GET', talk.room())).status,
    outsiderCreateRoom: (await outsider.request('POST', talk.room(), { json: { roomType: 2, roomName: 'x' } })).status,
    moderatorAddsOutsiderByUid: addOutsider.status,
    outsiderReadsThatRoom: (await outsider.request('GET', `${talk.chat(room.token)}?lookIntoFuture=0&limit=5`)).status,
    outsiderCapabilitiesHasSpreed: Boolean(ocsData(await outsider.request('GET', '/ocs/v2.php/cloud/capabilities'))?.capabilities?.spreed),
    moderatorAddsTeamBByUid: addB.status,
    teamBStillUsesTalk: (await managerB.request('GET', talk.room())).status,
  };
  // A file shared into that room: does the (Talk-blocked) outsider get it via Files?
  const dav = (who, p) => `/remote.php/dav/files/${encodeURIComponent(who.uid)}/${p.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
  await ownerA.request('MKCOL', dav(ownerA, 'talk17'));
  await ownerA.request('PUT', dav(ownerA, `talk17/${run}-allowed.txt`), { body: `allowed ${run}`, headers: { 'Content-Type': 'text/plain' } });
  const share = await ownerA.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', { json: { shareType: 10, shareWith: room.token, path: `/talk17/${run}-allowed.txt` } });
  const received = (ocsData(await outsider.request('GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares?shared_with_me=true')) ?? []).find((s) => s.path?.endsWith(`${run}-allowed.txt`));
  ev.withAllowedGroups.roomShareStatus = share.status;
  ev.withAllowedGroups.outsiderGetsFileViaFiles = received ? (await outsider.request('GET', dav(outsider, received.path))).status : 'not-listed';
} finally {
  if (room?.token) await ownerA.request('DELETE', talk.room(`/${room.token}`));
  if (before) await occ('config:app:set', 'spreed', 'allowed_groups', `--value=${before}`);
  else await occ('config:app:delete', 'spreed', 'allowed_groups');
  ev.restoredTo = (await occ('config:app:get', 'spreed', 'allowed_groups').catch(() => ({ stdout: '(unset)' }))).stdout.trim() || '(unset)';
}
await writeEvidence('hardening-allowed-groups.json', ev);
console.log(JSON.stringify(ev, null, 1));
