// Chat17 acceptance: offboarding a Talk user (member-b, Team B) with occ only.
//  1. Fixture: member-b owns a project conversation (manager-b member), posts,
//     shares a file into it, and has a 1-1 with manager-b.
//  2. talk:user:transfer-ownership member-b → manager-b (+ --remove-source-user).
//  3. Two devices (talk17-api, talk17-api-2): delete token #1 → time to 401
//     (≈ 10 s token cache, chat15/16); user:disable → device #2 status (503?);
//     delete all → 401.
//  4. What remains for the team: history attributed to the leaver, file shared
//     by the leaver into the room (owner disabled), 1-1 state.
//  5. finally: re-enable member-b, re-mint talk17 tokens, put member-b back in
//     the Team B group conversation (PoC re-run only).
import { execFileSync } from 'node:child_process';
import { assert, client, occ, occJson, ocsData, readEvidence, secret, sleep, talk, talkRoot, writeEvidence } from './lib.mjs';

const conv = await readEvidence('conversations.json');
const leaverName = 'member-b';
const leaver1 = await client(leaverName);
const leaver2 = await client(leaverName, { password: await secret(`app_password_${leaverName}_2`) });
const successor = await client('manager-b');
const run = Date.now().toString(36);
const ev = { run };
const files = (uid, path) => `/remote.php/dav/files/${encodeURIComponent(uid)}/${path.split('/').map(encodeURIComponent).join('/')}`;

