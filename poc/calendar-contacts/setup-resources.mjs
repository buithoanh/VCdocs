// Chat16: rooms/resources through calendar_resource_management 0.12.2 (occ only):
// building "VC HQ" → story "Tang 3" → room P301 (restricted to Team A group id),
// room P302 (everyone), resource projector-01. Then run the DAV job that syncs
// room/resource backends into principals and readback the DAV principals.
// Idempotent: reuses existing entries by uid.
import { client, occ, occJson, teamGroups, writeEvidence } from './lib.mjs';

const list = async () => (await occ('calendar-resource:resources:list')).stdout;
const tableRows = (text, section) => {
  const block = text.split(`${section}:`)[1]?.split(/\n[A-Z][a-z]+:/)[0] ?? '';
  return block.split('\n').filter((l) => /^\|\s*\d+/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
};
let text = await list();
let building = tableRows(text, 'Buildings').find((r) => r[1] === 'VC HQ');
if (!building) { await occ('calendar-resource:building:create', 'VC HQ'); text = await list(); building = tableRows(text, 'Buildings').find((r) => r[1] === 'VC HQ'); }
let story = tableRows(text, 'Stories').find((r) => r[2] === 'Tang 3');
if (!story) { await occ('calendar-resource:story:create', building[0], 'Tang 3'); text = await list(); story = tableRows(text, 'Stories').find((r) => r[2] === 'Tang 3'); }
const rooms = [
  { uid: 'vcw-room-p301', name: 'Phong hop P301 (Team A)', email: 'room-p301@vcworkspace.test', capacity: '8', restrictTo: teamGroups.a },
  { uid: 'vcw-room-p302', name: 'Phong hop P302 (chung)', email: 'room-p302@vcworkspace.test', capacity: '12' },
];
for (const room of rooms) {
  if (!text.includes(room.uid)) await occ('calendar-resource:room:create', `--capacity=${room.capacity}`, '--has-projector=1', story[0], room.uid, room.name, room.email, 'Meeting room');
}
if (!text.includes('vcw-projector-01')) await occ('calendar-resource:resource:create', 'vcw-projector-01', building[0], 'May chieu 01', 'projector-01@vcworkspace.test', 'Projector');
text = await list();
// Restriction for P301 → Team A group only.
const roomTable = text.split('Rooms:')[1].split('Resources:')[0];
const p301Id = (new RegExp(`\\|\\s*(\\d+)\\s*\\|\\s*vcw-room-p301`).exec(roomTable) ?? [])[1];
if (!p301Id) throw new Error(`ROOM_ID_NOT_FOUND:${roomTable.slice(0, 500)}`);
if (!tableRows(text, 'Restrictions').some((r) => r[1] === 'room' && r[2] === p301Id)) await occ('calendar-resource:restriction:create', 'room', p301Id, teamGroups.a);
text = await list();
// Sync backends into DAV principals now instead of waiting for the hourly job.
const jobs = await occJson('background-job:list', '--class=OCA\\DAV\\BackgroundJob\\UpdateCalendarResourcesRoomsBackgroundJob');
for (const job of jobs) await occ('background-job:execute', '--force-execute', String(job.id));

const admin = await client('successor-a');
const principalsFor = async (actor, collection) => {
  const res = await actor.dav('PROPFIND', `/remote.php/dav/principals/${collection}/`, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><cal:calendar-user-type/><cal:calendar-user-address-set/></d:prop></d:propfind>', { Depth: '1' });
  return { status: res.status, hrefs: [...res.text.matchAll(/<d:href>([^<]*)<\/d:href>/g)].map((m) => m[1]).filter((h) => !h.endsWith(`/${collection}/`) && h.includes(collection)) };
};
const views = {};
for (const name of ['successor-a', 'manager-b', 'outsider']) {
  const actor = name === 'successor-a' ? admin : await client(name);
  views[name] = { rooms: await principalsFor(actor, 'calendar-rooms'), resources: await principalsFor(actor, 'calendar-resources') };
}
await writeEvidence('resources.json', {
  app: 'calendar_resource_management 0.12.2',
  occListing: text.split('\n').filter((l) => /vcw-|VC HQ|Tang 3|room\s*\|/.test(l)),
  p301RestrictedToGroup: teamGroups.a,
  principalsVisibleTo: views,
});
console.log(JSON.stringify(views, null, 1));
