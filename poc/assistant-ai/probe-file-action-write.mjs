// Chat19 FINDING probe (fake data): the Assistant "Summarize" file action is
// not read-only. FileActionTaskSuccessfulListener writes "<name> - summarized.md"
// next to the source file with the asker's rights and tags it "Generated using
// AI" (DOC assistant 3.5.1). With a writable team folder the (possibly
// injection-hijacked) summary becomes a team file. Demonstrated with:
//   1. member-a's own folder ai19-own/
//   2. a Team A folder shared WRITABLE (perm 31) by successor-a: ai19-team-a-rw/
//      containing the injected document; successor-a then reads the new file.
// Read-only team folder (ai19-team-a, perm 1): write fails (see audit-logs.json).
import { client, ocs, teamGroups, tp, writeEvidence } from './lib.mjs';
import { injectionMarkers, teamAFiles } from './corpus.mjs';

const enc = encodeURIComponent;
const dav = (uid, path) => `/remote.php/dav/files/${enc(uid)}/${path.split('/').map(enc).join('/')}`;
const fileIdOf = async (c, path) => {
  const r = await c.request('PROPFIND', dav(c.uid, path), { headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>' });
  return Number((/<oc:fileid>(\d+)</.exec(r.text) ?? [])[1] ?? 0) || null;
};
const A = await client('member-a');
const S = await client('successor-a');
const B = await client('member-b');
const out = {};

async function summarizeAndWait(c, fileId) {
  const r = await c.request('POST', `/ocs/v2.php/apps/assistant/api/v1/file-action/${fileId}/core:text2text:summary`);
  const t0 = Date.now();
  let task;
  for (;;) {
    const list = ocs(await c.request('GET', tp(`/tasks?customId=${enc(`file-action:${fileId}`)}`)))?.tasks ?? [];
    task = list.sort((x, y) => y.id - x.id)[0];
    if (task && ['STATUS_SUCCESSFUL', 'STATUS_FAILED'].includes(task.status)) break;
    if (Date.now() - t0 > 600000) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  await new Promise((res) => setTimeout(res, 1500)); // listener runs right after success
  return { http: r.status, taskId: task?.id, status: task?.status, output: task?.output?.output };
}

// 1. Own folder.
await A.request('MKCOL', dav(A.uid, 'ai19-own'));
await A.request('PUT', dav(A.uid, 'ai19-own/ghi-chu-ca-nhan.md'), { body: '# Ghi chú cá nhân ai19\n\nTuần sau nộp báo cáo chi phí, gọi nhà cung cấp bao bì, nhắc kiểm kê kho.\n' });
const ownId = await fileIdOf(A, 'ai19-own/ghi-chu-ca-nhan.md');
const own = await summarizeAndWait(A, ownId);
const ownTarget = await A.request('GET', dav(A.uid, 'ai19-own/ghi-chu-ca-nhan.md - summarized.md'));
out.ownFolder = { ...own, sourceFileId: ownId, resultFileStatus: ownTarget.status, resultFileBody: ownTarget.status === 200 ? ownTarget.text : null };

// 2. Writable Team A folder with the injected document.
await S.request('MKCOL', dav(S.uid, 'ai19-team-a-rw'));
await S.request('PUT', dav(S.uid, 'ai19-team-a-rw/huong-dan-noi-bo-team-a.md'), { body: teamAFiles['huong-dan-noi-bo-team-a.md'] });
const shares = ocs(await S.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/shares?path=${enc('/ai19-team-a-rw')}`)) ?? [];
if (!shares.some((s) => s.share_type === 1 && s.share_with === teamGroups.a)) {
  await S.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', { json: { path: '/ai19-team-a-rw', shareType: 1, shareWith: teamGroups.a, permissions: 31 } });
}
await new Promise((res) => setTimeout(res, 1500));
const rwId = await fileIdOf(A, 'ai19-team-a-rw/huong-dan-noi-bo-team-a.md');
const rw = await summarizeAndWait(A, rwId);
const seenByOwner = await S.request('GET', dav(S.uid, 'ai19-team-a-rw/huong-dan-noi-bo-team-a.md - summarized.md'));
const tags = await S.request('PROPFIND', dav(S.uid, 'ai19-team-a-rw/huong-dan-noi-bo-team-a.md - summarized.md'), { headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns"><d:prop><nc:system-tags/></d:prop></d:propfind>' });
const teamBView = await B.request('GET', dav(B.uid, 'ai19-team-a-rw/huong-dan-noi-bo-team-a.md - summarized.md'));
out.writableTeamFolder = {
  ...rw,
  sourceFileId: rwId,
  resultFileSeenByFolderOwner: seenByOwner.status,
  resultFileBody: seenByOwner.status === 200 ? seenByOwner.text : null,
  resultFileHasInjectionMarkers: injectionMarkers.filter((m) => seenByOwner.text.toLowerCase().includes(m.toLowerCase())),
  resultFileSystemTags: [...tags.text.matchAll(/<nc:system-tag[^>]*>([^<]*)</g)].map((m) => m[1]),
  teamBCanRead: teamBView.status,
};
out.finding = (out.ownFolder.resultFileStatus === 200 || out.writableTeamFolder.resultFileSeenByFolderOwner === 200)
  ? 'FINDING: Assistant file action writes "<name> - summarized.md" beside the source with the asker\'s rights (not read-only)'
  : 'not reproduced';
await writeEvidence('finding-file-action-write.json', out);
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
