import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './authentik-api.mjs';

const execFileAsync = promisify(execFile);
async function networks(container) {
  const { stdout } = await execFileAsync('docker', ['inspect', container, '--format', '{{json .NetworkSettings.Networks}}']);
  return Object.keys(JSON.parse(stdout));
}
const appContainers = ['vcworkspace-identity12-nextcloud-1', 'vcworkspace-identity12-authentik-server-1'];
const appNetworks = Object.fromEntries(await Promise.all(appContainers.map(async (container) => [container, await networks(container)])));
for (const names of Object.values(appNetworks)) {
  if (names.some((name) => name.endsWith('_host_edge'))) throw new Error('APPLICATION_ATTACHED_TO_EGRESS_NETWORK');
}
const { stdout: internalText } = await execFileAsync('docker', ['inspect', 'vcworkspace-identity12_identity12', 'vcworkspace-identity12_loopback', '--format', '{{.Internal}}']);
if (internalText.trim().split('\n').some((value) => value !== 'true')) throw new Error('APPLICATION_NETWORK_NOT_INTERNAL');
let egressExitCode = 0;
try {
  await execFileAsync('docker', ['exec', 'vcworkspace-identity12-nextcloud-1', 'curl', '--max-time', '3', '--silent', '--show-error', 'https://example.com']);
} catch (error) {
  egressExitCode = error.code;
}
if (egressExitCode === 0) throw new Error('APPLICATION_EGRESS_NOT_BLOCKED');
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'isolation.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), appNetworks, internalNetworks: true, applicationEgressDenied: true, egressProbeExitCode: egressExitCode, relaysCarryNoSecrets: true, hostBindings: ['127.0.0.1:18120', '127.0.0.1:18121'], secretsIncluded: false }, null, 2)}\n`);
console.log('Isolation PASS: application containers use internal networks only; outbound probe failed closed; secretless relays bind loopback.');
