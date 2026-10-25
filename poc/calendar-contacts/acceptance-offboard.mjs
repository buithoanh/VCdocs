// Chat16 offboarding of member-b (Team B leaver) for Calendar/Contacts:
//  1. seed: member-b's group-shared calendar cal16-member-b (2 events, one it
//     organizes with manager-b invited) + private address book ab16-member-b (2 cards)
//  2. export: admin-side `occ calendar:export` (no leaver credential) and the
//     address book via CardDAV with the leaver's own app password before revoke
//  3. transfer: `occ dav:move-calendar` to manager-b (successor), import cards into a
//     new manager-b address book through CardDAV
//  4. revoke: two devices (two app passwords). Delete token #1 with occ → time to 401
//     (chat15: ~10 s APCu token cache); then `occ user:disable` → device #2 status
//  5. readback: successor owns the calendar + events, Team B still sees it, leaver
//     denied everywhere; attendee copies keep ORGANIZER = leaver (finding)
//  6. restore the persona (enable + fresh cal16 token) so the PoC can be re-run.
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abHome, abPath, calHome, calPath, client, occ, occJson, resetBruteforce, secretsDir, sleep, writeEvidence, assert } from './lib.mjs';
import { calendarQuery, lines, mkaddressbook, mkcalendar, putIcs, putVcf, share, groupPrincipal, stamp, vcalendar, vcard } from './dav-lib.mjs';
import { teamGroups } from './lib.mjs';

await resetBruteforce();
const leaver = await client('member-b');
const successor = await client('manager-b');
const outsider = await client('outsider');
const run = Date.now().toString(36);
const evidence = { run, leaver: 'member-b', successor: 'manager-b' };
const calUri = 'cal16-member-b';

