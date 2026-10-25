// Deck: board shared to the Team A federated group, stack/card, comment and
// file attachment; Team B and the outsider are denied on every direct API.
import { createHash } from 'node:crypto';
import { client, expectStatus, ocsData, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();

const { federatedGroups } = await readEvidence('nextcloud-config.json');
const manager = await client('manager-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const deck = '/index.php/apps/deck/api/v1.0';
const deck11 = '/index.php/apps/deck/api/v1.1';
const marker = `work13-deck-${Date.now()}`;

const board = expectStatus('create board', await manager.request('POST', `${deck}/boards`, { json: { title: `Team A board ${marker}`, color: '0082c9' } }), [200]).data;
expectStatus('share board to Team A', await manager.request('POST', `${deck}/boards/${board.id}/acl`, {
  json: { type: 1, participant: federatedGroups['vcw-team-a'], permissionEdit: true, permissionShare: false, permissionManage: false },
}), [200]);
const stack = expectStatus('create stack', await manager.request('POST', `${deck}/boards/${board.id}/stacks`, { json: { title: 'Todo', order: 1 } }), [200]).data;
const card = expectStatus('create card', await manager.request('POST', `${deck}/boards/${board.id}/stacks/${stack.id}/cards`, {
  json: { title: `Card ${marker}`, type: 'plain', order: 1, description: `Searchable ${marker}` },
}), [200]).data;

// Member (edit ACL via group) can read, comment and attach.
const memberBoard = expectStatus('member read board', await member.request('GET', `${deck}/boards/${board.id}`), [200]).data;
const comment = ocsData(expectStatus('member comment', await member.request('POST', `/ocs/v2.php/apps/deck/api/v1.0/cards/${card.id}/comments`, { json: { message: `Comment ${marker}` } }), [200]));
const attachmentBytes = Buffer.from(`attachment ${marker}\n`);
const form = new FormData();
form.append('type', 'file');
form.append('data', `${marker}.txt`);
form.append('file', new Blob([attachmentBytes], { type: 'text/plain' }), `${marker}.txt`);
const attachResponse = expectStatus('member attach', await member.request('POST', `${deck11}/boards/${board.id}/stacks/${stack.id}/cards/${card.id}/attachments`, { body: form }), [200]);
const attachment = attachResponse.data;
const download = await manager.request('GET', `${deck11}/boards/${board.id}/stacks/${stack.id}/cards/${card.id}/attachments/file/${attachment.id}`, { raw: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (download.status !== 200 || sha(download.bytes) !== sha(attachmentBytes)) throw new Error(`manager attachment download ${download.status}`);
const comments = ocsData(expectStatus('manager list comments', await manager.request('GET', `/ocs/v2.php/apps/deck/api/v1.0/cards/${card.id}/comments`), [200]));

// Deny matrix for Team B manager and outsider.
const deny = {};
await resetBruteforce();
for (const actor of [otherTeam, outsider]) {
  deny[actor.username] = {
    listBoards: (await actor.request('GET', `${deck}/boards`)).data?.some?.((item) => item.id === board.id) ? 'LEAK' : 'not listed',
    readBoard: (await actor.request('GET', `${deck}/boards/${board.id}`)).status,
    readCard: (await actor.request('GET', `${deck}/boards/${board.id}/stacks/${stack.id}/cards/${card.id}`)).status,
    createCard: (await actor.request('POST', `${deck}/boards/${board.id}/stacks/${stack.id}/cards`, { json: { title: 'intrusion', type: 'plain', order: 2 } })).status,
    comment: (await actor.request('POST', `/ocs/v2.php/apps/deck/api/v1.0/cards/${card.id}/comments`, { json: { message: 'intrusion' } })).status,
    readComments: (await actor.request('GET', `/ocs/v2.php/apps/deck/api/v1.0/cards/${card.id}/comments`)).status,
    downloadAttachment: (await actor.request('GET', `${deck11}/boards/${board.id}/stacks/${stack.id}/cards/${card.id}/attachments/file/${attachment.id}`, { raw: true })).status,
    grantSelfAcl: (await actor.request('POST', `${deck}/boards/${board.id}/acl`, { json: { type: 0, participant: actor.uid, permissionEdit: true, permissionShare: true, permissionManage: true } })).status,
  };
  for (const [check, value] of Object.entries(deny[actor.username])) {
    if (value === 'LEAK' || (typeof value === 'number' && value < 400)) throw new Error(`DECK_DENY_FAILED:${actor.username}:${check}:${value}`);
  }
}
// Member has edit but not manage: must not be able to re-share the board.
const memberReshare = (await member.request('POST', `${deck}/boards/${board.id}/acl`, { json: { type: 0, participant: outsider.uid, permissionEdit: true, permissionShare: false, permissionManage: false } })).status;
if (memberReshare < 400) throw new Error(`DECK_MEMBER_RESHARE_ALLOWED:${memberReshare}`);

await writeEvidence('acceptance-deck.json', {
  marker,
  resources: { boardId: board.id, stackId: stack.id, cardId: card.id, attachmentId: attachment.id, commentId: comment?.id },
  manager: { boardCreated: true, aclGroup: 'vcw-team-a (federated id)', attachmentDownloadSha256: sha(download.bytes), commentsVisible: comments.length },
  member: { readBoard: memberBoard.id === board.id, commented: Boolean(comment?.id), attached: attachment.id, reshareWithoutManage: memberReshare },
  deny,
  result: 'LOCAL PASS',
});
console.log(`Deck PASS: board ${board.id}, member comment+attachment, deny ${JSON.stringify(deny)}, member reshare ${memberReshare}`);
