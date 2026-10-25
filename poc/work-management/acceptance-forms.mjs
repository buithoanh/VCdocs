// Forms: owner shares a form to Team A with submit-only permission; member
// submits text + file upload but cannot read results; Team B / outsider cannot
// read, submit, upload or export. Export CSV is checked for the owner.
import { client, expectStatus, ocsData, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();

const { federatedGroups } = await readEvidence('nextcloud-config.json');
const manager = await client('manager-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const api = '/ocs/v2.php/apps/forms/api/v3';
const marker = `work13-forms-${Date.now()}`;

const form = ocsData(expectStatus('create form', await manager.request('POST', `${api}/forms`, { json: {} }), [200, 201]));
expectStatus('title form', await manager.request('PATCH', `${api}/forms/${form.id}`, { json: { keyValuePairs: { title: `Team A request ${marker}`, description: `Searchable ${marker}` } } }), [200]);
const textQuestion = ocsData(expectStatus('text question', await manager.request('POST', `${api}/forms/${form.id}/questions`, { json: { type: 'short', text: 'Request summary' } }), [200, 201]));
const fileQuestion = ocsData(expectStatus('file question', await manager.request('POST', `${api}/forms/${form.id}/questions`, { json: { type: 'file', text: 'Attachment' } }), [200, 201]));
const share = ocsData(expectStatus('share to Team A', await manager.request('POST', `${api}/forms/${form.id}/shares`, {
  json: { shareType: 1, shareWith: federatedGroups['vcw-team-a'], permissions: ['submit'] },
}), [200, 201]));

const memberForm = expectStatus('member read form', await member.request('GET', `${api}/forms/${form.id}`), [200]);
const fileBody = new FormData();
fileBody.append('files[]', new Blob([Buffer.from(`form attachment ${marker}\n`)], { type: 'text/plain' }), `${marker}.txt`);
const uploaded = ocsData(expectStatus('member upload', await member.request('POST', `${api}/forms/${form.id}/submissions/files/${fileQuestion.id}`, { body: fileBody }), [200, 201]));
const submission = expectStatus('member submit', await member.request('POST', `${api}/forms/${form.id}/submissions`, {
  json: { answers: { [textQuestion.id]: [`Answer ${marker}`], [fileQuestion.id]: uploaded.map((item) => ({ uploadedFileId: item.uploadedFileId, fileName: item.fileName, uploadToken: item.uploadToken })) } },
}), [200, 201]);
expectStatus('owner submit', await manager.request('POST', `${api}/forms/${form.id}/submissions`, {
  json: { answers: { [textQuestion.id]: [`Owner answer ${marker}`] } },
}), [200, 201]);
// A submit-only member may list submissions, but Forms must scope that list to
// the member's own responses and refuse the full export.
const memberList = ocsData(expectStatus('member own submissions', await member.request('GET', `${api}/forms/${form.id}/submissions`), [200]));
const memberSeesOnlyOwn = memberList.submissions.length === 1 && memberList.submissions.every((item) => item.userId === member.uid);
if (!memberSeesOnlyOwn || JSON.stringify(memberList).includes(`Owner answer ${marker}`)) throw new Error('FORMS_MEMBER_SEES_OTHER_SUBMISSIONS');
const memberResults = (await member.request('GET', `${api}/forms/${form.id}/submissions?fileFormat=csv`, { raw: true })).status;
if (memberResults < 400) throw new Error(`FORMS_MEMBER_EXPORT_${memberResults}`);
const results = ocsData(expectStatus('owner results', await manager.request('GET', `${api}/forms/${form.id}/submissions`), [200]));
const submissions = results.submissions ?? results;
if (!JSON.stringify(submissions).includes(`Answer ${marker}`)) throw new Error('FORMS_OWNER_RESULT_MISSING');
const csv = await manager.request('GET', `${api}/forms/${form.id}/submissions?fileFormat=csv`, { raw: true, headers: { Accept: 'text/csv' } });
if (csv.status !== 200 || !csv.bytes.toString().includes(`Answer ${marker}`)) throw new Error(`FORMS_CSV_EXPORT_${csv.status}`);

const deny = {};
await resetBruteforce();
for (const actor of [otherTeam, outsider]) {
  const probeFile = new FormData();
  probeFile.append('files[]', new Blob([Buffer.from('intrusion')], { type: 'text/plain' }), 'intrusion.txt');
  deny[actor.username] = {
    readForm: (await actor.request('GET', `${api}/forms/${form.id}`)).status,
    readQuestions: (await actor.request('GET', `${api}/forms/${form.id}/questions`)).status,
    submit: (await actor.request('POST', `${api}/forms/${form.id}/submissions`, { json: { answers: { [textQuestion.id]: ['intrusion'] } } })).status,
    upload: (await actor.request('POST', `${api}/forms/${form.id}/submissions/files/${fileQuestion.id}`, { body: probeFile })).status,
    readResults: (await actor.request('GET', `${api}/forms/${form.id}/submissions`)).status,
    exportCsv: (await actor.request('GET', `${api}/forms/${form.id}/submissions?fileFormat=csv`, { raw: true })).status,
    editForm: (await actor.request('PATCH', `${api}/forms/${form.id}`, { json: { keyValuePairs: { title: 'intrusion' } } })).status,
    addShare: (await actor.request('POST', `${api}/forms/${form.id}/shares`, { json: { shareType: 0, shareWith: actor.uid, permissions: ['submit', 'results'] } })).status,
  };
  const listed = ocsData(await actor.request('GET', `${api}/forms?type=shared`));
  deny[actor.username].sharedListContainsForm = Array.isArray(listed) && listed.some((item) => item.id === form.id);
  for (const [check, value] of Object.entries(deny[actor.username])) {
    if (value === true || (typeof value === 'number' && value < 400)) throw new Error(`FORMS_DENY_FAILED:${actor.username}:${check}:${value}`);
  }
}

await writeEvidence('acceptance-forms.json', {
  marker,
  resources: { formId: form.id, hash: form.hash, textQuestionId: textQuestion.id, fileQuestionId: fileQuestion.id, shareId: share.id },
  manager: { shareTo: 'vcw-team-a (federated id)', sharePermissions: share.permissions, resultsCount: submissions.length, csvExportBytes: csv.bytes.length },
  member: { readForm: memberForm.status, uploadedFiles: uploaded.length, submit: submission.status, listSubmissionsScopedToOwn: memberSeesOnlyOwn, exportCsv: memberResults },
  deny,
  comments: 'N/A: Forms has no comment feature; collaboration is through result sharing permissions.',
  result: 'LOCAL PASS',
});
console.log(`Forms PASS: form ${form.id}, member submit ${submission.status} + upload ${uploaded.length}, member sees only own, export ${memberResults}, deny ${JSON.stringify(deny)}`);
