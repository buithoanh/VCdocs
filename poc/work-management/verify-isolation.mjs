// Isolation check: application containers only on the internal network,
// outbound probe fails, relays publish on 127.0.0.1 only.
import { execFileAsync, writeEvidence } from './lib.mjs';

async function inspect(container, format) {
  return (await execFileAsync('docker', ['inspect', container, '--format', format])).stdout.trim();
}
const appContainers = ['vcworkspace-work13-nextcloud-1', 'vcworkspace-work13-authentik-server-1', 'vcworkspace-work13-authentik-worker-1', 'vcworkspace-work13-hook-sink-1'];
const appNetworks = {};
for (const container of appContainers) {
  appNetworks[container] = Object.keys(JSON.parse(await inspect(container, '{{json .NetworkSettings.Networks}}')));
  if (appNetworks[container].some((name) => name.endsWith('_host_edge'))) throw new Error(`EGRESS_NETWORK_ATTACHED:${container}`);
}
if (await inspect('vcworkspace-work13_work13', '{{.Internal}}') !== 'true') throw new Error('APP_NETWORK_NOT_INTERNAL');
const bindings = {};
for (const relay of ['vcworkspace-work13-nextcloud-loopback-relay-1', 'vcworkspace-work13-authentik-loopback-relay-1']) {
  const ports = JSON.parse(await inspect(relay, '{{json .NetworkSettings.Ports}}'));
  bindings[relay] = Object.values(ports).flat().filter(Boolean).map((item) => `${item.HostIp}:${item.HostPort}`);
  if (bindings[relay].some((item) => !item.startsWith('127.0.0.1:'))) throw new Error(`NON_LOOPBACK_BINDING:${relay}`);
  // The redis image declares VOLUME /data (empty anonymous volume); anything
  // else, especially a bind mount or /run/secrets, would carry data or secrets.
  const mounts = JSON.parse(await inspect(relay, '{{json .Mounts}}'));
  if (mounts.some((mount) => mount.Type !== 'volume' || mount.Destination !== '/data')) throw new Error(`RELAY_HAS_MOUNTS:${relay}`);
}
let egressExitCode = 0;
try {
  await execFileAsync('docker', ['exec', 'vcworkspace-work13-nextcloud-1', 'curl', '--max-time', '5', '--silent', '--show-error', 'https://apps.nextcloud.com/']);
} catch (error) {
  egressExitCode = error.code;
}
if (egressExitCode === 0) throw new Error('APPLICATION_EGRESS_NOT_BLOCKED');
await writeEvidence('isolation.json', { appNetworks, internalNetwork: true, relayBindings: bindings, relaysWithoutSecretOrBindMounts: true, egressProbe: { target: 'https://apps.nextcloud.com/', exitCode: egressExitCode }, result: 'LOCAL PASS' });
console.log(`Isolation PASS: internal-only app containers, egress exit ${egressExitCode}, bindings ${JSON.stringify(bindings)}`);
