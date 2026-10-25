// Chat17: install Talk (spreed) pinned by preflight-app-metadata.mjs into the
// work13 Nextcloud. App Store download only with TALK17_ALLOW_APP_DOWNLOADS=1,
// through a temporary egress attachment (host_edge) that is always removed in
// `finally` (chat13/14/16 pattern). `occ app:install` verifies the App Store
// signature; integrity:check-app is recorded afterwards.
import { docker, ncContainer, occ, occJson, readEvidence, writeEvidence } from './lib.mjs';

const preflight = await readEvidence('app-metadata-preflight.json');
const pinned = preflight.apps.find((a) => a.id === 'spreed').stableVersion;
let listing = await occJson('app:list');
const present = 'spreed' in listing.enabled || 'spreed' in listing.disabled;
let egressMs = null;
if (!present) {
  if (process.env.TALK17_ALLOW_APP_DOWNLOADS !== '1') throw new Error('SPREED_MISSING: set TALK17_ALLOW_APP_DOWNLOADS=1 for explicit bootstrap only');
  const t0 = Date.now();
  await docker('network', 'connect', 'vcworkspace-work13_host_edge', ncContainer);
  try {
    await occ('app:install', '--keep-disabled', 'spreed');
  } finally {
    await docker('network', 'disconnect', 'vcworkspace-work13_host_edge', ncContainer);
    egressMs = Date.now() - t0;
  }
  listing = await occJson('app:list');
}
const installed = String(listing.enabled.spreed ?? listing.disabled.spreed).split(' ')[0];
if (installed !== pinned) throw new Error(`APP_VERSION_DRIFT:spreed:installed=${installed}:pinned=${pinned}`);
if (!('spreed' in listing.enabled)) await occ('app:enable', 'spreed');
const { stdout } = await occ('integrity:check-app', '--output=json', 'spreed');
const integrity = stdout.trim() === '[]' || stdout.trim() === '' ? 'PASS' : JSON.parse(stdout);
const { stdout: networks } = await docker('inspect', ncContainer, '--format', '{{json .NetworkSettings.Networks}}');
const attached = Object.keys(JSON.parse(networks));
if (attached.some((n) => n.includes('host_edge'))) throw new Error('EGRESS_STILL_ATTACHED');
listing = await occJson('app:list');
await writeEvidence('apps.json', {
  apps: Object.fromEntries(['spreed', 'calendar', 'contacts', 'notifications', 'activity', 'webhook_listeners', 'files_sharing'].map((app) => [app, listing.enabled[app] ?? 'DISABLED'])),
  pinnedFromPreflight: { spreed: pinned },
  integrity: { spreed: integrity },
  egressAttachedMs: egressMs,
  nextcloudNetworksAfterInstall: attached,
});
console.log(`spreed ${listing.enabled.spreed}; integrity ${JSON.stringify(integrity)}; egress ${egressMs} ms; networks ${attached.join(',')}`);
