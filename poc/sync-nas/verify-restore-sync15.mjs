// Chat15: read back the restore stack (127.0.0.1:18153): SMB mounts verify,
// Team A/B/outsider ACL via WebDAV (same immutable uids + app passwords from the
// restored DB), direct-SMB deny matrix on the restored NAS, fileid/tag/comment/
// share of a decorated file, Flow core deny of a -mat file, content hash equal
// to the live stack.
import { createHash } from 'node:crypto';
import { secret } from '../flow/lib.mjs';
import { client as liveClient, docker, personas, readEvidence, writeEvidence } from './lib.mjs';

const base = 'http://nc13.localtest.me:18153';
const nc = 'vcworkspace-sync15-restore-restore-nextcloud-1';
const smbc = 'vcworkspace-sync15-restore-restore-smb-client-1';
const occ = (...args) => docker('exec', '-u', 'www-data', nc, 'php', 'occ', '--no-ansi', '--no-interaction', ...args);
const relayIp = (await docker('inspect', 'vcworkspace-sync15-restore-restore-relay-1', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}')).stdout.trim().split(' ');
for (const ip of relayIp) await occ('security:bruteforce:reset', ip);
const people = await personas();
const mk = async (name) => {
  const uid = people[name].nextcloudUserId;
  const auth = `Basic ${Buffer.from(`${uid}:${await secret(`app_password_${name}`)}`).toString('base64')}`;
  return {
    uid,
    request: async (method, path, { body, headers = {} } = {}) => {
      const r = await fetch(`${base}${path}`, { method, headers: { Authorization: auth, 'OCS-APIRequest': 'true', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) };
    },
  };
};
const dav = (actor, path) => `/remote.php/dav/files/${actor.uid}/${path.split('/').map(encodeURIComponent).join('/')}`;
const pf = async (actor, path, depth = '0') => {
  const r = await actor.request('PROPFIND', dav(actor, path), { headers: { Depth: depth, 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>' });
  return { status: r.status, fileId: Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(r.bytes.toString())?.[1]) || null };
};
const names = ['manager-a', 'member-a', 'successor-a', 'manager-b', 'member-b', 'outsider'];
const actors = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await mk(n)])));

const verify = {};
for (const id of ['1', '2']) verify[id] = (await occ('files_external:verify', id)).stdout.trim().split('\n')[0].trim();
const acl = {};
for (const n of names) acl[n] = { teamA: (await pf(actors[n], 'NAS-TeamA')).status, teamB: (await pf(actors[n], 'NAS-TeamB')).status };
const smbStatus = async (account, share) => {
  try {
    const { stdout, stderr } = await docker('exec', smbc, 'smbclient', `//nas15/${share}`, ...(account ? ['-A', `/auth/${account}`] : ['-N']), '-m', 'SMB3', '-c', 'ls');
    return /NT_STATUS_/.exec(stdout + stderr)?.[0] ?? 'ALLOWED';
  } catch (e) { return /NT_STATUS_[A-Z_]+/.exec(`${e.stdout}${e.stderr}`)?.[0] ?? 'ERROR'; }
};
const direct = {};
for (const [a, s] of [['nas-member-a', 'team-a'], ['nas-member-a', 'team-b'], ['nas-manager-b', 'team-b'], ['nas-manager-b', 'team-a'], ['nas-outsider', 'team-a'], [null, 'team-a']]) direct[`${a ?? 'anonymous'}@${s}`] = await smbStatus(a, s);

// File đã gắn tag/comment/share và đổi tên qua Nextcloud ở acceptance-nas-changes
const changes = await readEvidence('acceptance-nas-changes.json');
const decorated = `${changes.folders.teamA}/meta-nc-${changes.marker}-renamed.txt`;
const owner = actors['successor-a'];
const ownerPf = await pf(owner, decorated);
const tags = (await owner.request('PROPFIND', `/remote.php/dav/systemtags-relations/files/${ownerPf.fileId}`, { headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:display-name/></d:prop></d:propfind>' })).bytes.toString();
const comments = (await owner.request('REPORT', `/remote.php/dav/comments/files/${ownerPf.fileId}`, { body: '<?xml version="1.0"?><oc:filter-comments xmlns:oc="http://owncloud.org/ns"><oc:limit>20</oc:limit><oc:offset>0</oc:offset></oc:filter-comments>', headers: { 'Content-Type': 'application/xml' } })).bytes.toString();
const shares = (await owner.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=${encodeURIComponent(`/${decorated}`)}`)).bytes.toString();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const restoredBytes = (await owner.request('GET', dav(owner, decorated))).bytes;
const live = await liveClient('successor-a');
const liveBytes = (await live.request('GET', `/remote.php/dav/files/${live.uid}/${decorated.split('/').map(encodeURIComponent).join('/')}`, { raw: true })).bytes;
const decoratedResult = {
  fileIdLive: changes.renames.viaNextcloudMove.fileIdAfter,
  fileIdRestored: ownerPf.fileId,
  sameFileId: ownerPf.fileId === changes.renames.viaNextcloudMove.fileIdAfter,
  tag: tags.includes('sync15-meta'),
  comment: comments.includes(`comment ${changes.marker}`),
  share: shares.includes(people['member-a'].nextcloudUserId),
  sha256Equal: sha(restoredBytes) === sha(liveBytes),
};
// Flow core: file -mat do member-a tải qua WebDAV (acceptance-nas-flow) vẫn bị chặn với member-a
const flow = await readEvidence('acceptance-nas-flow.json');
const matPath = `${flow.folder}/${flow.marker}-webdav-mat.txt`;
const flowCore = { memberReadsMat: (await actors['member-a'].request('GET', dav(actors['member-a'], matPath))).status, ownerReadsMat: (await owner.request('GET', dav(owner, matPath))).status };

const pass = Object.values(verify).every((v) => v.includes('ok'))
  && names.every((n) => n === 'manager-a' ? acl[n].teamA === 401 && acl[n].teamB === 401 : (['member-a', 'successor-a'].includes(n) ? acl[n].teamA === 207 && acl[n].teamB === 404 : ['manager-b', 'member-b'].includes(n) ? acl[n].teamB === 207 && acl[n].teamA === 404 : acl[n].teamA === 404 && acl[n].teamB === 404))
  && direct['nas-member-a@team-a'] === 'ALLOWED' && direct['nas-manager-b@team-b'] === 'ALLOWED' && Object.entries(direct).filter(([k]) => !['nas-member-a@team-a', 'nas-manager-b@team-b'].includes(k)).every(([, v]) => v !== 'ALLOWED')
  && Object.values(decoratedResult).every((v) => v !== false)
  && flowCore.memberReadsMat === 404 && flowCore.ownerReadsMat === 200;
await writeEvidence('verify-restore.json', { base: '127.0.0.1:18153 (restore stack)', mountsVerify: verify, webdavAcl: acl, directSmb: direct, decorated: decoratedResult, flowCore, result: pass ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify({ verify, acl, direct, decoratedResult, flowCore, pass }, null, 1));
if (!pass) throw new Error('RESTORE_VERIFY_FAILED');