try {
  // 1. Fixture.
  const project = ocsData(await leaver1.request('POST', talk.room(), { json: { roomType: 2, roomName: `talk17-du-an-b-${run}` } }));
  await leaver1.request('POST', talk.room(`/${project.token}/participants`), { json: { newParticipant: successor.uid, source: 'users' } });
  await leaver1.request('POST', talk.chat(project.token), { json: { message: `ban giao du an ${run}` } });
  await leaver1.request('MKCOL', files(leaver1.uid, 'talk17'));
  await leaver1.request('PUT', files(leaver1.uid, `talk17/${run}-ho-so.txt`), { body: `ho so ${run}`, headers: { 'Content-Type': 'text/plain' } });
  const fileShare = await leaver1.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', { json: { shareType: 10, shareWith: project.token, path: `/talk17/${run}-ho-so.txt` } });
  const one = ocsData(await leaver1.request('POST', talk.room(), { json: { roomType: 1, invite: successor.uid } }));
  await leaver1.request('POST', talk.chat(one.token), { json: { message: `1-1 ${run}` } });
  await sleep(300);
  const sharedWithSuccessor = async () => {
    const list = ocsData(await successor.request('GET', '/ocs/v2.php/apps/files_sharing/api/v1/shares?shared_with_me=true')) ?? [];
    const s = list.find((x) => x.path?.endsWith(`${run}-ho-so.txt`));
    return s ? (await successor.request('GET', files(successor.uid, s.path.replace(/^\//, '')))).status : 'not-listed';
  };
  const participantsOf = async (actor, token) => (ocsData(await actor.request('GET', talk.room(`/${token}/participants`))) ?? []).map((p) => ({ who: p.actorId === leaver1.uid ? 'member-b' : p.actorId === successor.uid ? 'manager-b' : p.actorType, type: p.participantType }));
  ev.fixture = { fileShare: fileShare.status, participants: await participantsOf(successor, project.token), successorReadsFile: await sharedWithSuccessor() };

  // 2. Ownership transfer + removal from conversations.
  const transfer = await occ('talk:user:transfer-ownership', '--remove-source-user', leaver1.uid, successor.uid);
  ev.transfer = {
    output: transfer.stdout.trim().replaceAll(leaver1.uid, 'member-b').replaceAll(successor.uid, 'manager-b').slice(0, 300),
    projectParticipantsAfter: await participantsOf(successor, project.token),
    teamBRoomParticipantsAfter: await participantsOf(successor, conv.teamB.token),
    oneToOneVisibleForSuccessor: (await successor.request('GET', talk.room(`/${one.token}`))).status,
  };
  const history = ocsData(await successor.request('GET', `${talk.chat(project.token)}?lookIntoFuture=0&limit=50&setReadMarker=0`)) ?? [];
  ev.transfer.historyKeepsLeaverMessages = history.some((m) => m.actorId === leaver1.uid && m.message.includes(`ban giao du an ${run}`));
  ev.transfer.leaverReadsProjectAfter = (await leaver1.request('GET', `${talk.chat(project.token)}?lookIntoFuture=0&limit=5`)).status;
  const removeAll = await occ('talk:user:remove', `--user=${leaver1.uid}`);
  ev.removeFromAll = {
    output: removeAll.stdout.trim().replaceAll(leaver1.uid, 'member-b').slice(0, 200),
    leaverRooms: (ocsData(await leaver1.request('GET', talk.room())) ?? []).map((r) => r.type),
    teamBParticipants: await participantsOf(successor, conv.teamB.token),
  };

  // 3. Token revoke on two devices, then disable.
  const tokens = (await occJson('user:auth-tokens:list', leaver1.uid)).filter((t) => t.name === 'talk17-api' || t.name === 'talk17-api-2');
  const t1 = tokens.find((t) => t.name === 'talk17-api');
  const poll = (actor) => actor.request('GET', talk.room()).then((r) => r.status).catch((e) => `ERR:${e.name}`);
  const t0 = Date.now();
  await occ('user:auth-tokens:delete', leaver1.uid, String(t1.id));
  const timeline = [];
  let revokedAt = null;
  while (Date.now() - t0 < 30000) {
    const [d1, d2] = await Promise.all([poll(leaver1), poll(leaver2)]);
    timeline.push({ ms: Date.now() - t0, device1: d1, device2: d2 });
    if (d1 === 401) { revokedAt = Date.now() - t0; break; }
    await sleep(500);
  }
  const td = Date.now();
  await occ('user:disable', leaver1.uid);
  const afterDisable = [];
  for (let i = 0; i < 6; i += 1) { afterDisable.push({ ms: Date.now() - td, device2Rooms: await poll(leaver2), device2Post: (await leaver2.request('POST', talk.chat(conv.teamB.token), { json: { message: 'sau khi khoa' } })).status }); await sleep(500); }
  ev.fileAfterOwnerDisabled = await sharedWithSuccessor();
  for (const t of (await occJson('user:auth-tokens:list', leaver1.uid))) await occ('user:auth-tokens:delete', leaver1.uid, String(t.id));
  const ta = Date.now();
  const afterAll = [];
  while (Date.now() - ta < 30000) {
    const s = await poll(leaver2);
    afterAll.push({ ms: Date.now() - ta, device2: s });
    if (s === 401) break;
    await sleep(500);
  }
  ev.revoke = { device1RevokedAfterMs: revokedAt, timeline, afterDisable, afterAllTokensDeleted: { final: afterAll.at(-1).device2, reachedAfterMs: afterAll.at(-1).ms, statuses: [...new Set(afterAll.map((x) => x.device2))] } };
  ev.projectStillUsable = (await successor.request('POST', talk.chat(project.token), { json: { message: `tiep tuc ${run}` } })).status;
  await successor.request('DELETE', talk.room(`/${project.token}`));
  await writeEvidence('acceptance-offboard.json', ev);
  console.log(JSON.stringify(ev, null, 1));
  assert(ev.transfer.projectParticipantsAfter.some((p) => p.who === 'manager-b' && p.type === 1) && !ev.transfer.projectParticipantsAfter.some((p) => p.who === 'member-b'), 'ownership transferred, leaver removed', ev.transfer);
  assert(revokedAt !== null && afterDisable.every((a) => a.device2Post >= 400) && ev.revoke.afterAllTokensDeleted.final === 401, 'leaver locked out', ev.revoke);
} finally {
  await occ('user:enable', leaver1.uid);
  execFileSync('node', ['mint-app-passwords.mjs', leaverName], { cwd: talkRoot, stdio: 'ignore' });
  const fresh = await client(leaverName);
  const owner = await client('manager-b');
  const res = await owner.request('POST', talk.room(`/${conv.teamB.token}/participants`), { json: { newParticipant: fresh.uid, source: 'users' } });
  console.log(`persona restored for re-runs: enabled, new talk17 tokens, back in talk17-team-b (${res.status})`);
}
