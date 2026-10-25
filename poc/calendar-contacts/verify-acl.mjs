// Chat16 deny/allow matrix for Calendar/Contacts, run live, after restart and on
// the restored stack: `node verify-acl.mjs <label>` → evidence/verify-acl-<label>.json.
// Base/containers come from CAL16_NC_BASE / CAL16_NC_CONTAINER / CAL16_RELAY_*.
// Probes are the requests the Calendar/Contacts web apps and DAV clients send
// (PROPFIND/REPORT/GET/PUT/DELETE/MOVE/PROPPATCH/ACL/share POST/export/search),
// against Team A resources as Team B, outsider and anonymous; plus Team A against
// Team B. A deny must be HTTP >= 400 with no fixture marker in the body, and
// writes must leave the fixture unchanged. Positive controls must succeed.
import { abHome, abPath, anonymous, calHome, calPath, client, ncBase, resetBruteforce, writeEvidence, assert } from './lib.mjs';
import { groupPrincipal, share, userPrincipal } from './dav-lib.mjs';

const label = process.argv[2] || 'live';
await resetBruteforce();
const owner = await client('successor-a');
const member = await client('member-a');
const managerB = await client('manager-b');
const memberB = await client('member-b');
const outsider = await client('outsider');
const anon = anonymous();
const markerA = 'CAL16-FIXTURE-TEAM-A';
const markerB = 'CAL16-FIXTURE-TEAM-B';
const teamACal = calPath(owner.uid, 'cal16-team-a');
const teamAAb = abPath(owner.uid, 'ab16-team-a');
const teamBCal = calPath(managerB.uid, 'cal16-team-b');
const teamBAb = abPath(managerB.uid, 'ab16-team-b');
const eventA = `${teamACal}cal16-fixture-a.ics`;
const cardA = `${teamAAb}cal16-fixture-card-a.vcf`;
const propfind = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getetag/></d:prop></d:propfind>';
const calQuery = '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>';
const abQuery = '<?xml version="1.0"?><card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop></card:addressbook-query>';
const syncBody = '<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>';
const fbBody = '<?xml version="1.0"?><c:free-busy-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:time-range start="20261101T000000Z" end="20261231T000000Z"/></c:free-busy-query>';
const ics = (uid) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//VCworkspace//chat16 deny//VI\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261025T000000Z\r\nDTSTART:20261202T020000Z\r\nDTEND:20261202T030000Z\r\nSUMMARY:deny probe\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const vcf = (uid) => `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:deny probe\r\nEND:VCARD\r\n`;

