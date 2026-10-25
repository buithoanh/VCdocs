// Chat17 acceptance: Talk link in calendar invitations (chat16 Calendar 6.6.3).
//  A. Calendar → Talk: replay what calendar-main.js does for "Add Talk
//     conversation" (private room, objectType=event; attendees resolved through
//     core autocomplete itemType=users and matched by e-mail; unresolved ones
//     are ignored for private rooms), then PUT the event with the /call/ link in
//     LOCATION via CalDAV (iTIP: internal copy for Team A, iMIP for others).
//  B. Talk → Calendar: Talk 23 "schedule meeting" (POST room/{token}/meeting)
//     invites the room's user participants only.
//  The link never grants access: only room participants can open the room.
import { randomUUID } from 'node:crypto';
import { anonymous, assert, calPath, client, occ, ocsData, readEvidence, resetBruteforce, sleep, talk, writeEvidence } from './lib.mjs';

const conv = await readEvidence('conversations.json');
const ownerA = await client('successor-a');
const memberA = await client('member-a');
const managerB = await client('manager-b');
const outsider = await client('outsider');
const run = Date.now().toString(36);
const ev = { run };
await resetBruteforce();
const ocsGet = async (actor, path) => ocsData(await actor.request('GET', path));

// A1. Room for the event (Calendar "private" option = roomType 2).
const room = ocsData(await ownerA.request('POST', talk.room(), { json: { roomType: 2, roomName: `Hop talk17 ${run}`, objectType: 'event', objectId: randomUUID(), description: 'Hop thu chat17' } }));
const callUrl = `http://localhost:18130/call/${room.token}`;
// A2. Attendee resolution as Calendar does.
const attendees = [
  { cn: 'Member A', email: 'member-a@team-a.test' },
  { cn: 'Manager B', email: 'manager-b@team-b.test' },
  { cn: 'Doi Tac', email: 'partner@partner.test' },
];
const resolution = {};
for (const a of attendees) {
  const hits = await ocsGet(ownerA, `/ocs/v2.php/core/autocomplete/get?search=${encodeURIComponent(a.cn)}&itemType=users&shareTypes[]=0&limit=2`) ?? [];
  const match = hits.length === 1 && hits[0].shareWithDisplayNameUnique === a.email ? hits[0].id : null;
  resolution[a.email] = match ? 'resolved-user' : 'ignored (private room)';
  if (match) await ownerA.request('POST', talk.room(`/${room.token}/participants`), { json: { newParticipant: match, source: 'users' } });
}
ev.calendarToTalk = { roomType: room.type, objectType: room.objectType, attendeeResolution: resolution };
// A3. Event with the link, as organizer successor-a in the personal calendar.
const uid = `talk17-${run}`;
const start = new Date(Date.now() + 3 * 86400000);
const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VCworkspace//chat17 PoC//VI', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${fmt(new Date())}`,
  `DTSTART:${fmt(start)}`, `DTEND:${fmt(new Date(start.getTime() + 3600000))}`, `SUMMARY:Hop talk17 ${run}`, `LOCATION:${callUrl}`,
  `DESCRIPTION:Tham gia cuoc goi: ${callUrl}`, 'ORGANIZER;CN=Successor A:mailto:successor-a@team-a.test',
  'ATTENDEE;CN=Successor A;PARTSTAT=ACCEPTED:mailto:successor-a@team-a.test',
  ...attendees.map((a) => `ATTENDEE;CN=${a.cn};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
  'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n');
const put = await ownerA.request('PUT', `${calPath(ownerA.uid, 'personal')}${uid}.ics`, { body: ics, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
await sleep(1500);
const organizerCopy = (await ownerA.request('GET', `${calPath(ownerA.uid, 'personal')}${uid}.ics`)).text.replace(/\r\n[ \t]/g, '');
const scheduleStatus = Object.fromEntries(attendees.map((a) => [a.email, (new RegExp(`ATTENDEE[^\\n]*SCHEDULE-STATUS=([0-9.]+)[^\\n]*:mailto:${a.email.replace(/[.]/g, '\\.')}`).exec(organizerCopy) ?? [])[1] ?? 'none']));
const report = await memberA.request('REPORT', calPath(memberA.uid, 'personal'), {
  body: `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${uid}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
  headers: { Depth: '1', 'Content-Type': 'application/xml' },
});
ev.invitation = {
  putStatus: put.status,
  scheduleStatus, // 1.2 = delivered internally, 1.1 = sent by iMIP (mail16, chat16), 3.7/5.x = failed
  memberACopyHasLink: report.text.includes(`/call/${room.token}`),
};
// A4. Who can open the link?
const openAs = async (actor) => {
  const r = await actor.request('GET', talk.room(`/${room.token}`));
  const j = await actor.request('POST', talk.room(`/${room.token}/participants/active`), { json: { force: true } });
  return { getRoom: r.status, join: j.status };
};
await resetBruteforce();
ev.linkAccess = { 'member-a': await openAs(memberA), 'manager-b': await openAs(managerB), outsider: await openAs(outsider), anonymous: await openAs(anonymous()) };
await memberA.request('DELETE', talk.room(`/${room.token}/participants/active`));

