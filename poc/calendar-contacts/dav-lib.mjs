// Chat16 CalDAV/CardDAV request builders shared by the acceptance scripts.
// Everything is plain RFC 4791/6352/6578 + the Nextcloud sharing extension, the
// same requests the Calendar/Contacts web apps and DAVx5/Thunderbird send.
import { abPath, calPath, crlf, parseMultistatus, syncTokenOf, unxml } from './lib.mjs';

const xmlHead = '<?xml version="1.0" encoding="utf-8"?>';
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const TZ = {
  'Asia/Ho_Chi_Minh': ['BEGIN:VTIMEZONE', 'TZID:Asia/Ho_Chi_Minh', 'BEGIN:STANDARD', 'TZOFFSETFROM:+0700', 'TZOFFSETTO:+0700', 'TZNAME:+07', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE'],
  'America/New_York': ['BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'],
};

export const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Build a VCALENDAR with one or more VEVENT blocks (arrays of lines). */
export function vcalendar({ tzids = [], events, method }) {
  return crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VCworkspace//chat16 PoC//VI', 'CALSCALE:GREGORIAN',
    ...(method ? [`METHOD:${method}`] : []),
    ...tzids.flatMap((id) => TZ[id]),
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ]);
}

export async function mkcalendar(actor, uri, displayName, { components = ['VEVENT'] } = {}) {
  const body = `${xmlHead}<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>${esc(displayName)}</d:displayname><c:supported-calendar-component-set>${components.map((c) => `<c:comp name="${c}"/>`).join('')}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
  return actor.dav('MKCALENDAR', calPath(actor.uid, uri), body);
}

export async function mkaddressbook(actor, uri, displayName) {
  const body = `${xmlHead}<d:mkcol xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:set><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>${esc(displayName)}</d:displayname></d:prop></d:set></d:mkcol>`;
  return actor.dav('MKCOL', abPath(actor.uid, uri), body);
}

/** Nextcloud sharing extension (what the Calendar/Contacts UI sends). */
export async function share(actor, collectionPath, principalHref, { readWrite = false, remove = false } = {}) {
  const inner = remove
    ? `<o:remove><d:href>${esc(principalHref)}</d:href></o:remove>`
    : `<o:set><d:href>${esc(principalHref)}</d:href>${readWrite ? '<o:read-write/>' : ''}</o:set>`;
  return actor.dav('POST', collectionPath, `${xmlHead}<o:share xmlns:d="DAV:" xmlns:o="http://owncloud.org/ns">${inner}</o:share>`);
}
export const groupPrincipal = (gid) => `principal:principals/groups/${encodeURIComponent(gid)}`;
export const userPrincipal = (uid) => `principal:principals/users/${encodeURIComponent(uid)}`;

export async function invites(actor, collectionPath) {
  const res = await actor.dav('PROPFIND', collectionPath, `${xmlHead}<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:invite/><d:displayname/></d:prop></d:propfind>`, { Depth: '0' });
  const sharees = [...res.text.matchAll(/<oc:user>([\s\S]*?)<\/oc:user>/g)].map((m) => ({
    href: unxml((/<d:href>([^<]*)<\/d:href>/.exec(m[1]) ?? [])[1] ?? ''),
    access: /<oc:read-write\/>/.test(m[1]) ? 'read-write' : 'read',
  }));
  return { status: res.status, sharees };
}

export async function putIcs(actor, path, ics, headers = {}) {
  return actor.request('PUT', path, { body: ics, headers: { 'Content-Type': 'text/calendar; charset=utf-8', ...headers } });
}
export async function putVcf(actor, path, vcf, headers = {}) {
  return actor.request('PUT', path, { body: vcf, headers: { 'Content-Type': 'text/vcard; charset=utf-8', ...headers } });
}

/** calendar-query with optional server-side expand (UTC). */
export async function calendarQuery(actor, collectionPath, { start, end, expand = true, props = '' } = {}) {
  const range = start ? `<c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter>` : '<c:comp-filter name="VEVENT"/>';
  const data = expand && start ? `<c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data>` : '<c:calendar-data/>';
  const body = `${xmlHead}<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/>${data}${props}</d:prop><c:filter><c:comp-filter name="VCALENDAR">${range}</c:comp-filter></c:filter></c:calendar-query>`;
  const res = await actor.dav('REPORT', collectionPath, body, { Depth: '1' });
  return { status: res.status, text: res.text, items: res.status === 207 ? parseMultistatus(res.text).map((r) => ({ href: r.href, etag: unxml(r.props.getetag ?? ''), data: unxml(r.props['calendar-data'] ?? '') })) : [] };
}

/** RFC 6578 sync-collection. token='' for the initial sync. */
export async function syncCollection(actor, collectionPath, token, { dataProp = '' } = {}) {
  const body = `${xmlHead}<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:sync-token>${esc(token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/>${dataProp}</d:prop></d:sync-collection>`;
  const res = await actor.dav('REPORT', collectionPath, body);
  const responses = res.status === 207 ? parseMultistatus(res.text) : [];
  return {
    status: res.status,
    text: res.text,
    token: res.status === 207 ? syncTokenOf(res.text) : null,
    changed: responses.filter((r) => r.props.getetag !== undefined).map((r) => ({ href: r.href, etag: unxml(r.props.getetag) })),
    removed: responses.filter((r) => r.status === 404).map((r) => r.href),
    other: responses.filter((r) => r.props.getetag === undefined && r.status !== 404).map((r) => ({ href: r.href, status: r.status })),
  };
}

/** Free/busy request via the scheduling outbox (RFC 6638 §5), as Calendar's attendee picker does. */
export async function freeBusy(actor, organizerEmail, attendeeEmails, start, end) {
  const ics = crlf([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VCworkspace//chat16 PoC//VI', 'METHOD:REQUEST',
    'BEGIN:VFREEBUSY', `UID:fb-${Date.now()}-${Math.random().toString(16).slice(2)}`, `DTSTAMP:${stamp()}`,
    `DTSTART:${start}`, `DTEND:${end}`, `ORGANIZER:mailto:${organizerEmail}`, ...attendeeEmails.map((e) => `ATTENDEE:mailto:${e}`),
    'END:VFREEBUSY', 'END:VCALENDAR',
  ]);
  const res = await actor.request('POST', `/remote.php/dav/calendars/${encodeURIComponent(actor.uid)}/outbox/`, { body: ics, headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
  const responses = [...res.text.matchAll(/<cal:response>([\s\S]*?)<\/cal:response>/g)].map((m) => ({
    recipient: unxml((/<d:href>([^<]*)<\/d:href>/.exec(m[1]) ?? [])[1] ?? ''),
    requestStatus: unxml((/<cal:request-status>([^<]*)</.exec(m[1]) ?? [])[1] ?? ''),
    calendarData: unxml((/<cal:calendar-data>([\s\S]*?)<\/cal:calendar-data>/.exec(m[1]) ?? [])[1] ?? ''),
  }));
  return { status: res.status, text: res.text, responses };
}

/** Lines of a property name (unfolded), e.g. FREEBUSY, ATTENDEE. */
export function lines(ics, name) {
  return ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter((l) => l.split(/[;:]/)[0].toUpperCase() === name);
}

export function vcard(lines4) {
  return crlf(['BEGIN:VCARD', ...lines4, 'END:VCARD']);
}
