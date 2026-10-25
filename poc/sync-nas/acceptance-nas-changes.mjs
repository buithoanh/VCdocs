// Chat15 NAS: edit directly on the NAS (SMB client = user on Explorer/Finder,
// NAS filesystem = job/app on the NAS itself), then measure when Nextcloud and
// sync clients (home-root ETag) see it, with and without notify/scan; check
// whether a rename outside Nextcloud keeps share/tag/comment; Unicode NFC/NFD
// and case-only renames. Only the NAS volume and Nextcloud APIs/occ are used;
// the Nextcloud DB and data directory are never touched directly.
import { client, davPath, docker, fileId, nasContainer, nasExec, occ, ocsData, propfind, resetBruteforce, smb, smbClientContainer, stats, waitUntil, writeEvidence } from './lib.mjs';

await resetBruteforce();
const m = `c15-${Date.now()}`;
const owner = await client('successor-a'); // Team A
const member = await client('member-a'); // Team A
const managerB = await client('manager-b'); // Team B
const dirA = `Chat15-${m}`;
const dirB = `Chat15-${m}`;
const mustStatus = (label, r, ok) => { if (!ok.includes(r.status)) throw new Error(`${label}: ${r.status} ${String(r.data).slice(0, 300)}`); return r; };
mustStatus('mkcol A', await owner.request('MKCOL', davPath(owner, `NAS-TeamA/${dirA}`)), [201]);
mustStatus('mkcol B', await managerB.request('MKCOL', davPath(managerB, `NAS-TeamB/${dirB}`)), [201]);
const smbLocal = async (name, kb = 4) => docker('exec', smbClientContainer, 'dd', 'if=/dev/urandom', `of=/work/${name}`, 'bs=1024', `count=${kb}`, 'status=none');
const homeEtag = async (actor) => (await propfind(actor, '', '0')).entries[0]?.etag;
const listing = async (actor, path) => (await propfind(actor, path, '1')).entries.slice(1);
const names = (entries) => entries.map((e) => e.path.split('/').filter(Boolean).at(-1));
const visible = (actor, path, name) => async () => names(await listing(actor, path)).includes(name);

