// Chat15: enable files_external and import two SMB system mounts from the
// simulated NAS, each applicable to exactly one team group (immutable federated
// group id), each with its own NAS service account (password from secrets/,
// passed on stdin to `occ files_external:import -`, never on argv or in evidence).
//   /NAS-TeamA → //nas15/team-a, check changes on access, notify (files-notify)
//   /NAS-TeamB → //nas15/team-b, never check changes (scan only), no notify
// Idempotent: existing mount points are kept.
// Hardening from the chat15 findings (repro-case-unicode.json), enforced on every run:
//   case_sensitive=false  — NAS SMB shares are case-insensitive; with the default
//     (true) a case-only rename through Nextcloud deletes the file (SMB::rename
//     catches AlreadyExists and removes the "target", which is the source itself).
//   encoding_compatibility=true — files created on the NAS with NFD names (macOS)
//     are otherwise invisible in Nextcloud.
import { spawn } from 'node:child_process';
import { mounts, nasSecret, occ, teamGroups, writeEvidence } from './lib.mjs';

await occ('app:enable', 'files_external');
const wanted = [
  { mount_point: '/NAS-TeamA', share: 'team-a', account: 'svc-nc-team-a', group: teamGroups.a, checkChanges: 1 },
  { mount_point: '/NAS-TeamB', share: 'team-b', account: 'svc-nc-team-b', group: teamGroups.b, checkChanges: 0 },
];
const existing = await mounts();
for (const mount of wanted) {
  if (existing.some((item) => item.mount_point === mount.mount_point)) continue;
  const json = JSON.stringify([{
    mount_point: mount.mount_point,
    storage: '\\OCA\\Files_External\\Lib\\Storage\\SMB',
    authentication_type: 'password::password',
    configuration: { host: 'nas15', share: mount.share, root: '', domain: 'VCW15', show_hidden: false, case_sensitive: true, check_acl: false, user: mount.account, password: await nasSecret(mount.account) },
    options: { enable_sharing: true, filesystem_check_changes: mount.checkChanges, encrypt: false, previews: true, readonly: false, encoding_compatibility: false },
    applicable_users: [],
    applicable_groups: [mount.group],
  }]);
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '-u', 'www-data', 'vcworkspace-work13-nextcloud-1', 'php', 'occ', '--no-ansi', '--no-interaction', 'files_external:import', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`IMPORT_FAILED:${mount.mount_point}:${code}:${out.slice(0, 300)}`))));
    child.stdin.end(json);
  });
}
for (const item of (await mounts()).filter((m) => wanted.some((w) => w.mount_point === m.mount_point))) {
  await occ('files_external:config', String(item.mount_id), 'case_sensitive', 'false');
  await occ('files_external:option', String(item.mount_id), 'encoding_compatibility', 'true');
}
const list = await mounts();
const result = [];
for (const mount of wanted) {
  const item = list.find((m) => m.mount_point === mount.mount_point);
  const { stdout } = await occ('files_external:verify', String(item.mount_id));
  result.push({
    mountId: item.mount_id,
    mountPoint: item.mount_point,
    backend: item.storage,
    authentication: item.authentication_type,
    host: item.configuration.host,
    share: item.configuration.share,
    nasAccount: item.configuration.user,
    passwordInEvidence: false,
    applicableGroups: item.applicable_groups,
    applicableUsers: item.applicable_users,
    caseSensitive: item.configuration.case_sensitive,
    options: item.options,
    verify: stdout.trim().split('\n').map((line) => line.trim()),
  });
}
if (JSON.stringify(list).includes(await nasSecret('svc-nc-team-a'))) throw new Error('PASSWORD_LEAKED_IN_LIST_OUTPUT');
await writeEvidence('nas-mounts.json', { mounts: result });
console.log(JSON.stringify(result, null, 1));
