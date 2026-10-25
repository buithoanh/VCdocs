// Chat14: install the Flow apps pinned by preflight-flow-apps.mjs into the
// work13 Nextcloud. Store downloads only with FLOW14_ALLOW_APP_DOWNLOADS=1,
// through a temporary egress attachment that is always removed in `finally`
// (same pattern as chat13 configure-nextcloud.mjs). workflow_script is NOT
// installed: no arbitrary shell from Flow.
import { execFileAsync, ncContainer, occ, readEvidence, writeEvidence } from './lib.mjs';

const preflight = await readEvidence('flow-app-preflight.json');
const pinned = Object.fromEntries(preflight.apps.filter((app) => app.listed).map((app) => [app.id, app.stableVersion]));
const storeApps = ['forms_deck', 'files_automatedtagging', 'files_accesscontrol'];
const appList = async () => JSON.parse((await occ('app:list', '--output=json')).stdout);

let listing = await appList();
const missing = storeApps.filter((app) => !(app in listing.enabled) && !(app in listing.disabled));
if (missing.length) {
  if (process.env.FLOW14_ALLOW_APP_DOWNLOADS !== '1') throw new Error(`APPS_MISSING:${missing.join(',')}: set FLOW14_ALLOW_APP_DOWNLOADS=1 for explicit bootstrap only`);
  await execFileAsync('docker', ['network', 'connect', 'vcworkspace-work13_host_edge', ncContainer]);
  try {
    for (const app of missing) await occ('app:install', '--keep-disabled', app);
  } finally {
    await execFileAsync('docker', ['network', 'disconnect', 'vcworkspace-work13_host_edge', ncContainer]);
  }
  listing = await appList();
}
const installed = Object.fromEntries(Object.entries({ ...listing.enabled, ...listing.disabled }).map(([app, version]) => [app, String(version).split(' ')[0]]));
for (const app of storeApps) {
  if (installed[app] !== pinned[app]) throw new Error(`APP_VERSION_DRIFT:${app}:installed=${installed[app]}:pinned=${pinned[app]}`);
}
for (const app of ['workflowengine', 'systemtags', ...storeApps]) {
  if (!(app in listing.enabled)) await occ('app:enable', app);
}
if ('workflow_script' in listing.enabled) throw new Error('WORKFLOW_SCRIPT_MUST_NOT_BE_ENABLED');
const integrity = {};
for (const app of storeApps) {
  const { stdout } = await occ('integrity:check-app', '--output=json', app);
  integrity[app] = stdout.trim() === '[]' || stdout.trim() === '' ? 'PASS' : JSON.parse(stdout);
}
listing = await appList();
await writeEvidence('flow-apps.json', {
  apps: Object.fromEntries(['workflowengine', 'webhook_listeners', 'systemtags', ...storeApps].map((app) => [app, listing.enabled[app] ?? 'DISABLED'])),
  pinnedFromPreflight: Object.fromEntries(storeApps.map((app) => [app, pinned[app]])),
  integrity,
  workflowScript: 'workflow_script' in listing.enabled || 'workflow_script' in listing.disabled ? 'INSTALLED' : 'NOT_INSTALLED',
  deprecated: { externalAppFlow: 'không dùng', windmill: 'không dùng' },
});
console.log(`Flow apps: ${storeApps.map((app) => `${app} ${listing.enabled[app]}`).join(', ')}; integrity ${JSON.stringify(integrity)}`);
