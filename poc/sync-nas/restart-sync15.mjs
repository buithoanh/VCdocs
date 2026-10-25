// Chat15: restart the NAS, the notify listener and the work13 Nextcloud container
// (docker restart: same containers, no recreate), record StartedAt before/after,
// wait until Nextcloud and the mounts answer again, then check notify still
// delivers a direct NAS change. ACL is re-checked separately with
// SYNC15_ACL_LABEL=acceptance-nas-acl-after-restart node acceptance-nas-acl.mjs.
import { client, davPath, docker, nasContainer, notifyContainer, occ, propfind, smb, smbClientContainer, waitUntil, writeEvidence } from './lib.mjs';

const containers = [nasContainer, smbClientContainer, notifyContainer, 'vcworkspace-work13-nextcloud-1'];
const startedAt = async () => Object.fromEntries(await Promise.all(containers.map(async (name) => [name, (await docker('inspect', '--format', '{{.State.StartedAt}} {{.State.Status}}', name)).stdout.trim()])));
const before = await startedAt();
const t0 = Date.now();
await docker('restart', ...containers);
const after = await startedAt();
const notRestarted = containers.filter((name) => before[name] === after[name] || !after[name].endsWith('running'));
if (notRestarted.length) throw new Error(`NOT_RESTARTED:${notRestarted.join(',')}`);
const member = await client('member-a');
const ready = await waitUntil('nextcloud ready', async () => (await propfind(member, 'NAS-TeamA', '0').catch(() => ({ status: 0 }))).status === 207, { timeoutMs: 120_000, intervalMs: 1000 });
const verify = {};
for (const id of ['1', '2']) verify[id] = (await occ('files_external:verify', id)).stdout.trim().split('\n')[0].trim();
// notify còn chạy sau restart: ghi qua SMB rồi xem Nextcloud thấy
const name = `restart15-${Date.now()}.bin`;
await waitUntil('notify self-test', async () => (await docker('logs', '--since', '2m', notifyContainer)).stdout.includes('Self-test successful') || (await docker('logs', '--since', '2m', notifyContainer)).stderr.includes('Self-test successful'), { timeoutMs: 60_000, intervalMs: 1000 });
await docker('exec', smbClientContainer, 'dd', 'if=/dev/urandom', 'of=/work/restart', 'bs=1024', 'count=1', 'status=none');
await smb('nas-member-a', 'team-a', `put /work/restart ${name}`);
const seen = await waitUntil('visible after restart', async () => (await propfind(member, 'NAS-TeamA', '1')).entries.some((e) => e.path.endsWith(`/${name}`)), { timeoutMs: 30_000, intervalMs: 200 });
const pass = ready.value && Object.values(verify).every((v) => v.includes('ok')) && seen.value;
await writeEvidence('restart.json', { containers, before, after, readyAfterMs: ready.ms, totalMs: Date.now() - t0, mountsVerify: verify, nasChangeVisibleAfterRestartMs: seen.ms, davPathChecked: davPath(member, 'NAS-TeamA').replace(member.uid, '<member-a uid>'), result: pass ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify({ readyAfterMs: ready.ms, verify, seenMs: seen.ms, pass }));
if (!pass) throw new Error('RESTART_FAILED');
