// Chat16 isolation readback: the chat16 Stalwart only sits on the internal work13
// network, host exposure is loopback-only, the internal network has no route to
// the Internet, Nextcloud is not attached to the egress network after app install,
// and the Stalwart outbound queue is empty (nothing tried to leave the machine).
import { docker, writeEvidence, assert } from './lib.mjs';
import { adminJmap } from './mail-lib.mjs';

const networksOf = async (name) => Object.keys(JSON.parse((await docker('inspect', name, '--format', '{{json .NetworkSettings.Networks}}')).stdout));
const internal = (await docker('network', 'inspect', 'vcworkspace-work13_work13', '--format', '{{.Internal}}')).stdout.trim();
const ports = (await docker('port', 'vcworkspace-cal16-mail16-relay-1')).stdout.trim().split('\n');
const alpine = 'alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412';
const egress = await docker('run', '--rm', '--network', 'vcworkspace-work13_work13', alpine, 'nc', '-z', '-w', '3', '1.1.1.1', '443').then(() => 'CONNECTED').catch((e) => `blocked (exit ${e.code})`);
const smtpOut = await docker('run', '--rm', '--network', 'vcworkspace-work13_work13', alpine, 'nc', '-z', '-w', '3', 'gmail-smtp-in.l.google.com', '25').then(() => 'CONNECTED').catch((e) => `blocked (exit ${e.code})`);
const { call } = await adminJmap();
const queue = (await call([['x:QueuedMessage/query', {}, 'q']]))[0][1].ids;
const result = {
  mail16Networks: await networksOf('vcworkspace-cal16-mail16-1'),
  nextcloudNetworks: await networksOf('vcworkspace-work13-nextcloud-1'),
  work13NetworkInternal: internal,
  relayHostPorts: ports,
  egressProbe1111: egress,
  egressProbeMx25: smtpOut,
  stalwartOutboundQueue: queue.length,
};
await writeEvidence('isolation.json', result);
console.log(JSON.stringify(result, null, 1));
assert(internal === 'true' && JSON.stringify(result.mail16Networks) === JSON.stringify(['vcworkspace-work13_work13']), 'mail16 internal only', result);
assert(!result.nextcloudNetworks.some((n) => n.includes('host_edge')) && ports.every((p) => p.includes('127.0.0.1:')), 'no egress attachment, loopback only', result);
assert(egress.startsWith('blocked') && smtpOut.startsWith('blocked') && queue.length === 0, 'no route out, empty queue', result);
