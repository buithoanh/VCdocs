// Chat17: create the fixture conversations through the Talk OCS API, as the UI
// does (POST /room with invite=<group id>, source=groups). Group conversations
// are bound to the immutable federated group id; Talk adds/removes members when
// the group changes. Idempotent: reuses conversations with the same name owned
// by the same creator. Tokens are not secrets (they are useless without being a
// participant, see verify-acl.mjs) and go to evidence/conversations.json.
import { assert, client, ocsData, talk, teamGroups, writeEvidence } from './lib.mjs';

const ownerA = await client('successor-a');
const ownerB = await client('manager-b');
const memberA = await client('member-a');

async function ensureGroupRoom(owner, name, groupId) {
  const list = ocsData(await owner.request('GET', talk.room()));
  const existing = list.find((room) => room.name === name && room.type === 2);
  if (existing) return existing;
  const res = await owner.request('POST', talk.room(), { json: { roomType: 2, roomName: name, invite: groupId, source: 'groups' } });
  assert(res.status === 201 || res.status === 200, `create ${name}`, { status: res.status, body: res.text.slice(0, 300) });
  return ocsData(res);
}

const teamA = await ensureGroupRoom(ownerA, 'talk17-team-a', teamGroups.a);
const teamB = await ensureGroupRoom(ownerB, 'talk17-team-b', teamGroups.b);
// One-to-one inside Team A (member-a → successor-a).
const oneRes = await memberA.request('POST', talk.room(), { json: { roomType: 1, invite: ownerA.uid } });
assert([200, 201].includes(oneRes.status), 'create 1-1', { status: oneRes.status, body: oneRes.text.slice(0, 300) });
const oneToOne = ocsData(oneRes);
// Talk adds the other party of a 1-1 lazily (ensureOneToOneRoomIsFilled on the
// first message/join); the first message makes the room appear for successor-a.
await memberA.request('POST', talk.chat(oneToOne.token), { json: { message: 'talk17 chao anh, tin nhan 1-1' } });

const participants = async (actor, room) => (ocsData(await actor.request('GET', talk.room(`/${room.token}/participants`))) ?? [])
  .map((p) => ({ actorType: p.actorType, actorId: p.actorId, participantType: p.participantType }));
const result = {
  teamA: { token: teamA.token, name: teamA.name, type: teamA.type, participants: await participants(ownerA, teamA) },
  teamB: { token: teamB.token, name: teamB.name, type: teamB.type, participants: await participants(ownerB, teamB) },
  oneToOneA: { token: oneToOne.token, type: oneToOne.type, participants: await participants(memberA, oneToOne) },
};
await writeEvidence('conversations.json', result);
console.log(JSON.stringify(result, null, 1));
