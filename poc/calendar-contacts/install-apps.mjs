// Chat16: install Calendar, Contacts and calendar_resource_management pinned by
// preflight-app-metadata.mjs into the work13 Nextcloud. App Store downloads only
// with CAL16_ALLOW_APP_DOWNLOADS=1, through a temporary egress attachment that is
// always removed in `finally` (chat13/14 pattern). `occ app:install` verifies the
// App Store signature; integrity:check-app is recorded afterwards.
import { docker, ncContainer, occJson, occ, readEvidence, writeEvidence } from './lib.mjs';

const preflight = await readEvidence('app-metadata-preflight.json');
const pinned = Object.fromEntries(preflight.apps.filter((a) => a.listed).map((a) => [a.id, a.stableVersion]));
const storeApps = ['calendar', 'contacts', 'calendar_resource_management'];
const appList = () => occJson('app:list');

let listing = await appList();
const missing = storeApps.filter((app) => !(app in listing.enabled) && !(app in listing.disabled));
if (missing.length) {
  if (process.env.CAL16_ALLOW_APP_DOWNLOADS !== '1') throw new Error(`APPS_MISSING:${missing.join(',')}: set CAL16_ALLOW_APP_DOWNLOADS=1 for explicit bootstrap only`);
  await docker('network', 'connect', 'vcworkspace-work13_host_edge', ncContainer);
  try {
    for (const app of missing) await occ('app:install', '--keep-disabled', app);
  } finally {
    await docker('network', 'disconnect', 'vcworkspace-work13_host_edge', ncContainer);
  }
  listing = await appList();
}
const installed = Object.fromEntries(Object.entries({ ...listing.enabled, ...listing.disabled }).map(([app, version]) => [app, String(version).split(' ')[0]]));
for (const app of storeApps) {
  if (installed[app] !== pinned[app]) throw new Error(`APP_VERSION_DRIFT:${app}:installed=${installed[app]}:pinned=${pinned[app]}`);
}
for (const app of storeApps) if (!(app in listing.enabled)) await occ('app:enable', app);
const integrity = {};
for (const app of storeApps) {
  const { stdout } = await occ('integrity:check-app', '--output=json', app);
  integrity[app] = stdout.trim() === '[]' || stdout.trim() === '' ? 'PASS' : JSON.parse(stdout);
}
// Egress must be gone again.
const { stdout: networks } = await docker('inspect', ncContainer, '--format', '{{json .NetworkSettings.Networks}}');
const attached = Object.keys(JSON.parse(networks));
if (attached.some((n) => n.includes('host_edge'))) throw new Error('EGRESS_STILL_ATTACHED');
listing = await appList();
await writeEvidence('apps.json', {
  apps: Object.fromEntries(['dav', 'contactsinteraction', ...storeApps].map((app) => [app, listing.enabled[app] ?? 'DISABLED'])),
  pinnedFromPreflight: Object.fromEntries(storeApps.map((app) => [app, pinned[app]])),
  integrity,
  nextcloudNetworksAfterInstall: attached,
});
console.log(`Apps: ${storeApps.map((app) => `${app} ${listing.enabled[app]}`).join(', ')}; integrity ${JSON.stringify(integrity)}`);
