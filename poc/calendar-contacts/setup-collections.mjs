// Chat16: create the group-shared calendars/address books through CalDAV/CardDAV
// (MKCALENDAR / extended MKCOL + Nextcloud share POST, as the web apps do) with
// immutable ids: owner = persona uid (64-hex), sharee = federated group id.
//   successor-a: cal16-team-a (Team A read-write), cal16-team-a-thongbao (Team A read-only),
//                ab16-team-a (Team A read-write)
//   manager-b:   cal16-team-b (Team B read-write), ab16-team-b (Team B read-write)
//   member-b:    cal16-member-b (Team B read-only) — the offboarding subject
// Idempotent: existing collections are kept (MKCALENDAR/MKCOL 405), shares re-applied.
import { abPath, calPath, client, teamGroups, writeEvidence } from './lib.mjs';
import { groupPrincipal, invites, mkaddressbook, mkcalendar, share, stamp, vcalendar, vcard } from './dav-lib.mjs';

const plan = [
  { owner: 'successor-a', kind: 'cal', uri: 'cal16-team-a', name: 'Lich Team A', group: teamGroups.a, readWrite: true },
  { owner: 'successor-a', kind: 'cal', uri: 'cal16-team-a-thongbao', name: 'Thong bao Team A (chi doc)', group: teamGroups.a, readWrite: false },
  { owner: 'successor-a', kind: 'ab', uri: 'ab16-team-a', name: 'Danh ba Team A', group: teamGroups.a, readWrite: true },
  { owner: 'manager-b', kind: 'cal', uri: 'cal16-team-b', name: 'Lich Team B', group: teamGroups.b, readWrite: true },
  { owner: 'manager-b', kind: 'ab', uri: 'ab16-team-b', name: 'Danh ba Team B', group: teamGroups.b, readWrite: true },
  { owner: 'member-b', kind: 'cal', uri: 'cal16-member-b', name: 'Lich member-b (ban giao)', group: teamGroups.b, readWrite: false },
  { owner: 'member-b', kind: 'ab', uri: 'ab16-member-b', name: 'Danh ba rieng member-b', group: null },
];
const out = [];
for (const item of plan) {
  const actor = await client(item.owner);
  const path = item.kind === 'cal' ? calPath(actor.uid, item.uri) : abPath(actor.uid, item.uri);
  const created = item.kind === 'cal' ? await mkcalendar(actor, item.uri, item.name) : await mkaddressbook(actor, item.uri, item.name);
  if (![201, 405].includes(created.status)) throw new Error(`CREATE_${item.uri}_${created.status}:${created.text.slice(0, 300)}`);
  let shared = null;
  if (item.group) {
    const res = await share(actor, path, groupPrincipal(item.group), { readWrite: item.readWrite });
    if (res.status !== 200) throw new Error(`SHARE_${item.uri}_${res.status}:${res.text.slice(0, 300)}`);
    shared = await invites(actor, path);
  }
  out.push({ owner: item.owner, ownerUid: actor.uid, kind: item.kind, uri: item.uri, path, created: created.status === 201 ? 'created' : 'existed', sharees: shared?.sharees ?? [] });
}
// Fixed fixtures for verify-acl.mjs (live, after restart, after restore). Created
// once (If-None-Match: *), never modified afterwards.
const fixtures = [
  ['successor-a', calPath, 'cal16-team-a', 'cal16-fixture-a.ics', 'text/calendar', vcalendar({ events: [['UID:cal16-fixture-a', `DTSTAMP:${stamp()}`, 'DTSTART:20261201T020000Z', 'DTEND:20261201T030000Z', 'SUMMARY:CAL16-FIXTURE-TEAM-A hop noi bo', 'DESCRIPTION:CAL16-FIXTURE-TEAM-A noi dung', 'LOCATION:CAL16-FIXTURE-TEAM-A P301']] })],
  ['manager-b', calPath, 'cal16-team-b', 'cal16-fixture-b.ics', 'text/calendar', vcalendar({ events: [['UID:cal16-fixture-b', `DTSTAMP:${stamp()}`, 'DTSTART:20261201T020000Z', 'DTEND:20261201T030000Z', 'SUMMARY:CAL16-FIXTURE-TEAM-B hop noi bo']] })],
  ['successor-a', abPath, 'ab16-team-a', 'cal16-fixture-card-a.vcf', 'text/vcard', vcard(['VERSION:3.0', 'UID:cal16-fixture-card-a', 'FN:CAL16-FIXTURE-TEAM-A Khach hang', 'EMAIL:fixture-a@partner.test'])],
  ['manager-b', abPath, 'ab16-team-b', 'cal16-fixture-card-b.vcf', 'text/vcard', vcard(['VERSION:3.0', 'UID:cal16-fixture-card-b', 'FN:CAL16-FIXTURE-TEAM-B Khach hang', 'EMAIL:fixture-b@partner.test'])],
];
const fixtureResults = [];
for (const [ownerName, pathFn, uri, name, type, body] of fixtures) {
  const actor = await client(ownerName);
  const res = await actor.request('PUT', `${pathFn(actor.uid, uri)}${name}`, { body, headers: { 'Content-Type': `${type}; charset=utf-8`, 'If-None-Match': '*' } });
  if (![201, 412].includes(res.status)) throw new Error(`FIXTURE_${name}_${res.status}`);
  fixtureResults.push({ owner: ownerName, uri, name, created: res.status === 201 });
}
await writeEvidence('collections.json', { collections: out, fixtures: fixtureResults });
console.log(JSON.stringify(out.map((o) => ({ uri: o.uri, created: o.created, sharees: o.sharees })), null, 1));