const probes = (actor, { cal, ab, event, card, ownerUid, marker }) => {
  const self = actor.uid ?? 'anonymous';
  const forgedCal = `${calHome(self)}${cal.split('/').filter(Boolean).pop()}_shared_by_${ownerUid}/`;
  const forgedAb = `${abHome(self)}${ab.split('/').filter(Boolean).pop()}_shared_by_${ownerUid}/`;
  return [
    ['PROPFIND calendar home of owner', () => actor.dav('PROPFIND', calHome(ownerUid), propfind, { Depth: '1' }), { markerOnly: true }],
    ['PROPFIND calendar depth 0', () => actor.dav('PROPFIND', cal, propfind, { Depth: '0' })],
    ['PROPFIND calendar depth 1', () => actor.dav('PROPFIND', cal, propfind, { Depth: '1' })],
    ['GET event', () => actor.request('GET', event)],
    ['GET event via forged shared path', () => actor.request('GET', `${forgedCal}${event.split('/').pop()}`)],
    ['GET calendar ?export', () => actor.request('GET', `${cal}?export`)],
    ['REPORT calendar-query', () => actor.dav('REPORT', cal, calQuery, { Depth: '1' })],
    ['REPORT sync-collection (calendar)', () => actor.dav('REPORT', cal, syncBody)],
    ['REPORT free-busy-query', () => actor.dav('REPORT', cal, fbBody, { Depth: '1' })],
    ['PUT new event', () => actor.request('PUT', `${cal}deny-${self.slice(0, 8)}.ics`, { body: ics(`deny-${self.slice(0, 8)}`), headers: { 'Content-Type': 'text/calendar' } }), { write: `${cal}deny-${self.slice(0, 8)}.ics` }],
    ['PUT overwrite event', () => actor.request('PUT', event, { body: ics('cal16-fixture-a'), headers: { 'Content-Type': 'text/calendar' } })],
    ['DELETE event', () => actor.request('DELETE', event)],
    ['MOVE event to own calendar', () => actor.request('MOVE', event, { headers: { Destination: `${ncBase}${calPath(self, 'personal')}stolen.ics` } })],
    ['PROPPATCH calendar displayname', () => actor.dav('PROPPATCH', cal, '<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>hijack</d:displayname></d:prop></d:set></d:propertyupdate>')],
    ['ACL grant self all', () => actor.dav('ACL', cal, `<?xml version="1.0"?><d:acl xmlns:d="DAV:"><d:ace><d:principal><d:href>/remote.php/dav/principals/users/${self}/</d:href></d:principal><d:grant><d:privilege><d:all/></d:privilege></d:grant></d:ace></d:acl>`)],
    ['POST share calendar to self (escalation)', () => share(actor, cal, userPrincipal(self), { readWrite: true })],
    ['POST share calendar to own group (escalation)', () => share(actor, cal, groupPrincipal('3e54c1d9f7d6edb3e6e1a4f065288afa0fcdc69840a13d3385a4838d724e33cf'), { readWrite: true })],
    ['legacy /remote.php/caldav GET event', () => actor.request('GET', event.replace('/remote.php/dav/calendars/', '/remote.php/caldav/calendars/'))],
    ['PROPFIND address book', () => actor.dav('PROPFIND', ab, propfind, { Depth: '1' })],
    ['GET card', () => actor.request('GET', card)],
    ['GET card via forged shared path', () => actor.request('GET', `${forgedAb}${card.split('/').pop()}`)],
    ['GET address book ?export', () => actor.request('GET', `${ab}?export`)],
    ['REPORT addressbook-query', () => actor.dav('REPORT', ab, abQuery, { Depth: '1' })],
    ['REPORT sync-collection (address book)', () => actor.dav('REPORT', ab, syncBody)],
    ['PUT new card', () => actor.request('PUT', `${ab}deny-${self.slice(0, 8)}.vcf`, { body: vcf(`deny-${self.slice(0, 8)}`), headers: { 'Content-Type': 'text/vcard' } }), { write: `${ab}deny-${self.slice(0, 8)}.vcf` }],
    ['DELETE card', () => actor.request('DELETE', card)],
    ['POST share address book to self (escalation)', () => share(actor, ab, userPrincipal(self), { readWrite: true })],
    ['legacy /remote.php/carddav GET card', () => actor.request('GET', card.replace('/remote.php/dav/addressbooks/users/', '/remote.php/carddav/addressbooks/'))],
    ['unified search calendar provider', () => actor.request('GET', `/ocs/v2.php/search/providers/calendar/search?term=${encodeURIComponent(marker)}&format=json`, { headers: { Accept: 'application/json' } }), { searchEmpty: true }],
    ['unified search contacts provider', () => actor.request('GET', `/ocs/v2.php/search/providers/contacts/search?term=${encodeURIComponent(marker)}&format=json`, { headers: { Accept: 'application/json' } }), { searchEmpty: true }],
  ];
};

const runMatrix = async (actor, target) => {
  const rows = [];
  for (const [name, fn, opts = {}] of probes(actor, target)) {
    const res = await fn();
    const body = typeof res.text === 'string' ? res.text : '';
    const leaked = body.includes(target.marker);
    let denied;
    if (opts.searchEmpty) denied = !leaked && (res.status >= 400 || (res.data?.ocs?.data?.entries ?? []).length === 0);
    else if (opts.markerOnly) denied = !leaked && !body.includes(target.cal);
    else denied = res.status >= 400 && !leaked;
    let createdAnyway = false;
    if (opts.write) createdAnyway = (await owner.request('GET', opts.write)).status === 200 || (await managerB.request('GET', opts.write)).status === 200;
    rows.push({ probe: name, status: res.status, denied: denied && !createdAnyway, leaked, createdAnyway });
  }
  return rows;
};

