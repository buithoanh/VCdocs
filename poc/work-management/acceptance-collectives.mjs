// Collectives: wiki owned by a Team (circle); Team A group is added as a team
// member. Member creates a page, writes it through WebDAV, uploads an
// attachment and comments on the page file; Team B / outsider are denied on
// collective, page, attachment, WebDAV, comment and team-membership APIs.
import { client, expectStatus, ocsData, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();
const { federatedGroups } = await readEvidence('nextcloud-config.json');
const manager = await client('manager-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const api = '/ocs/v2.php/apps/collectives/api/v1.0';
const marker = `work13-wiki-${Date.now()}`;
const davPath = (uid, path) => `/remote.php/dav/files/${encodeURIComponent(uid)}/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

const created = ocsData(expectStatus('create collective', await manager.request('POST', `${api}/collectives`, { json: { name: `Team A wiki ${marker}` } }), [200]));
const collective = created.collective ?? created;
// Circles member type 2 = group: membership then follows the federated group.
const teamMember = ocsData(expectStatus('add Team A group to team', await manager.request('POST', `/ocs/v2.php/apps/circles/circles/${collective.circleId}/members`, {
  json: { userId: federatedGroups['vcw-team-a'], type: 2 },
}), [200]));

const pageList = (actor) => actor.request('GET', `${api}/collectives/${collective.id}/pages`);
const landing = ocsData(expectStatus('member list pages', await pageList(member), [200])).pages.find((page) => page.parentId === 0);
const page = ocsData(expectStatus('member create page', await member.request('POST', `${api}/collectives/${collective.id}/pages/${landing.id}`, { json: { title: `Runbook ${marker}` } }), [200])).page;
// collectivePath already starts with the member's (hidden) Collectives folder.
const memberPagePath = `${page.collectivePath}/${page.filePath}/${page.fileName}`.replace(/\/+/g, '/');
expectStatus('member write page', await member.request('PUT', davPath(member.uid, memberPagePath), { body: `# Runbook ${marker}\n\nSearchable wiki body ${marker}\n` }), [201, 204]);
const attachmentForm = new FormData();
attachmentForm.append('file', new Blob([Buffer.from(`wiki attachment ${marker}\n`)], { type: 'text/plain' }), `${marker}.txt`);
const attachment = ocsData(expectStatus('member upload attachment', await member.request('POST', `${api}/collectives/${collective.id}/pages/${page.id}/attachments`, { body: attachmentForm }), [200]));
const comment = await member.request('POST', `/remote.php/dav/comments/files/${page.id}`, { json: { actorType: 'users', verb: 'comment', message: `Comment ${marker}` } });
if (comment.status !== 201) throw new Error(`COLLECTIVES_MEMBER_COMMENT_${comment.status}`);
const managerPage = ocsData(expectStatus('manager reads member page', await manager.request('GET', `${api}/collectives/${collective.id}/pages/${page.id}`), [200])).page;
const managerAttachments = ocsData(expectStatus('manager lists attachments', await manager.request('GET', `${api}/collectives/${collective.id}/pages/${page.id}/attachments`), [200])).attachments;

const deny = {};
await resetBruteforce();
for (const actor of [otherTeam, outsider]) {
  const probe = new FormData();
  probe.append('file', new Blob([Buffer.from('intrusion')], { type: 'text/plain' }), 'intrusion.txt');
  deny[actor.username] = {
    listPages: (await pageList(actor)).status,
    readPage: (await actor.request('GET', `${api}/collectives/${collective.id}/pages/${page.id}`)).status,
    createPage: (await actor.request('POST', `${api}/collectives/${collective.id}/pages/${landing.id}`, { json: { title: 'intrusion' } })).status,
    listAttachments: (await actor.request('GET', `${api}/collectives/${collective.id}/pages/${page.id}/attachments`)).status,
    uploadAttachment: (await actor.request('POST', `${api}/collectives/${collective.id}/pages/${page.id}/attachments`, { body: probe })).status,
    contentSearch: (await actor.request('GET', `${api}/collectives/${collective.id}/search?searchString=${marker}`)).status,
    webdavMemberPath: (await actor.request('GET', davPath(member.uid, memberPagePath), { raw: true })).status,
    filesComment: (await actor.request('POST', `/remote.php/dav/comments/files/${page.id}`, { json: { actorType: 'users', verb: 'comment', message: 'intrusion' } })).status,
    addSelfToTeam: (await actor.request('POST', `/ocs/v2.php/apps/circles/circles/${collective.circleId}/members`, { json: { userId: actor.uid, type: 1 } })).status,
    createShareLink: (await actor.request('POST', `${api}/collectives/${collective.id}/shares`, { json: {} })).status,
  };
  const listed = ocsData(await actor.request('GET', `${api}/collectives`));
  deny[actor.username].listContainsCollective = JSON.stringify(listed ?? '').includes(marker);
  for (const [check, value] of Object.entries(deny[actor.username])) {
    if (value === true || (typeof value === 'number' && value < 400)) throw new Error(`COLLECTIVES_DENY_FAILED:${actor.username}:${check}:${value}`);
  }
}

await writeEvidence('acceptance-collectives.json', {
  marker,
  resources: { collectiveId: collective.id, circleId: collective.circleId, landingPageId: landing.id, pageId: page.id, attachmentId: attachment.attachment?.id ?? attachment.id, memberPagePath },
  manager: { teamMemberType: 'group (federated vcw-team-a)', teamMemberAdded: Boolean(teamMember), sawMemberPage: managerPage.id === page.id, attachments: managerAttachments.length },
  member: { createdPage: page.id, webdavWrite: true, attachment: true, filesComment: comment.status },
  deny,
  result: 'LOCAL PASS',
});
console.log(`Collectives PASS: collective ${collective.id} circle ${collective.circleId}, page ${page.id}, deny ${JSON.stringify(deny)}`);
