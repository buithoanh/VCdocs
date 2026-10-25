// Reconcile Nextcloud 33.0.10 for chat 13: OIDC login, audit log and the five
// Work management apps pinned to the versions recorded in
// evidence/app-metadata-preflight.json. Store downloads only happen with
// WORK13_ALLOW_APP_DOWNLOADS=1, through a temporary egress attachment that is
// always removed in `finally`.
import { createHash } from 'node:crypto';
import { execFileAsync, ncContainer, occ, readEvidence, writeEvidence } from './lib.mjs';

const preflight = await readEvidence('app-metadata-preflight.json');
const pinned = Object.fromEntries(preflight.apps.map((app) => [app.id, app.stableVersion]));
const storeApps = ['user_oidc', 'deck', 'notes', 'forms', 'tables', 'collectives'];
const bundledApps = ['admin_audit', 'circles', 'text', 'comments', 'activity', 'webhook_listeners'];

const appList = async () => JSON.parse((await occ('app:list', '--output=json')).stdout);
let listing = await appList();
const missing = storeApps.filter((app) => !(app in listing.enabled) && !(app in listing.disabled));
if (missing.length) {
  if (process.env.WORK13_ALLOW_APP_DOWNLOADS !== '1') throw new Error(`APPS_MISSING:${missing.join(',')}: set WORK13_ALLOW_APP_DOWNLOADS=1 for explicit bootstrap only`);
  await execFileAsync('docker', ['network', 'connect', 'vcworkspace-work13_host_edge', ncContainer]);
  try {
    for (const app of missing) await occ('app:install', '--keep-disabled', app);
  } finally {
    await execFileAsync('docker', ['network', 'disconnect', 'vcworkspace-work13_host_edge', ncContainer]);
  }
  listing = await appList();
}
// app:list prints disabled apps as "<version> (installed <version>)".
const installed = Object.fromEntries(Object.entries({ ...listing.enabled, ...listing.disabled }).map(([app, version]) => [app, String(version).split(' ')[0]]));
for (const app of storeApps) {
  if (installed[app] !== pinned[app]) throw new Error(`APP_VERSION_DRIFT:${app}:installed=${installed[app]}:pinned=${pinned[app]}`);
}
for (const app of [...bundledApps, ...storeApps]) {
  if (!(app in listing.enabled)) await occ('app:enable', app);
}
const integrity = {};
for (const app of storeApps) {
  const { stdout } = await occ('integrity:check-app', '--output=json', app);
  integrity[app] = stdout.trim() === '[]' || stdout.trim() === '' ? 'PASS' : JSON.parse(stdout);
}

// The first-run wizard overlays every page for new OIDC accounts and hides the
// UI under test in screenshots.
if ('firstrunwizard' in listing.enabled) await occ('app:disable', 'firstrunwizard');
await occ('config:system:set', 'trusted_domains', '2', '--value=nc13.localtest.me');
await occ('config:system:set', 'overwrite.cli.url', '--value=http://nc13.localtest.me:18130');
await occ('background:cron');
// Loopback-only PoC without TLS: user_oidc refuses HTTP discovery unless this
// app-level exception is set, and the IdP lives on the internal Docker network.
// Never carry either exception outside this local PoC.
await occ('config:app:set', 'user_oidc', 'allow_insecure_http', '--value=1', '--type=boolean');
await occ('config:system:set', 'allow_local_remote_servers', '--value=true', '--type=boolean');
await occ('config:system:set', 'log_type_audit', '--value=file');
await occ('config:system:set', 'logfile_audit', '--value=/var/www/html/data/audit.log');
await occ('user_oidc:provider', 'authentik',
  '--clientid=nextcloud-work13', '--clientsecret-file=/run/secrets/oidc_nc_client_secret',
  '--discoveryuri=http://ak13.localtest.me:18131/application/o/nextcloud-work13/.well-known/openid-configuration',
  '--endsessionendpointuri=http://ak13.localtest.me:18131/application/o/nextcloud-work13/end-session/',
  '--postlogouturi=http://nc13.localtest.me:18130/login', '--scope=openid email profile',
  '--unique-uid=1', '--check-bearer=0', '--bearer-provisioning=0', '--send-id-token-hint=1',
  '--mapping-display-name=name', '--mapping-email=email', '--mapping-uid=sub', '--mapping-groups=groups',
  '--group-provisioning=1', '--group-whitelist-regex=^(vcw-|[0-9a-f]{64}$)');
// Only admins may create shares to arbitrary users; restrict sharing to group
// members so an outsider cannot even be offered as a share target.
await occ('config:app:set', 'core', 'shareapi_only_share_with_group_members', '--value=yes');
await occ('config:app:set', 'core', 'shareapi_allow_links', '--value=no');

const providers = JSON.parse((await occ('user_oidc:provider', '--output=json')).stdout);
const providerId = (Array.isArray(providers) ? providers : Object.values(providers)).find((item) => item.identifier === 'authentik')?.id;
const federatedGroups = Object.fromEntries(['vcw-team-a', 'vcw-team-b', 'vcw-outsiders'].map((name) => [name, createHash('sha256').update(`${providerId}_0_${name}`).digest('hex')]));
const status = JSON.parse((await occ('status', '--output=json')).stdout);
listing = await appList();
await writeEvidence('nextcloud-config.json', {
  nextcloud: status.versionstring,
  apps: Object.fromEntries([...storeApps, ...bundledApps].map((app) => [app, listing.enabled[app] ?? 'DISABLED'])),
  pinnedFromPreflight: Object.fromEntries(storeApps.map((app) => [app, pinned[app]])),
  integrity,
  oidcProviderId: providerId,
  federatedGroups,
  sharing: { onlyShareWithGroupMembers: true, publicLinks: false },
  localOnlyExceptions: ['user_oidc.allow_insecure_http', 'allow_local_remote_servers'],
});
console.log(`Nextcloud ${status.versionstring} reconciled: ${storeApps.length} store apps at pinned versions, integrity ${JSON.stringify(integrity)}; no secret printed.`);
