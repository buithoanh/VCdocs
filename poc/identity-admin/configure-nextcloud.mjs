import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const container = 'vcworkspace-identity12-nextcloud-1';
const occ = (...args) => execFileAsync('docker', ['exec', '-u', 'www-data', container, 'php', 'occ', '--no-ansi', '--no-interaction', ...args], { maxBuffer: 10 * 1024 * 1024 });

async function appList() {
  return JSON.parse((await occ('app:list', '--output=json')).stdout);
}
async function ensureApp(app) {
  let listing = await appList();
  if (app in listing.enabled) return;
  if (!(app in listing.disabled)) {
    if (process.env.IDENTITY12_ALLOW_APP_DOWNLOADS !== '1') throw new Error(`APP_${app}_MISSING: set IDENTITY12_ALLOW_APP_DOWNLOADS=1 for explicit bootstrap only`);
    await execFileAsync('docker', ['network', 'connect', 'vcworkspace-identity12_host_edge', container]);
    try { await occ('app:install', app); } finally { await execFileAsync('docker', ['network', 'disconnect', 'vcworkspace-identity12_host_edge', container]); }
    listing = await appList();
  }
  if (!(app in listing.enabled)) await occ('app:enable', app);
}

for (const app of ['admin_audit', 'groupfolders', 'user_oidc']) await ensureApp(app);
await occ('config:system:set', 'trusted_domains', '2', '--value=nextcloud.localtest.me');
// The Chat 12 loopback-only PoC intentionally has no TLS terminator. user_oidc
// otherwise refuses to start the browser flow over HTTP. Never carry this
// app-level exception into a non-local environment.
await occ('config:app:set', 'user_oidc', 'allow_insecure_http', '--value=1', '--type=boolean');
// Discovery and token exchange target the Authentik service on the isolated
// Docker network. Nextcloud blocks local-address HTTP clients by default, so
// this exception is also local-PoC-only.
await occ('config:system:set', 'allow_local_remote_servers', '--value=true', '--type=boolean');
await occ('config:system:set', 'log_type_audit', '--value=file');
await occ('config:system:set', 'logfile_audit', '--value=/var/www/html/data/audit.log');
await occ('config:system:set', 'log.condition', '--type=json', '--value={"apps":["admin_audit"]}');
await occ('user_oidc:provider', 'authentik',
  '--clientid=nextcloud-33-test', '--clientsecret-file=/run/secrets/oidc_nc_client_secret',
  '--discoveryuri=http://authentik.localtest.me:18121/application/o/nextcloud-33-test/.well-known/openid-configuration',
  '--endsessionendpointuri=http://authentik.localtest.me:18121/application/o/nextcloud-33-test/end-session/',
  '--postlogouturi=http://nextcloud.localtest.me:18120/login', '--scope=openid email profile offline_access',
  '--unique-uid=1', '--check-bearer=1', '--bearer-provisioning=0', '--send-id-token-hint=1',
  '--mapping-display-name=name', '--mapping-email=email', '--mapping-uid=sub', '--mapping-groups=groups',
  // Import only vcw-* claims, and also match their 64-hex unique-uid form so
  // groups removed upstream are actually removed during the next login.
  '--group-provisioning=1', '--group-whitelist-regex=^(vcw-|[0-9a-f]{64}$)');
const managedGroups = ['vcw-admins', 'vcw-team-a', 'vcw-outsiders-b'];
for (const group of managedGroups) {
  try { await occ('group:add', group); } catch (error) { if (!`${error.stdout || ''}${error.stderr || ''}`.includes('already exists')) throw error; }
}
// user_oidc unique-uid namespaces group IDs with sha256("<provider>_0_<gid>").
// Bind Team A to that real federated group as well as the local lifecycle-test
// group; the display name remains vcw-team-a after the first OIDC login.
const oidcTeamAGroup = createHash('sha256').update('1_0_vcw-team-a').digest('hex');
for (const group of managedGroups.map((name) => createHash('sha256').update(`1_0_${name}`).digest('hex'))) {
  try { await occ('group:add', group); } catch (error) { if (!`${error.stdout || ''}${error.stderr || ''}`.includes('already exists')) throw error; }
}
const folders = JSON.parse((await occ('groupfolders:list', '--output=json')).stdout);
let teamA = folders.find((value) => value.mountPoint === 'Team A')?.id;
if (!teamA) {
  const created = await occ('groupfolders:create', 'Team A');
  teamA = created.stdout.match(/(\d+)/)?.[1];
}
if (!teamA) throw new Error('TEAM_FOLDER_ID_MISSING');
await occ('groupfolders:group', teamA, 'vcw-team-a', 'read', 'write');
await occ('groupfolders:group', teamA, oidcTeamAGroup, 'read', 'write');
console.log(`Nextcloud configuration reconciled: 3 apps, strict local OIDC, audit, groups and Team A folder ${teamA}; no secret printed.`);
