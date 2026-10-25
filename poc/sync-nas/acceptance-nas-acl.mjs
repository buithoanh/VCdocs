// Chat15 NAS ACL: the two SMB mounts are visible/writable only to their team
// via WebDAV (app passwords, immutable uids), and the NAS itself denies other
// teams, outsiders, anonymous and the other team's service account over SMB.
// Run again after restart/restore (SYNC15_ACL_LABEL names the evidence file).
import { client, davPath, propfind, resetBruteforce, smb, writeEvidence } from './lib.mjs';

const label = process.env.SYNC15_ACL_LABEL || 'acceptance-nas-acl';
await resetBruteforce();
const marker = `acl15-${Date.now()}`;
const names = ['manager-a', 'member-a', 'successor-a', 'manager-b', 'member-b', 'outsider'];
// manager-a đã offboard ở chat13 (disabled, vẫn còn trong nhóm Team A): mọi request 401
const leaver = 'manager-a';
const team = { 'manager-a': 'a', 'member-a': 'a', 'successor-a': 'a', 'manager-b': 'b', 'member-b': 'b', outsider: null };
const actors = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await client(n)])));

const webdav = {};
for (const name of names) {
  const actor = actors[name];
  const root = await propfind(actor, '', '1');
  const top = root.entries.map((e) => e.path.split('/').filter(Boolean).at(-1));
  const row = { rootStatus: root.status, seesTeamA: top.includes('NAS-TeamA'), seesTeamB: top.includes('NAS-TeamB') };
  for (const [key, mount] of [['a', 'NAS-TeamA'], ['b', 'NAS-TeamB']]) {
    row[`propfind_${key}`] = (await propfind(actor, mount, '0')).status;
    row[`put_${key}`] = (await actor.request('PUT', davPath(actor, `${mount}/${marker}-${name}.txt`), { body: `${name} ${marker}\n` })).status;
  }
  webdav[name] = row;
}
// Đường dẫn của người khác: luôn bị chặn bất kể đội
await resetBruteforce();
const crossUser = {
  'manager-b→member-a/NAS-TeamA': (await actors['manager-b'].request('PROPFIND', davPath(actors['member-a'], 'NAS-TeamA'), { headers: { Depth: '0' } })).status,
  'outsider→member-a/NAS-TeamA': (await actors.outsider.request('PROPFIND', davPath(actors['member-a'], 'NAS-TeamA'), { headers: { Depth: '0' } })).status,
  'member-a→manager-b/NAS-TeamB': (await actors['member-a'].request('PROPFIND', davPath(actors['manager-b'], 'NAS-TeamB'), { headers: { Depth: '0' } })).status,
  'outsider PUT member-a/NAS-TeamA': (await actors.outsider.request('PUT', davPath(actors['member-a'], `NAS-TeamA/${marker}-x.txt`), { body: 'x' })).status,
};

const direct = {};
for (const [account, share] of [
  ['nas-member-a', 'team-a'], ['nas-member-a', 'team-b'],
  ['nas-manager-b', 'team-b'], ['nas-manager-b', 'team-a'],
  ['nas-outsider', 'team-a'], ['nas-outsider', 'team-b'],
  [null, 'team-a'], [null, 'team-b'],
  ['svc-nc-team-a', 'team-b'], ['svc-nc-team-b', 'team-a'],
]) {
  const r = await smb(account, share, 'ls');
  direct[`${account ?? 'anonymous'}@${share}`] = r.ok ? 'ALLOWED' : r.status;
}
// Thoát khỏi share bằng ../ không được
const traversal = await smb('nas-member-a', 'team-a', 'ls ../team-b/*');
direct['nas-member-a@team-a ls ../team-b'] = /team-b|\.txt/.test(traversal.out) && traversal.ok ? 'LEAK' : traversal.status;

const expectA = (name) => team[name] === 'a';
const expectB = (name) => team[name] === 'b';
const webdavPass = names.every((name) => {
  const r = webdav[name];
  if (name === leaver) return [r.rootStatus, r.propfind_a, r.put_a, r.propfind_b, r.put_b].every((s) => s === 401);
  return r.rootStatus === 207 && r.seesTeamA === expectA(name) && r.seesTeamB === expectB(name)
    && (expectA(name) ? r.propfind_a === 207 && r.put_a === 201 : r.propfind_a === 404 && r.put_a >= 400)
    && (expectB(name) ? r.propfind_b === 207 && r.put_b === 201 : r.propfind_b === 404 && r.put_b >= 400);
});
const crossPass = Object.values(crossUser).every((status) => status >= 400 && status !== 500);
const directPass = direct['nas-member-a@team-a'] === 'ALLOWED' && direct['nas-manager-b@team-b'] === 'ALLOWED'
  && Object.entries(direct).filter(([k]) => !['nas-member-a@team-a', 'nas-manager-b@team-b'].includes(k)).every(([, v]) => v !== 'ALLOWED' && v !== 'LEAK');
const pass = webdavPass && crossPass && directPass;
await writeEvidence(`${label}.json`, { marker, leaver: { name: leaver, state: 'offboarded in chat13: Nextcloud disabled, tokens revoked, still member of Team A group' }, webdav, crossUser, directSmb: direct, checks: { webdavPass, crossPass, directPass }, result: pass ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify({ webdav, crossUser, direct, pass }, null, 1));
if (!pass) throw new Error('NAS_ACL_FAILED');
