// Readback that the restore target is a separate instance with the same
// Nextcloud/app versions and the same immutable account IDs.
import { execFileAsync, personas, readEvidence, writeEvidence } from './lib.mjs';

const restore = 'vcworkspace-work13-restore-restore-nextcloud-1';
const occ = async (...args) => (await execFileAsync('docker', ['exec', '-u', 'www-data', restore, 'php', 'occ', '--no-ansi', '--no-interaction', ...args], { maxBuffer: 20 * 1024 * 1024 })).stdout;
const source = await readEvidence('nextcloud-config.json');
const status = JSON.parse(await occ('status', '--output=json'));
const apps = JSON.parse(await occ('app:list', '--output=json')).enabled;
const drift = Object.entries(source.apps).filter(([app, version]) => apps[app] !== version).map(([app]) => app);
if (status.versionstring !== source.nextcloud || drift.length) throw new Error(`RESTORE_VERSION_DRIFT:${status.versionstring}:${drift.join(',')}`);
const users = JSON.parse(await occ('user:list', '--output=json'));
const missing = Object.values(await personas()).filter((binding) => !(binding.nextcloudUserId in users)).map((binding) => binding.username);
if (missing.length) throw new Error(`RESTORE_USERS_MISSING:${missing.join(',')}`);
const { stdout: networks } = await execFileAsync('docker', ['inspect', restore, '--format', '{{json .NetworkSettings.Networks}}']);
const backup = await readEvidence('backup.json');
await writeEvidence('restore-readback.json', {
  restoreContainer: restore,
  restoreNetworks: Object.keys(JSON.parse(networks)),
  nextcloud: status.versionstring,
  maintenance: status.maintenance,
  appsMatchSource: true,
  personasPresentById: Object.keys(await personas()).length,
  backupChecksums: backup.checksums,
  aclReadback: 'verify-acl-restore.json',
  notTested: ['Authentik restore and OIDC browser login on the restored instance'],
  result: 'LOCAL PASS',
});
console.log(`Restore readback PASS: ${status.versionstring}, apps match, ${Object.keys(await personas()).length} personas present by immutable ID.`);
