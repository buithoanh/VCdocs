// Chat16: record the runtime versions/digests used by this PoC (read-only).
import { docker, occ, occJson, writeEvidence } from './lib.mjs';

const inspect = async (name) => {
  const { stdout } = await docker('inspect', name, '--format', '{{.Config.Image}}|{{.Image}}|{{.State.Status}}');
  const [image, id, state] = stdout.trim().split('|');
  return { image, imageId: id.slice(0, 19), state };
};
const apps = await occJson('app:list');
const status = JSON.parse((await occ('status', '--output=json')).stdout);
const containers = {};
for (const name of ['vcworkspace-work13-nextcloud-1', 'vcworkspace-work13-nc-db-1', 'vcworkspace-work13-redis-1', 'vcworkspace-cal16-mail16-1', 'vcworkspace-cal16-mail16-relay-1', 'vcworkspace-flow14-webhook-worker-1', 'vcworkspace-work13-hook-sink-1']) containers[name] = await inspect(name);
await writeEvidence('environment.json', {
  nextcloud: { version: status.versionstring, edition: status.edition || 'community' },
  apps: Object.fromEntries(['calendar', 'contacts', 'calendar_resource_management', 'dav', 'contactsinteraction', 'user_oidc', 'webhook_listeners'].map((a) => [a, apps.enabled[a] ?? apps.disabled[a] ?? 'MISSING'])),
  stalwart: '0.16.27 (stalwartlabs/stalwart@sha256:c429b311…836c, như chat07)',
  containers,
});
console.log(JSON.stringify({ nextcloud: status.versionstring, containers: Object.keys(containers).length }));