// B. Talk → Calendar: schedule a meeting from the Team A conversation.
const meetingStart = Math.floor(Date.now() / 1000) + 5 * 86400;
const meetingBody = { calendarUri: 'personal', start: meetingStart, end: meetingStart + 1800, title: `Hop tu Talk ${run}`, description: 'Lich tu Talk chat17' };
// A persona that never opened the web UI has no "core timezone" preference;
// Talk then throws (DateTimeZone(null)) → 500. The web UI sets it on first
// login; the PoC sets it with occ (user preference, not DB) and retries.
const tzBefore = (await occ('user:setting', ownerA.uid, 'core', 'timezone').catch(() => ({ stdout: '(unset)' }))).stdout.trim() || '(unset)';
const first = await ownerA.request('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${conv.teamA.token}/meeting`, { json: meetingBody });
ev.scheduleMeetingWithoutUserTimezone = { timezoneBefore: tzBefore, status: first.status };
if (first.status !== 200) await occ('user:setting', ownerA.uid, 'core', 'timezone', 'Asia/Ho_Chi_Minh');
const sched = first.status === 200 ? first : await ownerA.request('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${conv.teamA.token}/meeting`, { json: meetingBody });
await sleep(1500);
const findIn = async (actor, needle) => {
  const r = await actor.request('REPORT', calPath(actor.uid, 'personal'), {
    body: `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="SUMMARY"><c:text-match>${needle}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
  });
  const data = r.text.replace(/\r?\n[ \t]/g, '').replace(/&#13;/g, '');
  return { status: r.status, found: data.includes(needle), hasTalkLink: data.includes(`/call/${conv.teamA.token}`), attendeeCount: (data.match(/ATTENDEE/g) ?? []).length };
};
ev.talkToCalendar = {
  status: sched.status,
  error: ocsData(sched)?.error ?? null,
  organizer: await findIn(ownerA, `Hop tu Talk ${run}`),
  'member-a': await findIn(memberA, `Hop tu Talk ${run}`),
  'manager-b': await findIn(managerB, `Hop tu Talk ${run}`),
};
// cleanup (event room + events)
await ownerA.request('DELETE', `${calPath(ownerA.uid, 'personal')}${uid}.ics`);
await ownerA.request('DELETE', talk.room(`/${room.token}`));
await writeEvidence('acceptance-calendar.json', ev);
console.log(JSON.stringify(ev, null, 1));
assert(ev.invitation.memberACopyHasLink && ev.linkAccess['member-a'].join === 200, 'member-a gets link and can join', ev);
assert(['manager-b', 'outsider', 'anonymous'].every((w) => ev.linkAccess[w].getRoom !== 200 && ev.linkAccess[w].join !== 200), 'link does not grant access', ev.linkAccess);
