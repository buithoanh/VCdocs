// Chat14 flow (c): Flow core rules (workflowengine + files_automatedtagging +
// files_accesscontrol) for the shared folder Flow14-HoSo. Admin setup only;
// the NestJS receiver never uses admin credentials.
//   - restricted tag flow14-hoso: every file uploaded under /Flow14-HoSo/
//   - restricted tag flow14-mat: file name ending -mat.<ext>
//   - access control: files tagged flow14-mat are denied to anybody not in the
//     local group flow14-reviewers (successor-a only). The group name does not
//     match the user_oidc whitelist (^vcw-), so OIDC logins do not prune it.
// Idempotent: existing tags/rules with the same name are reused.
import { adminRequest, ocsData, occ, personas, writeEvidence } from './lib.mjs';

const admin = await adminRequest();
const owner = (await personas())['successor-a'];
const group = 'flow14-reviewers';
const groups = JSON.parse((await occ('group:list', '--output=json')).stdout);
if (!(group in groups)) await occ('group:add', group);
const members = JSON.parse((await occ('group:list', '--output=json')).stdout)[group] ?? [];
if (!members.includes(owner.nextcloudUserId)) await occ('group:adduser', group, owner.nextcloudUserId);

async function tagId(name) {
  const find = async () => JSON.parse((await occ('tag:list', '--output=json')).stdout);
  let tags = await find();
  let id = Object.entries(tags).find(([, tag]) => (tag.name ?? tag) === name)?.[0];
  if (!id) {
    await occ('tag:add', name, 'restricted');
    tags = await find();
    id = Object.entries(tags).find(([, tag]) => (tag.name ?? tag) === name)?.[0];
  }
  if (!id) throw new Error(`TAG_NOT_CREATED:${name}`);
  return Number(id);
}
const hosoTag = await tagId('flow14-hoso');
const matTag = await tagId('flow14-mat');

const base = '/ocs/v2.php/apps/workflowengine/api/v1/workflows/global?format=json';
const fileEntity = 'OCA\\WorkflowEngine\\Entity\\File';
const wanted = [
  {
    name: 'flow14-tag-hoso', class: 'OCA\\FilesAutomatedTagging\\Operation', entity: fileEntity, events: [], operation: String(hosoTag),
    checks: [{ class: 'OCA\\WorkflowEngine\\Check\\RequestURL', operator: 'matches', value: '/\\/Flow14-HoSo\\//' }],
  },
  {
    name: 'flow14-tag-mat', class: 'OCA\\FilesAutomatedTagging\\Operation', entity: fileEntity, events: [], operation: String(matTag),
    checks: [{ class: 'OCA\\WorkflowEngine\\Check\\FileName', operator: 'matches', value: '/-mat\\.[a-z0-9]+$/i' }],
  },
  {
    name: 'flow14-deny-mat', class: 'OCA\\FilesAccessControl\\Operation', entity: fileEntity, events: [], operation: 'deny',
    checks: [
      { class: 'OCA\\WorkflowEngine\\Check\\FileSystemTags', operator: 'is', value: String(matTag) },
      { class: 'OCA\\WorkflowEngine\\Check\\UserGroupMembership', operator: '!is', value: group },
    ],
  },
];
const listRules = async () => {
  const data = ocsData(await admin('GET', base));
  return Object.values(data ?? {}).flat();
};
let existing = await listRules();
const created = {};
for (const rule of wanted) {
  const found = existing.find((item) => item.name === rule.name);
  if (found) { created[rule.name] = { id: found.id, reused: true }; continue; }
  const response = await admin('POST', base, rule);
  if (response.status !== 200) throw new Error(`RULE_${rule.name}_${response.status}:${JSON.stringify(response.data).slice(0, 400)}`);
  created[rule.name] = { id: ocsData(response).id, reused: false };
}
existing = await listRules();
await writeEvidence('flow-core-rules.json', {
  tags: { 'flow14-hoso': { id: hosoTag, access: 'restricted' }, 'flow14-mat': { id: matTag, access: 'restricted' } },
  reviewersGroup: { name: group, members: ['successor-a'] },
  rules: existing.filter((item) => item.name?.startsWith('flow14-')).map((item) => ({ id: item.id, name: item.name, class: item.class, operation: item.operation, checks: item.checks.map((check) => ({ class: check.class, operator: check.operator, value: check.value })) })),
  created,
});
console.log(`tags hoso=${hosoTag} mat=${matTag}; rules ${JSON.stringify(created)}`);
