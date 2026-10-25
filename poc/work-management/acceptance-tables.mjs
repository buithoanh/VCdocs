// Tables: table shared to Team A with read/create/update (no delete/manage);
// member adds and edits rows but cannot delete or re-share; Team B / outsider
// are denied on table, scheme, rows and share APIs. Scheme+rows JSON is the
// export path checked for the owner.
import { client, expectStatus, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();
const { federatedGroups } = await readEvidence('nextcloud-config.json');
const manager = await client('manager-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const api = '/index.php/apps/tables/api/1';
const marker = `work13-tables-${Date.now()}`;

const table = expectStatus('create table', await manager.request('POST', `${api}/tables`, { json: { title: `Team A tracker ${marker}`, emoji: '📋', template: 'custom' } }), [200]).data;
const column = expectStatus('create column', await manager.request('POST', `${api}/tables/${table.id}/columns`, {
  json: { title: 'Task', type: 'text', subtype: 'line', mandatory: false, description: '' },
}), [200]).data;
const ownerRow = expectStatus('owner row', await manager.request('POST', `${api}/tables/${table.id}/rows`, { json: { data: { [column.id]: `Owner task ${marker}` } } }), [200]).data;
const share = expectStatus('share to Team A', await manager.request('POST', `${api}/tables/${table.id}/shares`, {
  json: { receiver: federatedGroups['vcw-team-a'], receiverType: 'group', permissionRead: true, permissionCreate: true, permissionUpdate: true, permissionDelete: false, permissionManage: false },
}), [200]).data;

const memberTable = expectStatus('member read table', await member.request('GET', `${api}/tables/${table.id}`), [200]);
const memberRow = expectStatus('member create row', await member.request('POST', `${api}/tables/${table.id}/rows`, { json: { data: { [column.id]: `Member task ${marker}` } } }), [200]).data;
expectStatus('member update row', await member.request('PUT', `${api}/rows/${memberRow.id}`, { json: { data: { [column.id]: `Member task edited ${marker}` } } }), [200]);
const memberDelete = (await member.request('DELETE', `${api}/rows/${ownerRow.id}`)).status;
const memberReshare = (await member.request('POST', `${api}/tables/${table.id}/shares`, {
  json: { receiver: outsider.uid, receiverType: 'user', permissionRead: true, permissionCreate: true, permissionUpdate: true, permissionDelete: true, permissionManage: true },
})).status;
if (memberDelete < 400 || memberReshare < 400) throw new Error(`TABLES_MEMBER_EXCEEDS_SHARE:${memberDelete}:${memberReshare}`);

const scheme = expectStatus('owner scheme export', await manager.request('GET', `${api}/tables/${table.id}/scheme`), [200]).data;
const rows = expectStatus('owner rows export', await manager.request('GET', `${api}/tables/${table.id}/rows`), [200]).data;
if (!JSON.stringify(rows).includes(`Member task edited ${marker}`)) throw new Error('TABLES_MEMBER_EDIT_NOT_EXPORTED');

const deny = {};
await resetBruteforce();
for (const actor of [otherTeam, outsider]) {
  deny[actor.username] = {
    readTable: (await actor.request('GET', `${api}/tables/${table.id}`)).status,
    readScheme: (await actor.request('GET', `${api}/tables/${table.id}/scheme`)).status,
    readRows: (await actor.request('GET', `${api}/tables/${table.id}/rows`)).status,
    readRow: (await actor.request('GET', `${api}/rows/${ownerRow.id}`)).status,
    createRow: (await actor.request('POST', `${api}/tables/${table.id}/rows`, { json: { data: { [column.id]: 'intrusion' } } })).status,
    updateRow: (await actor.request('PUT', `${api}/rows/${ownerRow.id}`, { json: { data: { [column.id]: 'intrusion' } } })).status,
    deleteRow: (await actor.request('DELETE', `${api}/rows/${ownerRow.id}`)).status,
    readShares: (await actor.request('GET', `${api}/tables/${table.id}/shares`)).status,
    shareToSelf: (await actor.request('POST', `${api}/tables/${table.id}/shares`, {
      json: { receiver: actor.uid, receiverType: 'user', permissionRead: true, permissionCreate: true, permissionUpdate: true, permissionDelete: true, permissionManage: true },
    })).status,
  };
  const listed = (await actor.request('GET', `${api}/tables`)).data;
  deny[actor.username].listContainsTable = Array.isArray(listed) && listed.some((item) => item.id === table.id);
  for (const [check, value] of Object.entries(deny[actor.username])) {
    if (value === true || (typeof value === 'number' && value < 400)) throw new Error(`TABLES_DENY_FAILED:${actor.username}:${check}:${value}`);
  }
}
const ownerRowAfter = expectStatus('owner row intact', await manager.request('GET', `${api}/rows/${ownerRow.id}`), [200]).data;
if (!JSON.stringify(ownerRowAfter).includes(`Owner task ${marker}`)) throw new Error('TABLES_OWNER_ROW_TAMPERED');

await writeEvidence('acceptance-tables.json', {
  marker,
  resources: { tableId: table.id, columnId: column.id, ownerRowId: ownerRow.id, memberRowId: memberRow.id, shareId: share.id },
  manager: { shareTo: 'vcw-team-a (federated id)', export: { schemeColumns: scheme.columns?.length, rows: rows.length } },
  member: { readTable: memberTable.status, createRow: true, updateRow: true, deleteWithoutPermission: memberDelete, reshareWithoutManage: memberReshare },
  deny,
  comments: 'N/A: Tables 2.3.2 has no row comments.',
  attachments: 'N/A: Tables has no file upload column; files can only be referenced by link.',
  result: 'LOCAL PASS',
});
console.log(`Tables PASS: table ${table.id}, member create/update, delete ${memberDelete}, reshare ${memberReshare}, deny ${JSON.stringify(deny)}`);
