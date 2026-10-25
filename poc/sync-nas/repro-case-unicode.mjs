// Chat15: focused repro for two NAS findings, each on a throwaway dummy file.
//  1. Case-only rename through Nextcloud (WebDAV MOVE a.txt → A.txt) on the SMB
//     mount: home storage (control) vs SMB mount with case_sensitive=true
//     (default) vs case_sensitive=false. Records status, fileid, whether the
//     bytes still exist on the NAS.
//  2. NFD-named file created on the NAS: listed / readable in Nextcloud with
//     encoding_compatibility off vs on (after files:scan).
// Mount options are restored to the values found at start.
import { client, davPath, docker, fileId, mounts, nasExec, occ, propfind, resetBruteforce, smb, smbClientContainer, waitUntil, writeEvidence } from './lib.mjs';

await resetBruteforce();
const m = `rep15-${Date.now()}`;
const owner = await client('successor-a');
const member = await client('member-a');
const teamA = (await mounts()).find((x) => x.mount_point === '/NAS-TeamA');
const original = { case_sensitive: teamA.configuration.case_sensitive ?? true, encoding_compatibility: teamA.options.encoding_compatibility ?? false };
const dir = `Chat15-${m}`;
await owner.request('MKCOL', davPath(owner, dir));
await owner.request('MKCOL', davPath(owner, `NAS-TeamA/${dir}`));
const nasLs = async () => (await nasExec('ls', '-1', `/srv/nas/team-a/${dir}`)).stdout.split('\n').filter(Boolean);
const dest = (path) => `${new URL(davPath(owner, path), 'http://nc13.localtest.me:18130')}`;

async function caseMove(base, label) {
  const from = `${base}/${label}-${m}.txt`;
  const to = `${base}/${label.toUpperCase()}-${m}.txt`;
  const put = await owner.request('PUT', davPath(owner, from), { body: `payload ${label}\n` });
  const id = await fileId(owner, from);
  const move = await owner.request('MOVE', davPath(owner, from), { headers: { Destination: dest(to) } });
  const getNew = await owner.request('GET', davPath(owner, to), { raw: true });
  const getOld = await owner.request('GET', davPath(owner, from), { raw: true });
  return {
    put: put.status,
    move: move.status,
    sameFileId: (await fileId(owner, to)) === id,
    getNewName: getNew.status,
    getOldName: getOld.status,
    contentKept: getNew.status === 200 && getNew.bytes.toString() === `payload ${label}\n`,
    onNas: base.startsWith('NAS-TeamA') ? (await nasLs()).filter((n) => n.toLowerCase() === `${label}-${m}.txt`) : 'n/a (home storage)',
  };
}

const result = { original };
try {
  result.caseOnlyMove = {};
  result.caseOnlyMove.homeStorage = await caseMove(dir, 'home');
  await occ('files_external:config', String(teamA.mount_id), 'case_sensitive', 'true');
  result.caseOnlyMove.smbCaseSensitiveTrue = await caseMove(`NAS-TeamA/${dir}`, 'cstrue');
  await occ('files_external:config', String(teamA.mount_id), 'case_sensitive', 'false');
  result.caseOnlyMove.smbCaseSensitiveFalse = await caseMove(`NAS-TeamA/${dir}`, 'csfalse');

  const nfd = `Tài liệu ${m}`.normalize('NFD');
  const nfc = nfd.normalize('NFC');
  await docker('exec', smbClientContainer, 'dd', 'if=/dev/urandom', 'of=/work/nfd', 'bs=1024', 'count=1', 'status=none');
  await smb('nas-member-a', 'team-a', `cd ${dir}; put /work/nfd "${nfd}.txt"`);
  const listed = async () => (await propfind(member, `NAS-TeamA/${dir}`, '1')).entries.slice(1).map((e) => e.path.split('/').filter(Boolean).at(-1)).filter((n) => n.startsWith('T'));
  result.nfd = {};
  await occ('files_external:option', String(teamA.mount_id), 'encoding_compatibility', 'false');
  await occ('files:scan', `--path=/${member.uid}/files/NAS-TeamA/${dir}`);
  result.nfd.compatOff = { listed: await listed(), getByNfc: (await member.request('GET', davPath(member, `NAS-TeamA/${dir}/${nfc}.txt`), { raw: true })).status };
  await occ('files_external:option', String(teamA.mount_id), 'encoding_compatibility', 'true');
  await occ('files:scan', `--path=/${member.uid}/files/NAS-TeamA/${dir}`);
  const shown = await waitUntil('nfd listed', async () => (await listed()).length > 0, { timeoutMs: 5000 });
  result.nfd.compatOn = { listed: await listed(), listedForm: (await listed()).map((n) => (n === n.normalize('NFC') ? 'NFC' : 'NFD')), getByNfc: (await member.request('GET', davPath(member, `NAS-TeamA/${dir}/${nfc}.txt`), { raw: true })).status, visibleMs: shown.ms };
  result.nfd.nasStillNfd = (await nasLs()).filter((n) => n.startsWith('T')).map((n) => (n === n.normalize('NFC') ? 'NFC' : 'NFD'));
} finally {
  await occ('files_external:config', String(teamA.mount_id), 'case_sensitive', String(original.case_sensitive));
  await occ('files_external:option', String(teamA.mount_id), 'encoding_compatibility', String(original.encoding_compatibility));
}
const c = result.caseOnlyMove;
result.findings = {
  caseOnlyMoveHomeOk: c.homeStorage.contentKept && c.homeStorage.sameFileId,
  caseOnlyMoveSmbDefaultLosesFile: !c.smbCaseSensitiveTrue.contentKept && c.smbCaseSensitiveTrue.onNas.length === 0,
  caseOnlyMoveSmbCaseInsensitiveOk: c.smbCaseSensitiveFalse.contentKept,
  nfdHiddenWithoutCompat: result.nfd.compatOff.listed.length === 0,
  nfdVisibleWithCompat: result.nfd.compatOn.listed.length === 1 && result.nfd.compatOn.getByNfc === 200,
};
await writeEvidence('repro-case-unicode.json', { marker: m, ...result, result: 'LOCAL (repro)' });
console.log(JSON.stringify(result, null, 1));