const etagBefore = (await owner.request('GET', eventA)).headers.get('etag');
const cardEtagBefore = (await owner.request('GET', cardA)).headers.get('etag');
const targetA = { cal: teamACal, ab: teamAAb, event: eventA, card: cardA, ownerUid: owner.uid, marker: markerA };
const targetB = { cal: teamBCal, ab: teamBAb, event: `${teamBCal}cal16-fixture-b.ics`, card: `${teamBAb}cal16-fixture-card-b.vcf`, ownerUid: managerB.uid, marker: markerB };
const matrix = {
  'manager-b→TeamA': await runMatrix(managerB, targetA),
  'member-b→TeamA': await runMatrix(memberB, targetA),
  'outsider→TeamA': await runMatrix(outsider, targetA),
  'anonymous→TeamA': await runMatrix(anon, targetA),
  'member-a→TeamB': await runMatrix(member, targetB),
};
await resetBruteforce();
const etagAfter = (await owner.request('GET', eventA)).headers.get('etag');
const cardEtagAfter = (await owner.request('GET', cardA)).headers.get('etag');
const sharedCal = `${calHome(member.uid)}cal16-team-a_shared_by_${owner.uid}/`;
const sharedAb = `${abHome(member.uid)}ab16-team-a_shared_by_${owner.uid}/`;
const positive = {
  ownerGetEvent: (await owner.request('GET', eventA)).status,
  memberGetEventViaShare: await member.request('GET', `${sharedCal}cal16-fixture-a.ics`).then((r) => ({ status: r.status, marker: r.text.includes(markerA) })),
  memberGetCardViaShare: await member.request('GET', `${sharedAb}cal16-fixture-card-a.vcf`).then((r) => ({ status: r.status, marker: r.text.includes(markerA) })),
  memberBGetTeamBViaShare: await memberB.request('GET', `${calHome(memberB.uid)}cal16-team-b_shared_by_${managerB.uid}/cal16-fixture-b.ics`).then((r) => ({ status: r.status, marker: r.text.includes(markerB) })),
  memberUnifiedSearchFindsFixture: await member.request('GET', `/ocs/v2.php/search/providers/calendar/search?term=${encodeURIComponent(markerA)}&format=json`, { headers: { Accept: 'application/json' } }).then((r) => (r.data?.ocs?.data?.entries ?? []).length),
};
const failures = Object.entries(matrix).flatMap(([who, rows]) => rows.filter((r) => !r.denied).map((r) => `${who}:${r.probe}:${r.status}`));
const summary = Object.fromEntries(Object.entries(matrix).map(([who, rows]) => [who, `${rows.filter((r) => r.denied).length}/${rows.length} deny`]));
await writeEvidence(`verify-acl-${label}.json`, { base: ncBase, summary, fixtureUnchanged: { event: etagBefore === etagAfter, card: cardEtagBefore === cardEtagAfter }, positive, failures, matrix });
console.log(JSON.stringify({ label, summary, positive, failures, fixtureUnchanged: etagBefore === etagAfter && cardEtagBefore === cardEtagAfter }, null, 1));
assert(failures.length === 0, 'all deny probes denied', failures);
assert(etagBefore === etagAfter && cardEtagBefore === cardEtagAfter, 'fixtures unchanged');
assert(positive.ownerGetEvent === 200 && positive.memberGetEventViaShare.status === 200 && positive.memberGetEventViaShare.marker && positive.memberGetCardViaShare.status === 200 && positive.memberBGetTeamBViaShare.status === 200 && positive.memberUnifiedSearchFindsFixture > 0, 'positive controls', positive);
