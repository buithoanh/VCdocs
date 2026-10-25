// Chat16 ↔ Flow (chat14): are Calendar/Contacts events webhook-compatible?
//  - Register webhook_listeners hooks (admin13 app password, OCS API) to the
//    internal hook-sink for OCP\Calendar\Events\CalendarObject{Created,Updated,
//    Deleted,MovedToTrash}Event, scoped by eventFilter on the calendar (owner
//    principal + uri — no DB read), and try the DAV contact/address book events.
//  - Trigger create (by a sharee), update, PRIVATE event, delete, scheduling copy,
//    and an event in Team B's calendar (must not match the filter).
//  - Read what the sink received (header token, payload shape, how much event data
//    leaves Nextcloud), then remove the chat16 hooks again.
import { calPath, client, docker, sleep, writeEvidence, assert, abPath } from './lib.mjs';
import { putIcs, putVcf, stamp, vcalendar, vcard } from './dav-lib.mjs';
import { randomBytes } from 'node:crypto';

const admin = await client('admin13');
const owner = await client('successor-a');
const member = await client('member-a');
const managerB = await client('manager-b');
const api = '/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks';
const sinkUri = 'http://hook-sink:8080/cal16';
const token = randomBytes(24).toString('hex'); // per-run sink header, never written to evidence
const ocs = (r) => r.data?.ocs?.data;
const run = Date.now().toString(36);
const evidence = { run };

// Remove leftovers of earlier chat16 runs only (other chats' hooks untouched).
for (const hook of ocs(await admin.request('GET', `${api}?format=json`, { headers: { Accept: 'application/json' } })) ?? []) {
  if (hook.uri === sinkUri) await admin.request('DELETE', `${api}/${hook.id}?format=json`, { headers: { Accept: 'application/json' } });
}
const calendarScope = { 'event.calendarData.principaluri': `principals/users/${owner.uid}`, 'event.calendarData.uri': 'cal16-team-a' };
const candidates = [
  'OCP\\Calendar\\Events\\CalendarObjectCreatedEvent',
  'OCP\\Calendar\\Events\\CalendarObjectUpdatedEvent',
  'OCP\\Calendar\\Events\\CalendarObjectDeletedEvent',
  'OCP\\Calendar\\Events\\CalendarObjectMovedToTrashEvent',
  'OCA\\DAV\\Events\\CardCreatedEvent',
  'OCA\\DAV\\Events\\CardUpdatedEvent',
  'OCA\\DAV\\Events\\AddressBookUpdatedEvent',
  'OCA\\DAV\\Events\\CalendarObjectCreatedEvent',
];
const registration = [];
const created = [];
for (const event of candidates) {
  const isCalendar = event.startsWith('OCP\\Calendar');
  const res = await admin.request('POST', `${api}?format=json`, { json: { httpMethod: 'POST', uri: sinkUri, event, ...(isCalendar ? { eventFilter: calendarScope } : {}), authMethod: 'header', authData: { 'X-Cal16-Token': token } } });
  registration.push({ event, status: res.status, message: res.status === 200 ? 'registered' : (ocs(res)?.error ?? res.data?.ocs?.meta?.message ?? String(res.text).slice(0, 200)) });
  if (res.status === 200) created.push(ocs(res).id);
}
evidence.registration = registration;

