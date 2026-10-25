// Chat14 flow (c), Nextcloud side: member-a uploads into the shared folder
// Flow14-HoSo; Flow core tags every file flow14-hoso and *-mat.* files
// flow14-mat; access control denies flow14-mat files to anybody outside
// flow14-reviewers (member-a included, even though the folder is shared to
// Team A with write). Owner successor-a (reviewer) still reads them. Team B
// and outsider have no share at all. Tag readback is done as successor-a.
import { client, expectStatus, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();
const resources = await readEvidence('resources.json');
const rules = await readEvidence('flow-core-rules.json');
const owner = await client('successor-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const marker = `flow14-core-${Date.now()}`;
const dav = (actor, name) => `/remote.php/dav/files/${encodeURIComponent(actor.uid)}/${resources.files.folder}/${name}`;
const plain = `${marker}.txt`;
const secretName = `${marker}-mat.txt`;

expectStatus('member upload plain', await member.request('PUT', dav(member, plain), { body: `plain ${marker}\n` }), [201]);
const secretUpload = await member.request('PUT', dav(member, secretName), { body: `mat ${marker}\n` });

const fileId = async (actor, name) => {
  const response = await actor.request('PROPFIND', dav(actor, name), {
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
    headers: { Depth: '0', 'Content-Type': 'application/xml' },
  });
  return { status: response.status, id: Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(String(response.data))?.[1]) || null };
};
const tagsOf = async (actor, id) => {
  const response = await actor.request('PROPFIND', `/remote.php/dav/systemtags-relations/files/${id}`, {
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:display-name/></d:prop></d:propfind>',
    headers: { Depth: '1', 'Content-Type': 'application/xml' },
  });
  return { status: response.status, names: [...String(response.data).matchAll(/<oc:display-name>([^<]+)<\/oc:display-name>/g)].map((match) => match[1]) };
};
const plainId = await fileId(owner, plain);
const secretId = await fileId(owner, secretName);
const plainTags = await tagsOf(owner, plainId.id);
const secretTags = secretId.id ? await tagsOf(owner, secretId.id) : { status: null, names: [] };

const read = async (actor, name) => (await actor.request('GET', dav(actor, name), { raw: true })).status;
const result = {
  marker,
  rules: rules.rules.map((rule) => rule.name),
  upload: { plain: 201, secret: secretUpload.status },
  fileIds: { plain: plainId.id, secret: secretId.id },
  tags: { plain: plainTags.names, secret: secretTags.names },
  access: {
    ownerReadsPlain: await read(owner, plain),
    ownerReadsSecret: await read(owner, secretName),
    memberReadsPlain: await read(member, plain),
    memberReadsSecret: await read(member, secretName),
    memberOverwritesSecret: (await member.request('PUT', dav(member, secretName), { body: 'overwrite\n' })).status,
    memberDeletesSecret: (await member.request('DELETE', dav(member, secretName))).status,
  },
  deny: {},
};
await resetBruteforce();
for (const actor of [otherTeam, outsider]) {
  result.deny[actor.username] = {
    readPlainViaOwnerPath: (await actor.request('GET', dav(owner, plain), { raw: true })).status,
    readPlainOwnPath: (await actor.request('GET', dav(actor, plain), { raw: true })).status,
    tagsOfPlain: (await tagsOf(actor, plainId.id)).status,
  };
}
const pass = result.tags.plain.includes('flow14-hoso')
  && result.tags.secret.includes('flow14-hoso') && result.tags.secret.includes('flow14-mat')
  && result.access.ownerReadsPlain === 200 && result.access.ownerReadsSecret === 200
  && result.access.memberReadsPlain === 200 && result.access.memberReadsSecret >= 400
  && result.access.memberOverwritesSecret >= 400 && result.access.memberDeletesSecret >= 400
  && Object.values(result.deny).every((probe) => Object.values(probe).every((status) => status >= 400 && status !== 207));
await writeEvidence('acceptance-flow-core.json', { ...result, result: pass ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify(result, null, 1));
if (!pass) throw new Error('FLOW_CORE_ACCEPTANCE_FAILED');
