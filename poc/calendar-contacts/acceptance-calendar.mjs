// Chat16 Calendar acceptance over CalDAV (the same requests the Calendar web app
// and DAV clients send), personas with immutable uid + app password:
//  A. group-shared calendars: Team A sees both shares, read-write vs read-only
//  B. ETag/If-Match conflict between two Team A writers
//  C. CLASS:PRIVATE / CONFIDENTIAL in a group-shared calendar
//  D. recurring event with EXDATE + overridden instance (RECURRENCE-ID), expand
//  E. time zones Asia/Ho_Chi_Minh + America/New_York across the 2026-11-01 DST end,
//     plus the non-existent (2026-03-08 02:30) and ambiguous (2026-11-01 01:30) local times
//  F. sync-token incremental sync (add/modify/delete) + invalid token
//  G. free/busy: busy periods only, no event details, for Team B and outsider
import { calHome, calPath, client, resetBruteforce, writeEvidence, assert } from './lib.mjs';
import { calendarQuery, freeBusy, lines, putIcs, stamp, syncCollection, vcalendar } from './dav-lib.mjs';

await resetBruteforce();
const owner = await client('successor-a');
const member = await client('member-a');
const managerB = await client('manager-b');
const outsider = await client('outsider');
const run = Date.now().toString(36);
const secretMarker = `CAL16-BIMAT-${run}`;
const teamCal = calPath(owner.uid, 'cal16-team-a');
const roCal = calPath(owner.uid, 'cal16-team-a-thongbao');
const sharedPath = (actor, uri) => `${calHome(actor.uid)}${uri}_shared_by_${owner.uid}/`;
const memberTeamCal = sharedPath(member, 'cal16-team-a');
const memberRoCal = sharedPath(member, 'cal16-team-a-thongbao');
const evidence = { run, marker: secretMarker };
const ev = (uid, extra) => [`UID:${uid}`, `DTSTAMP:${stamp()}`, ...extra];

