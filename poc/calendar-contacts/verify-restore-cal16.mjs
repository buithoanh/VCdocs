// Chat16 restore readback. `node verify-restore-cal16.mjs snapshot` (on live,
// right after backup) records a state digest; with CAL16_NC_BASE/CAL16_MAIL_BASE
// pointing at the restore, `node verify-restore-cal16.mjs compare` recomputes it
// there and compares: collections + shares, object hrefs/ETags, sync-tokens,
// room/resource principals, directory policy effect, mailbox counts, and that a
// new invitation still goes out through the restored Stalwart.
import { abHome, abPath, calHome, calPath, client, ncBase, occ, readEvidence, resetBruteforce, sleep, writeEvidence, assert } from './lib.mjs';
import { invites, putIcs, stamp, syncCollection, vcalendar } from './dav-lib.mjs';
import { listMessages, mailBase } from './mail-lib.mjs';

const mode = process.argv[2];
if (!['snapshot', 'compare'].includes(mode)) throw new Error('usage: snapshot|compare');
await resetBruteforce();
const owner = await client('successor-a');
const member = await client('member-a');
const managerB = await client('manager-b');
const outsider = await client('outsider');
const collections = [
  [owner, calPath(owner.uid, 'cal16-team-a')], [owner, calPath(owner.uid, 'cal16-team-a-thongbao')], [owner, abPath(owner.uid, 'ab16-team-a')],
  [managerB, calPath(managerB.uid, 'cal16-team-b')], [managerB, abPath(managerB.uid, 'ab16-team-b')],
];
const digest = {};
for (const [actor, path] of collections) {
  const sync = await syncCollection(actor, path, '');
  const inv = await invites(actor, path);
  digest[path.replace(actor.uid, `<${actor.username}>`)] = {
    status: sync.status,
    syncToken: sync.token,
    objects: Object.fromEntries(sync.changed.map((c) => [c.href.split("/").pop(), c.etag]).sort((a, b) => a[0].localeCompare(b[0]))),
    sharees: inv.sharees,
  };
}
const principals = async (collection) => {
  const res = await owner.dav('PROPFIND', `/remote.php/dav/principals/${collection}/`, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>', { Depth: '1' });
  return [...new Set([...res.text.matchAll(/principals\/[a-z-]+\/(calendar_resource_management-[^/<]+)\//g)].map((m) => m[1]))].sort();
};
const sysCards = async (actor) => {
  const res = await actor.dav('PROPFIND', `${abHome(actor.uid)}z-server-generated--system/`, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>', { Depth: '1' });
  return (res.text.match(/\.vcf<\/d:href>/g) ?? []).length;
};
const boxes = ['partner@partner.test', 'manager-b@team-b.test', 'member-a@team-a.test'];
const state = {
  base: ncBase,
  mailBase,
  collections: digest,
  memberSharedHome: (await member.dav('PROPFIND', calHome(member.uid), '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '1' })).text.includes(`cal16-team-a_shared_by_${owner.uid}`),
  rooms: await principals('calendar-rooms'),
  resources: await principals('calendar-resources'),
  systemAddressBookCards: { 'member-a': await sysCards(member), outsider: await sysCards(outsider) },
  policy: { restrictToGroup: (await occ('config:app:get', 'core', 'shareapi_restrict_user_enumeration_to_group')).stdout.trim(), groupMembersOnly: (await occ('config:app:get', 'core', 'shareapi_only_share_with_group_members')).stdout.trim() },
  mailboxCounts: Object.fromEntries(await Promise.all(boxes.map(async (b) => [b, (await listMessages(b, { limit: 500 })).length]))),
};
if (mode === 'snapshot') {
  await writeEvidence('restore-reference.json', state);
  console.log(JSON.stringify({ collections: Object.keys(digest).length, rooms: state.rooms, mail: state.mailboxCounts }));
} else {
  const ref = await readEvidence('restore-reference.json');
  const diffs = [];
  for (const [path, value] of Object.entries(ref.collections)) {
    const got = state.collections[path];
    if (!got) { diffs.push(`${path}: missing`); continue; }
    if (got.syncToken !== value.syncToken) diffs.push(`${path}: syncToken ${value.syncToken} → ${got.syncToken}`);
    if (JSON.stringify(got.objects) !== JSON.stringify(value.objects)) diffs.push(`${path}: objects/etags differ`);
    if (JSON.stringify(got.sharees) !== JSON.stringify(value.sharees)) diffs.push(`${path}: sharees differ`);
  }
  for (const key of ['memberSharedHome', 'rooms', 'resources', 'systemAddressBookCards', 'policy', 'mailboxCounts']) {
    if (JSON.stringify(state[key]) !== JSON.stringify(ref[key])) diffs.push(`${key}: ${JSON.stringify(ref[key])} → ${JSON.stringify(state[key])}`);
  }
  // New invitation on the restored stack goes out through the restored Stalwart only.
  const uid = `cal16-restore-inv-${Date.now().toString(36)}`;
  const put = await putIcs(owner, `${calPath(owner.uid, 'cal16-team-a')}${uid}.ics`, vcalendar({ events: [[`UID:${uid}`, `DTSTAMP:${stamp()}`, 'DTSTART:20261215T020000Z', 'DTEND:20261215T030000Z', `SUMMARY:Sau restore ${uid}`, 'ORGANIZER:mailto:successor-a@team-a.test', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:successor-a@team-a.test', 'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:partner@partner.test']] }));
  let delivered = false;
  for (let i = 0; i < 30 && !delivered; i += 1) { await sleep(500); delivered = (await listMessages('partner@partner.test')).some((m) => (m.subject ?? '').includes(uid)); }
  await owner.request('DELETE', `${calPath(owner.uid, 'cal16-team-a')}${uid}.ics`);
  const result = { reference: ref.generatedAt, base: ncBase, diffs, newInvitationOnRestore: { put: put.status, deliveredToRestoredStalwart: delivered }, state };
  await writeEvidence('verify-restore.json', result);
  console.log(JSON.stringify({ diffs, newInvitationOnRestore: result.newInvitationOnRestore }, null, 1));
  assert(diffs.length === 0, 'restore matches reference', diffs);
  assert(put.status === 201 && delivered, 'iMIP works on restore', result.newInvitationOnRestore);
}
