// Chat14 flow (c): file vào thư mục chia sẻ Flow14-HoSo → Flow core gắn tag
// (flow14-hoso, flow14-mat) và chặn truy cập file *-mat cho người ngoài nhóm
// flow14-reviewers → receiver NestJS nhận NodeCreated/NodeWritten, đọc lại bằng
// quyền successor-a (SEARCH theo fileid + systemtags) và ghi journal
// tag_verified. File riêng của member-a ngoài thư mục: receiver không thấy
// (not_visible_to_runner), không leo thang.
import { client, expectStatus, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';
import { stats, waitEvent } from './flow-helpers.mjs';
import { startReceiver, vcLogin } from './receiver-lib.mjs';
import { registerWebhooks } from './register-webhooks.mjs';

await resetBruteforce();
const resources = await readEvidence('resources.json');
const owner = await client('successor-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const marker = `flow14-c-${Date.now()}`;
const dav = (actor, path) => `/remote.php/dav/files/${encodeURIComponent(actor.uid)}/${path}`;
const fileId = async (actor, path) => {
  const response = await actor.request('PROPFIND', dav(actor, path), {
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
    headers: { Depth: '0', 'Content-Type': 'application/xml' },
  });
  return Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(String(response.data))?.[1]) || null;
};

const receiver = await startReceiver();
try {
  const it = await vcLogin('it@vcprosperous.com');
  await registerWebhooks();
  const folder = resources.files.folder;
  const uploads = {
    plain: `${folder}/${marker}.txt`,
    secret: `${folder}/${marker}-mat.txt`,
    private: `${marker}-rieng.txt`,
  };
  const timing = {};
  for (const [key, path] of Object.entries(uploads)) {
    const t0 = Date.now();
    expectStatus(`member upload ${key}`, await member.request('PUT', dav(member, path), { body: `${key} ${marker}\n` }), [201]);
    timing[key] = t0;
  }
  const ids = {
    plain: await fileId(owner, uploads.plain),
    secret: await fileId(owner, uploads.secret),
    private: await fileId(member, uploads.private),
  };
  const journal = {};
  const latency = [];
  for (const [key, id] of Object.entries(ids)) {
    const items = await waitEvent(it, `files:node:${id}`, { count: 2 });
    journal[key] = items.map((e) => ({ eventClass: e.eventClass.split('\\').pop(), status: e.status, outcome: e.results[0]?.outcome, tags: e.results[0]?.tags ?? null, attempts: e.attempts }));
    for (const e of items) if (e.finishedAt) latency.push(Date.parse(e.finishedAt) - timing[key]);
  }
  await resetBruteforce();
  const read = async (actor, path) => (await actor.request('GET', dav(actor, path), { raw: true })).status;
  const access = {
    ownerPlain: await read(owner, uploads.plain),
    ownerSecret: await read(owner, uploads.secret),
    memberPlain: await read(member, uploads.plain),
    memberSecret: await read(member, uploads.secret),
    'manager-b': await read(otherTeam, uploads.plain),
    outsider: await read(outsider, uploads.plain),
    outsiderUploadIntoOwnerFolder: (await outsider.request('PUT', dav(owner, `${folder}/${marker}-outsider.txt`), { body: 'x' })).status,
  };
  const verified = (key) => journal[key].some((e) => e.outcome === 'tag_verified' && e.tags.includes('flow14-hoso'));
  const result = {
    marker,
    fileIds: ids,
    journal,
    latencyDoneAfterUploadStartMs: stats(latency),
    access,
    note: 'Webhook file lọc theo user.uid ∈ Team A (PHPMongoQuery không có $regex); receiver lọc thư mục bằng readback',
  };
  const pass = verified('plain') && verified('secret')
    && journal.secret.some((e) => e.tags?.includes('flow14-mat'))
    && journal.private.every((e) => e.outcome === 'not_visible_to_runner' && e.status === 'skipped')
    && access.ownerPlain === 200 && access.ownerSecret === 200 && access.memberPlain === 200 && access.memberSecret >= 400
    && access['manager-b'] >= 400 && access.outsider >= 400 && access.outsiderUploadIntoOwnerFolder >= 400;
  await writeEvidence('acceptance-files-flow.json', { ...result, result: pass ? 'LOCAL PASS' : 'FAIL' });
  console.log(JSON.stringify({ ...result, pass }, null, 1));
  if (!pass) throw new Error('FILES_FLOW_ACCEPTANCE_FAILED');
} finally {
  await receiver.stop();
}
