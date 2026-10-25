// Chat16: point the work13 Nextcloud's outgoing mail at the isolated chat16
// Stalwart (mail16, internal network only) so iMIP invitations reach local test
// mailboxes, and pin the DAV settings this PoC relies on. The SMTP password is
// passed through `occ config:import` on stdin (never argv, never printed).
// Only occ is used (no DB/data-directory writes).
import { spawn } from 'node:child_process';
import { ncContainer, occ, secret, writeEvidence } from './lib.mjs';
import { mailSecretName } from './mail-lib.mjs';

const sender = 'calendar@vcworkspace.test';
const system = {
  mail_smtpmode: 'smtp',
  mail_smtphost: 'mail16',
  mail_smtpport: 465,
  mail_smtpsecure: 'ssl',
  mail_smtpauth: true,
  mail_smtpname: sender,
  mail_smtppassword: await secret(mailSecretName(sender)),
  mail_from_address: 'calendar',
  mail_domain: 'vcworkspace.test',
  mail_smtptimeout: 20,
  // Local self-signed Stalwart certificate only (chat07 pattern); production must verify TLS.
  mail_smtpstreamoptions: { ssl: { verify_peer: false, verify_peer_name: false, allow_self_signed: true } },
};
await new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-ansi', '--no-interaction', 'config:import'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  child.stdout.on('data', () => {});
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`CONFIG_IMPORT_FAILED:${code}:${err.slice(0, 300)}`))));
  child.stdin.end(JSON.stringify({ system }));
});
// DAV app settings used by the acceptance (explicit, so restore/readback can compare).
const davSettings = {
  sendInvitations: 'yes',
  generateBirthdayCalendar: 'no',
  system_addressbook_exposed: 'yes',
};
for (const [key, value] of Object.entries(davSettings)) await occ('config:app:set', 'dav', key, `--value=${value}`);
const readback = {};
for (const key of Object.keys(system)) {
  const { stdout } = await occ('config:system:get', key).catch(() => ({ stdout: '<unset>' }));
  readback[key] = key === 'mail_smtppassword' ? (stdout.trim() ? 'SET (not printed)' : 'MISSING') : stdout.trim();
}
const dav = {};
for (const key of Object.keys(davSettings)) dav[key] = (await occ('config:app:get', 'dav', key)).stdout.trim();
const sharing = {};
for (const key of ['shareapi_only_share_with_group_members', 'shareapi_restrict_user_enumeration_to_group', 'shareapi_allow_share_dialog_user_enumeration', 'shareapi_restrict_user_enumeration_full_match', 'shareapi_allow_links']) {
  sharing[key] = (await occ('config:app:get', 'core', key).catch(() => ({ stdout: '<unset>' }))).stdout.trim() || '<unset>';
}
await writeEvidence('nextcloud-config.json', { mail: readback, dav, sharing });
console.log(JSON.stringify({ mail: readback, dav, sharing }, null, 1));
