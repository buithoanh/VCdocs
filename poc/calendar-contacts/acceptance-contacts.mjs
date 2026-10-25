// Chat16 Contacts acceptance over CardDAV + the endpoints the web UI uses:
//  A. directory policy: system address book + user search with the Nextcloud
//     defaults vs. "restrict enumeration to group" (outsider must be hidden)
//  B. group address book Team A (read-write), Team B/outsider cannot see it
//  C. vCard round-trip (3.0 and 4.0, UTF-8 Vietnamese, multi-value, photo, custom X-),
//     export (?export) and re-import into another address book
//  D. sync-token incremental sync + ETag/If-Match
import { abHome, abPath, client, occ, resetBruteforce, sleep, teamGroups, writeEvidence, assert, unxml } from './lib.mjs';
import { putVcf, syncCollection, vcard } from './dav-lib.mjs';

await resetBruteforce();
const actors = Object.fromEntries(await Promise.all(['successor-a', 'member-a', 'manager-b', 'member-b', 'outsider'].map(async (n) => [n, await client(n)])));
const { 'successor-a': owner, 'member-a': member, 'manager-b': managerB, outsider } = actors;
const run = Date.now().toString(36);
const evidence = { run };
const policyKeys = ['shareapi_only_share_with_group_members', 'shareapi_allow_share_dialog_user_enumeration', 'shareapi_restrict_user_enumeration_to_group', 'shareapi_restrict_user_enumeration_full_match'];
const readPolicy = async () => Object.fromEntries(await Promise.all(policyKeys.map(async (k) => [k, (await occ('config:app:get', 'core', k).catch(() => ({ stdout: '' }))).stdout.trim() || '<default>'])));
const uidToName = Object.fromEntries(Object.entries(actors).map(([n, a]) => [a.uid, n]));
const label = (uid) => uidToName[uid] ?? `${uid.slice(0, 8)}…`;