// ── 1. Độ trễ thấy thay đổi trực tiếp trên NAS ──
const delays = { teamA_smb_new: [], teamA_smb_new_homeEtag: [], teamA_nasfs_new_burst: [], teamA_smb_overwrite_listingEtag: [], teamA_smb_overwrite_fileEtag: [], teamB_smb_new_without_scan: [], teamB_scan_ms: [], teamB_after_scan_visible: [] };
for (let i = 0; i < 5; i++) {
  await smbLocal(`d${i}`);
  const name = `smb-new-${i}.bin`;
  const before = await homeEtag(member);
  await smb('nas-member-a', 'team-a', `cd ${dirA}; put /work/d${i} ${name}`);
  const t0 = Date.now();
  const seen = await waitUntil('teamA smb new', visible(member, `NAS-TeamA/${dirA}`, name), { timeoutMs: 30_000, intervalMs: 100 });
  delays.teamA_smb_new.push(seen.ms ?? null);
  const etag = await waitUntil('home etag', async () => (await homeEtag(member)) !== before, { timeoutMs: 30_000, intervalMs: 100 });
  delays.teamA_smb_new_homeEtag.push(etag.value ? Date.now() - t0 : null);
}
for (let i = 0; i < 5; i++) {
  const name = `nasfs-new-${i}.bin`;
  await docker('exec', '-u', 'nas-member-a', nasContainer, 'dd', 'if=/dev/urandom', `of=/srv/nas/team-a/${dirA}/${name}`, 'bs=1024', 'count=4', 'status=none');
  const seen = await waitUntil('teamA nasfs new', visible(member, `NAS-TeamA/${dirA}`, name), { timeoutMs: 30_000, intervalMs: 100 });
  delays.teamA_nasfs_new_burst.push(seen.ms ?? null); // ghi dồn ngay sau lượt trước: xem probe-detection.json
}
// Ghi đè nội dung (cùng tên) qua SMB: fileid giữ? listing và chính file thấy ETag mới khi nào?
const overwrite = { fileIdStable: [] };
for (let i = 0; i < 5; i++) {
  const name = `smb-new-${i}.bin`;
  const id0 = await fileId(member, `NAS-TeamA/${dirA}/${name}`);
  const etag0 = (await listing(member, `NAS-TeamA/${dirA}`)).find((e) => e.path.endsWith(`/${name}`))?.etag;
  await smbLocal(`o${i}`, 8);
  await smb('nas-member-a', 'team-a', `cd ${dirA}; put /work/o${i} ${name}`);
  const inListing = await waitUntil('overwrite listing etag', async () => (await listing(member, `NAS-TeamA/${dirA}`)).find((e) => e.path.endsWith(`/${name}`))?.etag !== etag0, { timeoutMs: 30_000, intervalMs: 100 });
  delays.teamA_smb_overwrite_listingEtag.push(inListing.ms);
  const t1 = Date.now();
  const direct = (await propfind(member, `NAS-TeamA/${dirA}/${name}`, '0')).entries[0];
  delays.teamA_smb_overwrite_fileEtag.push(direct.etag !== etag0 ? Date.now() - t1 : null);
  overwrite.fileIdStable.push(direct.fileId === id0);
}
// Team B: không notify, không kiểm thay đổi khi truy cập → chỉ thấy sau files:scan
for (let i = 0; i < 3; i++) {
  await smbLocal(`b${i}`);
  const name = `smb-b-${i}.bin`;
  await smb('nas-manager-b', 'team-b', `cd ${dirB}; put /work/b${i} ${name}`);
  const seen = await waitUntil('teamB without scan', visible(managerB, `NAS-TeamB/${dirB}`, name), { timeoutMs: 10_000, intervalMs: 500 });
  delays.teamB_smb_new_without_scan.push(seen.ms ?? 'not visible after 10 s');
  const s0 = Date.now();
  await occ('files:scan', `--path=/${managerB.uid}/files/NAS-TeamB/${dirB}`);
  delays.teamB_scan_ms.push(Date.now() - s0);
  delays.teamB_after_scan_visible.push(await visible(managerB, `NAS-TeamB/${dirB}`, name)());
}

