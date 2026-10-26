// Chat19: install Assistant + integration_openai pinned by
// preflight-app-metadata.mjs into the work13 Nextcloud. App Store download only
// with AI19_ALLOW_APP_DOWNLOADS=1, through a temporary egress attachment
// (host_edge) that is always removed in `finally` (chat13/14/16/17 pattern).
// chat17 set has_internet_connection=false (no STUN fallback), which also
// disables the App Store fetcher, so it is flipped to true only for the install
// and restored in the same `finally`. `occ app:install` verifies the App Store
// signature; integrity:check-app is recorded afterwards.
import { docker, ncContainer, occ, occJson, readEvidence, writeEvidence } from './lib.mjs';

const preflight = await readEvidence('app-metadata-preflight.json');
const pins = Object.fromEntries(preflight.install.map((id) => [id, preflight.apps.find((a) => a.id === id).stableVersion]));
let listing = await occJson('app:list');
const missing = Object.keys(pins).filter((id) => !(id in listing.enabled) && !(id in listing.disabled));
let egressMs = null;
if (missing.length) {
  if (process.env.AI19_ALLOW_APP_DOWNLOADS !== '1') throw new Error(`APPS_MISSING:${missing.join(',')}: set AI19_ALLOW_APP_DOWNLOADS=1 for explicit bootstrap only`);
  const before = (await occ('config:system:get', 'has_internet_connection')).stdout.trim();
  const t0 = Date.now();
  await docker('network', 'connect', 'vcworkspace-work13_host_edge', ncContainer);
  try {
    await occ('config:system:set', 'has_internet_connection', '--type=boolean', '--value=true');
    for (const id of missing) await occ('app:install', '--keep-disabled', id);
  } finally {
    await occ('config:system:set', 'has_internet_connection', '--type=boolean', `--value=${before === 'true' ? 'true' : 'false'}`);
    await docker('network', 'disconnect', 'vcworkspace-work13_host_edge', ncContainer);
    egressMs = Date.now() - t0;
  }
  listing = await occJson('app:list');
}
const versions = {};
for (const [id, pinned] of Object.entries(pins)) {
  const installed = String(listing.enabled[id] ?? listing.disabled[id]).split(' ')[0];
  if (installed !== pinned) throw new Error(`APP_VERSION_DRIFT:${id}:installed=${installed}:pinned=${pinned}`);
  if (!(id in listing.enabled)) await occ('app:enable', id);
  versions[id] = installed;
}
const integrity = {};
for (const id of Object.keys(pins)) {
  const { stdout } = await occ('integrity:check-app', '--output=json', id);
  integrity[id] = stdout.trim() === '[]' || stdout.trim() === '' ? 'PASS' : JSON.parse(stdout);
}
const { stdout: networks } = await docker('inspect', ncContainer, '--format', '{{json .NetworkSettings.Networks}}');
const attached = Object.keys(JSON.parse(networks));
if (attached.some((n) => n.includes('host_edge'))) throw new Error('EGRESS_STILL_ATTACHED');
const internet = (await occ('config:system:get', 'has_internet_connection')).stdout.trim();
if (internet !== 'false') throw new Error(`HAS_INTERNET_NOT_RESTORED:${internet}`);
listing = await occJson('app:list');
await writeEvidence('apps.json', {
  apps: Object.fromEntries(['assistant', 'integration_openai', 'context_chat', 'context_agent', 'app_api', 'admin_audit', 'spreed', 'notes', 'deck', 'collectives', 'text', 'mail'].map((app) => [app, listing.enabled[app] ?? (listing.disabled[app] ? `DISABLED ${listing.disabled[app]}` : 'NOT_INSTALLED')])),
  pinnedFromPreflight: pins,
  installedVersions: versions,
  integrity,
  egressAttachedMs: egressMs,
  hasInternetConnectionAfter: internet,
  nextcloudNetworksAfterInstall: attached,
});
console.log(`${JSON.stringify(versions)}; integrity ${JSON.stringify(integrity)}; egress ${egressMs} ms; networks ${attached.join(',')}; has_internet_connection=${internet}`);
