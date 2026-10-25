// Chat17: record the runtime versions/digests used by this PoC (read-only).
import { docker, occ, occJson, writeEvidence } from './lib.mjs';

const inspect = async (name) => {
  const { stdout } = await docker('inspect', name, '--format', '{{.Config.Image}}|{{.Image}}|{{.State.Status}}');
  const [image, id, state] = stdout.trim().split('|');
  return { image, imageId: id.slice(0, 19), state };
};
const apps = await occJson('app:list');
const status = JSON.parse((await occ('status', '--output=json')).stdout);
const php = (await docker('exec', 'vcworkspace-work13-nextcloud-1', 'php', '-r', 'echo PHP_VERSION;')).stdout.trim();
const containers = {};
for (const name of ['vcworkspace-work13-nextcloud-1', 'vcworkspace-work13-nc-db-1', 'vcworkspace-work13-redis-1', 'vcworkspace-work13-hook-sink-1', 'vcworkspace-work13-nextcloud-loopback-relay-1']) containers[name] = await inspect(name);
const chrome = (await import('node:child_process')).execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version']).toString().trim();
await writeEvidence('environment.json', {
  nextcloud: { version: status.versionstring, edition: status.edition || 'community', php },
  apps: Object.fromEntries(['spreed', 'calendar', 'contacts', 'notifications', 'activity', 'files_sharing', 'user_oidc', 'webhook_listeners'].map((a) => [a, apps.enabled[a] ?? apps.disabled[a] ?? 'MISSING'])),
  browserForWebRTC: chrome,
  node: process.version,
  containers,
});
console.log(JSON.stringify({ nextcloud: status.versionstring, spreed: apps.enabled.spreed, php, chrome }));