// ── 2. Rename ngoài Nextcloud có mất share/tag/comment? ──
const tagName = 'sync15-meta';
const tags = JSON.parse((await occ('tag:list', '--output=json')).stdout);
let tagId = Number(Object.entries(tags).find(([, t]) => (t.name ?? t) === tagName)?.[0]);
if (!tagId) {
  await occ('tag:add', tagName, 'public');
  tagId = Number(Object.entries(JSON.parse((await occ('tag:list', '--output=json')).stdout)).find(([, t]) => (t.name ?? t) === tagName)?.[0]);
}
async function decorate(name) {
  const path = `NAS-TeamA/${dirA}/${name}`;
  mustStatus(`put ${name}`, await owner.request('PUT', davPath(owner, path), { body: `meta ${name}\n` }), [201]);
  const id = await fileId(owner, path);
  mustStatus('tag', await owner.request('PUT', `/remote.php/dav/systemtags-relations/files/${id}/${tagId}`), [201, 409]);
  mustStatus('comment', await owner.request('POST', `/remote.php/dav/comments/files/${id}`, { json: { actorType: 'users', verb: 'comment', message: `comment ${m}` } }), [201]);
  const share = await owner.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', { json: { path: `/${path}`, shareType: 0, shareWith: member.uid, permissions: 1 } });
  mustStatus('share', share, [200]);
  return { id, shareId: ocsData(share).id };
}
async function metadata(id, shareId) {
  const tagsOf = await owner.request('PROPFIND', `/remote.php/dav/systemtags-relations/files/${id}`, { body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:display-name/></d:prop></d:propfind>', headers: { Depth: '1', 'Content-Type': 'application/xml' } });
  const comments = await owner.request('REPORT', `/remote.php/dav/comments/files/${id}`, { body: '<?xml version="1.0"?><oc:filter-comments xmlns:oc="http://owncloud.org/ns"><oc:limit>20</oc:limit><oc:offset>0</oc:offset></oc:filter-comments>', headers: { 'Content-Type': 'application/xml' } });
  const share = await owner.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/shares/${shareId}?format=json`);
  const shareData = ocsData(share);
  const recipientView = names((await propfind(member, '', '1')).entries.slice(1));
  return {
    tag: tagsOf.status === 207 && String(tagsOf.data).includes(tagName),
    comment: comments.status === 207 && String(comments.data).includes(`comment ${m}`),
    share: share.status === 200 && Array.isArray(shareData) && shareData.length > 0 ? { path: shareData[0].path, fileSource: shareData[0].file_source } : `status ${share.status}`,
    recipientSeesShareInRoot: recipientView.filter((n) => n.startsWith('meta-')),
  };
}
const renames = {};
{ // đối chứng: rename qua Nextcloud (WebDAV MOVE)
  const { id, shareId } = await decorate(`meta-nc-${m}.txt`);
  mustStatus('move', await owner.request('MOVE', davPath(owner, `NAS-TeamA/${dirA}/meta-nc-${m}.txt`), { headers: { Destination: `${new URL(davPath(owner, `NAS-TeamA/${dirA}/meta-nc-${m}-renamed.txt`), 'http://nc13.localtest.me:18130')}` } }), [201, 204]);
  const after = await fileId(owner, `NAS-TeamA/${dirA}/meta-nc-${m}-renamed.txt`);
  renames.viaNextcloudMove = { fileIdBefore: id, fileIdAfter: after, sameFileId: id === after, metadata: await metadata(after, shareId) };
}
{ // rename trực tiếp qua SMB (Team A có notify)
  const { id, shareId } = await decorate(`meta-smb-${m}.txt`);
  const before = await metadata(id, shareId);
  await smb('nas-member-a', 'team-a', `cd ${dirA}; rename meta-smb-${m}.txt meta-smb-${m}-renamed.txt`);
  const seen = await waitUntil('smb rename visible', visible(owner, `NAS-TeamA/${dirA}`, `meta-smb-${m}-renamed.txt`), { timeoutMs: 30_000, intervalMs: 100 });
  const gone = await waitUntil('old name gone', async () => !(await visible(owner, `NAS-TeamA/${dirA}`, `meta-smb-${m}.txt`)()), { timeoutMs: 30_000, intervalMs: 100 });
  const after = await fileId(owner, `NAS-TeamA/${dirA}/meta-smb-${m}-renamed.txt`);
  renames.viaSmbRenameWithNotify = { fileIdBefore: id, fileIdAfter: after, sameFileId: id === after, visibleAfterMs: seen.ms, oldNameGoneAfterMs: gone.ms, metadataBefore: before, metadataOnNewFileId: await metadata(after, shareId), metadataOnOldFileId: await metadata(id, shareId) };
}
{ // rename trực tiếp trên NAS rồi files:scan (cách làm khi không có notify)
  const { id, shareId } = await decorate(`meta-scan-${m}.txt`);
  await docker('stop', 'vcworkspace-sync15-files-notify-1');
  try {
    await nasExec('mv', `/srv/nas/team-a/${dirA}/meta-scan-${m}.txt`, `/srv/nas/team-a/${dirA}/meta-scan-${m}-renamed.txt`);
    await occ('files:scan', `--path=/${owner.uid}/files/NAS-TeamA/${dirA}`);
  } finally {
    await docker('start', 'vcworkspace-sync15-files-notify-1');
  }
  const after = await fileId(owner, `NAS-TeamA/${dirA}/meta-scan-${m}-renamed.txt`);
  renames.viaNasMvThenScan = { fileIdBefore: id, fileIdAfter: after, sameFileId: id === after, metadataOnNewFileId: await metadata(after, shareId), metadataOnOldFileId: await metadata(id, shareId) };
}

// ── 3. Unicode NFC/NFD và đổi tên chỉ khác hoa/thường ──
const nfc = `Hồ sơ ${m}`.normalize('NFC');
const nfd = `Hồ sơ ${m}`.normalize('NFD');
const hex = (s) => Buffer.from(s).toString('hex');
const nasNames = async (dir) => (await nasExec('ls', '-1', `/srv/nas/team-a/${dir}`)).stdout.split('\n').filter(Boolean);
const unicode = {};
await smbLocal('u1');
await smb('nas-member-a', 'team-a', `cd ${dirA}; put /work/u1 "${nfd}-nfd.txt"`);
await smb('nas-member-a', 'team-a', `cd ${dirA}; put /work/u1 "${nfc}-nfc.txt"`);
await waitUntil('unicode visible', async () => names(await listing(member, `NAS-TeamA/${dirA}`)).filter((n) => n.includes(m) && n.startsWith('H')).length >= 2, { timeoutMs: 15_000 });
const listed = names(await listing(member, `NAS-TeamA/${dirA}`)).filter((n) => n.includes(m) && n.startsWith('H'));
unicode.mountEncodingCompatibility = true;
unicode.nfdVisibleInListingWithCompat = listed.some((n) => n.endsWith('-nfd.txt'));
unicode.nasBytes = (await nasNames(dirA)).filter((n) => n.includes(m) && n.startsWith('H')).map((n) => ({ form: n === n.normalize('NFC') ? 'NFC' : 'NFD', hexPrefix: hex(n).slice(0, 24) }));
unicode.nextcloudListing = listed.map((n) => ({ name: n.endsWith('-nfd.txt') ? 'NFD file' : 'NFC file', form: n === n.normalize('NFC') ? 'NFC' : 'NFD' }));
unicode.getNfdFileByNfcPath = (await member.request('GET', davPath(member, `NAS-TeamA/${dirA}/${nfc}-nfd.txt`), { raw: true })).status;
unicode.getNfdFileByNfdPath = (await member.request('GET', davPath(member, `NAS-TeamA/${dirA}/${nfd}-nfd.txt`), { raw: true })).status;
unicode.getNfcFile = (await member.request('GET', davPath(member, `NAS-TeamA/${dirA}/${nfc}-nfc.txt`), { raw: true })).status;
// Tải lên qua WebDAV với tên NFD (như client macOS không chuẩn hoá) → NAS lưu dạng nào?
mustStatus('put nfd via dav', await member.request('PUT', davPath(member, `NAS-TeamA/${dirA}/${nfd}-dav.txt`), { body: 'dav nfd\n' }), [201]);
unicode.webdavPutNfdStoredOnNasAs = (await nasNames(dirA)).filter((n) => n.endsWith('-dav.txt')).map((n) => (n === n.normalize('NFC') ? 'NFC' : 'NFD'));
// encoding_compatibility đã bật trên mount (setup-nas-mounts.mjs); so sánh bật/tắt ở repro-case-unicode.json

const caseTests = {};
mustStatus('put case', await owner.request('PUT', davPath(owner, `NAS-TeamA/${dirA}/case-${m}.txt`), { body: 'case\n' }), [201]);
const caseId = await fileId(owner, `NAS-TeamA/${dirA}/case-${m}.txt`);
const caseMove = await owner.request('MOVE', davPath(owner, `NAS-TeamA/${dirA}/case-${m}.txt`), { headers: { Destination: `${new URL(davPath(owner, `NAS-TeamA/${dirA}/CASE-${m}.txt`), 'http://nc13.localtest.me:18130')}` } });
caseTests.webdavCaseOnlyMove = {
  caseSensitiveOption: false,
  status: caseMove.status,
  sameFileId: (await fileId(owner, `NAS-TeamA/${dirA}/CASE-${m}.txt`)) === caseId,
  oldNameReadable: (await owner.request('GET', davPath(owner, `NAS-TeamA/${dirA}/case-${m}.txt`), { raw: true })).status,
  newNameReadable: (await owner.request('GET', davPath(owner, `NAS-TeamA/${dirA}/CASE-${m}.txt`), { raw: true })).status,
  nasHas: (await nasNames(dirA)).filter((n) => n.toLowerCase() === `case-${m}.txt`),
};
mustStatus('put case2', await owner.request('PUT', davPath(owner, `NAS-TeamA/${dirA}/case2-${m}.txt`), { body: 'case2\n' }), [201]);
const case2Id = await fileId(owner, `NAS-TeamA/${dirA}/case2-${m}.txt`);
const smbCase = await smb('nas-member-a', 'team-a', `cd ${dirA}; rename case2-${m}.txt CASE2-${m}.txt`);
const case2Seen = await waitUntil('case2 visible', visible(owner, `NAS-TeamA/${dirA}`, `CASE2-${m}.txt`), { timeoutMs: 20_000, intervalMs: 100 });
const case2Listing = names(await listing(owner, `NAS-TeamA/${dirA}`)).filter((n) => n.toLowerCase() === `case2-${m}.txt`);
caseTests.smbCaseOnlyRename = { smb: smbCase.status, visibleAfterMs: case2Seen.ms, nextcloudListing: case2Listing, sameFileId: (await fileId(owner, `NAS-TeamA/${dirA}/CASE2-${m}.txt`)) === case2Id, nasHas: (await nasNames(dirA)).filter((n) => n.toLowerCase() === `case2-${m}.txt`) };
// Hai tên chỉ khác hoa/thường cùng tồn tại trên NAS (tạo trên filesystem NAS)
await docker('exec', '-u', 'nas-member-a', nasContainer, 'dd', 'if=/dev/zero', `of=/srv/nas/team-a/${dirA}/dup-${m}.txt`, 'bs=1', 'count=3', 'status=none');
await docker('exec', '-u', 'nas-member-a', nasContainer, 'dd', 'if=/dev/zero', `of=/srv/nas/team-a/${dirA}/DUP-${m}.txt`, 'bs=1', 'count=5', 'status=none');
await waitUntil('dup visible', async () => names(await listing(owner, `NAS-TeamA/${dirA}`)).filter((n) => n.toLowerCase() === `dup-${m}.txt`).length >= 2, { timeoutMs: 15_000 });
caseTests.caseCollisionOnNas = {
  nextcloudListing: names(await listing(owner, `NAS-TeamA/${dirA}`)).filter((n) => n.toLowerCase() === `dup-${m}.txt`),
  smbListing: (await smb('nas-member-a', 'team-a', `cd ${dirA}; ls dup-${m}*`)).out.split('\n').filter((l) => l.toLowerCase().includes(`dup-${m}`)).map((l) => l.trim().split(/\s+/)[0]),
  getLower: (await owner.request('GET', davPath(owner, `NAS-TeamA/${dirA}/dup-${m}.txt`), { raw: true })).bytes?.length,
  getUpper: (await owner.request('GET', davPath(owner, `NAS-TeamA/${dirA}/DUP-${m}.txt`), { raw: true })).bytes?.length,
};

const summary = Object.fromEntries(Object.entries(delays).map(([k, v]) => [k, v.every((x) => typeof x === 'number') ? stats(v) : v]));
const checks = {
  teamA_smb_visible_all: delays.teamA_smb_new.every((x) => typeof x === 'number'),
  case_move_no_data_loss: caseTests.webdavCaseOnlyMove.nasHas.length === 1 && (caseTests.webdavCaseOnlyMove.oldNameReadable === 200 || caseTests.webdavCaseOnlyMove.newNameReadable === 200),
  nfd_visible_with_encoding_compat: unicode.nfdVisibleInListingWithCompat === true,
  teamB_needs_scan: delays.teamB_smb_new_without_scan.every((x) => typeof x === 'string') && delays.teamB_after_scan_visible.every(Boolean),
  overwrite_fileId_stable: overwrite.fileIdStable.every(Boolean),
  nextcloud_move_keeps_all: renames.viaNextcloudMove.sameFileId && renames.viaNextcloudMove.metadata.tag && renames.viaNextcloudMove.metadata.comment,
};
await writeEvidence('acceptance-nas-changes.json', {
  marker: m,
  folders: { teamA: `NAS-TeamA/${dirA}`, teamB: `NAS-TeamB/${dirB}` },
  delaysMs: summary,
  delaysRawMs: delays,
  overwrite,
  renames,
  unicode,
  caseTests,
  checks,
  result: Object.values(checks).every(Boolean) ? 'LOCAL PASS (đo đạc + phát hiện, xem renames/unicode/caseTests)' : 'FAIL',
});
console.log(JSON.stringify({ summary, overwrite, renames, unicode, caseTests, checks }, null, 1));