const sinkLog = async () => (await docker('exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log')).stdout;
const offset = (await sinkLog()).length;
const teamCal = calPath(owner.uid, 'cal16-team-a');
const sharedCal = `/remote.php/dav/calendars/${member.uid}/cal16-team-a_shared_by_${owner.uid}/`;
const uid1 = `cal16-flow-${run}`;
const uidPrivate = `cal16-flow-private-${run}`;
const secret = `CAL16-FLOW-BIMAT-${run}`;
const t0 = Date.now();
const steps = [];
const step = async (name, fn) => { const r = await fn(); steps.push({ name, status: r.status, atMs: Date.now() - t0 }); };
await step('member-a creates event via share', () => putIcs(member, `${sharedCal}${uid1}.ics`, vcalendar({ events: [[`UID:${uid1}`, `DTSTAMP:${stamp()}`, 'DTSTART:20261203T020000Z', 'DTEND:20261203T030000Z', `SUMMARY:Flow ${run}`]] })));
await step('successor-a updates it', () => putIcs(owner, `${teamCal}${uid1}.ics`, vcalendar({ events: [[`UID:${uid1}`, `DTSTAMP:${stamp()}`, 'DTSTART:20261203T020000Z', 'DTEND:20261203T040000Z', `SUMMARY:Flow ${run} (sua)`]] })));
await step('successor-a creates PRIVATE event', () => putIcs(owner, `${teamCal}${uidPrivate}.ics`, vcalendar({ events: [[`UID:${uidPrivate}`, 'CLASS:PRIVATE', `DTSTAMP:${stamp()}`, 'DTSTART:20261204T020000Z', 'DTEND:20261204T030000Z', `SUMMARY:${secret}`, `DESCRIPTION:${secret}`]] })));
await step('successor-a invites member-a (scheduling copy lands in member-a/personal)', () => putIcs(owner, `${teamCal}inv-${uid1}.ics`, vcalendar({ events: [[`UID:inv-${uid1}`, `DTSTAMP:${stamp()}`, 'DTSTART:20261205T020000Z', 'DTEND:20261205T030000Z', `SUMMARY:Moi hop flow ${run}`, 'ORGANIZER:mailto:successor-a@team-a.test', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:successor-a@team-a.test', 'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:member-a@team-a.test']] })));
await step('manager-b creates event in Team B calendar', () => putIcs(managerB, `${calPath(managerB.uid, 'cal16-team-b')}${uid1}-b.ics`, vcalendar({ events: [[`UID:${uid1}-b`, `DTSTAMP:${stamp()}`, 'DTSTART:20261203T020000Z', 'DTEND:20261203T030000Z', `SUMMARY:Team B ${run}`]] })));
await step('successor-a adds a contact to Team A address book', () => putVcf(owner, `${abPath(owner.uid, 'ab16-team-a')}flow-${run}.vcf`, vcard(['VERSION:3.0', `UID:flow-${run}`, `FN:Flow ${run}`])));
await step('successor-a deletes the event', () => owner.request('DELETE', `${teamCal}${uid1}.ics`));
await step('successor-a deletes the invitation (cancel)', () => owner.request('DELETE', `${teamCal}inv-${uid1}.ics`));

// Wait for the background worker (chat14 webhook-worker, --interval=1).
let deliveries = [];
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  deliveries = (await sinkLog()).slice(offset).split('--END--').map((x) => x.trim()).filter((x) => x.includes('/cal16'));
  if (deliveries.length >= 6 && i > 6) break;
}
const parsed = deliveries.map((raw) => {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  let body = null;
  try { body = JSON.parse(rest.join('\n\n')); } catch { body = null; }
  const ev = body?.event ?? {};
  const calendarData = ev.calendarData ?? {};
  const objectData = ev.objectData ?? {};
  const ics = String(objectData.calendardata ?? '');
  return {
    tokenHeaderOk: head.includes(`X-Cal16-Token: ${token}`),
    contentType: (/content-type:\s*([^\r\n]+)/i.exec(head) ?? [])[1] ?? null,
    eventClass: ev.class ?? body?.event?.class ?? null,
    userUid: body?.user?.uid === owner.uid ? 'successor-a' : body?.user?.uid === member.uid ? 'member-a' : body?.user?.uid ?? null,
    time: body?.time ?? null,
    calendarId: ev.calendarId ?? null,
    calendarUri: calendarData.uri ?? null,
    calendarKeys: Object.keys(calendarData).sort(),
    sharesCount: Array.isArray(ev.shares) ? ev.shares.length : null,
    objectKeys: Object.keys(objectData).sort(),
    objectUri: objectData.uri ?? null,
    classification: objectData.classification ?? null,
    fullIcsInPayload: ics.includes('BEGIN:VEVENT'),
    privateSecretInPayload: JSON.stringify(body ?? {}).includes(secret),
    hasAuthenticationField: Boolean(body?.authentication),
  };
});
// Cleanup chat16 hooks.
for (const id of created) await admin.request('DELETE', `${api}/${id}?format=json`, { headers: { Accept: 'application/json' } });
const remaining = (ocs(await admin.request('GET', `${api}?format=json`, { headers: { Accept: 'application/json' } })) ?? []).filter((h) => h.uri === sinkUri).length;
evidence.steps = steps;
evidence.deliveries = parsed;
evidence.summary = {
  calendarEventsWebhookCompatible: registration.filter((r) => r.event.startsWith('OCP\\Calendar') && r.status === 200).map((r) => r.event.split('\\').pop()),
  rejected: registration.filter((r) => r.status !== 200).map((r) => `${r.event.split('\\').pop()} → ${r.status}`),
  deliveredClasses: parsed.map((p) => p.eventClass?.split('\\').pop()),
  allForTeamACalendar: parsed.every((p) => p.calendarUri === 'cal16-team-a'),
  teamBOrPersonalLeaked: parsed.some((p) => p.calendarUri !== 'cal16-team-a'),
  privateEventDetailsInPayload: parsed.some((p) => p.privateSecretInPayload),
  hooksRemovedAfterRun: remaining === 0,
};
await writeEvidence('acceptance-flow-events.json', evidence);
console.log(JSON.stringify({ registration, summary: evidence.summary, deliveries: parsed.map((p) => ({ c: p.eventClass, u: p.userUid, uri: p.calendarUri, cls: p.classification, ics: p.fullIcsInPayload, tok: p.tokenHeaderOk })) }, null, 1));
assert(evidence.summary.calendarEventsWebhookCompatible.length === 4, 'calendar object events register', registration);
assert(parsed.length >= 4 && parsed.every((p) => p.tokenHeaderOk) && evidence.summary.allForTeamACalendar, 'deliveries scoped to the Team A calendar', evidence.summary);
assert(registration.filter((r) => r.event.startsWith('OCA\\DAV')).every((r) => r.status !== 200), 'DAV contact/address book events not webhook-compatible', registration);
