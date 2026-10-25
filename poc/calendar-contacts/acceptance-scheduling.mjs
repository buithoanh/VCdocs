// Chat16 scheduling acceptance (RFC 6638 implicit scheduling over CalDAV, iMIP
// through the isolated chat16 Stalwart — local .test mailboxes only):
//  1. Team A organizer invites: internal member (local delivery), Team B user,
//     external partner (iMIP e-mail), room P301 (restricted to Team A), projector.
//  2. External partner accepts through the link in the e-mail; member-a accepts
//     through CalDAV (PARTSTAT on its own copy) → organizer copy updated.
//  3. Room booking: conflict auto-decline, free slot auto-accept, Team B cannot book
//     the Team-A-restricted room, shared room P302 works for Team B.
//  4. Update (new time, SEQUENCE) and cancellation propagate to all parties.
//  5. Mail only reached local test mailboxes; free/busy of rooms has no details.
import { calPath, client, ncBase, occ, resetBruteforce, sleep, writeEvidence, assert } from './lib.mjs';
import { calendarQuery, freeBusy, lines, putIcs, stamp, vcalendar } from './dav-lib.mjs';
import { listMessages } from './mail-lib.mjs';

await resetBruteforce();
const organizer = await client('successor-a');
const member = await client('member-a');
const managerB = await client('manager-b');
const run = Date.now().toString(36);
const teamCal = calPath(organizer.uid, 'cal16-team-a');
const room301 = 'room-p301@vcworkspace.test';
const room302 = 'room-p302@vcworkspace.test';
const projector = 'projector-01@vcworkspace.test';
const evidence = { run };
const attendeeLine = (email, extra = '') => `ATTENDEE;${extra}PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`;
const partstats = (ics) => Object.fromEntries(lines(ics, 'ATTENDEE').map((l) => [l.split('mailto:')[1]?.toLowerCase(), { partstat: (/PARTSTAT=([A-Z-]+)/.exec(l) ?? [])[1], scheduleStatus: (/SCHEDULE-STATUS=("?)([0-9.;]+)\1/.exec(l) ?? [])[2] ?? null }]));
const waitFor = async (fn, { timeoutMs = 20000, stepMs = 500 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return { value, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { value: null, ms: Date.now() - t0 };
    await sleep(stepMs);
  }
};
const mailWith = (address, needle, extra = () => true) => waitFor(async () => (await listMessages(address)).find((m) => ((m.subject ?? '').includes(needle) || (m.calendar ?? '').includes(needle)) && extra(m)));
const event = (uid, summary, start, end, attendees, seq = 0) => vcalendar({ tzids: ['Asia/Ho_Chi_Minh'], events: [[
  `UID:${uid}`, `DTSTAMP:${stamp()}`, `SEQUENCE:${seq}`, `DTSTART;TZID=Asia/Ho_Chi_Minh:${start}`, `DTEND;TZID=Asia/Ho_Chi_Minh:${end}`,
  `SUMMARY:${summary}`, `LOCATION:P301`, `DESCRIPTION:Noi dung cuoc hop ${uid}`,
  `ORGANIZER;CN=Successor A:mailto:successor-a@team-a.test`,
  `ATTENDEE;CN=Successor A;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:successor-a@team-a.test`,
  ...attendees,
]] });

// Remove this script's bookings from earlier runs (CalDAV DELETE of own test
// events; Nextcloud keeps them in the calendar trash bin) so the room slots are free.
const cleanup = {};
for (const [actor, uri] of [[organizer, 'cal16-team-a'], [member, 'personal'], [managerB, 'cal16-team-b']]) {
  const all = await calendarQuery(actor, calPath(actor.uid, uri), { expand: false });
  const stale = all.items.filter((i) => /cal16-(hop|room)/.test(i.href));
  for (const item of stale) await actor.request('DELETE', item.href);
  cleanup[`${actor.username}/${uri}`] = stale.length;
}
evidence.cleanupPreviousRuns = cleanup;
await sleep(1000);

// ---------- 1. invitation ----------
const uid = `cal16-hop-${run}`;
const summary = `Hop du an ${run}`;
const attendees = [
  attendeeLine('member-a@team-a.test', 'CN=Member A;CUTYPE=INDIVIDUAL;'),
  attendeeLine('manager-b@team-b.test', 'CN=Manager B;CUTYPE=INDIVIDUAL;'),
  attendeeLine('partner@partner.test', 'CN=Doi tac;CUTYPE=INDIVIDUAL;'),
  attendeeLine(room301, 'CN=P301;CUTYPE=ROOM;'),
  attendeeLine(projector, 'CN=May chieu;CUTYPE=RESOURCE;'),
];
const t0 = Date.now();
const put = await putIcs(organizer, `${teamCal}${uid}.ics`, event(uid, summary, '20261110T090000', '20261110T100000', attendees));
const putMs = Date.now() - t0;
const orgCopy = await organizer.request('GET', `${teamCal}${uid}.ics`);
const memberCopy = await waitFor(async () => (await calendarQuery(member, calPath(member.uid, 'personal'), { start: '20261110T000000Z', end: '20261111T000000Z', expand: false })).items.find((i) => i.data.includes(uid)));
const partnerMail = await mailWith('partner@partner.test', run);
const managerBMail = await mailWith('manager-b@team-b.test', run, () => true);
const memberMail = await waitFor(async () => (await listMessages('member-a@team-a.test')).find((m) => (m.subject ?? '').includes(run)), { timeoutMs: 3000 });
const roomMail = await waitFor(async () => (await listMessages(room301)).find((m) => (m.subject ?? '').includes(run)), { timeoutMs: 3000 });
const acceptLink = (/https?:\/\/[^\s"'<>]*\/apps\/dav\/invitation\/accept\/[A-Za-z0-9]+/.exec(partnerMail.value?.text ?? '') ?? [])[0] ?? null;
evidence.invitation = {
  put: put.status, putMs,
  organizerCopy: partstats(orgCopy.text),
  memberA: { deliveredToPersonalCalendar: Boolean(memberCopy.value), afterMs: memberCopy.ms, emailReceived: Boolean(memberMail.value) },
  managerB: { emailReceived: Boolean(managerBMail.value), viaIMip: managerBMail.value ? lines(managerBMail.value.calendar ?? '', 'METHOD')[0] ?? null : null, note: 'khác nhóm + shareapi_only_share_with_group_members → không tìm thấy principal nội bộ, Nextcloud coi là khách ngoài và gửi iMIP' },
  partner: partnerMail.value ? {
    afterMs: partnerMail.ms, subject: partnerMail.value.subject, from: partnerMail.value.from, replyTo: partnerMail.value.replyTo,
    partTypes: partnerMail.value.partTypes, method: partnerMail.value.calendarMethodParam, icsMethod: lines(partnerMail.value.calendar ?? '', 'METHOD'),
    icsHasSummary: (partnerMail.value.calendar ?? '').includes(summary), acceptLinkHost: acceptLink ? new URL(acceptLink).host : null,
  } : null,
  room301EmailReceived: Boolean(roomMail.value),
};
assert(put.status === 201 && memberCopy.value && partnerMail.value && lines(partnerMail.value.calendar ?? '', 'METHOD')[0] === 'METHOD:REQUEST', 'invitation delivered', evidence.invitation);
assert(evidence.invitation.organizerCopy[room301]?.partstat === 'ACCEPTED', 'room P301 auto-accepted for Team A organizer', evidence.invitation.organizerCopy);

// ---------- 2. replies ----------
// External partner: GET the accept link from the e-mail (host checked: only our own Nextcloud).
let partnerAccept = null;
if (acceptLink) {
  const link = new URL(acceptLink);
  assert(['nc13.localtest.me:18130', 'localhost:18130'].includes(link.host), 'accept link points to our Nextcloud', link.host);
  const click = async () => {
    const response = await fetch(`${ncBase}${link.pathname}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const page = await response.text();
    await sleep(500);
    const partstat = partstats((await organizer.request('GET', `${teamCal}${uid}.ics`)).text)['partner@partner.test']?.partstat;
    return { status: response.status, anonymous: true, page: /There was an error|error updating/i.test(page) ? 'schedule-response-error' : (/Response recorded|has been recorded|successfully/i.test(page) ? 'schedule-response-success' : 'other'), organizerCopyPartstat: partstat };
  };
  // (a) as configured (shareapi_only_share_with_group_members=yes, chat13 policy)
  const withGroupOnly = await click();
  // (b) root-cause check: the anonymous link handler resolves the organizer with
  // Principal::findByUri(), which returns null when "share with group members only"
  // is on and there is no user session (DOC). Toggle the policy off only for this
  // one click, then restore it in finally.
  let withoutGroupOnly = null;
  if (withGroupOnly.organizerCopyPartstat !== 'ACCEPTED') {
    await occ('config:app:set', 'core', 'shareapi_only_share_with_group_members', '--value=no');
    try { await sleep(3000); withoutGroupOnly = await click(); } finally { await occ('config:app:set', 'core', 'shareapi_only_share_with_group_members', '--value=yes'); }
  }
  partnerAccept = { withGroupMembersOnly: withGroupOnly, withPolicyTemporarilyOff: withoutGroupOnly, policyRestored: (await occ('config:app:get', 'core', 'shareapi_only_share_with_group_members')).stdout.trim() };
}
// member-a accepts in its own copy (what Thunderbird/iOS do).
const memberHref = memberCopy.value.href;
const memberGet = await member.request('GET', memberHref);
const accepted = memberGet.text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  .map((l) => (/^ATTENDEE/i.test(l) && /mailto:member-a@team-a\.test$/i.test(l) ? l.replace('PARTSTAT=NEEDS-ACTION', 'PARTSTAT=ACCEPTED') : l)).join('\r\n');
const memberReply = await putIcs(member, memberHref, accepted, { 'If-Match': memberGet.headers.get('etag') });
await sleep(1000);
const orgAfterReplies = partstats((await organizer.request('GET', `${teamCal}${uid}.ics`)).text);
evidence.replies = { partnerAcceptLink: partnerAccept, memberCalDavReply: memberReply.status, organizerCopy: orgAfterReplies, note: 'Link chấp nhận là GET công khai (không cần đăng nhập): trình quét link của hộp thư có thể tự "chấp nhận".' };
assert(orgAfterReplies['member-a@team-a.test']?.partstat === 'ACCEPTED', 'member-a reply reached organizer', evidence.replies);
assert(!acceptLink || (partnerAccept.withGroupMembersOnly.organizerCopyPartstat === 'ACCEPTED' || partnerAccept.withPolicyTemporarilyOff?.organizerCopyPartstat === 'ACCEPTED'), 'partner accept link works (at least without group-only policy)', evidence.replies);

// ---------- 3. rooms ----------
const booking = async (actor, calUri, bookingUid, email, start, end) => {
  const path = `${calPath(actor.uid, calUri)}${bookingUid}.ics`;
  const ics = vcalendar({ tzids: ['Asia/Ho_Chi_Minh'], events: [[
    `UID:${bookingUid}`, `DTSTAMP:${stamp()}`, `DTSTART;TZID=Asia/Ho_Chi_Minh:${start}`, `DTEND;TZID=Asia/Ho_Chi_Minh:${end}`, `SUMMARY:Dat phong ${bookingUid}`,
    `ORGANIZER:mailto:${actor === member ? 'member-a@team-a.test' : 'manager-b@team-b.test'}`,
    `ATTENDEE;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:${actor === member ? 'member-a@team-a.test' : 'manager-b@team-b.test'}`,
    attendeeLine(email, 'CUTYPE=ROOM;'),
  ]] });
  const res = await putIcs(actor, path, ics);
  const copy = await actor.request('GET', path);
  return { put: res.status, room: partstats(copy.text)[email] ?? null, path };
};
const conflict = await booking(member, 'personal', `cal16-room-conflict-${run}`, room301, '20261110T093000', '20261110T103000');
const free = await booking(member, 'personal', `cal16-room-free-${run}`, room301, '20261110T140000', '20261110T150000');
const teamBRestricted = await booking(managerB, 'cal16-team-b', `cal16-room-teamb-${run}`, room301, '20261111T090000', '20261111T100000');
const teamBRoomMail = await waitFor(async () => (await listMessages(room301)).find((m) => (m.subject ?? '').includes(`cal16-room-teamb-${run}`) || (m.calendar ?? '').includes(`cal16-room-teamb-${run}`)), { timeoutMs: 5000 });
const teamBShared = await booking(managerB, 'cal16-team-b', `cal16-room302-teamb-${run}`, room302, '20261111T090000', '20261111T100000');
const teamAShared = await booking(member, 'personal', `cal16-room302-teama-${run}`, room302, '20261111T093000', '20261111T094500');
// Free/busy of the rooms as Team B (no details) — the attendee picker of the Calendar app does this.
const roomFb = await freeBusy(managerB, 'manager-b@team-b.test', [room301, room302], '20261110T000000Z', '20261112T000000Z');
// Room calendars themselves must not be readable by users.
const roomCalendarHome = await managerB.dav('PROPFIND', '/remote.php/dav/calendars/calendar-rooms/', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>', { Depth: '1' });
evidence.rooms = {
  conflictSameSlot: conflict.room,
  freeSlot: free.room,
  teamBBooksRestrictedP301: { ...teamBRestricted.room, emailToRoomMailbox: Boolean(teamBRoomMail.value) },
  teamBBooksSharedP302: teamBShared.room,
  teamABooksP302OverlappingTeamB: teamAShared.room,
  roomFreeBusyAsTeamB: roomFb.responses.map((r) => ({ recipient: r.recipient, requestStatus: r.requestStatus, freebusy: lines(r.calendarData, 'FREEBUSY'), hasSummary: lines(r.calendarData, 'SUMMARY').length > 0 })),
  roomCalendarsListableByTeamB: roomCalendarHome.status,
};
assert(conflict.room?.partstat === 'DECLINED' && free.room?.partstat === 'ACCEPTED', 'room conflict declined, free slot accepted', evidence.rooms);
assert(teamBRestricted.room?.partstat !== 'ACCEPTED', 'Team B cannot book Team-A-restricted room', evidence.rooms.teamBBooksRestrictedP301);
assert(teamBShared.room?.partstat === 'ACCEPTED' && teamAShared.room?.partstat === 'DECLINED', 'shared room P302 first-come', evidence.rooms);
assert(roomFb.responses.every((r) => lines(r.calendarData, 'SUMMARY').length === 0) && !roomFb.text.includes(run), 'room free/busy has no details', evidence.rooms.roomFreeBusyAsTeamB);

// ---------- 4. update + cancel ----------
const current = await organizer.request('GET', `${teamCal}${uid}.ics`);
const moved = current.text
  .replace('DTSTART;TZID=Asia/Ho_Chi_Minh:20261110T090000', 'DTSTART;TZID=Asia/Ho_Chi_Minh:20261110T160000')
  .replace('DTEND;TZID=Asia/Ho_Chi_Minh:20261110T100000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261110T170000')
  .replace(/SEQUENCE:\d+/, 'SEQUENCE:1');
const updatePut = await putIcs(organizer, `${teamCal}${uid}.ics`, moved, { 'If-Match': current.headers.get('etag') });
const partnerUpdate = await mailWith('partner@partner.test', run, (m) => (m.calendar ?? '').includes('20261110T160000'));
const memberAfterUpdate = (await member.request('GET', memberHref)).text;
const orgAfterUpdate = partstats((await organizer.request('GET', `${teamCal}${uid}.ics`)).text);
const del = await organizer.request('DELETE', `${teamCal}${uid}.ics`);
const partnerCancel = await mailWith('partner@partner.test', run, (m) => lines(m.calendar ?? '', 'METHOD')[0] === 'METHOD:CANCEL');
const memberAfterCancel = await member.request('GET', memberHref);
// After cancellation the P301 slot is free again.
const rebook = await booking(member, 'personal', `cal16-room-rebook-${run}`, room301, '20261110T160000', '20261110T170000');
evidence.updateCancel = {
  update: { put: updatePut.status, partnerGotUpdate: Boolean(partnerUpdate.value), partnerUpdateMethod: lines(partnerUpdate.value?.calendar ?? '', 'METHOD')[0] ?? null, memberCopyMoved: memberAfterUpdate.includes('20261110T160000'), roomAfterMove: orgAfterUpdate[room301] ?? null },
  cancel: { delete: del.status, partnerGotCancel: Boolean(partnerCancel.value), memberCopyStatus: memberAfterCancel.status === 200 ? (lines(memberAfterCancel.text, 'STATUS')[0] ?? 'no STATUS') : `HTTP ${memberAfterCancel.status}` },
  roomRebookAfterCancel: rebook.room,
};
assert(updatePut.status === 204 && partnerUpdate.value && evidence.updateCancel.update.memberCopyMoved, 'update propagated', evidence.updateCancel.update);
assert(del.status === 204 && partnerCancel.value && /CANCELLED|HTTP 404/.test(evidence.updateCancel.cancel.memberCopyStatus), 'cancel propagated', evidence.updateCancel.cancel);

// ---------- 5. mail stayed local ----------
const allRecipients = {};
for (const address of ['partner@partner.test', 'manager-b@team-b.test', 'member-a@team-a.test', 'successor-a@team-a.test', room301, room302, projector]) {
  const messages = (await listMessages(address)).filter((m) => (m.subject ?? '').includes(run) || (m.calendar ?? '').includes(run));
  allRecipients[address] = messages.map((m) => ({ subject: m.subject, method: lines(m.calendar ?? '', 'METHOD')[0] ?? null }));
}
evidence.mailboxes = allRecipients;
await writeEvidence('acceptance-scheduling.json', evidence);
console.log(JSON.stringify(evidence, null, 1).slice(0, 8000));