// ---------- 1. seed ----------
const mk = await mkcalendar(leaver, calUri, 'Lich member-b (ban giao)');
if (mk.status === 201) await share(leaver, calPath(leaver.uid, calUri), groupPrincipal(teamGroups.b), { readWrite: false });
await mkaddressbook(leaver, 'ab16-member-b', 'Danh ba rieng member-b');
const legacyEvent = `off-${run}`;
const organized = `off-org-${run}`;
await putIcs(leaver, `${calPath(leaver.uid, calUri)}${legacyEvent}.ics`, vcalendar({ events: [[`UID:${legacyEvent}`, `DTSTAMP:${stamp()}`, 'DTSTART:20261207T020000Z', 'DTEND:20261207T030000Z', `SUMMARY:Viec ban giao ${run}`]] }));
await putIcs(leaver, `${calPath(leaver.uid, calUri)}${organized}.ics`, vcalendar({ events: [[`UID:${organized}`, `DTSTAMP:${stamp()}`, 'DTSTART:20261208T020000Z', 'DTEND:20261208T030000Z', `SUMMARY:Hop do member-b to chuc ${run}`, 'ORGANIZER;CN=Member B:mailto:member-b@team-b.test', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:member-b@team-b.test', 'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:manager-b@team-b.test']] }));
for (const i of [1, 2]) await putVcf(leaver, `${abPath(leaver.uid, 'ab16-member-b')}off-${run}-${i}.vcf`, vcard(['VERSION:3.0', `UID:off-${run}-${i}`, `FN:Doi tac rieng ${i} ${run}`, `EMAIL:doitac${i}@partner.test`]));
// Second device: an extra app password for the leaver (minted like a phone would get it).
const { stdout: second } = await occ('user:auth-tokens:add', '--name=cal16-device2', leaver.uid);
const device2 = await client('member-b', { password: second.trim().split('\n').map((l) => l.trim()).filter(Boolean).at(-1) });

// ---------- 2. export ----------
const exportCal = await occ('calendar:export', leaver.uid, calUri);
const icsExport = exportCal.stdout;
const abExport = await leaver.request('GET', `${abPath(leaver.uid, 'ab16-member-b')}?export`);
evidence.export = {
  calendarViaOcc: { events: (icsExport.match(/BEGIN:VEVENT/g) ?? []).length, containsRunEvents: icsExport.includes(legacyEvent) && icsExport.includes(organized) },
  addressBookViaLeaverToken: { status: abExport.status, cards: (abExport.text.match(/BEGIN:VCARD/g) ?? []).length },
};

// ---------- 3. transfer ----------
const calendarUris = async () => (await occ('dav:list-calendars', successor.uid)).stdout.split('\n').map((l) => l.split('|').map((c) => c.trim())[1]).filter((u) => u && u !== 'URI');
const urisBefore = await calendarUris();
let moveOut;
if (urisBefore.includes(calUri)) {
  // A previous run already moved one: rename via --force to avoid the conflict.
  moveOut = await occ('dav:move-calendar', '--force', calUri, leaver.uid, successor.uid).catch((e) => ({ stdout: `${e.stdout}${e.stderr}` }));
} else {
  moveOut = await occ('dav:move-calendar', calUri, leaver.uid, successor.uid).catch((e) => ({ stdout: `${e.stdout}${e.stderr}` }));
}
const movedUri = (await calendarUris()).find((u) => !urisBefore.includes(u)) ?? null;
const newAb = `ab16-from-member-b-${run}`;
await mkaddressbook(successor, newAb, `Danh ba tiep nhan tu member-b ${run}`);
const imported = [];
for (const card of abExport.text.split(/(?=BEGIN:VCARD)/).filter((c) => c.includes('BEGIN:VCARD'))) {
  const uid = (/^UID:(.+)$/m.exec(card) ?? [])[1].trim();
  imported.push((await putVcf(successor, `${abPath(successor.uid, newAb)}${uid}.vcf`, card)).status);
}
evidence.transfer = { moveCalendar: moveOut.stdout.trim().split('\n').slice(-2).join(' ') || 'ok', calendarUriAtSuccessor: movedUri, addressBookImportStatuses: imported };

// ---------- 6 (always, in finally). restore the persona for re-runs ----------
const restorePersona = async () => {
  await occ('user:enable', leaver.uid);
  for (const t of await occJson('user:auth-tokens:list', leaver.uid)) if (t.name === 'cal16-dav') await occ('user:auth-tokens:delete', leaver.uid, String(t.id));
  const { stdout } = await occ('user:auth-tokens:add', '--name=cal16-dav', leaver.uid);
  const fresh = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
  const path = join(secretsDir, 'app_password_member-b');
  await writeFile(path, `${fresh}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  evidence.personaRestored = { enabled: true, newTokenMinted: true, note: 'Chỉ khôi phục persona thử để chạy lại PoC; offboard thật dừng ở bước 5.' };
  await writeEvidence('acceptance-offboard.json', evidence);
};
try {
// ---------- 4. revoke + disable ----------
const probe = (actor) => actor.dav('PROPFIND', calHome(actor.uid), '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>', { Depth: '0' });
const tokens = await occJson('user:auth-tokens:list', leaver.uid);
const token1 = tokens.find((t) => t.name === 'cal16-dav');
const t0 = Date.now();
await occ('user:auth-tokens:delete', leaver.uid, String(token1.id));
const timeline = [];
let revokedAt = null;
for (let i = 0; i < 40; i += 1) {
  const [d1, d2] = await Promise.all([probe(leaver), probe(device2)]);
  timeline.push({ ms: Date.now() - t0, device1: d1.status, device2: d2.status });
  if (d1.status === 401 && revokedAt === null) { revokedAt = Date.now() - t0; break; }
  await sleep(500);
}
await resetBruteforce();
const t1 = Date.now();
await occ('user:disable', leaver.uid);
const afterDisable = [];
for (let i = 0; i < 6; i += 1) {
  const d2 = await probe(device2);
  const card = await device2.request('GET', `${abHome(leaver.uid)}`);
  afterDisable.push({ ms: Date.now() - t1, device2Propfind: d2.status, device2AddressBookHome: card.status });
  await sleep(500);
}
// Remaining tokens are deleted as the offboarding step (chat13/15 rule).
for (const t of await occJson('user:auth-tokens:list', leaver.uid)) await occ('user:auth-tokens:delete', leaver.uid, String(t.id));
const t2 = Date.now();
const afterAllDeletedTimeline = [];
for (let i = 0; i < 40; i += 1) {
  const status = (await probe(device2)).status;
  afterAllDeletedTimeline.push({ ms: Date.now() - t2, device2: status });
  if (status === 401) break;
  await sleep(500);
}
const afterAllDeleted = afterAllDeletedTimeline.at(-1).device2;
evidence.revoke = { device1RevokedAfterMs: revokedAt, timeline, afterDisable, device2AfterAllTokensDeleted: { final: afterAllDeleted, reached401AfterMs: afterAllDeleted === 401 ? afterAllDeletedTimeline.at(-1).ms : null, statuses: [...new Set(afterAllDeletedTimeline.map((x) => x.device2))] } };

// ---------- 5. readback ----------
await resetBruteforce();
const successorCal = calPath(successor.uid, movedUri);
const succEvents = await calendarQuery(successor, successorCal, { expand: false });
const orgCopy = succEvents.items.find((i) => i.href.includes(organized));
const managerBInvite = (await calendarQuery(successor, calPath(successor.uid, 'personal'), { start: '20261208T000000Z', end: '20261209T000000Z', expand: false })).items.find((i) => i.data.includes(organized));
const shares = (await successor.dav('PROPFIND', successorCal, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:invite/></d:prop></d:propfind>', { Depth: '0' })).text;
const leaverOldPath = await successor.request('GET', `${calPath(leaver.uid, calUri)}${legacyEvent}.ics`);
const outsiderOnMoved = await outsider.request('GET', `${successorCal}${legacyEvent}.ics`);
const importedCards = await successor.dav('PROPFIND', abPath(successor.uid, newAb), '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>', { Depth: '1' });
evidence.readback = {
  successorOwnsCalendar: succEvents.status === 207 && succEvents.items.some((i) => i.href.includes(legacyEvent)),
  successorEvents: succEvents.items.length,
  calendarStillSharedWithTeamB: shares.includes(teamGroups.b),
  organizerOfMovedEvent: orgCopy ? lines(orgCopy.data, 'ORGANIZER')[0] : null,
  managerBAttendeeCopyOrganizer: managerBInvite ? lines(managerBInvite.data, 'ORGANIZER')[0] : null,
  importedCards: (importedCards.text.match(/\.vcf<\/d:href>/g) ?? []).length,
  oldPathAfterMove: leaverOldPath.status,
  outsiderOnMovedCalendar: outsiderOnMoved.status,
};
assert(evidence.export.calendarViaOcc.containsRunEvents && evidence.export.addressBookViaLeaverToken.cards >= 2, 'export before revoke', evidence.export);
assert(evidence.readback.successorOwnsCalendar && evidence.readback.importedCards >= 2 && [403, 404].includes(evidence.readback.outsiderOnMovedCalendar), 'transfer readback', evidence.readback);
assert(revokedAt !== null && afterDisable.every((a) => a.device2Propfind >= 400) && afterAllDeleted === 401, 'revoke/disable lock the leaver out', evidence.revoke);
} finally {
  await restorePersona();
}
console.log(JSON.stringify(evidence, null, 1).slice(0, 5000));
