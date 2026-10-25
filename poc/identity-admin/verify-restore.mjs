import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { api, results, root, secret } from './authentik-api.mjs';

const bindings = JSON.parse(await readFile(join(root, 'evidence', 'identity-bindings.json'), 'utf8')).bindings;
const execFileAsync = promisify(execFile);
const [users, groups, applications] = await Promise.all([
  api('/core/users/?page_size=100'), api('/core/groups/?page_size=100'), api('/core/applications/?page_size=100'),
]);
const restoredUsernames = new Set(results(users).map((item) => item.username));
const restoredGroups = new Set(results(groups).map((item) => item.name));
const restoredApps = new Set(results(applications).map((item) => item.slug));
for (const expected of ['admin12', 'manager-a', 'member-a', 'outsider-b']) if (!restoredUsernames.has(expected)) throw new Error(`RESTORE_AK_USER_${expected}`);
for (const expected of ['vcw-admins', 'vcw-team-a', 'vcw-outsiders-b']) if (!restoredGroups.has(expected)) throw new Error(`RESTORE_AK_GROUP_${expected}`);
for (const expected of ['vcworkspace-portal-test', 'nextcloud-33-test']) if (!restoredApps.has(expected)) throw new Error(`RESTORE_AK_APP_${expected}`);

const adminPassword = await secret('nc_admin_password');
for (const binding of bindings) {
  const response = await fetch(`http://localhost:18123/ocs/v1.php/cloud/users/${encodeURIComponent(binding.subject)}?format=json`, {
    headers: { Authorization: `Basic ${Buffer.from(`admin12:${adminPassword}`).toString('base64')}`, 'OCS-APIRequest': 'true' },
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  if (![100, 200].includes(payload?.ocs?.meta?.statuscode) || payload?.ocs?.data?.id !== binding.subject) throw new Error(`RESTORE_NC_BINDING_${binding.username}`);
}
const statusResponse = await fetch('http://localhost:18123/status.php', { signal: AbortSignal.timeout(5000) });
const nextcloudStatus = await statusResponse.json();
if (!statusResponse.ok || nextcloudStatus.versionstring !== '33.0.10') throw new Error(`RESTORE_NC_VERSION_${nextcloudStatus.versionstring}`);
const expectedUsers = results(users).filter((item) => ['admin12', 'manager-a', 'member-a', 'outsider-b'].includes(item.username));
const expectedGroups = results(groups).filter((item) => ['vcw-admins', 'vcw-team-a', 'vcw-outsiders-b'].includes(item.name));
const expectedApps = results(applications).filter((item) => ['vcworkspace-portal-test', 'nextcloud-33-test'].includes(item.slug));
const { stdout: inspectText } = await execFileAsync('docker', ['inspect', 'vcworkspace-identity12-restore-restore-nextcloud-1', 'vcworkspace-identity12-restore-restore-authentik-1', '--format', '{{.Name}}|{{.Config.Image}}|{{.Id}}']);
const containers = inspectText.trim().split('\n').map((line) => {
  const [name, configuredImage, imageId] = line.split('|');
  return { name, configuredImage, imageId };
});
const backupChecksums = {};
for (const name of ['nextcloud.dump', 'authentik.dump', 'nextcloud-html.tgz']) {
  const content = await readFile(join(root, 'backup', name));
  backupChecksums[name] = createHash('sha256').update(content).digest('hex');
}
const { stdout: appsText } = await execFileAsync('docker', ['exec', '-u', 'www-data', 'vcworkspace-identity12-restore-restore-nextcloud-1', 'php', 'occ', 'app:list', '--output=json']);
const enabledApps = JSON.parse(appsText).enabled;
for (const app of ['admin_audit', 'groupfolders', 'user_oidc']) if (!(app in enabledApps)) throw new Error(`RESTORE_NC_APP_${app}`);
const occJson = async (...args) => JSON.parse((await execFileAsync('docker', ['exec', '-u', 'www-data', 'vcworkspace-identity12-restore-restore-nextcloud-1', 'php', 'occ', '--no-ansi', '--no-interaction', ...args])).stdout);
const restoredProviders = await occJson('user_oidc:providers');
const restoredFolders = await occJson('groupfolders:list', '--output=json');
const oidcTeamAGroup = createHash('sha256').update('1_0_vcw-team-a').digest('hex');
const restoredProvider = Array.isArray(restoredProviders) ? restoredProviders.find((provider) => provider.identifier === 'authentik') : restoredProviders;
const restoredTeamA = restoredFolders.find((folder) => folder.mountPoint === 'Team A');
if (restoredProvider?.settings?.groupWhitelistRegex !== '^(vcw-|[0-9a-f]{64}$)') throw new Error('RESTORE_OIDC_GROUP_REMOVAL_REGEX');
if (!restoredTeamA?.groups?.[oidcTeamAGroup]) throw new Error('RESTORE_TEAM_A_FEDERATED_GROUP_BINDING');
const evidence = {
  generatedAt: new Date().toISOString(),
  authentik: { users: expectedUsers.length, groups: expectedGroups.length, applications: expectedApps.length },
  nextcloud: { version: nextcloudStatus.versionstring, installed: nextcloudStatus.installed, maintenance: nextcloudStatus.maintenance, enabledApps: ['admin_audit', 'groupfolders', 'user_oidc'], oidcGroupRemovalRegex: restoredProvider.settings.groupWhitelistRegex, teamAFederatedGroupBound: true },
  nextcloudBindings: bindings.length,
  containers,
  backupChecksums,
  sourcePorts: { nextcloud: 18120, authentik: 18121 },
  restorePorts: { nextcloud: 18123, authentik: 18124 },
  distinctRuntime: true,
  secretsIncluded: false,
};
await writeFile(join(root, 'evidence', 'restore-readback.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('Restore readback PASS: Authentik 4 personas/3 groups/2 apps and Nextcloud 4 immutable bindings via APIs.');