// ---------- A. shared calendars ----------
const homeListing = async (actor) => {
  const res = await actor.dav('PROPFIND', calHome(actor.uid), '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '1' });
  return [...res.text.matchAll(/<d:href>([^<]*)<\/d:href>/g)].map((m) => m[1]);
};
const memberHome = await homeListing(member);
const managerBHome = await homeListing(managerB);
const outsiderHome = await homeListing(outsider);
assert(memberHome.includes(memberTeamCal) && memberHome.includes(memberRoCal), 'member-a sees both Team A shares', memberHome);
assert(!managerBHome.some((h) => h.includes(owner.uid)) && !outsiderHome.some((h) => h.includes(owner.uid)), 'Team B/outsider do not see Team A shares');
const memberEventUid = `cal16-member-${run}`;
const memberPut = await putIcs(member, `${memberTeamCal}${memberEventUid}.ics`, vcalendar({ tzids: ['Asia/Ho_Chi_Minh'], events: [ev(memberEventUid, ['DTSTART;TZID=Asia/Ho_Chi_Minh:20261103T090000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261103T100000', `SUMMARY:Hop nhom do member-a tao ${run}`])] }));
const ownerSeesMember = await owner.request('GET', `${teamCal}${memberEventUid}.ics`);
const roPutByMember = await putIcs(member, `${memberRoCal}ro-${run}.ics`, vcalendar({ events: [ev(`ro-${run}`, ['DTSTART:20261104T020000Z', 'DTEND:20261104T030000Z', 'SUMMARY:khong duoc ghi'])] }));
const roOwnerPut = await putIcs(owner, `${roCal}tb-${run}.ics`, vcalendar({ events: [ev(`tb-${run}`, ['DTSTART:20261104T020000Z', 'DTEND:20261104T030000Z', `SUMMARY:Thong bao ${run}`])] }));
const roMemberGet = await member.request('GET', `${memberRoCal}tb-${run}.ics`);
const roMemberDelete = await member.request('DELETE', `${memberRoCal}tb-${run}.ics`);
const roNotCreated = await owner.request('GET', `${roCal}ro-${run}.ics`);
const roStillThere = await owner.request('GET', `${roCal}tb-${run}.ics`);
evidence.shared = {
  memberSeesShares: [memberTeamCal, memberRoCal].map((p) => p.replace(member.uid, '<member-a>').replace(owner.uid, '<successor-a>')),
  teamBOrOutsiderSeeTeamA: false,
  readWrite: { memberPut: memberPut.status, ownerReadsMemberEvent: ownerSeesMember.status },
  readOnly: { memberPut: roPutByMember.status, ownerPut: roOwnerPut.status, memberGet: roMemberGet.status, memberDelete: roMemberDelete.status, ownerGetOfMemberPut: roNotCreated.status, ownerGetAfterMemberDelete: roStillThere.status },
};
assert(memberPut.status === 201 && ownerSeesMember.status === 200, 'read-write share works', evidence.shared.readWrite);
assert([403, 404].includes(roPutByMember.status) && roNotCreated.status === 404 && roOwnerPut.status === 201 && roMemberGet.status === 200 && [403, 404].includes(roMemberDelete.status) && roStillThere.status === 200, 'read-only share enforced', evidence.shared.readOnly);

// ---------- B. If-Match conflict ----------
const conflictUid = `cal16-conflict-${run}`;
const base = (summary) => vcalendar({ events: [ev(conflictUid, ['DTSTART:20261105T020000Z', 'DTEND:20261105T030000Z', `SUMMARY:${summary}`])] });
const created = await putIcs(owner, `${teamCal}${conflictUid}.ics`, base('ban dau'), { 'If-None-Match': '*' });
const etag = created.headers.get('etag');
// Sequential (offline client with a stale ETag): must be refused.
const w1 = await putIcs(owner, `${teamCal}${conflictUid}.ics`, base('sua boi successor-a'), { 'If-Match': etag });
const w2 = await putIcs(member, `${memberTeamCal}${conflictUid}.ics`, base('sua boi member-a (ETag cu)'), { 'If-Match': etag });
const staleDelete = await member.request('DELETE', `${memberTeamCal}${conflictUid}.ics`, { headers: { 'If-Match': etag } });
const createAgain = await putIcs(member, `${memberTeamCal}${conflictUid}.ics`, base('tao trung'), { 'If-None-Match': '*' });
const final = await owner.request('GET', `${teamCal}${conflictUid}.ics`);
// Truly concurrent writers with the same ETag (10 rounds): record, do not assume.
const rounds = [];
for (let i = 0; i < 10; i += 1) {
  const current = (await owner.request('GET', `${teamCal}${conflictUid}.ics`)).headers.get('etag');
  const [a, b] = await Promise.all([
    putIcs(owner, `${teamCal}${conflictUid}.ics`, base(`dong thoi ${i} successor-a`), { 'If-Match': current }),
    putIcs(member, `${memberTeamCal}${conflictUid}.ics`, base(`dong thoi ${i} member-a`), { 'If-Match': current }),
  ]);
  rounds.push([a.status, b.status].sort().join('+'));
}
const tally = rounds.reduce((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
evidence.etagConflict = { created: created.status, etagPresent: Boolean(etag), sequential: { winner: w1.status, staleEtagPut: w2.status, staleEtagDelete: staleDelete.status }, ifNoneMatchOnExisting: createAgain.status, finalSummary: lines(final.text, 'SUMMARY')[0], concurrentSameEtag10Rounds: tally, lostUpdateRounds: rounds.filter((r) => r === '204+204').length };
assert(w1.status === 204 && w2.status === 412 && staleDelete.status === 412 && createAgain.status === 412 && /successor-a/.test(evidence.etagConflict.finalSummary), 'stale ETag refused (412)', evidence.etagConflict);

// ---------- C. PRIVATE / CONFIDENTIAL ----------
const classify = async (ownerCal, memberCal, label) => {
  const privUid = `cal16-private-${label}-${run}`;
  const confUid = `cal16-confidential-${label}-${run}`;
  const marker = `${secretMarker}-${label}`;
  await putIcs(owner, `${ownerCal}${privUid}.ics`, vcalendar({ events: [ev(privUid, ['CLASS:PRIVATE', 'DTSTART:20261106T020000Z', 'DTEND:20261106T030000Z', `SUMMARY:Rieng tu ${marker}`, `LOCATION:Phong kin ${marker}`, `DESCRIPTION:Noi dung ${marker}`])] }));
  await putIcs(owner, `${ownerCal}${confUid}.ics`, vcalendar({ events: [ev(confUid, ['CLASS:CONFIDENTIAL', 'DTSTART:20261106T040000Z', 'DTEND:20261106T050000Z', `SUMMARY:Mat ${marker}`, `LOCATION:Phong mat ${marker}`, `DESCRIPTION:Noi dung mat ${marker}`])] }));
  const privGet = await member.request('GET', `${memberCal}${privUid}.ics`);
  const confGet = await member.request('GET', `${memberCal}${confUid}.ics`);
  const query = await calendarQuery(member, memberCal, { start: '20261106T000000Z', end: '20261107T000000Z', expand: false });
  const sync = await syncCollection(member, memberCal, '');
  const ownerPrivGet = await owner.request('GET', `${ownerCal}${privUid}.ics`);
  return {
    private: { memberGet: privGet.status, inQuery: query.items.some((i) => i.href.includes(privUid)), hrefInSyncCollection: sync.changed.some((c) => c.href.includes(privUid)) || sync.text.includes(privUid), markerLeaked: privGet.text.includes(marker) || query.text.includes(`Rieng tu ${marker}`), ownerGet: ownerPrivGet.status },
    confidential: { memberGet: confGet.status, inQuery: query.items.some((i) => i.href.includes(confUid)), markerLeaked: confGet.text.includes(marker) || query.text.includes(`Mat ${marker}`), memberSees: { summary: lines(confGet.text, 'SUMMARY'), location: lines(confGet.text, 'LOCATION'), description: lines(confGet.text, 'DESCRIPTION'), dtstart: lines(confGet.text, 'DTSTART') } },
  };
};
evidence.classification = {
  readWriteShare: await classify(teamCal, memberTeamCal, 'rw'),
  readOnlyShare: await classify(roCal, memberRoCal, 'ro'),
};
const { readWriteShare: rw, readOnlyShare: ro } = evidence.classification;
assert(!rw.private.markerLeaked && !ro.private.markerLeaked && rw.private.memberGet === 404 && ro.private.memberGet === 404, 'PRIVATE hidden from every sharee', evidence.classification);
assert(!ro.confidential.markerLeaked && ro.confidential.memberGet === 200, 'CONFIDENTIAL shown only as busy to read-only sharee', ro.confidential);

// ---------- D. recurrence with exceptions ----------
const recUid = `cal16-recur-${run}`;
const recIcs = vcalendar({ tzids: ['Asia/Ho_Chi_Minh'], events: [
  ev(recUid, ['DTSTART;TZID=Asia/Ho_Chi_Minh:20261102T090000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261102T100000', 'RRULE:FREQ=WEEKLY;COUNT=6', 'EXDATE;TZID=Asia/Ho_Chi_Minh:20261116T090000', `SUMMARY:Giao ban tuan ${run}`]),
  ev(recUid, ['RECURRENCE-ID;TZID=Asia/Ho_Chi_Minh:20261123T090000', 'DTSTART;TZID=Asia/Ho_Chi_Minh:20261123T140000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261123T150000', `SUMMARY:Giao ban tuan (doi gio) ${run}`]),
] });
const recPut = await putIcs(owner, `${teamCal}${recUid}.ics`, recIcs);
const expanded = await calendarQuery(member, memberTeamCal, { start: '20261101T000000Z', end: '20261215T000000Z' });
const recItem = expanded.items.find((i) => i.href.includes(recUid));
const instances = recItem ? lines(recItem.data, 'DTSTART').map((l) => l.split(':')[1]) : [];
const recurrenceIds = recItem ? lines(recItem.data, 'RECURRENCE-ID').map((l) => l.split(':')[1]) : [];
// Change a single occurrence later (what a client does for "only this event"): cancel 2026-11-30.
const recGet = await owner.request('GET', `${teamCal}${recUid}.ics`);
const withCancel = recGet.text.replace('END:VCALENDAR', ['BEGIN:VEVENT', `UID:${recUid}`, `DTSTAMP:${stamp()}`, 'RECURRENCE-ID;TZID=Asia/Ho_Chi_Minh:20261130T090000', 'DTSTART;TZID=Asia/Ho_Chi_Minh:20261130T090000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261130T100000', 'STATUS:CANCELLED', `SUMMARY:Giao ban tuan (huy) ${run}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
const recPut2 = await putIcs(owner, `${teamCal}${recUid}.ics`, withCancel, { 'If-Match': recGet.headers.get('etag') });
const expanded2 = await calendarQuery(member, memberTeamCal, { start: '20261101T000000Z', end: '20261215T000000Z' });
const recItem2 = expanded2.items.find((i) => i.href.includes(recUid));
const statuses = recItem2 ? recItem2.data.split('BEGIN:VEVENT').slice(1).map((b) => ({ start: (/DTSTART[^:]*:(\S+)/.exec(b) ?? [])[1], status: (/STATUS:(\S+)/.exec(b) ?? [])[1] ?? 'CONFIRMED' })) : [];
evidence.recurrence = { put: recPut.status, expandedStartsUtc: instances, recurrenceIds, afterCancellingOne: { put: recPut2.status, instances: statuses } };
assert(JSON.stringify(instances) === JSON.stringify(['20261102T020000Z', '20261109T020000Z', '20261123T070000Z', '20261130T020000Z', '20261207T020000Z']), 'recurrence expand with EXDATE + override', instances);
assert(recPut2.status === 204 && statuses.find((s) => s.start === '20261130T020000Z')?.status === 'CANCELLED', 'single occurrence cancelled', statuses);

// ---------- E. time zones and DST ----------
const nyUid = `cal16-ny-${run}`;
const nyPut = await putIcs(owner, `${teamCal}${nyUid}.ics`, vcalendar({ tzids: ['America/New_York'], events: [ev(nyUid, ['DTSTART;TZID=America/New_York:20261022T090000', 'DTEND;TZID=America/New_York:20261022T093000', 'RRULE:FREQ=WEEKLY;COUNT=4', `SUMMARY:Hop doi tac New York ${run}`])] }));
const nyExpanded = await calendarQuery(member, memberTeamCal, { start: '20261020T000000Z', end: '20261120T000000Z' });
const nyStarts = lines(nyExpanded.items.find((i) => i.href.includes(nyUid))?.data ?? '', 'DTSTART').map((l) => l.split(':')[1]);
const hcmLocal = (utc) => { const d = new Date(`${utc.slice(0, 4)}-${utc.slice(4, 6)}-${utc.slice(6, 8)}T${utc.slice(9, 11)}:${utc.slice(11, 13)}:00Z`); return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); };
const edgeGap = `cal16-dst-gap-${run}`;
const edgeOverlap = `cal16-dst-overlap-${run}`;
await putIcs(owner, `${teamCal}${edgeGap}.ics`, vcalendar({ tzids: ['America/New_York'], events: [ev(edgeGap, ['DTSTART;TZID=America/New_York:20260308T023000', 'DTEND;TZID=America/New_York:20260308T033000', 'SUMMARY:gio khong ton tai'])] }));
await putIcs(owner, `${teamCal}${edgeOverlap}.ics`, vcalendar({ tzids: ['America/New_York'], events: [ev(edgeOverlap, ['DTSTART;TZID=America/New_York:20261101T013000', 'DTEND;TZID=America/New_York:20261101T020000', 'SUMMARY:gio lap lai'])] }));
const gapQ = await calendarQuery(owner, teamCal, { start: '20260308T000000Z', end: '20260309T000000Z' });
const overlapQ = await calendarQuery(owner, teamCal, { start: '20261101T000000Z', end: '20261102T000000Z' });
const firstStart = (q, uid) => lines(q.items.find((i) => i.href.includes(uid))?.data ?? '', 'DTSTART')[0]?.split(':')[1];
// Same wall-clock meeting stored with the HCM zone (no DST) stays at 02:00Z.
const hcmUid = `cal16-hcm-${run}`;
await putIcs(owner, `${teamCal}${hcmUid}.ics`, vcalendar({ tzids: ['Asia/Ho_Chi_Minh'], events: [ev(hcmUid, ['DTSTART;TZID=Asia/Ho_Chi_Minh:20261029T090000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261029T100000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Hop HCM'])] }));
const hcmQ = await calendarQuery(owner, teamCal, { start: '20261028T000000Z', end: '20261110T000000Z' });
const hcmStarts = lines(hcmQ.items.find((i) => i.href.includes(hcmUid))?.data ?? '', 'DTSTART').map((l) => l.split(':')[1]);
evidence.timezones = {
  newYorkWeekly0900: { put: nyPut.status, startsUtc: nyStarts, inHoChiMinh: nyStarts.map(hcmLocal) },
  hoChiMinhWeekly0900: { startsUtc: hcmStarts },
  dstGap20260308_0230NY: { storedAs: 'DTSTART;TZID=America/New_York:20260308T023000', expandedUtc: firstStart(gapQ, edgeGap) },
  dstOverlap20261101_0130NY: { storedAs: 'DTSTART;TZID=America/New_York:20261101T013000', expandedUtc: firstStart(overlapQ, edgeOverlap) },
};
assert(JSON.stringify(nyStarts) === JSON.stringify(['20261022T130000Z', '20261029T130000Z', '20261105T140000Z', '20261112T140000Z']), 'NY weekly crosses DST end', nyStarts);
assert(JSON.stringify(hcmStarts) === JSON.stringify(['20261029T020000Z', '20261105T020000Z']), 'HCM has no DST', hcmStarts);

// ---------- F. sync-token ----------
const initial = await syncCollection(member, memberTeamCal, '');
const syncUid = `cal16-sync-${run}`;
await putIcs(owner, `${teamCal}${syncUid}.ics`, vcalendar({ events: [ev(syncUid, ['DTSTART:20261110T020000Z', 'DTEND:20261110T030000Z', 'SUMMARY:sync 1'])] }));
const s1 = await syncCollection(member, memberTeamCal, initial.token);
await putIcs(owner, `${teamCal}${syncUid}.ics`, vcalendar({ events: [ev(syncUid, ['DTSTART:20261110T020000Z', 'DTEND:20261110T040000Z', 'SUMMARY:sync 2'])] }));
const s2 = await syncCollection(member, memberTeamCal, s1.token);
await owner.request('DELETE', `${teamCal}${syncUid}.ics`);
const s3 = await syncCollection(member, memberTeamCal, s2.token);
const s4 = await syncCollection(member, memberTeamCal, s3.token);
const future = await syncCollection(member, memberTeamCal, 'http://sabre.io/ns/sync/999999999');
const bad = await syncCollection(member, memberTeamCal, 'urn:vcw:not-a-token');
const badB = await syncCollection(managerB, memberTeamCal, initial.token);
const short = (r) => ({ status: r.status, token: r.token?.replace('http://sabre.io/ns/sync/', ''), changed: r.changed.map((c) => c.href.split('/').pop()), removed: r.removed.map((h) => h.split('/').pop()) });
evidence.syncToken = { initialCount: initial.changed.length, initialToken: initial.token, afterAdd: short(s1), afterModify: short(s2), afterDelete: short(s3), noChange: short(s4), invalidToken: { status: bad.status, body: bad.text.slice(0, 300) }, futureToken: short(future), teamBWithValidToken: badB.status };
assert(s1.changed.some((c) => c.href.endsWith(`${syncUid}.ics`)) && s1.changed.length === 1, 'sync add', s1);
assert(s2.changed.length === 1 && s3.removed.some((h) => h.endsWith(`${syncUid}.ics`)) && s4.changed.length === 0 && s4.removed.length === 0, 'sync modify/delete', { s2: short(s2), s3: short(s3), s4: short(s4) });
assert([400, 403, 507].includes(bad.status) && [403, 404].includes(badB.status), 'invalid token / Team B refused', { bad: bad.status, badB: badB.status });

// ---------- G. free/busy ----------
const fbRange = ['20261102T000000Z', '20261108T000000Z'];
const fb = {};
for (const [name, actor, email] of [['manager-b', managerB, 'manager-b@team-b.test'], ['outsider', outsider, 'manager-a@outsider.test'], ['member-a', member, 'member-a@team-a.test']]) {
  const res = await freeBusy(actor, email, ['successor-a@team-a.test', 'member-a@team-a.test'], ...fbRange);
  fb[name] = {
    status: res.status,
    perRecipient: res.responses.map((r) => ({ recipient: r.recipient, requestStatus: r.requestStatus, freebusy: lines(r.calendarData, 'FREEBUSY'), detailProps: ['SUMMARY', 'LOCATION', 'DESCRIPTION', 'CLASS', 'CATEGORIES'].filter((p) => lines(r.calendarData, p).length), otherAttendees: lines(r.calendarData, 'ATTENDEE').filter((l) => !l.toLowerCase().endsWith(r.recipient.toLowerCase())) })),
    markerLeaked: res.text.includes(secretMarker) || res.text.includes(run),
  };
}
// Calendar-collection free-busy-query by Team B on Team A's calendar.
const fbq = await managerB.dav('REPORT', teamCal, `<?xml version="1.0"?><c:free-busy-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:time-range start="${fbRange[0]}" end="${fbRange[1]}"/></c:free-busy-query>`, { Depth: '1' });
const fbqMember = await member.dav('REPORT', memberTeamCal, `<?xml version="1.0"?><c:free-busy-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:time-range start="${fbRange[0]}" end="${fbRange[1]}"/></c:free-busy-query>`, { Depth: '1' });
// Spoofed organizer (Team B asks as if it were successor-a).
const spoof = await freeBusy(managerB, 'successor-a@team-a.test', ['member-a@team-a.test'], ...fbRange);
evidence.freeBusy = { range: fbRange, viaOutbox: fb, collectionReport: { teamB: fbq.status, memberA: fbqMember.status, memberAFreebusyLines: lines(fbqMember.text, 'FREEBUSY').length }, spoofedOrganizer: { status: spoof.status, body: spoof.text.slice(0, 200) } };
for (const [name, r] of Object.entries(fb)) {
  assert(r.status === 200 && !r.markerLeaked && r.perRecipient.every((p) => p.detailProps.length === 0 && p.otherAttendees.length === 0), `free/busy has no details (${name})`, r);
}
assert([403, 404].includes(fbq.status) && spoof.status >= 400, 'Team B cannot query Team A collection or spoof organizer', { fbq: fbq.status, spoof: spoof.status });

await writeEvidence('acceptance-calendar.json', evidence);
console.log(JSON.stringify(evidence, null, 1).slice(0, 6000));
