// Chat14: create the fake-data resources for the three acceptance flows, all
// owned by successor-a (Team A owner after the chat13 offboard of manager-a):
//   (a) form "Flow14 Yêu cầu" (submit share to Team A) + Deck board with two
//       stacks: one for forms_deck 0.7.0, one for the NestJS receiver;
//       the board has NO ACL for anybody else (answers stay with the owner);
//   (b) table "Flow14 Sự cố" shared directly to member-a (read/create);
//   (c) folder Flow14-HoSo shared to Team A (read/write) for Flow core rules.
// Also creates the forms_deck mapping (as successor-a, its own settings API).
// IDs are written to evidence/resources.json; rerun is refused if it exists.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { client, expectStatus, flowRoot, ocsData, readWork13Evidence, resetBruteforce, writeEvidence } from './lib.mjs';

if (existsSync(join(flowRoot, 'evidence', 'resources.json')) && process.env.FLOW14_RECREATE !== '1') {
  throw new Error('RESOURCES_EXIST: evidence/resources.json already exists (set FLOW14_RECREATE=1 to create a new set)');
}
await resetBruteforce();
const { federatedGroups } = await readWork13Evidence('nextcloud-config.json');
const owner = await client('successor-a');
const member = await client('member-a');
for (const persona of ['successor-a', 'member-a', 'manager-b', 'member-b', 'outsider']) {
  const actor = await client(persona);
  expectStatus(`app password ${persona}`, await actor.request('GET', '/ocs/v2.php/cloud/user?format=json'), [200]);
}

// (a) Form + Deck
const forms = '/ocs/v2.php/apps/forms/api/v3';
const form = ocsData(expectStatus('create form', await owner.request('POST', `${forms}/forms`, { json: {} }), [200, 201]));
expectStatus('form settings', await owner.request('PATCH', `${forms}/forms/${form.id}`, { json: { keyValuePairs: { title: 'Flow14 Yêu cầu', description: 'Form thử chat14 (dữ liệu giả)', submitMultiple: true } } }), [200]);
const titleQuestion = ocsData(expectStatus('title question', await owner.request('POST', `${forms}/forms/${form.id}/questions`, { json: { type: 'short', text: 'Tiêu đề' } }), [200, 201]));
const detailQuestion = ocsData(expectStatus('detail question', await owner.request('POST', `${forms}/forms/${form.id}/questions`, { json: { type: 'long', text: 'Mô tả' } }), [200, 201]));
expectStatus('share form to Team A', await owner.request('POST', `${forms}/forms/${form.id}/shares`, {
  json: { shareType: 1, shareWith: federatedGroups['vcw-team-a'], permissions: ['submit'] },
}), [200, 201]);

const deck = '/index.php/apps/deck/api/v1.0';
const board = expectStatus('create board', await owner.request('POST', `${deck}/boards`, { json: { title: 'Flow14 Tiếp nhận', color: '0082c9' } }), [200]).data;
const formsDeckStack = expectStatus('stack forms_deck', await owner.request('POST', `${deck}/boards/${board.id}/stacks`, { json: { title: 'forms_deck', order: 1 } }), [200]).data;
const nestStack = expectStatus('stack nestjs', await owner.request('POST', `${deck}/boards/${board.id}/stacks`, { json: { title: 'NestJS receiver', order: 2 } }), [200]).data;

// forms_deck mapping through the app's own (user-scoped) settings route.
const mapping = await owner.request('POST', '/index.php/apps/forms_deck/mappings', {
  json: { formId: form.id, boardId: board.id, stackId: formsDeckStack.id, titleParts: [`q:${titleQuestion.id}`], titleSeparator: ' - ', enabled: true, attachFiles: false },
});

// (b) Table shared directly to member-a (direct user share: the receiver can
// verify recipients from the share list without admin rights).
const tables = '/index.php/apps/tables/api/1';
const table = expectStatus('create table', await owner.request('POST', `${tables}/tables`, { json: { title: 'Flow14 Sự cố', emoji: '🚨', template: 'custom' } }), [200]).data;
const column = expectStatus('create column', await owner.request('POST', `${tables}/tables/${table.id}/columns`, {
  json: { title: 'Sự cố', type: 'text', subtype: 'line', mandatory: false, description: '' },
}), [200]).data;
expectStatus('share table to member-a', await owner.request('POST', `${tables}/tables/${table.id}/shares`, {
  json: { receiver: member.uid, receiverType: 'user', permissionRead: true, permissionCreate: true, permissionUpdate: false, permissionDelete: false, permissionManage: false },
}), [200]);

// (c) Folder shared to Team A for Flow core tagging/access control.
const folder = 'Flow14-HoSo';
expectStatus('create folder', await owner.request('MKCOL', `/remote.php/dav/files/${encodeURIComponent(owner.uid)}/${folder}`), [201]);
const folderShare = ocsData(expectStatus('share folder to Team A', await owner.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', {
  json: { path: `/${folder}`, shareType: 1, shareWith: federatedGroups['vcw-team-a'], permissions: 15 },
}), [200]));
const propfind = await owner.request('PROPFIND', `/remote.php/dav/files/${encodeURIComponent(owner.uid)}/${folder}`, {
  body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
  headers: { Depth: '0', 'Content-Type': 'application/xml' },
});
const folderFileId = Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(String(propfind.data))?.[1]);

await writeEvidence('resources.json', {
  owner: { persona: 'successor-a', uid: owner.uid },
  member: { persona: 'member-a', uid: member.uid },
  forms: { formId: form.id, titleQuestionId: titleQuestion.id, detailQuestionId: detailQuestion.id, sharedTo: 'vcw-team-a (federated id), submit' },
  deck: { boardId: board.id, formsDeckStackId: formsDeckStack.id, nestStackId: nestStack.id, boardAcl: 'chỉ chủ board (không ACL nhóm)' },
  formsDeckMapping: { status: mapping.status, id: mapping.data?.id ?? null, response: mapping.status === 200 || mapping.status === 201 ? 'created' : JSON.stringify(mapping.data).slice(0, 300) },
  tables: { tableId: table.id, columnId: column.id, sharedTo: 'member-a (user share, read+create)' },
  files: { folder, folderFileId, shareId: folderShare.id, sharedTo: 'vcw-team-a (federated id), permissions 15' },
});
console.log(`form ${form.id}, board ${board.id} (stacks ${formsDeckStack.id}/${nestStack.id}), mapping ${mapping.status}, table ${table.id}, folder ${folderFileId}`);