// ---------- A. directory visibility ----------
const systemCards = async (actor) => {
  const res = await actor.dav('PROPFIND', `${abHome(actor.uid)}z-server-generated--system/`, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>', { Depth: '1' });
  return { status: res.status, cards: [...res.text.matchAll(/<d:href>[^<]*\/([^/<]+)\.vcf<\/d:href>/g)].map((m) => label(decodeURIComponent(m[1]).split(':').pop())) };
};
const searchAll = async (actor, term) => {
  const enc = encodeURIComponent(term);
  const autocomplete = await actor.request('GET', `/ocs/v2.php/core/autocomplete/get?search=${enc}&itemType=%20&itemId=%20&shareTypes[]=0&limit=20&format=json`, { headers: { Accept: 'application/json' } });
  const sharees = await actor.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/sharees?search=${enc}&itemType=file&shareType[]=0&perPage=20&format=json`, { headers: { Accept: 'application/json' } });
  const unified = await actor.request('GET', `/ocs/v2.php/search/providers/contacts/search?term=${enc}&limit=20&format=json`, { headers: { Accept: 'application/json' } });
  const menu = await actor.request('POST', '/index.php/contactsmenu/contacts', { json: { filter: term } });
  const attendee = await actor.request('POST', '/index.php/apps/calendar/v1/autocompletion/attendee', { json: { search: term } });
  const principal = await actor.dav('REPORT', '/remote.php/dav/principals/users/', `<?xml version="1.0"?><d:principal-property-search xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" test="anyof"><d:property-search><d:prop><d:displayname/></d:prop><d:match>${term}</d:match></d:property-search><d:property-search><d:prop><s:email-address/></d:prop><d:match>${term}</d:match></d:property-search><d:prop><d:displayname/></d:prop></d:principal-property-search>`, { Depth: '0' });
  const ocs = (r) => r.data?.ocs?.data;
  const ids = (list) => (list ?? []).map((x) => label(x.id ?? x.value?.shareWith ?? x.shareWith ?? '')).filter(Boolean);
  return {
    autocomplete: { status: autocomplete.status, ids: ids(ocs(autocomplete)) },
    sharees: { status: sharees.status, ids: [...ids(ocs(sharees)?.users), ...ids(ocs(sharees)?.exact?.users)] },
    unifiedSearchContacts: { status: unified.status, titles: (ocs(unified)?.entries ?? []).map((e) => e.title) },
    contactsMenu: { status: menu.status, names: (menu.data?.contacts ?? []).map((c) => c.fullName) },
    calendarAttendeeAutocomplete: { status: attendee.status, emails: (Array.isArray(attendee.data) ? attendee.data : []).map((c) => c.email ?? c.emails?.[0] ?? c.name) },
    principalSearch: { status: principal.status, principals: [...principal.text.matchAll(/<d:href>\/remote\.php\/dav\/principals\/users\/([^/<]+)\/<\/d:href>/g)].map((m) => label(decodeURIComponent(m[1]))) },
  };
};
const directorySnapshot = async () => ({
  systemAddressBook: Object.fromEntries(await Promise.all(['member-a', 'manager-b', 'outsider'].map(async (n) => [n, await systemCards(actors[n])]))),
  search: {
    'outsider→"Member A"': await searchAll(outsider, 'Member A'),
    'outsider→member-a@team-a.test': await searchAll(outsider, 'member-a@team-a.test'),
    'manager-b→"Successor"': await searchAll(managerB, 'Successor'),
    'member-a→"Outsider"': await searchAll(member, 'Outsider'),
    'member-a→"Member"': await searchAll(member, 'Member'),
    'member-a→"Successor" (đối chứng dương)': await searchAll(member, 'Successor'),
  },
});
const policyBefore = await readPolicy();
// Snapshot with the Nextcloud defaults for the two enumeration keys (chat13 only
// set "share with group members only"), then apply the chat16 directory policy.
let defaultsSnapshot = null;
try {
  await occ('config:app:delete', 'core', 'shareapi_restrict_user_enumeration_to_group');
  await occ('config:app:delete', 'core', 'shareapi_restrict_user_enumeration_full_match');
  await sleep(3000);
  defaultsSnapshot = { policy: await readPolicy(), ...(await directorySnapshot()) };
} finally {
  await occ('config:app:set', 'core', 'shareapi_restrict_user_enumeration_to_group', '--value=yes');
  await occ('config:app:set', 'core', 'shareapi_restrict_user_enumeration_full_match', '--value=no');
  await sleep(3000);
}
await occ('dav:sync-system-addressbook');
const policyAfter = await readPolicy();
const restricted = await directorySnapshot();
evidence.directory = { policyBefore, defaultsSnapshot, policyAfter, restricted };
const sys = restricted.systemAddressBook;
assert(!sys['member-a'].cards.includes('outsider') && !sys['member-a'].cards.includes('manager-b') && sys['member-a'].cards.includes('successor-a'), 'Team A system address book hides outsider/Team B', sys['member-a']);
assert(JSON.stringify(sys.outsider.cards) === JSON.stringify(['outsider']), 'outsider sees only itself', sys.outsider);
for (const [probe, result] of Object.entries(restricted.search)) {
  if (probe.startsWith('member-a→"Member"') || probe.includes('đối chứng')) continue;
  const found = JSON.stringify(result);
  assert(!/successor-a|member-a"|"member-a|manager-b|outsider|Member A|Successor A|Outsider|team-a\.test|outsider\.test/.test(found.replace(/"(status)":\d+/g, '')), `no cross-group directory hit (${probe})`, result);
}
const positive = restricted.search['member-a→"Successor" (đối chứng dương)'];
assert(positive.autocomplete.ids.includes('successor-a') && positive.contactsMenu.names.includes('Successor A') && positive.calendarAttendeeAutocomplete.emails.includes('successor-a@team-a.test') && positive.principalSearch.principals.includes('successor-a'), 'positive control: same-group search works', positive);
// Direct GET of a hidden system card, and sync-collection on the system address book.
const hiddenCard = await outsider.request('GET', `${abHome(outsider.uid)}z-server-generated--system/user_oidc:${encodeURIComponent(member.uid)}.vcf`);
const sysSync = await syncCollection(outsider, `${abHome(outsider.uid)}z-server-generated--system/`, '');
evidence.directory.outsiderDirectGetOfMemberCard = hiddenCard.status;
evidence.directory.outsiderSystemSyncCollection = { status: sysSync.status, changedHrefs: sysSync.changed.map((c) => label(decodeURIComponent(c.href.split('/').pop().replace('.vcf', '')).split(':').pop())), otherHrefs: sysSync.other.map((o) => ({ who: label(decodeURIComponent(o.href.split('/').pop().replace('.vcf', '')).split(':').pop()), status: o.status })), removed: sysSync.removed.length };
assert([403, 404].includes(hiddenCard.status) && !hiddenCard.text.includes('BEGIN:VCARD'), 'outsider cannot GET hidden system card', hiddenCard.status);
// Incremental sync after a hidden user's card changes (profile address via occ →
// system address book update): does the outsider learn that href?
const ownerSysBefore = await syncCollection(owner, `${abHome(owner.uid)}z-server-generated--system/`, '');
const phoneBefore = (await occ('user:profile', member.uid, 'address').catch(() => ({ stdout: '' }))).stdout.trim();
await occ('user:profile', member.uid, 'address', `So ${String(Date.now()).slice(-4)} Le Loi, Quan 1`);
await occ('dav:sync-system-addressbook');
const sysSync2 = await syncCollection(outsider, `${abHome(outsider.uid)}z-server-generated--system/`, sysSync.token);
const memberSync2 = await syncCollection(member, `${abHome(member.uid)}z-server-generated--system/`, '');
evidence.directory.outsiderIncrementalAfterHiddenCardChange = {
  status: sysSync2.status,
  changed: sysSync2.changed.map((c) => label(decodeURIComponent(c.href.split('/').pop().replace('.vcf', '')).split(':').pop())),
  otherHrefs: sysSync2.other.map((o) => ({ who: label(decodeURIComponent(o.href.split('/').pop().replace('.vcf', '')).split(':').pop()), status: o.status })),
  removedHrefs: sysSync2.removed.map((h) => label(decodeURIComponent(h.split('/').pop().replace('.vcf', '')).split(':').pop())),
  rawHasMemberUid: sysSync2.text.includes(member.uid),
  phoneSetBefore: Boolean(phoneBefore),
};
evidence.directory.memberAFullSyncCount = memberSync2.changed.length;
const ownerSysAfter = await syncCollection(owner, `${abHome(owner.uid)}z-server-generated--system/`, ownerSysBefore.token);
evidence.directory.teamAIncrementalSeesTheChange = ownerSysAfter.changed.map((c) => label(decodeURIComponent(c.href.split('/').pop().replace('.vcf', '')).split(':').pop()));
assert(evidence.directory.teamAIncrementalSeesTheChange.includes('member-a') && !evidence.directory.outsiderIncrementalAfterHiddenCardChange.rawHasMemberUid, 'hidden card change not leaked through outsider sync-collection', evidence.directory);

// ---------- B. group address book ----------
const teamAb = abPath(owner.uid, 'ab16-team-a');
const memberTeamAb = `${abHome(member.uid)}ab16-team-a_shared_by_${owner.uid}/`;
const cardUid = `cal16-card-${run}`;
const memberCreates = await putVcf(member, `${memberTeamAb}${cardUid}.vcf`, vcard(['VERSION:3.0', `UID:${cardUid}`, `FN:Khach hang ${run}`, 'N:hang;Khach;;;', 'EMAIL;TYPE=WORK:khach@partner.test']));
const ownerReads = await owner.request('GET', `${teamAb}${cardUid}.vcf`);
const homeOf = async (actor) => (await actor.dav('PROPFIND', abHome(actor.uid), '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '1' })).text;
const teamBHome = await homeOf(managerB);
const outsiderHome = await homeOf(outsider);
evidence.groupAddressBook = { memberCreates: memberCreates.status, ownerReads: ownerReads.status, teamBSeesShare: teamBHome.includes('ab16-team-a'), outsiderSeesShare: outsiderHome.includes('ab16-team-a') };
assert(memberCreates.status === 201 && ownerReads.status === 200 && !evidence.groupAddressBook.teamBSeesShare && !evidence.groupAddressBook.outsiderSeesShare, 'group address book shared only to Team A', evidence.groupAddressBook);

// ---------- C. vCard round-trip ----------
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const v3 = vcard([
  'VERSION:3.0', `UID:rt3-${run}`, 'FN:Nguyễn Văn Ánh', 'N:Nguyễn;Văn Ánh;;;', 'ORG:Công ty VC Phồn Vinh;Phòng Kỹ thuật', 'TITLE:Trưởng phòng',
  'EMAIL;TYPE=WORK:anh.nguyen@team-a.test', 'EMAIL;TYPE=HOME:anh@partner.test', 'TEL;TYPE=CELL:+84 90 123 4567', 'TEL;TYPE=WORK:+84 28 3822 0000',
  'ADR;TYPE=WORK:;;12 Lê Lợi;Quận 1;TP. Hồ Chí Minh;700000;Việt Nam', 'BDAY:1990-02-28', 'NOTE:Dòng 1\\nDòng 2\\, có dấu phẩy\\; chấm phẩy',
  'CATEGORIES:Khách hàng,VIP', `X-VCW-ID:${run}`, `PHOTO;ENCODING=b;TYPE=PNG:${pngBase64}`,
]);
const v4 = vcard([
  'VERSION:4.0', `UID:urn:uuid:rt4-${run}`, 'FN:Trần Thị Bích', 'N:Trần;Thị Bích;;;', 'KIND:individual', 'EMAIL;TYPE=work;PREF=1:bich@team-a.test',
  'TEL;VALUE=uri;TYPE=cell:tel:+84-91-000-1111', `PHOTO:data:image/png;base64,${pngBase64}`, 'LANG:vi', 'TZ:Asia/Ho_Chi_Minh', `X-VCW-ID:${run}`,
]);
const ownAb = abPath(owner.uid, 'contacts');
const roundTrip = async (name, data, accept) => {
  const put = await putVcf(owner, `${teamAb}${name}.vcf`, data);
  const get = await owner.request('GET', `${teamAb}${name}.vcf`, { headers: accept ? { Accept: accept } : {} });
  const norm = (s) => unxml(s).replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
  const sent = norm(data);
  const back = norm(get.text);
  return { put: put.status, get: get.status, contentType: get.headers.get('content-type'), missingAfterRoundTrip: sent.filter((l) => !back.includes(l)), addedByServer: back.filter((l) => !sent.includes(l)).map((l) => l.slice(0, 80)) };
};
const rt3 = await roundTrip(`rt3-${run}`, v3);
const rt4 = await roundTrip(`rt4-${run}`, v4);
const rt4AsV4 = await roundTrip(`rt4-${run}`, v4, 'text/vcard; version=4.0');
const exported = await owner.request('GET', `${teamAb}?export`);
const exportCount = (exported.text.match(/BEGIN:VCARD/g) ?? []).length;
const exportedCards = exported.text.split(/(?=BEGIN:VCARD)/).filter((c) => c.includes(`X-VCW-ID:${run}`));
// Re-import the exported cards into another address book (as an import UI does: one PUT per card).
const importAb = abPath(owner.uid, 'contacts');
const imported = [];
for (const card of exportedCards) {
  const uid = (/^UID:(.+)$/m.exec(card) ?? [])[1].trim().replace(/[^A-Za-z0-9-]/g, '');
  const res = await putVcf(owner, `${importAb}import-${uid}.vcf`, card.replace(/\r?\n?$/, '\r\n'));
  const back = await owner.request('GET', `${importAb}import-${uid}.vcf`);
  imported.push({ uid, put: res.status, fnPreserved: (/^FN:(.+)$/m.exec(back.text) ?? [])[1]?.trim() === (/^FN:(.+)$/m.exec(card) ?? [])[1]?.trim(), photoPreserved: back.text.replace(/\r?\n[ \t]/g, '').includes(pngBase64) });
}
evidence.vcard = { v3: rt3, v4DefaultGet: rt4, v4WithAcceptVersion4: rt4AsV4, export: { status: exported.status, contentType: exported.headers.get('content-type'), cards: exportCount, runCards: exportedCards.length }, reimport: imported, ownAddressBook: ownAb.replace(owner.uid, '<successor-a>') };
assert(rt3.put === 201 && rt3.missingAfterRoundTrip.length === 0, 'vCard 3.0 round-trip lossless', rt3);
assert(rt4.put === 201 && rt4.get === 200 && rt4AsV4.missingAfterRoundTrip.filter((l) => !/^PRODID/.test(l)).length <= 1, 'vCard 4.0 stored and served as 4.0 on request', { rt4, rt4AsV4 });
assert(exportedCards.length === 2 && imported.every((i) => i.put === 201 && i.fnPreserved && i.photoPreserved), 'export + re-import', { exportCount, imported });

// ---------- D. sync-token + ETag ----------
const s0 = await syncCollection(member, memberTeamAb, '');
const syncUid = `sync-${run}`;
await putVcf(owner, `${teamAb}${syncUid}.vcf`, vcard(['VERSION:3.0', `UID:${syncUid}`, 'FN:sync 1']));
const s1 = await syncCollection(member, memberTeamAb, s0.token);
const cur = await owner.request('GET', `${teamAb}${syncUid}.vcf`);
const etag = cur.headers.get('etag');
const upd = await putVcf(owner, `${teamAb}${syncUid}.vcf`, vcard(['VERSION:3.0', `UID:${syncUid}`, 'FN:sync 2']), { 'If-Match': etag });
const stale = await putVcf(member, `${memberTeamAb}${syncUid}.vcf`, vcard(['VERSION:3.0', `UID:${syncUid}`, 'FN:sync stale']), { 'If-Match': etag });
const s2 = await syncCollection(member, memberTeamAb, s1.token);
await owner.request('DELETE', `${teamAb}${syncUid}.vcf`);
const s3 = await syncCollection(member, memberTeamAb, s2.token);
const s4 = await syncCollection(member, memberTeamAb, s3.token);
const badToken = await syncCollection(member, memberTeamAb, 'urn:vcw:not-a-token');
const teamBSync = await syncCollection(managerB, memberTeamAb, s0.token);
const short = (r) => ({ status: r.status, token: r.token?.split('/').pop(), changed: r.changed.map((c) => c.href.split('/').pop()), removed: r.removed.map((h) => h.split('/').pop()) });
evidence.syncToken = { initialCount: s0.changed.length, afterAdd: short(s1), ifMatch: { update: upd.status, staleEtag: stale.status }, afterModify: short(s2), afterDelete: short(s3), noChange: short(s4), invalidToken: badToken.status, teamBWithValidToken: teamBSync.status };
assert(s1.changed.length === 1 && s2.changed.length === 1 && s3.removed.length === 1 && s4.changed.length + s4.removed.length === 0, 'CardDAV sync-token incremental', evidence.syncToken);
assert(upd.status === 204 && stale.status === 412 && badToken.status === 403 && [403, 404].includes(teamBSync.status), 'ETag + token errors', evidence.syncToken);

evidence.groupIds = { teamA: teamGroups.a, teamB: teamGroups.b };
await writeEvidence('acceptance-contacts.json', evidence);
console.log(JSON.stringify({ directory: { policyAfter, systemAddressBook: restricted.systemAddressBook, outsiderSync: evidence.directory.outsiderSystemSyncCollection }, vcard: evidence.vcard, syncToken: evidence.syncToken }, null, 1).slice(0, 6000));
