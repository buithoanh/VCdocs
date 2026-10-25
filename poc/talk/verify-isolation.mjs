// Chat17: isolation evidence (read-only). work13 network internal, Nextcloud
// not attached to host_edge after the Talk install, host ports loopback only,
// no route out from the internal network, Talk hands clients no STUN/TURN and
// no external signaling server, has_internet_connection=false.
import { assert, client, docker, occ, ocsData, readEvidence, talk, writeEvidence } from './lib.mjs';

const networksOf = async (name) => Object.keys(JSON.parse((await docker('inspect', name, '--format', '{{json .NetworkSettings.Networks}}')).stdout));
const internal = (await docker('network', 'inspect', 'vcworkspace-work13_work13', '--format', '{{.Internal}}')).stdout.trim();
const ports = (await docker('port', 'vcworkspace-work13-nextcloud-loopback-relay-1')).stdout.trim().split('\n');
const alpine = 'alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412';
const probe = (host, port) => docker('run', '--rm', '--network', 'vcworkspace-work13_work13', alpine, 'nc', '-z', '-w', '3', host, String(port)).then(() => 'CONNECTED').catch((e) => `blocked (exit ${e.code})`);
const conv = await readEvidence('conversations.json');
const member = await client('member-a');
const settings = ocsData(await member.request('GET', talk.signaling(`/settings?token=${conv.teamA.token}`)));
const result = {
  nextcloudNetworks: await networksOf('vcworkspace-work13-nextcloud-1'),
  work13NetworkInternal: internal,
  relayHostPorts: ports,
  egressProbe1111: await probe('1.1.1.1', 443),
  egressProbeStunNextcloud: await probe('stun.nextcloud.com', 443),
  hasInternetConnection: (await occ('config:system:get', 'has_internet_connection')).stdout.trim(),
  signalingSettingsForClients: { stunservers: settings?.stunservers, turnservers: settings?.turnservers?.length ?? 0, server: settings?.server ?? '', signalingMode: settings?.signalingMode },
  restoreStackRunning: (await docker('ps', '--format', '{{.Names}}')).stdout.split('\n').filter((n) => n.includes('talk17')).length,
};
await writeEvidence('isolation.json', result);
console.log(JSON.stringify(result, null, 1));
assert(internal === 'true' && !result.nextcloudNetworks.some((n) => n.includes('host_edge')) && ports.every((p) => p.includes('127.0.0.1:')), 'internal + loopback', result);
assert(result.egressProbe1111.startsWith('blocked') && result.egressProbeStunNextcloud.startsWith('blocked'), 'no route out', result);
assert((settings?.stunservers ?? []).length === 0 && result.signalingSettingsForClients.turnservers === 0 && result.signalingSettingsForClients.server === '', 'no STUN/TURN/HPB handed to clients', result);
